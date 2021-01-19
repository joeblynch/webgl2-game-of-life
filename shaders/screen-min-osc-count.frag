#version 300 es
precision mediump float;
precision mediump int;
precision mediump usampler2D;

uniform usampler2D u_min_osc_count;
uniform int cell_size;

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
  ivec2 coord = ivec2(gl_FragCoord.xy);
  if (cell_size > 2 && (coord.x % cell_size == 0 || coord.y % cell_size == 0)) {
    // for cell sizes over 2, add a black line between cells
    frag_color = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    uvec4 cell = texelFetch(u_min_osc_count, coord / cell_size, 0);

    float mult = 1.0;
    if (cell.r == uint(0)) {
      mult = 8.0;
    }
    
    frag_color = vec4(vec3(OSC_COLORS[cell.r]) * mult * INV_BYTE * (float(cell.g) * INV_BYTE), 1.0);
  }
}