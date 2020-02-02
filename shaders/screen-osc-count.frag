#version 300 es
precision mediump float;
precision mediump int;
precision mediump usampler2D;

uniform usampler2D u_osc_count;
uniform int cell_size;

layout(location=0) out vec4 frag_color;

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  if (cell_size > 2 && (coord.x % cell_size == 0 || coord.y % cell_size == 0)) {
    // for cell sizes over 2, add a black line between cells
    frag_color = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    uvec4 cell = texelFetch(u_osc_count, coord / cell_size, 0);
    frag_color = vec4(vec3(cell.rgb) / 255.0, 1.0);
  }
}