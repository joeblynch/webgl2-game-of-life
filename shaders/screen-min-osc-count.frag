#version 300 es
precision mediump float;
precision mediump int;
precision mediump usampler2D;

uniform usampler2D u_min_osc_count;
uniform float u_view_x1, u_view_y1, u_view_x2, u_view_y2;
uniform float u_canvas_w, u_canvas_h;
uniform int u_universe_offset_x, u_universe_offset_y;
uniform int u_universe_w, u_universe_h;

layout(location=0) out vec4 frag_color;

const vec3 OSC_COLORS[16] = vec3[16](
  vec3(131.0, 255.0, 29.0),    // P0
  vec3(0.0, 0.0, 64.0),        // P1
  vec3(255.0, 89.0, 29.0),     // P2
  vec3(255.0, 29.0, 131.0),    // P3
  vec3(29.0, 232.0, 255.0),    // P4
  vec3(255.0, 255.0, 255.0),   // P5
  vec3(255.0, 255.0, 255.0),   // P6
  vec3(255.0, 255.0, 255.0),   // P7
  vec3(255.0, 255.0, 255.0),   // P8
  vec3(255.0, 255.0, 255.0),   // P9
  vec3(255.0, 255.0, 255.0),   // P10
  vec3(255.0, 255.0, 255.0),   // P11
  vec3(255.0, 255.0, 255.0),   // P12
  vec3(255.0, 255.0, 255.0),   // P13
  vec3(255.0, 255.0, 255.0),   // P14
  vec3(255.0, 251.0, 31.0)     // P15
);

const float INV_BYTE = 1.0 / 255.0;

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(u_canvas_w, u_canvas_h);
  vec2 state_coord = vec2(mix(u_view_x1, u_view_x2, uv.x), mix(u_view_y1, u_view_y2, uv.y));
  ivec2 cell = ivec2(floor(state_coord));

  if (cell.x < 0 || cell.y < 0 || cell.x >= u_universe_w || cell.y >= u_universe_h) {
    frag_color = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float cell_pixels = u_canvas_w / (u_view_x2 - u_view_x1);
  if (cell_pixels > 2.5) {
    vec2 f = fract(state_coord);
    float line_w = 1.0 / cell_pixels;
    if (f.x < line_w || f.y < line_w) {
      frag_color = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  }

  ivec2 texel = cell + ivec2(u_universe_offset_x, u_universe_offset_y);
  uvec4 osc = texelFetch(u_min_osc_count, texel, 0);

  float mult = 1.0;
  if (osc.r == uint(0)) {
    mult = 8.0;
  }

  frag_color = vec4(vec3(OSC_COLORS[osc.r]) * mult * INV_BYTE * (float(osc.g) * INV_BYTE), 1.0);
}