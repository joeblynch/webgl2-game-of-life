#version 300 es
precision mediump float;
precision mediump int;
precision mediump isampler2D;
precision mediump usampler2D;

uniform isampler2D u_state;
uniform usampler2D u_min_osc_count;

layout(location=0) out uvec4 active_out;

void main() {
  ivec2 tl = ivec2(gl_FragCoord.xy) << 4;
  uint active_count = uint(0);
  ivec4 cell;
  uvec4 min_osc;

  for (int y = 0; y < 16; y++) {
    ivec2 p = ivec2(tl.x, tl.y + y);

    for (int x = 0; x < 16; x++) {
      p.x = tl.x + x;
      cell = texelFetch(u_state, p, 0);
      min_osc = texelFetch(u_min_osc_count, p, 0);
      active_count += uint(cell.r) & uint(min_osc.r == uint(0));
    }
  }
  
  active_out.r = active_count;
}