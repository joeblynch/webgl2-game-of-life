#version 300 es
precision mediump float;
precision mediump int;
precision mediump isampler2D;
precision mediump usampler2D;

uniform usampler2D u_min_osc_count;
uniform isampler2D u_state;
uniform int cell_size;

layout(location=0) out vec4 frag_color;

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
        frag_color = vec4(vec3(0.15), 1.0);
      }
    } else {
      frag_color = vec4(vec3(0.0), 1.0);
    }
  }
}