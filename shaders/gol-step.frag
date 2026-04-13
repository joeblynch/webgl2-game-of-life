#version 300 es
// Conway's Game of Life with observation based cell existence

precision mediump float;
precision mediump int;
precision mediump isampler2D;
precision mediump usampler2D;

// entropy is externally injected into the universe
uniform isampler2D u_entropy;

// a value between 0 and 1 defines the normalized pressure threshold needed to trigger nucleation
uniform float u_nucleation_threshold;

// the universe state, each texture pixel is a cell. red: on/off state bit, green/blue: x/y vector of cell's hue angle
uniform isampler2D u_state;

// external observer's viewport
uniform int u_observer_x1, u_observer_y1, u_observer_x2, u_observer_y2;
// TODO: use full set of external observer's observation points
// uniform isampler2D u_observer;

// odds that a cell's alive state from entropy is alive vs dead
uniform float u_alive_probability;

// is physics ticking inside the universe, or are we just rendering entropy fluctuations?
uniform bool u_is_physics_ticking;

// the last 32 on/off states of each cell are remembered, to detect oscillators of up to 16P
uniform usampler2D u_history;

// count how many times oscillators have oscillated, for the most common periods.
// this allows us to detect "active" cells (non-oscillators), and when no active cells remain, the end of the universe
uniform usampler2D u_osc_count_1;
uniform usampler2D u_osc_count_2;

// after the universe ends, it fades out to black. this multiplier is used to reduce cell saturation and lightness
uniform float u_existence;

// input user configurable multipliers for saturation and lightness of on and off cells
uniform float u_saturation_on;
uniform float u_saturation_off;
uniform float u_saturation_entropy;
uniform float u_lightness_on;
uniform float u_lightness_off;
uniform float u_lightness_entropy;

// output the next cell state, and the new state of the cell's history and oscillator counts
layout(location=0) out ivec4 cell_out;
layout(location=1) out uvec4 history_out;
layout(location=2) out uvec4 osc_count_out_1;
layout(location=3) out vec4 cell_color_out;
layout(location=4) out uvec4 osc_count_out_2;
layout(location=5) out uvec2 min_osc_count_out;

// set a lower bound on the number of oscillation repetitions, before a cell is has its saturation and lightness
// modified. this prevents short bursts of random oscillations from being highlighted or dimmed
const uint MIN_OSC_LEN = uint(8);

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

// a null cell has no state, the entropy texture has a random normalized unit vector for hue angle in the gb channels
const ivec4 NULL_CELL = ivec4(0);

// there's a 1 in 255^2 chance we have a null hue in the entropy data,
const ivec2 NULL_HUE = ivec2(0);
const ivec2 DEFAULT_HUE = ivec2(0, 255);

const float PI = 3.1415927;
const float RAD_TO_DEG = 180.0 / PI;
const float DEG_TO_RAD = PI / 180.0;
const float INV_127 = 1.0 / 127.0;
const float INV_255 = 1.0 / 255.0;
const float INV_360 = 1.0 / 360.0;
const float NORMALIZE_EPSILON = 1e-6;

// transform unit vectors to determine inward pressure based on relative neighbor position
const vec2 TC_N  = vec2( 0.0,  1.0);
const vec2 TC_W  = vec2( 1.0,  0.0);
const vec2 TC_E  = vec2(-1.0,  0.0);
const vec2 TC_S  = vec2( 0.0, -1.0);
const vec2 TC_NW = normalize(vec2( 1.0,  1.0));
const vec2 TC_NE = normalize(vec2(-1.0,  1.0));
const vec2 TC_SW = normalize(vec2( 1.0, -1.0));
const vec2 TC_SE = normalize(vec2(-1.0, -1.0));

// the 8 neighbor vectors are normalized, so our max pressure is also 8
const float MAX_ENTROPY_PRESSURE = 8.0;

ivec2 get_entropy_vec(ivec2 coord, ivec2 size) {
  // handle the wrapping of coordinates around the torus manually, to support non-power-of-two sized universes
  ivec2 wrapped = (coord + size) % size;
  return texelFetch(u_entropy, wrapped, 0).gb;
}

bool is_nucleation(ivec2 coord, ivec2 size, float threshold, out ivec2 pressure_vec) {
  // the neighboring entropy determines if nucleation occurs, and if so its hue state
  vec2 nw = vec2(get_entropy_vec(coord + ivec2(-1, -1), size)) * INV_127;
  vec2 n  = vec2(get_entropy_vec(coord + ivec2( 0, -1), size)) * INV_127;
  vec2 ne = vec2(get_entropy_vec(coord + ivec2( 1, -1), size)) * INV_127;
  vec2 w  = vec2(get_entropy_vec(coord + ivec2(-1,  0), size)) * INV_127;
  vec2 e  = vec2(get_entropy_vec(coord + ivec2( 1,  0), size)) * INV_127;
  vec2 sw = vec2(get_entropy_vec(coord + ivec2(-1,  1), size)) * INV_127;
  vec2 s  = vec2(get_entropy_vec(coord + ivec2( 0,  1), size)) * INV_127;
  vec2 se = vec2(get_entropy_vec(coord + ivec2( 1,  1), size)) * INV_127;

  // flip the vectors to determine how much they point towards this cell
  float nw_force = dot(nw, TC_NW);
  float n_force =  dot(n,   TC_N);
  float ne_force = dot(ne, TC_NE);
  float w_force =  dot(w,   TC_W);
  float e_force =  dot(e,   TC_E);
  float sw_force = dot(sw, TC_SW);
  float s_force =  dot(s,   TC_S);
  float se_force = dot(se, TC_SE);

  // the incoming pressure vector becomes the cell's hue angle, if nucleated
  vec2 residual =
    TC_NW * nw_force + TC_N * n_force + TC_NE * ne_force +
    TC_W  * w_force          +          TC_E  *  e_force +
    TC_SW * sw_force + TC_S * s_force + TC_SE * se_force;

  // the pressure vector is the residual force, while handling the NaN case for `normalize` for near-zero values
  pressure_vec = dot(residual, residual) > NORMALIZE_EPSILON ? ivec2(normalize(residual) * 127.0) : NULL_HUE;

  // determine how much pressure is being exerted towards the cell by it's neighboring entropy
  float total_pressure =
    nw_force + n_force + ne_force +
    w_force       +       e_force +
    sw_force + s_force + se_force;

  // the total pressure determines if the entropy "pokes through" into the universe
  return total_pressure >= threshold * MAX_ENTROPY_PRESSURE;
}

ivec4 get_state(ivec2 coord, ivec2 size) {
  // handle the wrapping of coordinates around the torus manually, to support non-power-of-two sized universes
  ivec2 wrapped = (coord + size) % size;
  return texelFetch(u_state, wrapped, 0);
}

uint get_osc_count(uint history, uint p, uint prev_osc_count) {
  // check if the last [p] states match the previous [p] states
  uint mask = uint((1 << p) - 1);
  bool is_match = (history & mask) == ((history >> p) & mask);

  // clamp count at 256 - p, so that for example a P2 isn't seen as a P4 when both hit 255 length
  uint next_increment = min(prev_osc_count + uint(1), uint(256) - p);

  // multiply by is_match, to avoid branching
  return uint(is_match) * next_increment;
}

bool is_externally_observed(ivec2 coord) {
  //ivec4 last_cell = texelFetch(u_state, coord, 0);
  return coord.x >= u_observer_x1 && coord.x <= u_observer_x2 && coord.y >= u_observer_y1 && coord.y <= u_observer_y2;
}

bool has_sufficient_observability(int existing_neighbor_count) {
  // GoL physics require full Moore neighborhood
  return existing_neighbor_count == 8;
}

void find_min_p(uvec4 osc_count_1, uvec4 osc_count_2, out uint min_p, out uint max_len) {
  max_len = uint(0);
  min_p = uint(0);

  // find min oscillator period, since a P2 is also P4, a P1 also P2, P3, etc.
  for (uint i = uint(0); i < uint(5); i++) {
    uint len = i < uint(4) ? osc_count_1[i] : osc_count_2[i - uint(4)];
    if (len > max_len && len >= MIN_OSC_LEN) {
      max_len = len;
      min_p = OSCILLATOR_PERIODS[i];
    }
  }

  if (min_p == uint(0)) {
    // this is an active cell. treat active cells as "P0" oscillators, and count them like other oscillators
    max_len = osc_count_2[3] + uint(1);
  }
}

void main() {
  // allocate outputs
  ivec4 next_cell;
  uvec4 next_history;
  uvec4 next_osc_count_1;
  uvec4 next_osc_count_2;
  uvec2 next_min_osc_count;
  uint max_len;
  uint min_p;
  ivec2 entropy_hue_vec;
  float saturation, lightness;

  // lookup cell's last state
  ivec2 coord = ivec2(gl_FragCoord.xy);
  ivec4 last_cell = texelFetch(u_state, coord, 0);
  
  // lookup neighbor state
  ivec2 size = textureSize(u_state, 0);
  ivec4 nw = get_state(coord + ivec2(-1, -1), size);
  ivec4 n  = get_state(coord + ivec2( 0, -1), size);
  ivec4 ne = get_state(coord + ivec2( 1, -1), size);
  ivec4 w  = get_state(coord + ivec2(-1,  0), size);
  ivec4 e  = get_state(coord + ivec2( 1,  0), size);
  ivec4 sw = get_state(coord + ivec2(-1,  1), size);
  ivec4 s  = get_state(coord + ivec2( 0,  1), size);
  ivec4 se = get_state(coord + ivec2( 1,  1), size);

  if (last_cell == NULL_CELL) {
    // count neighbors that exist (have state) to see if we have any local observers
    int existing_neighbor_count = 
      int(nw != NULL_CELL) +
      int(n  != NULL_CELL) +
      int(ne != NULL_CELL) +
      int(e  != NULL_CELL) +
      int(se != NULL_CELL) +
      int(s  != NULL_CELL) +
      int(sw != NULL_CELL) +
      int(w  != NULL_CELL);

    // I do not exist. Am I observed?
    bool is_observed = existing_neighbor_count > 0 || is_externally_observed(coord);

    ivec2 pressure_vec;
    bool is_nucleated = is_nucleation(coord, size, u_nucleation_threshold, pressure_vec);

    // If I'm observed, is physics also ticking to convert probability into state?
    if ((is_observed || is_nucleated) && u_is_physics_ticking) {
      // I am observed, I will come into existence... but only if probability can collapse into state.
      ivec4 entropy = texelFetch(u_entropy, coord, 0);
      if (entropy != NULL_CELL) {
        // collapse probability into state
        next_cell.r = int(float(entropy.r + 128) * INV_255 <= u_alive_probability);

        // the hue vector of the cell's entropy is considered an outward force, while the combined with the pressure
        // of the neighboring entropy that triggered the nucleation is considered an inwards force. the delta then
        // determines the cell's initial hue
        vec2 hue_delta = vec2(pressure_vec - entropy.gb);
        if (dot(hue_delta, hue_delta) > NORMALIZE_EPSILON) {
          next_cell.gb = ivec2(normalize(hue_delta) * 127.0);
        } else {
          next_cell.gb = DEFAULT_HUE;
        }

        // make the cell barely visible, as it is just came into existence
        if (next_cell.r == 0) {
          saturation = 0.0;
          lightness = 0.05;
        } else {
          saturation = 0.6;
          lightness = 0.2;
        }
      }
    } else {
      next_cell = NULL_CELL;

      // TODO: is this still needed? if so, why
      next_osc_count_1 = uvec4(255);
      next_osc_count_2 = uvec4(255);
    }
    
    if (next_cell == NULL_CELL) {
      // no collapse into state, instead we'll visualize the entropy
      ivec4 entropy = texelFetch(u_entropy, coord, 0);
      entropy_hue_vec = entropy.gb;
      saturation = u_saturation_entropy;
      lightness = u_lightness_entropy;
    }
  } else {
    // I exist. With a full Moore neighborhood I can tick.
    if (has_sufficient_observability(neighbor_count)) {
      // lookup own past
      uvec4 last_history = texelFetch(u_history, coord, 0);
      uvec4 last_osc_count_1 = texelFetch(u_osc_count_1, coord, 0);
      uvec4 last_osc_count_2 = texelFetch(u_osc_count_2, coord, 0);

      if (u_is_physics_ticking) {
        // standard Game of Life: born when 3 neighbors, survive when 2 or 3 neighbors
        // calculate existence without branching
        int alive_neighbor_count = nw.r + n.r + ne.r + w.r + e.r + sw.r + s.r + se.r;
        next_cell.r = int(alive_neighbor_count == 3) | (int(alive_neighbor_count == 2) & last_cell.r);

        // update history
        next_history.r = last_history.r << 1 | uint(next_cell.r);

        // count oscillators for most frequent periods
        // NOTE: min oscillator search MUST have increasing P value
        next_osc_count_1[0] = get_osc_count(next_history.r, OSCILLATOR_PERIODS[0], last_osc_count_1[0]);
        next_osc_count_1[1] = get_osc_count(next_history.r, OSCILLATOR_PERIODS[1], last_osc_count_1[1]);
        next_osc_count_1[2] = get_osc_count(next_history.r, OSCILLATOR_PERIODS[2], last_osc_count_1[2]);
        next_osc_count_1[3] = get_osc_count(next_history.r, OSCILLATOR_PERIODS[3], last_osc_count_1[3]);
        next_osc_count_2[0] = get_osc_count(next_history.r, OSCILLATOR_PERIODS[4], last_osc_count_2[0]);

        // find min oscillator period, since a P2 is also P4, a P1 also P2, P3, etc.
        find_min_p(next_osc_count_1, next_osc_count_2, min_p, max_len);

        // output the min oscillator period, and its count
        next_min_osc_count.r = min_p;
        next_min_osc_count.g = max_len;

        if (min_p == uint(0)) {
          // this is an active cell. treat active cells as "P0" oscillators, and count them like other oscillators
          next_osc_count_2[3] = max_len;
        } else {
          // cell is an oscillator of a tracked period, reset P0 counter
          next_osc_count_2[3] = uint(0);
        }

        if (next_cell.r == 1 && (last_history.r & uint(1)) == uint(0) && min_p == uint(0)) {
          // cell is newly born, so it inherits its color from its three parents
          // calculate new hue vector by summing hue vectors of alive neighbors
          next_cell.gb = ivec2(normalize(vec2(
            nw.r * nw.gb + n.r * n.gb + ne.r * ne.gb +
            w.r  *  w.gb +               e.r *  e.gb +
            sw.r * sw.gb + s.r * s.gb + se.r * se.gb

          // scale down hue sum before normalize to prevent overflow on GPUs (e.g. Galaxy Note)
          // where built-in functions run at mediump (FP16) regardless of declared precision.
          // max component sum is 3 * 127 = 381, so dot(v,v) can reach 290,322 which exceeds 
          // FP16 max of 65,504. dividing by 4 keeps it safe, and since normalize only cares
          // about direction, the result is unchanged.
          ) / 4.0) * 127.0);
        } else {
          // surviving this step, maintain color
          next_cell.gb = last_cell.gb;
        }
      } else {
        // no physics, all state stays the same
        next_cell = last_cell;
        next_history = last_history;
        next_osc_count_1 = last_osc_count_1;
        next_osc_count_2 = last_osc_count_2;
        
        // find min oscillator period, since a P2 is also P4, a P1 also P2, P3, etc.
        // this is a derived value, so we re-calculate here to avoid extra memory allocation
        find_min_p(last_osc_count_1, last_osc_count_2, min_p, max_len);
        next_min_osc_count.r = min_p;
        next_min_osc_count.g = max_len;
      }

      float saturation_scale = SATURATION_ON_SCALE * u_saturation_on;
      float lightness_scale = LIGHTNESS_ON_SCALE * u_lightness_on;

      if (next_cell.r == 1) {
        // determine color for alive cell
        if (min_p == uint(0)) {
          // no oscillator match, so this is an active cell
          uint recent = (next_history.r >> 1) & uint(3);
          saturation = SATURATION[recent] * saturation_scale;
          lightness = LIGHTNESS[recent] * lightness_scale;
        } else {
          saturation = SATURATION_OSC[min_p] * saturation_scale;
          lightness = LIGHTNESS_OSC[min_p] * lightness_scale;
        }
      } else {
        // cell is dead, ease out to the off saturation and lightness
        float p1_factor = min(1.0, float(next_osc_count_1[0]) / 255.0 * 4.0);
        float p1_ease_out = p1_factor * (2.0 - p1_factor);

        saturation = mix(
          SATURATION[3] * saturation_scale * 0.78,
          SATURATION_OFF * SATURATION_OFF_SCALE * u_saturation_off,
          p1_ease_out * 0.84
        );
        lightness = mix(
          LIGHTNESS[3] * lightness_scale * 0.62,
          LIGHTNESS_OFF * LIGHTNESS_OFF_SCALE * u_lightness_off,
          p1_ease_out * 0.84
        );
      }
    } else {
      // I exist, but not with sufficient local observability to tick and change my state.
      next_cell = last_cell;

      // light up the cell as it exists at the event horizon
      if (next_cell.r == 0) {
        saturation = 0.0;
        lightness = 0.64;
      } else {
        saturation = 1.0;
        lightness = 0.84;
      }
    }
  }

  // calculate the color from the hsl
  ivec2 hue_vec = next_cell != NULL_CELL ? next_cell.gb : entropy_hue_vec;
  float hue_deg = atan(float(hue_vec.r), float(hue_vec.g)) * RAD_TO_DEG;
  if (hue_deg < 0.0) {
    hue_deg += 360.0;
  }

  // copy outputs
  cell_color_out = vec4(hsl2rgb(hue_deg * INV_360, saturation * u_existence, lightness * u_existence), 1.0);
  cell_out = next_cell;
  history_out = next_history;
  osc_count_out_1 = next_osc_count_1;
  osc_count_out_2 = next_osc_count_2;
  min_osc_count_out = next_min_osc_count;
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
