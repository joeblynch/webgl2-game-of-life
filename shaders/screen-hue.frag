#version 300 es
precision mediump float;
precision mediump int;
precision mediump isampler2D;

uniform isampler2D u_state;
uniform int cell_size;

layout(location=0) out vec4 frag_color;

float hue2rgb(float f1, float f2, float hue);
vec3 hsl2rgb(vec3 hsl);
vec3 hsl2rgb(float h, float s, float l);

const float PI = 3.14159;
const float RAD_TO_DEG = 180.0 / PI;
const float INV_360 = 1.0 / 360.0;

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  if (cell_size > 2 && (coord.x % cell_size == 0 || coord.y % cell_size == 0)) {
    // for cell sizes over 2, add a black line between cells
    frag_color = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    ivec4 cell = texelFetch(u_state, coord / cell_size, 0);

    ivec2 hue_vec = cell.gb;
    float hue_deg = atan(float(hue_vec.y), float(hue_vec.x)) * RAD_TO_DEG;
    float hue = hue_deg * INV_360;
    float s, l;
    
    if (cell.r == 0) {
      s = 0.3;
      l = 0.08;
    } else {
      s = 1.0;
      l = 0.5;
    }

    vec3 rgb = hsl2rgb(hue, s, l);

    // alive/dead state is a single bit in the r channel, multiply by 255 to make it visible
    frag_color = vec4(rgb, 1.0);
  }
}

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