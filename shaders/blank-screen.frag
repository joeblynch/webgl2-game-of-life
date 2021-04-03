#version 300 es
precision mediump float;
precision mediump int;
precision mediump isampler2D;

layout(location=0) out vec4 frag_color;

void main() {
  frag_color = vec4(vec3(0.0), 1.0);
}