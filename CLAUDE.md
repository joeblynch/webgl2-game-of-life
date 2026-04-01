# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a WebGL2 implementation of Conway's Game of Life with several advanced features:
- Big Bang universe expansion starting from generation -2
- Color inheritance through hue vectors (cells inherit color from their three parents)
- Oscillator detection (periods 1, 2, 3, 4, 15) with saturation/lightness adjustments
- End-of-universe detection when all cells become oscillators
- Fade-out animation when universe ends

The project is **client-side only** with no build system, package.json, or npm dependencies.

## Development

**Running the project:**
- Open [index.html](index.html) directly in a browser (requires WebGL2 support)
- For local development, use a simple HTTP server:
  ```bash
  python -m http.server 8000
  # or
  python3 -m http.server 8000
  ```
  Then navigate to `http://localhost:8000`

**No build, compile, or test commands** - all code runs directly in the browser.

## Architecture

### Core Files

- **[index.html](index.html)** - Entry point with canvas, toolbar/settings drawer HTML, CSS, and help modal
- **[main.js](main.js)** - WebGL setup, rendering loop, simulation state
- **[ui.js](ui.js)** - All UI logic: toolbar, settings drawer, keyboard/touch handlers, config persistence
- **[manifest.json](manifest.json)** - PWA web app manifest
- **[shaders/gol-step.frag](shaders/gol-step.frag)** - The core Game of Life logic (read this first to understand the implementation)
- **[lib/picogl.min.js](lib/picogl.min.js)** - External WebGL2 wrapper library (minified, do not modify)

### Shader Pipeline

The application uses a multi-pass rendering pipeline:

1. **State computation pass** ([gol-step.frag](shaders/gol-step.frag)):
   - Computes next cell state based on Conway's rules
   - Updates cell history (32-bit for oscillator detection)
   - Tracks oscillator counts for periods 1, 2, 3, 4, 15
   - Computes HSL colors based on cell state and oscillator type
   - Outputs to 6 separate textures (MRT - Multiple Render Targets)

2. **Active cell counting pass** ([count-active.frag](shaders/count-active.frag)):
   - Counts non-oscillating (active) cells for end-of-universe detection

3. **Screen rendering passes** (screen-*.frag shaders):
   - Various debug/visualization modes (colors, alive cells, oscillator counts, etc.)
   - Default mode: composite color rendering from pre-computed cell colors

### Key Concepts

**Big Bang Universe Expansion:**
- Universe starts at generation -2 (before it exists)
- Expands at rate of 1 cell per generation in all directions
- Three zones:
  - **Entropy injection** (generation + 2 cells from center): Initial random state
  - **Event horizon** (generation + 1 cells from center): State exists but time doesn't tick
  - **Universe interior** (≤ generation cells from center): Standard GoL rules apply
- Once expansion reaches torus edges, boundaries collide and wrap

**Color Inheritance:**
- Each cell stores hue as 2D unit vector (stored as int8 x/y in state.gb channels)
- New cells inherit color by summing and normalizing hue vectors of 3 parent cells
- Uses vector representation to handle 360°/0° boundary smoothly

**Oscillator Detection:**
- History texture stores last 32 states as bit-shifted uint (R32UI format)
- For period P, compare last P states to previous P states: `(history & mask) == ((history >> P) & mask)`
- Counters track consecutive oscillations (clamped at 256-P to prevent overflow issues)
- Minimum period determined by finding counter with highest value ≥ MIN_OSC_LEN (8)
- P0 = "active" (non-oscillating) cells
- End of universe when no P0 cells remain

**Texture Strategy:**
- Ping-pong buffers: Front/back textures swap each generation
- Back buffer read during computation, results written to front buffer
- Uses integer textures (isampler2D/usampler2D) for precise state tracking
- MRT writes 6 outputs per fragment in gol-step.frag

### State Management

Global state in [main.js](main.js) (shared with [ui.js](ui.js) via global scope):
- `_generation`: Current generation (starts at -2)
- `_endedGeneration`: When universe ended (-1 if still running)
- `_textures`: Object containing all WebGL textures (state, history, oscCounts, etc.)
- `_drawCalls`: PicoGL draw call objects for each shader program
- User preferences: `_cellSize`, `_speed`, `_saturation_on/off`, `_lightness_on/off`, `_cellAliveProbability`, `_textureMode`

UI state in [ui.js](ui.js):
- `_uiHideDelay`: Toolbar auto-hide delay in ms (-1 = disabled)
- `_autoHideTimer`: Active auto-hide setTimeout handle

## Modifying the Code

**To change Game of Life rules:**
Edit the neighbor counting logic in [gol-step.frag:183-191](shaders/gol-step.frag#L183-L191). Current implementation:
```glsl
int neighbors = nw.r + n.r + ne.r + w.r + e.r + sw.r + s.r + se.r;
next_cell.r = int(neighbors == 3) | (int(neighbors == 2) & last_cell.r);
```

**To adjust oscillator periods:**
Modify `OSCILLATOR_PERIODS` array in [gol-step.frag:95-103](shaders/gol-step.frag#L95-L103) (must be ascending order).

**To change color/saturation/lightness:**
Adjust constants in [gol-step.frag:52-83](shaders/gol-step.frag#L52-L83) or modify user-adjustable uniforms (u_saturation_on, u_lightness_on, etc.).

**To add keyboard controls:**
Add cases to keydown handler in [ui.js:149-296](ui.js#L149-L296).

**To add toolbar buttons:**
Add button HTML in [index.html](index.html) toolbar div, wire handler in [ui.js](ui.js) button handlers section.

**To add settings:**
Add input HTML to settings drawer in [index.html](index.html), sync in `openSettings()` and bind handler in [ui.js](ui.js).

**To add visualization modes:**
1. Add mode to `TEXTURE_MODES` array in [main.js:10](main.js#L10)
2. Add description to `TEXTURE_DESC` in [main.js:11-20](main.js#L11-L20)
3. Create new screen-*.frag shader
4. Load shader in [main.js:344-368](main.js#L344-L368)
5. Add draw call case in [main.js:205-236](main.js#L205-L236)

## Settings Persistence

Settings are stored in two places, with hash parameters taking priority:
1. **URL hash** — shareable, overrides localStorage on load
2. **localStorage** (`gol-config`) — persists across sessions automatically

Both are updated on every setting change via `updateConfig()` in [ui.js](ui.js).

### Hash Parameters

- `alive`: Probability cell starts alive (0-1, default 0.5)
- `size`: Cell size in pixels (default 3 * devicePixelRatio)
- `speed`: Generations per frame (negative = slower, default -5)
- `satOn/satOff`: Saturation multipliers (0-1)
- `liOn/liOff`: Lightness multipliers (0-1)
- `texture`: Visualization mode index (0-7)
- `uiHide`: Toolbar auto-hide delay in seconds (-1 = no auto-hide, default 5)

Example: `index.html#alive=1&size=2&speed=-1` creates a 100% alive universe with smaller, slower cells.

## Mobile & PWA Support

- Touch-friendly toolbar with 44px button targets, shown/hidden by tapping the canvas
- Settings drawer with sliders for brightness, saturation, cell size, alive probability
- PWA manifest and Apple meta tags for home screen installation (standalone mode, translucent black status bar)
- CSS canvas rotation for landscape orientation in standalone mode
- Fullscreen button hidden via feature detection where unsupported (e.g. iPhone Safari)
- `touch-action: manipulation` on toolbar buttons to prevent double-tap zoom

## WebGL2 Requirements

- This project requires WebGL2 (uses integer textures, MRT, bit operations)
- No fallback for WebGL 1.0
- Desktop Chrome/Firefox recommended
- Mobile Chrome/Firefox/Safari supported via touch UI and PWA
