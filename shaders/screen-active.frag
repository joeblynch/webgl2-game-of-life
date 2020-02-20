#version 300 es
precision mediump float;
precision mediump int;
precision mediump isampler2D;
precision mediump usampler2D;

uniform usampler2D u_min_osc_count;
uniform usampler2D u_active_counts;
uniform isampler2D u_state;
uniform int cell_size;
uniform bool u_show_active_counts;

layout(location=0) out vec4 frag_color;

const float INV_255 = 1.0 / 255.0;

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  if (cell_size > 2 && (coord.x % cell_size == 0 || coord.y % cell_size == 0)) {
    // for cell sizes over 2, add a black line between cells
    frag_color = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    ivec4 cell = texelFetch(u_state, coord / cell_size, 0);
    uvec4 min_osc = texelFetch(u_min_osc_count, coord / cell_size, 0);

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
      uint active_count = texelFetch(u_active_counts, (coord / cell_size) >> 4, 0).r;
      frag_color.r += float(active_count) * INV_255 * 2.0;
      if (active_count > uint(0)) {
        frag_color.b = 0.25;
      }
    }
  }
}