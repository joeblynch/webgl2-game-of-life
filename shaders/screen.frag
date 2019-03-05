#version 300 es
precision mediump float;
precision mediump int;
precision mediump sampler2D;

uniform sampler2D u_cell_colors;
// uniform usampler2D u_cell_colors;
uniform int cell_size;

layout(location=0) out vec4 frag_color;

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  if (coord.x % cell_size == 0 || coord.y % cell_size == 0) {
    frag_color = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    vec4 cell = texelFetch(u_cell_colors, coord / cell_size, 0);
    // frag_color = vec4(float(cell.r), vec2(cell.gb + 127) / 255.0, 1.0);
    frag_color = cell;
    // frag_color = vec4(vec3(cell.rgb)/255.0, 1.0);
  }
}