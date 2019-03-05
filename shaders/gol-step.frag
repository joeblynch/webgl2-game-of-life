#version 300 es
precision mediump float;
precision mediump int;
precision mediump isampler2D;
precision mediump usampler2D;

uniform int u_generation;
uniform isampler2D u_state;
uniform usampler2D u_history;
uniform isampler2D u_entropy;
uniform usampler2D u_osc_count;

layout(location=0) out ivec4 cell_out;
layout(location=1) out uvec4 history_out;
layout(location=2) out uvec4 osc_count_out;
layout(location=3) out vec4 cell_color_out;

const float PI = 3.14159;
const float RAD_TO_DEG = 180.0 / PI;
const float DEG_TO_RAD = PI / 180.0;
const float INV_360 = 1.0 / 360.0;

const uint MIN_OSC_LEN = uint(8);
const uint MAX_OSC_COUNT[5] = uint[5](uint(0), uint(255), uint(127), uint(84), uint(62));

const float HUE_SHIFT_P_FACTOR = 2.0;

const float SATURATION[4] = float[4](
  0.98, // 001
  0.71, // 011
  0.93, // 101
  0.71  // 111
);

const float LIGHTNESS[4] = float[4](
  0.6,  // 001
  0.36, // 011
  0.41, // 101
  0.26  // 111
);

const float SATURATION_OSC[5] = float[5](
  0.0,
  0.68,
  0.68,
  1.0,
  1.0
);

const float LIGHTNESS_OSC[5] = float[5](
  0.0,
  0.24,
  0.26,
  0.65,
  0.65
);

const float SATURATION_OFF = 0.40;
const float LIGHTNESS_OFF = 0.04;

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

ivec4 getWrapped(ivec2 coord, ivec2 size) {
  ivec2 wrapped = (coord + size) % size;
  return texelFetch(u_state, wrapped, 0);
}

uint getOscCount(uint history, uint p, uint prev_osc_count) {
  uint mask = uint((1 << p) - 1);
  bool is_match = (history & mask) == ((history >> p) & mask);

  // clamp count at 256 - p, so that for example a P2 isn't seen as a P4 whe both hit 255 length
  // uint next_increment = min(prev_osc_count + uint(1), MAX_OSC_COUNT[p]);
  uint next_increment = min(prev_osc_count + uint(1), uint(256) - p);

  return uint(is_match) * next_increment;
}

void main() {
  ivec2 size = textureSize(u_state, 0);
  ivec2 coord = ivec2(gl_FragCoord.xy);
  ivec2 center = size >> 1;
  ivec4 next_cell;
  uvec4 next_history;
  uvec4 next_osc_count;
  float saturation, lightness;
  ivec2 hue_vec;
  float hue_shift = 0.0;

  // lookup this cell's state as of the last generation
  ivec4 last_cell = texelFetch(u_state, coord, 0);

  // figure out where the event horizon is, and where we are relative to it
  // the universe starts as a single empty point, surrounded by an event horizon which expands at the speed of light.
  // we start at a generation of -1, just before the universe exists, in order to inject entropy just beyond the horizon
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
    -1: universe does not yet exist, but is about to. it has zero size, and an event horizon of a single point. entropy is injected around that point
    0: universe has a size of 1, that point steps forward, using the entropy at the event horizon to determine its state, entropy is injected just beyond the horizon

    universe_edge_dist = gen + 1
    horizon_dist = universe_edge_dist + 1;
    entropy_dist = horizon_dist + 1;
    */

    // lookup neighbor state
    ivec4 nw = getWrapped(coord + ivec2(-1, -1), size);
    ivec4 n  = getWrapped(coord + ivec2( 0, -1), size);
    ivec4 ne = getWrapped(coord + ivec2( 1, -1), size);
    ivec4 w  = getWrapped(coord + ivec2(-1,  0), size);
    ivec4 e  = getWrapped(coord + ivec2( 1,  0), size);
    ivec4 sw = getWrapped(coord + ivec2(-1,  1), size);
    ivec4 s  = getWrapped(coord + ivec2( 0,  1), size);
    ivec4 se = getWrapped(coord + ivec2( 1,  1), size);

    // lookup own past
    uvec4 last_history = texelFetch(u_history, coord, 0);
    uvec4 last_osc_count = texelFetch(u_osc_count, coord, 0);

    // calculate existance
    int neighbors = nw.r + n.r + ne.r + w.r + e.r + sw.r + s.r + se.r;
    next_cell.r = int(neighbors == 3) | (int(neighbors == 2) & last_cell.r);

    // update history
    next_history.r = last_history.r << 1 | uint(next_cell.r);

    // count oscillatorsl
    // NOTE: best oscilator search expects increasing P value
    next_osc_count[0] = getOscCount(next_history.r, uint(1), last_osc_count[0]);
    next_osc_count[1] = getOscCount(next_history.r, uint(2), last_osc_count[1]);
    next_osc_count[2] = getOscCount(next_history.r, uint(3), last_osc_count[2]);
    next_osc_count[3] = getOscCount(next_history.r, uint(15), last_osc_count[3]);

    // find best oscillator
    uint max_len = uint(0);
    uint best_p = uint(0);

    for (uint i = uint(0); i < uint(4); i++) {
      uint period = i + uint(1);
      uint len = next_osc_count[i];
      if (len > max_len && len >= MIN_OSC_LEN) {
        max_len = len;
        best_p = period;
      }
    }

    // determine color
    hue_vec = last_cell.gb;

    if (next_cell.r == 1) {
      if (best_p == uint(0)) {
        if ((last_history.r & uint(1)) == uint(0)) {
          // cell is newly on, so it inherits it's color from it's parents
          // calculate new hue vector by summing hue vectors of alive neighbors
          hue_vec = ivec2(normalize(vec2(
            nw.r * nw.gb + n.r * n.gb + ne.r * ne.gb +
            w.r  *  w.gb +               e.r *  e.gb +
            sw.r * sw.gb + s.r * s.gb + se.r * se.gb
          )) * 127.0);
        }

        // no osc match, so this is an active cell
        uint recent = last_history.r & uint(3);
        saturation = SATURATION[recent];
        lightness = LIGHTNESS[recent];
      } else {
        // oscillators don't inherit their hue, instead it's shifted at a speed relative to its P value
        if (best_p > uint(1)) {
          hue_shift = HUE_SHIFT_P_FACTOR * (float(best_p) - 1.0);
        }

        saturation = SATURATION_OSC[best_p];
        lightness = LIGHTNESS_OSC[best_p];
      }
    } else {
      // saturation = SATURATION_OFF;
      // lightness = LIGHTNESS_OFF;

      float p1_factor = min(1.0, float(next_osc_count[0]) / 255.0 * 4.0);
      float p1_ease_out = p1_factor * (2.0 - p1_factor);
      // cell_color = vec4(0.06, 0.06, 0.06, 1.0);
      saturation = mix(0.8, SATURATION_OFF, p1_ease_out);
      lightness = mix(0.15, LIGHTNESS_OFF, p1_ease_out);
    }
  } else if (
    ((coord.x == center.x - horizon_dist || coord.x == center.x + horizon_dist) &&
      coord.y >= center.y - horizon_dist && coord.y <= center.y + horizon_dist) ||
    ((coord.y == center.y - horizon_dist || coord.y == center.y + horizon_dist) &&
      coord.x >= center.x - horizon_dist && coord.x <= center.x + horizon_dist)
  ) {
    // we're at the event horizon. this cell has entered the universe, and effects the state of it's neighbors inside
    // the universe. time doesn't tick here, because some of it's neightbors are still beyond the event horizon, and
    // are not part of the state yet.
    next_cell = last_cell;

    hue_vec = next_cell.gb;
    saturation = 1.0;
    lightness = 0.84;
  } else if (
    ((coord.x == center.x - entropy_dist || coord.x == center.x + entropy_dist) &&
      coord.y >= center.y - entropy_dist && coord.y <= center.y + entropy_dist) ||
    ((coord.y == center.y - entropy_dist || coord.y == center.y + entropy_dist) &&
      coord.x >= center.x - entropy_dist && coord.x <= center.x + entropy_dist)
  ) {
    // we're just beyond the event horizon, inject some entropy into the state grid, ready to for it's neighbors to
    // interact with starting the next generation.
    next_cell = texelFetch(u_entropy, coord, 0);

    hue_vec = next_cell.gb;
    saturation = 0.6;
    lightness = 0.2;
  } else {
    // we're outside the universe, nothing to see here, move along.
    next_cell = ivec4(0);

    hue_vec = ivec2(0);
    saturation = 0.0;
    lightness = 0.0;
  }

  // calculate the color from the hsl and hue shift
  float hue_deg = atan(float(hue_vec.y), float(hue_vec.x)) * RAD_TO_DEG;
  if (hue_shift > 0.0) {
    vec2 shifted_hue_vec;
    hue_deg += hue_shift;

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
  cell_color_out = vec4(hsl2rgb(hue, saturation, lightness), 1.0);
  cell_out = next_cell;
  history_out = next_history;
  osc_count_out = next_osc_count;
}