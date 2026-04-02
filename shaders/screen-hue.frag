#version 300 es
precision mediump float;
precision mediump int;
precision mediump isampler2D;

uniform isampler2D u_state;
uniform float u_view_x1, u_view_y1, u_view_x2, u_view_y2;
uniform float u_canvas_w, u_canvas_h;
uniform int u_universe_offset_x, u_universe_offset_y;
uniform int u_universe_w, u_universe_h;

layout(location=0) out vec4 frag_color;

float hue2rgb(float f1, float f2, float hue);
vec3 hsl2rgb(vec3 hsl);
vec3 hsl2rgb(float h, float s, float l);

const float PI = 3.14159;
const float RAD_TO_DEG = 180.0 / PI;
const float INV_360 = 1.0 / 360.0;

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

  frag_color = vec4(hsl2rgb(hue, s, l), 1.0);
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