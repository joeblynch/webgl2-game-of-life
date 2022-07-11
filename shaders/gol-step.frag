#version 300 es
precision mediump float;
precision mediump int;
precision mediump isampler2D;
precision mediump usampler2D;

// generation is input to determine horizon distance
uniform int u_generation;

// input user configurable multipliers for saturation and lightness of on and off cells
uniform float u_saturation_on;
uniform float u_saturation_off;
uniform float u_lightness_on;
uniform float u_lightness_off;

// after the universe ends, it fades out to black. this multiplier is used to reduce cell saturation and lightness
uniform float u_existence;

// the universe state, each texture pixel is a cell. red: on/off state bit, green/blue: x/y vector of cell's hue angle
uniform isampler2D u_state;

// the last 32 on/off states of each cell are remembered, to detect oscillators of up to 16P
uniform usampler2D u_history;

// entire universe soup for initial cell state is in this texture, and injected at the outer edge of the horizon
uniform isampler2D u_entropy;

// count how many times oscillators have oscillated, for the most common periods.
// this allows us to detect "active" cells (non-oscillators), and when no active cells remain, the end of the universe
uniform usampler2D u_osc_count_1;
uniform usampler2D u_osc_count_2;

// output the next cell state, and the new state of the cell's history and oscillator counts
layout(location=0) out ivec4 cell_out;
layout(location=1) out uvec4 history_out;
layout(location=2) out uvec4 osc_count_out_1;
layout(location=3) out vec4 cell_color_out;
layout(location=4) out uvec4 osc_count_out_2;
layout(location=5) out uvec2 min_osc_count;

// set a lower bound on the number of oscillation repetitions, before a cell is has its saturation and lightness
// modified. this prevents short bursts of random oscillations from being highlighted or dimmed
const uint MIN_OSC_LEN = uint(8);

// multiplier for how fast oscillators spin
const float HUE_SPIN_P_FACTOR = 42.0;

// TODO: adjustable global brightness, and adjustment at each level inc. off

// saturation and lightness config for on cells, based on prior two states
const float SATURATION[4] = float[4](
  0.98, // 001: cell is newly on, after being off for a while. it's "recharged", and at its brightest
  0.71, // 011: cell has been on for a prior tick, and is starting to dim
  0.93, // 101: cell had a bit of time to recharge, but not quite all the way
  0.71  // 111: cell is dimming down to a P1 oscillator (still life)
);

const float LIGHTNESS[4] = float[4](
  0.6,  // 001
  0.46, // 011
  0.51, // 101
  0.26  // 111
);

// saturation and lightness config for oscillators with period 1-4
// TODO: handle P15
const float SATURATION_OSC[5] = float[5](
  0.0,
  0.68,
  0.68,
  1.0,
  1.0
);

const float LIGHTNESS_OSC[5] = float[5](
  0.0,
  0.21,
  0.26,
  0.65,
  0.65
);

const float SATURATION_OFF = 0.40;
const float LIGHTNESS_OFF = 0.04;

// multipliers so that (max saturation/lightness * SATURATION_SCALE * u_saturation_on) == 1 when u_saturation_on == 1
const float SATURATION_ON_SCALE = 1.0 / SATURATION[0];
const float SATURATION_OFF_SCALE = 1.0 / SATURATION_OFF;
const float LIGHTNESS_ON_SCALE = 1.0 / LIGHTNESS[0];
const float LIGHTNESS_OFF_SCALE = 1.0 / LIGHTNESS_OFF;

// most frequent oscillator periods to check for
// NOTE: MUST be in ascending order
const uint OSCILLATOR_PERIODS[5] = uint[5](
  uint(1),
  uint(2),
  uint(3),
  uint(4),
  // uint(8),
  // uint(14),
  uint(15)
);

float hue2rgb(float f1, float f2, float hue);
vec3 hsl2rgb(vec3 hsl);
vec3 hsl2rgb(float h, float s, float l);

const float PI = 3.14159;
const float RAD_TO_DEG = 180.0 / PI;
const float DEG_TO_RAD = PI / 180.0;
const float INV_360 = 1.0 / 360.0;

// max hue spin speed is set to twice the spin of a pentadecatholon
const float MAX_HUE_SPIN = 15.0 * HUE_SPIN_P_FACTOR * 2.0;
const float HUE_SPIN_SCALE = MAX_HUE_SPIN / 127.0;
const float HUE_SPIN_SCALE_INV = 1.0 / HUE_SPIN_SCALE;

// percentage of spin delta applied per generation
const float HUE_SPIN_FRICTION = 0.05;

// percentge of internal spin friction a surving cell has
const float HUE_SPIN_INTERNAL_FRICTION = 0.02;

ivec4 getState(ivec2 coord, ivec2 size) {
  // handle the wrapping of coordinates around the torus manually, to support non-power-of-two sized universes
  ivec2 wrapped = (coord + size) % size;
  return texelFetch(u_state, wrapped, 0);
}

uint getOscCount(uint history, uint p, uint prev_osc_count) {
  // check if the last [p] states match the previous [p] states
  uint mask = uint((1 << p) - 1);
  bool is_match = (history & mask) == ((history >> p) & mask);

  // clamp count at 256 - p, so that for example a P2 isn't seen as a P4 when both hit 255 length
  uint next_increment = min(prev_osc_count + uint(1), uint(256) - p);

  // multiply by is_match, to avoid branching
  return uint(is_match) * next_increment;
}

void main() {
  ivec2 size = textureSize(u_state, 0);
  ivec2 coord = ivec2(gl_FragCoord.xy);
  ivec2 center = size >> 1;
  ivec4 next_cell;
  uvec4 next_history;
  uvec4 next_osc_count_1;
  uvec4 next_osc_count_2;
  uvec2 next_min_osc_count;
  float saturation, lightness;
  ivec2 hue_vec;
  float hue_spin = 0.0;

  // lookup this cell's state as of the last generation
  ivec4 last_cell = texelFetch(u_state, coord, 0);

  // figure out where the "event horizon" is, and where we are relative to it
  // this "universe" starts as a single empty point, surrounded by an event horizon, and expands at the speed of light.
  // we start at a generation -2, just before the universe exists, in order to inject entropy just beyond the horizon
  int horizon_dist = u_generation + 1;
  int entropy_dist = horizon_dist + 1;

  if (
    coord.x > center.x - horizon_dist &&
    coord.x < center.x + horizon_dist &&
    coord.y > center.y - horizon_dist &&
    coord.y < center.y + horizon_dist
  ) {
    // this cell is inside the universe

    /*
    gen -2: universe does not yet exist, event horizon is external and will push a single cell of entropy in.
    gen -1: event horizon is entering as a single point. entropy is injected around that point.
    gen  0: time starts and universe has a size of 1, that point steps forward using the neighboring event horizon.
    */

    // lookup neighbor state
    ivec4 nw = getState(coord + ivec2(-1, -1), size);
    ivec4 n  = getState(coord + ivec2( 0, -1), size);
    ivec4 ne = getState(coord + ivec2( 1, -1), size);
    ivec4 w  = getState(coord + ivec2(-1,  0), size);
    ivec4 e  = getState(coord + ivec2( 1,  0), size);
    ivec4 sw = getState(coord + ivec2(-1,  1), size);
    ivec4 s  = getState(coord + ivec2( 0,  1), size);
    ivec4 se = getState(coord + ivec2( 1,  1), size);

    // lookup own past
    uvec4 last_history = texelFetch(u_history, coord, 0);
    uvec4 last_osc_count_1 = texelFetch(u_osc_count_1, coord, 0);
    uvec4 last_osc_count_2 = texelFetch(u_osc_count_2, coord, 0);

    // standard Game of Life: born when 3 neighbors, survive when 2 or 3 neighbors
    // calculate existence without branching
    int neighbors = nw.r + n.r + ne.r + w.r + e.r + sw.r + s.r + se.r;
    next_cell.r = int(neighbors == 3) | (int(neighbors == 2) & last_cell.r);

    // next_cell.r = int(neighbors == 3) | (int(neighbors >= 1) & (int(neighbors <= 5)) & last_cell.r);
    // next_cell.r = int(neighbors == 3) | (int(neighbors >= 1) & (int(neighbors <= 4)) & last_cell.r);

    // some other interesting variations
    // next_cell.r = int(neighbors == 3) | int(neighbors == 4) | (int(neighbors == 2) & last_cell.r);
    // next_cell.r = int(neighbors == 3) | int(neighbors == 1) | (int(neighbors == 2) & last_cell.r);
    // next_cell.r = int(neighbors == 3) | int(neighbors == 5) | (int(neighbors == 2) & last_cell.r);

    // update history
    next_history.r = last_history.r << 1 | uint(next_cell.r);

    // count oscillators for most frequent periods
    // NOTE: min oscillator search MUST have increasing P value
    next_osc_count_1[0] = getOscCount(next_history.r, OSCILLATOR_PERIODS[0], last_osc_count_1[0]);
    next_osc_count_1[1] = getOscCount(next_history.r, OSCILLATOR_PERIODS[1], last_osc_count_1[1]);
    next_osc_count_1[2] = getOscCount(next_history.r, OSCILLATOR_PERIODS[2], last_osc_count_1[2]);
    next_osc_count_1[3] = getOscCount(next_history.r, OSCILLATOR_PERIODS[3], last_osc_count_1[3]);
    next_osc_count_2[0] = getOscCount(next_history.r, OSCILLATOR_PERIODS[4], last_osc_count_2[0]);

    // find min oscillator period, since a P2 is also P4, a P1 also P2, P3, etc.
    uint max_len = uint(0);
    uint min_p = uint(0);

    for (uint i = uint(0); i < uint(5); i++) {
      uint len = i < uint(4) ? next_osc_count_1[i] : next_osc_count_2[i - uint(4)];
      if (len > max_len && len >= MIN_OSC_LEN) {
        max_len = len;
        min_p = OSCILLATOR_PERIODS[i];
      }
    }

    if (min_p == uint(0)) {
      // this is an active cell. treat active cells as "P0" oscillators, and count them like other oscillators
      next_osc_count_2[3] = last_osc_count_2[3] + uint(1);
      max_len = next_osc_count_2[3];
    } else {
      // cell is an oscillator of a tracked period, reset P0 counter
      next_osc_count_2[3] = uint(0);
    }

    // output the min oscillator period, and its count
    next_min_osc_count.r = min_p;
    next_min_osc_count.g = max_len;

    // determine next and color and spin of the cell
    hue_vec = last_cell.gb;

    float saturation_scale = SATURATION_ON_SCALE * u_saturation_on;
    float lightness_scale = LIGHTNESS_ON_SCALE * u_lightness_on;


/*
  let spin = getSpin(x, y);

  const deltaExternal = NEIGHBORS.reduce((acc, [dx, dy]) => {
    const nSpin = getSpin(x + dx, y + dy);
    const nAlive = getAlive(x + dx, y + dy);
    return acc + (nAlive * (nSpin - spin) * SINGLE_FRICTION);
  }, 0);

  spin += deltaExternal * DELTA_APPLY;

  if (p > 0) {
    const target = (p - 1) * OSC_SPIN_SCALE;
    const deltaTarget = target - spin;

    spin += deltaTarget * DELTA_APPLY;
  }
*/

    if (next_cell.r == 1) {
      // cell is alive
      if ((last_history.r & uint(1)) == uint(0)) {
        // cell is newly on, so it inherits its color from its three parents
        // calculate new hue vector by summing hue vectors of alive neighbors
        hue_vec = ivec2(normalize(vec2(
          nw.r * nw.gb + n.r * n.gb + ne.r * ne.gb +
          w.r  *  w.gb +               e.r *  e.gb +
          sw.r * sw.gb + s.r * s.gb + se.r * se.gb
        )) * 127.0);

        // newly born cells start with a spin that is the average of their parents
        hue_spin = float(
          nw.a + n.a + ne.a +
          w.a  +        e.a +
          sw.a + s.a + se.a
        ) * HUE_SPIN_SCALE_INV / float(neighbors);
      } else {
        // surviving cells maintain their spin across generations, but with some friction
        hue_spin = float(last_cell.a) * HUE_SPIN_SCALE_INV * (1.0 - HUE_SPIN_INTERNAL_FRICTION);
      }

      // share spin with neighbors, due to friction
      int spin_int = int(hue_spin * HUE_SPIN_SCALE);
      float delta_external = float(
        nw.r * (nw.a - spin_int) + n.r * (n.a - spin_int) + ne.r * (ne.a - spin_int) +
        w.r  * (w.a  - spin_int) +                           e.r *  (e.a - spin_int) +
        sw.r * (sw.a - spin_int) + s.r * (s.a - spin_int) + se.r * (se.a - spin_int)
      ) * HUE_SPIN_SCALE_INV;

      // apply external spin forces to own spin
      hue_spin += delta_external * HUE_SPIN_FRICTION;

      if (min_p == uint(0)) {
        // no oscillator match, so this is an active cell
        uint recent = last_history.r & uint(3);
        saturation = SATURATION[recent] * saturation_scale;
        lightness = LIGHTNESS[recent] * lightness_scale;
      } else {
        // oscillators are hue shifted at a speed relative to its P value
        if (min_p > uint(0)) {
          float target_spin = (float(min_p) - 1.0) * HUE_SPIN_P_FACTOR;
          float delta_target = target_spin - hue_spin;

          // apply oscillator target spin force to own spin
          hue_spin += delta_target * HUE_SPIN_FRICTION;
        }

        saturation = SATURATION_OSC[min_p] * saturation_scale;
        lightness = LIGHTNESS_OSC[min_p] * lightness_scale;
      }

      // save spin to cell state
      next_cell.a = int(hue_spin * HUE_SPIN_SCALE);
    } else {
      // cell is dead, ease out to the off saturation and lightness
      float p1_factor = min(1.0, float(next_osc_count_1[0]) / 255.0 * 4.0);
      float p1_ease_out = p1_factor * (2.0 - p1_factor);

      // dead cells have no spin
      next_cell.a = int(0);

      saturation = mix(
        SATURATION[3] * saturation_scale * 0.78,
        SATURATION_OFF * SATURATION_OFF_SCALE * u_saturation_off,
        p1_ease_out * 0.84
      );
      lightness = mix(
        LIGHTNESS[3] * saturation_scale * 0.78,
        LIGHTNESS_OFF * LIGHTNESS_OFF_SCALE * u_lightness_off,
        p1_ease_out * 0.84
      );
    }
  } else if (
    ((coord.x == center.x - horizon_dist || coord.x == center.x + horizon_dist) &&
      coord.y >= center.y - horizon_dist && coord.y <= center.y + horizon_dist) ||
    ((coord.y == center.y - horizon_dist || coord.y == center.y + horizon_dist) &&
      coord.x >= center.x - horizon_dist && coord.x <= center.x + horizon_dist)
  ) {
    // we're in the event horizon. this cell has entered the universe, and affects the state of its neighbors inside
    // the universe. time does not tick here, because some of its neighbors are still beyond the event horizon, and
    // are not part of the universe's state yet.
    next_cell = last_cell;

    // light up the cell as it crosses the event horizon
    hue_vec = next_cell.gb;
    if (next_cell.r == 0) {
      saturation = 0.0;
      lightness = 0.64;
    } else {
      saturation = 1.0;
      lightness = 0.84;
    }
  } else if (
    ((coord.x == center.x - entropy_dist || coord.x == center.x + entropy_dist) &&
      coord.y >= center.y - entropy_dist && coord.y <= center.y + entropy_dist) ||
    ((coord.y == center.y - entropy_dist || coord.y == center.y + entropy_dist) &&
      coord.x >= center.x - entropy_dist && coord.x <= center.x + entropy_dist)
  ) {
    // we're just beyond the event horizon, inject some entropy into the state grid, ready for its neighbors to
    // interact with starting the next generation.
    next_cell = texelFetch(u_entropy, coord, 0);

    // make the cell barely visible, as it is just about to enter the event horizon
    hue_vec = next_cell.gb;
    if (next_cell.r == 0) {
      saturation = 0.0;
      lightness = 0.05;
    } else {
      saturation = 0.6;
      lightness = 0.2;
    }
  } else {
    // we're outside the universe. nothing to see here, move along.
    next_cell = ivec4(0);

    hue_vec = ivec2(0);
    saturation = 0.0;
    lightness = 0.0;

    next_osc_count_1 = uvec4(255);
  }

  // calculate the color from the hsl and hue shift
  float hue_deg = atan(float(hue_vec.y), float(hue_vec.x)) * RAD_TO_DEG;
  if (hue_spin != 0.0) {
    vec2 shifted_hue_vec;
    hue_deg += hue_spin;

    shifted_hue_vec.x = cos(hue_deg * DEG_TO_RAD);
    shifted_hue_vec.y = sin(hue_deg * DEG_TO_RAD);
    hue_vec = ivec2(normalize(shifted_hue_vec) * 127.0);
  }

  next_cell.gb = hue_vec;

  if (hue_deg < 0.0) {
    hue_deg += 360.0;
  }
  float hue = hue_deg * INV_360;

  // copy outputs
  cell_color_out = vec4(hsl2rgb(hue, saturation * u_existence, lightness * u_existence), 1.0);
  cell_out = next_cell;
  history_out = next_history;
  osc_count_out_1 = next_osc_count_1;
  osc_count_out_2 = next_osc_count_2;
  min_osc_count = next_min_osc_count;
}

// hsl convert functions from here: https://github.com/Jam3/glsl-hsl2rgb/blob/master/index.glsl
float hue2rgb(float f1, float f2, float hue) {
  if (hue < 0.0)
    hue += 1.0;
  else if (hue > 1.0)
    hue -= 1.0;
  float res;
  if ((6.0 * hue) < 1.0)
    res = f1 + (f2 - f1) * 6.0 * hue;
  else if ((2.0 * hue) < 1.0)
    res = f2;
  else if ((3.0 * hue) < 2.0)
    res = f1 + (f2 - f1) * ((2.0 / 3.0) - hue) * 6.0;
  else
    res = f1;
  return res;
}

vec3 hsl2rgb(vec3 hsl) {
  vec3 rgb;

  if (hsl.y == 0.0) {
    rgb = vec3(hsl.z); // Luminance
  } else {
    float f2;

    if (hsl.z < 0.5)
      f2 = hsl.z * (1.0 + hsl.y);
    else
      f2 = hsl.z + hsl.y - hsl.y * hsl.z;

    float f1 = 2.0 * hsl.z - f2;

    rgb.r = hue2rgb(f1, f2, hsl.x + (1.0/3.0));
    rgb.g = hue2rgb(f1, f2, hsl.x);
    rgb.b = hue2rgb(f1, f2, hsl.x - (1.0/3.0));
  }
  return rgb;
}

vec3 hsl2rgb(float h, float s, float l) {
  return hsl2rgb(vec3(h, s, l));
}
