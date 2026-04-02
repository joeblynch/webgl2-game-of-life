#version 300 es
precision mediump float;
precision mediump int;
precision mediump isampler2D;
precision mediump usampler2D;

uniform usampler2D u_min_osc_count;
uniform usampler2D u_active_counts;
uniform isampler2D u_state;
uniform bool u_show_active_counts;
uniform float u_view_x1, u_view_y1, u_view_x2, u_view_y2;
uniform float u_canvas_w, u_canvas_h;
uniform int u_universe_offset_x, u_universe_offset_y;
uniform int u_universe_w, u_universe_h;

layout(location=0) out vec4 frag_color;

const float INV_255 = 1.0 / 255.0;

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(u_canvas_w, u_canvas_h);
  vec2 state_coord = vec2(mix(u_view_x1, u_view_x2, uv.x), mix(u_view_y1, u_view_y2, uv.y));
  ivec2 cell_coord = ivec2(floor(state_coord));

  if (cell_coord.x < 0 || cell_coord.y < 0 || cell_coord.x >= u_universe_w || cell_coord.y >= u_universe_h) {
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

  ivec2 texel = cell_coord + ivec2(u_universe_offset_x, u_universe_offset_y);
  ivec4 cell = texelFetch(u_state, texel, 0);
  uvec4 min_osc = texelFetch(u_min_osc_count, texel, 0);

  if (cell.r == 1) {
    if (min_osc.r == uint(0)) {
      frag_color = vec4(1.0);
    } else {
      frag_color = vec4(vec3(0.19), 1.0);
    }
  } else {
    frag_color = vec4(vec3(0.0), 1.0);
  }

  if (u_show_active_counts && cell.r == 0) {
    uint active_count = texelFetch(u_active_counts, texel >> 4, 0).r;
    frag_color.r += float(active_count) * INV_255 * 2.0;
    if (active_count > uint(0)) {
      frag_color.b = 0.25;
    }
  }
}