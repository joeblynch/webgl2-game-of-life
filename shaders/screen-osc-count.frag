#version 300 es
precision mediump float;
precision mediump int;
precision mediump usampler2D;

uniform usampler2D u_osc_count;
uniform float u_view_x1, u_view_y1, u_view_x2, u_view_y2;
uniform float u_canvas_w, u_canvas_h;
layout(location=0) out vec4 frag_color;

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(u_canvas_w, u_canvas_h);
  vec2 state_coord = vec2(mix(u_view_x1, u_view_x2, uv.x), mix(u_view_y1, u_view_y2, uv.y));
  ivec2 cell = ivec2(floor(state_coord));
  ivec2 tex_size = textureSize(u_osc_count, 0);

  if (cell.x < 0 || cell.y < 0 || cell.x >= tex_size.x || cell.y >= tex_size.y) {
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

  uvec4 osc = texelFetch(u_osc_count, cell, 0);
  frag_color = vec4(vec3(osc.gba) / 255.0, 1.0);
}