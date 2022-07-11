#version 300 es
precision mediump float;
precision mediump int;
precision mediump isampler2D;

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

    // get the hue spin speed
    int hue_spin = cell.a;
    vec3 rgb = vec3(0.0);
    if (hue_spin > 0) {
      rgb.r = float(hue_spin) / 64.0;
    } else if (hue_spin < 0) {
      rgb.g = -float(hue_spin) / 64.0;
    }

    // alive/dead state is a single bit in the r channel, multiply by 255 to make it visible
    frag_color = vec4(rgb, 1.0);
  }
}
