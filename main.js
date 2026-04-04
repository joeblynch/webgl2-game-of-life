// NOTE: This code is ugly because it's uninteresting, so as little time was spent on it as possible.
//       The magic happens in gol-step.frag.

const DEFAULT_CELL_SIZE = Math.floor(2 * window.devicePixelRatio) + 1;
const DEFAULT_ALIVE_PROBABILITY = 0.5;
const DEFAULT_TARGET_FPS = 15;
const DEFAULT_SATURATION_ON = 0.98;
const DEFAULT_SATURATION_OFF = 1.0;
const DEFAULT_LIGHTNESS_ON = 0.76;
const DEFAULT_LIGHTNESS_OFF = 0.015;
const DEFAULT_TEXTURE_MODE = 0;

const MAX_ENTROPY = 65536;
const CELL_STATE_BYTES = 4;
const CELL_OSC_COUNT_BYTES = 4;

const TEXTURE_MODES = ['colors', 'alive', 'active', 'activeCounts', 'oscCount', 'minOscCount', 'state', 'hue'];
const TEXTURE_DESC = [
  '',
  'alive bit',
  'P0 (non-oscillating) alive cells',
  'P0 (non-oscillating) alive cells with block counts',
  'oscillator counters (r: P2, g: P3, b: P4)',
  'labeled oscillator counters',
  'raw state (r: alive, gb: xy hue vector)',
  'hue state'
];

function parseHash() {
  let stored = {};
  try {
    const json = localStorage.getItem('gol-config');
    if (json) stored = JSON.parse(json);
  } catch (e) {}

  const hash = location.hash
    .substring(1)
    .split('&')
    .map(kv => kv.split('='))
    .reduce((h, [key, value]) => {
      if (key) {
        if (value && value.match(/^-?\d+(?:\.\d+)?$/)) {
          value = parseFloat(value);
        }

        h[key] = value;
      }

      return h;
    }, {});

  return Object.assign(stored, hash);
}

// NOTE: seed entropy saved before 2019/11/08 uses a start generation of -1
const START_GENERATION = -2;

const FADE_OUT_GENERATION_COUNT = 30;
const INPUT_HOLD_DELAY = 200;
const INPUT_HOLD_RAMP = 5000;

let _app;
const _programs = {};
const _drawCalls = {};
const _textures = {};
const options = parseHash();
let _cellAliveProbability = options.alive >= 0 && options.alive <= 1 ? options.alive : DEFAULT_ALIVE_PROBABILITY;
let _cellSize = options.size || DEFAULT_CELL_SIZE;
let _targetFPS = typeof options.fps === 'number' ? options.fps : DEFAULT_TARGET_FPS;
let _saturation_on = typeof options.satOn === 'number' ? options.satOn : DEFAULT_SATURATION_ON;
let _saturation_off = typeof options.satOff === 'number' ? options.satOff : DEFAULT_SATURATION_OFF;
let _lightness_on = typeof options.liOn === 'number' ? options.liOn : DEFAULT_LIGHTNESS_ON;
let _lightness_off = typeof options.liOff === 'number' ? options.liOff : DEFAULT_LIGHTNESS_OFF;
let _textureMode = options.texture >= 0 && options.texture < TEXTURE_MODES.length ? options.texture : DEFAULT_TEXTURE_MODE;
let _gridWidth = options.width > 0 ? Math.floor(options.width) : 0;
let _gridHeight = options.height > 0 ? Math.floor(options.height) : 0;
let _ratio = options.ratio > 0 ? options.ratio : 0;
let _activeCounts;
let _offscreen;
let _quad;
let _vao;
let _stateWidth;
let _stateHeight;
let _maxWidth;
let _maxHeight;
let _canvasWidth;
let _canvasHeight;
let _activeWidth;
let _activeHeight;
let _activeFramebuffer;
let _readFramebuffer;
let _clearFramebuffer;
let _generation = START_GENERATION;
let _observerMode = 'touch';
let _entropyMode = 'eye';
let _observerX1 = -1, _observerY1 = -1, _observerX2 = -1, _observerY2 = -1;
let _touchTexX = -1, _touchTexY = -1;
let _entropyX1, _entropyY1, _entropyX2, _entropyY2;
let _maxGenerations = -1;
let _maxActive = -1;
let _lastDrawnPanX, _lastDrawnPanY, _lastDrawnZoom;
let _entropy;
let _zoom;
let _maxZoom;
let _panX, _panY;
let _viewX1, _viewY1, _viewX2, _viewY2;
let _wakeLock = null;
let _running = true;
let _endedGeneration = -1;
let _lastFPSUpdate = 0;
let _lastActiveUpdate = 0;
let _actualFPS = 0;
let _stepsThisSecond = 0;
let _stepBudget = 0;
let _lastFrameTime = 0;
let _speedUpPressedAt = null;
let _speedDownPressedAt = null;
let _momentumVX = 0, _momentumVY = 0;
let _momentumActive = false;
let _underperformStart = 0;
let _wasPaused = false;
const _fpsEl = document.getElementById('fps');
const _activeEl = document.getElementById('active');
const _textureDescEl = document.getElementById('texture-desc');
const _speedDisplayEl = document.getElementById('speed-display');

function updateSpeedDisplay() {
  const d = Math.round(_targetFPS);
  _speedDisplayEl.innerText = (d >= 1000 ? (d / 1000).toFixed(1) + 'k' : d) + 'fps';
}
updateSpeedDisplay();

(async function main() {
  await init();
  requestWakeLock();

  requestAnimationFrame(function render(now) {
    requestAnimationFrame(render);

    const deltaTime = _lastFrameTime ? now - _lastFrameTime : 0;
    _lastFrameTime = now;

    // process speed hold acceleration (only if one direction pressed, not both)
    const pressedAt = _speedUpPressedAt ?? _speedDownPressedAt;
    if (pressedAt !== null && !(_speedUpPressedAt && _speedDownPressedAt)) {
      const held = now - pressedAt - INPUT_HOLD_DELAY;
      if (held > 0) {
        const rampRate = Math.min(1 + (held / INPUT_HOLD_RAMP) * 49, 50);
        const delta = rampRate * (deltaTime / 1000);
        if (_speedUpPressedAt) _targetFPS += delta;
        else _targetFPS = Math.max(1, _targetFPS - delta);

        updateSpeedDisplay();
      }
    }

    if (!_running) {
      applyMomentum();
      const viewportChanged = _panX !== _lastDrawnPanX || _panY !== _lastDrawnPanY || _zoom !== _lastDrawnZoom;
      if (viewportChanged) {
        _lastDrawnPanX = _panX;
        _lastDrawnPanY = _panY;
        _lastDrawnZoom = _zoom;
        draw();
      }
      _wasPaused = true;
      return;
    }

    // reset throttle state after unpause to avoid false auto-downgrade
    if (_wasPaused) {
      _wasPaused = false;
      _stepBudget = 0;
      _stepsThisSecond = 0;
      _lastFPSUpdate = now;
      _underperformStart = 0;
    }

    computeViewport();
    computeObserver();
    ensureEntropy();

    // budget-based step scheduling
    let stepped = false;
    if (deltaTime > 0 && deltaTime < 500) {  // ignore huge gaps (tab switch)
      _stepBudget += deltaTime;
      const stepTime = 1000 / _targetFPS;
      // cap budget to prevent spiral of death
      _stepBudget = Math.min(_stepBudget, stepTime * 10);
      while (_stepBudget >= stepTime) {
        step();
        _stepBudget -= stepTime;
        _stepsThisSecond++;
        stepped = true;
      }
    }

    applyMomentum();
    const viewportChanged = _panX !== _lastDrawnPanX || _panY !== _lastDrawnPanY || _zoom !== _lastDrawnZoom;
    if (!stepped && !viewportChanged) {
      return;
    }
    _lastDrawnPanX = _panX;
    _lastDrawnPanY = _panY;
    _lastDrawnZoom = _zoom;
    draw();

    // track actual FPS and auto-downgrade
    if (now - 1000 >= _lastFPSUpdate) {
      _actualFPS = _stepsThisSecond;
      _fpsEl.innerText = _stepsThisSecond;

      updateSpeedDisplay();

      // auto-downgrade: if actual < target * 0.9 for > 2 seconds
      if (_stepsThisSecond < _targetFPS * 0.9) {
        if (_underperformStart === 0) _underperformStart = now;
        else if (now - _underperformStart > 2000) {
          _targetFPS = _stepsThisSecond;
          _underperformStart = 0;
        }
      } else {
        _underperformStart = 0;
      }

      _lastFPSUpdate = now;
      _stepsThisSecond = 0;
    }

    if (/*now - 100 >= _lastActiveUpdate && */_generation > 0 && _endedGeneration < 0) {
      const active = getActiveCells();
      _activeEl.innerText = active;
      if (!active && _maxActive > 0) {
        if (_generation > _maxGenerations) {
          _maxGenerations = _generation;
          console.log('max generations: ', _generation, _entropy);
        }

        _endedGeneration = _generation - 1;
      }

      _lastActiveUpdate = now;
      
      if (active > _maxActive) {
        _maxActive = active;
      }
    }

    if (_endedGeneration >= 0 && _generation >= _endedGeneration + FADE_OUT_GENERATION_COUNT) {
      reset();
    }
  });
})();

function step() {
  const backIndex = (_generation + (_generation < 0 ? 2 : 0)) % 2;
  const frontIndex = (backIndex + 1) % 2;

  let existence;
  if (_endedGeneration >= 0) {
    // universe has ended, fade out with cubic ease out
    const pct = (_generation - _endedGeneration) / FADE_OUT_GENERATION_COUNT;
    const t = pct - 1;

    existence = 1 - (t * t * t + 1);
  } else {
    // universe hasn't ended, full brightness
    existence = 1;
  }

  _offscreen.colorTarget(0, _textures.state[frontIndex]);
  _offscreen.colorTarget(1, _textures.history[frontIndex]);
  _offscreen.colorTarget(2, _textures.oscCounts[0][frontIndex]);
  _offscreen.colorTarget(3, _textures.cellColors);
  _offscreen.colorTarget(4, _textures.oscCounts[1][frontIndex]);
  _offscreen.colorTarget(5, _textures.minOscCount);
  _app.drawFramebuffer(_offscreen);

  _drawCalls.golStep.uniform('u_saturation_on', _saturation_on);
  _drawCalls.golStep.uniform('u_saturation_off', _saturation_off);
  _drawCalls.golStep.uniform('u_lightness_on', _lightness_on);
  _drawCalls.golStep.uniform('u_lightness_off', _lightness_off);
  _drawCalls.golStep.uniform('u_existence', existence);
  _drawCalls.golStep.uniform('u_observer_x1', _observerX1);
  _drawCalls.golStep.uniform('u_observer_y1', _observerY1);
  _drawCalls.golStep.uniform('u_observer_x2', _observerX2);
  _drawCalls.golStep.uniform('u_observer_y2', _observerY2);
  _drawCalls.golStep.texture('u_state', _textures.state[backIndex]);
  _drawCalls.golStep.texture('u_history', _textures.history[backIndex]);
  _drawCalls.golStep.texture('u_entropy', _textures.entropy);
  _drawCalls.golStep.texture('u_osc_count_1', _textures.oscCounts[0][backIndex]);
  _drawCalls.golStep.texture('u_osc_count_2', _textures.oscCounts[1][backIndex]);

  _app.gl.viewport(0, 0, _maxWidth, _maxHeight);
  _drawCalls.golStep.draw();

  _generation++;
}

function computeObserver() {
  if (_observerMode === 'eye') {
    _observerX1 = Math.max(0, Math.floor(_viewX1));
    _observerY1 = Math.max(0, Math.floor(_viewY1));
    _observerX2 = Math.min(_maxWidth - 1, Math.ceil(_viewX2));
    _observerY2 = Math.min(_maxHeight - 1, Math.ceil(_viewY2));
  } else if (_touchTexX >= 0) {
    _observerX1 = Math.max(0, _touchTexX);
    _observerY1 = Math.max(0, _touchTexY);
    _observerX2 = Math.min(_maxWidth - 1, _touchTexX);
    _observerY2 = Math.min(_maxHeight - 1, _touchTexY);
  } else {
    _observerX1 = _observerY1 = _observerX2 = _observerY2 = -1;
  }
}

function ensureEntropy() {
  const x1 = Math.max(0, Math.floor(_viewX1));
  const y1 = Math.max(0, Math.floor(_viewY1));
  const x2 = Math.min(_maxWidth, Math.floor(_viewX2));
  const y2 = Math.min(_maxHeight, Math.floor(_viewY2));

  const oldX1 = _entropyX1, oldY1 = _entropyY1;
  const oldX2 = _entropyX2, oldY2 = _entropyY2;
  const newX1 = Math.min(oldX1, x1);
  const newY1 = Math.min(oldY1, y1);
  const newX2 = Math.max(oldX2, x2);
  const newY2 = Math.max(oldY2, y2);

  if (newX1 === oldX1 && newY1 === oldY1 && newX2 === oldX2 && newY2 === oldY2) return;

  // use a high texture unit to avoid disturbing PicoGL's cached bindings on units 0-7
  const gl = _app.gl;
  const tempUnit = gl.TEXTURE15;
  const prevUnit = gl.getParameter(gl.ACTIVE_TEXTURE);
  gl.activeTexture(tempUnit);
  gl.bindTexture(gl.TEXTURE_2D, _textures.entropy.texture);

  if (newY1 < oldY1) uploadEntropyStrip(gl, newX1, newY1, newX2 - newX1, oldY1 - newY1);
  if (newY2 > oldY2) uploadEntropyStrip(gl, newX1, oldY2, newX2 - newX1, newY2 - oldY2);
  if (newX1 < oldX1) uploadEntropyStrip(gl, newX1, oldY1, oldX1 - newX1, oldY2 - oldY1);
  if (newX2 > oldX2) uploadEntropyStrip(gl, oldX2, oldY1, newX2 - oldX2, oldY2 - oldY1);

  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(prevUnit);
  _entropyX1 = newX1; _entropyY1 = newY1;
  _entropyX2 = newX2; _entropyY2 = newY2;
}

function uploadEntropyStrip(gl, x, y, w, h) {
  if (w <= 0 || h <= 0) return;
  const { PicoGL } = window;
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, PicoGL.RGBA_INTEGER, PicoGL.BYTE, generateRandomState(w, h));
}

function applyMomentum() {
  if (!_momentumActive) return;
  _panX -= _momentumVX * 16 * _zoom;
  _panY += _momentumVY * 16 * _zoom;
  _momentumVX *= 0.95;
  _momentumVY *= 0.95;
  if (Math.hypot(_momentumVX, _momentumVY) < 0.01) {
    _momentumActive = false;
  }
}

function computeViewport(clamped = true) {
  const viewW = _canvasWidth * _zoom;
  const viewH = _canvasHeight * _zoom;

  if (clamped) {
    _panX = Math.max(viewW / 2, Math.min(_panX, _maxWidth - viewW / 2));
    _panY = Math.max(viewH / 2, Math.min(_panY, _maxHeight - viewH / 2));
  }

  _viewX1 = _panX - viewW / 2;
  _viewY1 = _panY - viewH / 2;
  _viewX2 = _panX + viewW / 2;
  _viewY2 = _panY + viewH / 2;
}

function setViewportUniforms(dc) {
  dc.uniform('u_view_x1', _viewX1);
  dc.uniform('u_view_y1', _viewY1);
  dc.uniform('u_view_x2', _viewX2);
  dc.uniform('u_view_y2', _viewY2);
  dc.uniform('u_canvas_w', _canvasWidth);
  dc.uniform('u_canvas_h', _canvasHeight);
}

function draw() {
  computeViewport();

  const frontIndex = (_generation + (_generation < 0 ? 2 : 0)) % 2;

  if (TEXTURE_MODES[_textureMode] === 'activeCounts') {
    countActiveCells();
  }

  _app.gl.viewport(0, 0, _canvasWidth, _canvasHeight);

  _app.defaultDrawFramebuffer();

  switch (TEXTURE_MODES[_textureMode]) {
    case 'colors':
      _drawCalls.screenColors.texture('u_cell_colors', _textures.cellColors);
      setViewportUniforms(_drawCalls.screenColors);
      _drawCalls.screenColors.draw();
      break;
    case 'alive':
      _drawCalls.screenAlive.texture('u_state', _textures.state[frontIndex]);
      setViewportUniforms(_drawCalls.screenAlive);
      _drawCalls.screenAlive.draw();
      break;
    case 'state':
      _drawCalls.screenState.texture('u_state', _textures.state[frontIndex]);
      setViewportUniforms(_drawCalls.screenState);
      _drawCalls.screenState.draw();
      break;
    case 'hue':
      _drawCalls.screenHue.texture('u_state', _textures.state[frontIndex]);
      setViewportUniforms(_drawCalls.screenHue);
      _drawCalls.screenHue.draw();
      break;
    case 'oscCount':
      _drawCalls.screenOscCount.texture('u_osc_count', _textures.oscCounts[0][frontIndex]);
      setViewportUniforms(_drawCalls.screenOscCount);
      _drawCalls.screenOscCount.draw();
      break;
    case 'minOscCount':
      setViewportUniforms(_drawCalls.screenMinOscCount);
      _drawCalls.screenMinOscCount.draw();
      break;
    case 'active':
      _drawCalls.screenActive.texture('u_state', _textures.state[frontIndex]);
      setViewportUniforms(_drawCalls.screenActive);
      _drawCalls.screenActive.draw();
      break;
    case 'activeCounts':
      _drawCalls.screenActiveCounts.texture('u_state', _textures.state[frontIndex]);
      setViewportUniforms(_drawCalls.screenActiveCounts);
      _drawCalls.screenActiveCounts.draw();
      break;
  }
}

function reset() {
  _generation = START_GENERATION;
  _endedGeneration = -1;
  _maxActive = -1;
  // _panX = _maxWidth / 2;
  // _panY = _maxHeight / 2;
  // _zoom = 1 / _cellSize;

  // reset entropy region to initial universe
  _entropyX1 = (_maxWidth - _stateWidth) >> 1;
  _entropyY1 = (_maxHeight - _stateHeight) >> 1;
  _entropyX2 = _entropyX1 + _stateWidth;
  _entropyY2 = _entropyY1 + _stateHeight;

  // clear all simulation textures via GPU-side clearBuffer
  const { gl } = _app;
  const zeros_i = new Int32Array(4);
  const zeros_u = new Uint32Array(4);
  const zeros_f = new Float32Array(4);

  _textures.state.forEach(t => clearTexture(gl, _clearFramebuffer, t, 'iv', zeros_i));
  _textures.history.forEach(t => clearTexture(gl, _clearFramebuffer, t, 'uiv', zeros_u));
  _textures.oscCounts.forEach(pair => pair.forEach(t => clearTexture(gl, _clearFramebuffer, t, 'uiv', zeros_u)));
  clearTexture(gl, _clearFramebuffer, _textures.minOscCount, 'uiv', zeros_u);
  clearTexture(gl, _clearFramebuffer, _textures.cellColors, 'fv', zeros_f);

  // clear entropy and re-upload for initial region only
  clearTexture(gl, _clearFramebuffer, _textures.entropy, 'iv', zeros_i);
  _app.defaultDrawFramebuffer();

  const initialEntropy = generateRandomState(_stateWidth, _stateHeight);
  gl.bindTexture(gl.TEXTURE_2D, _textures.entropy.texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, _entropyX1, _entropyY1, _stateWidth, _stateHeight,
    PicoGL.RGBA_INTEGER, PicoGL.BYTE, initialEntropy);
  gl.bindTexture(gl.TEXTURE_2D, null);

  // expand entropy to cover current viewport (pan/zoom aren't reset)
  ensureEntropy();
}

function clearTexture(gl, framebuffer, texture, type, values) {
  // Use raw GL to attach only this single texture, avoiding framebuffer
  // incompleteness when _offscreen has stale MRT attachments from step().
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.texture, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  gl.viewport(0, 0, texture.width, texture.height);
  if (type === 'iv') gl.clearBufferiv(gl.COLOR, 0, values);
  else if (type === 'uiv') gl.clearBufferuiv(gl.COLOR, 0, values);
  else gl.clearBufferfv(gl.COLOR, 0, values);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
}

function countActiveCells() {
  const { gl } = _app;

  gl.viewport(0, 0, _activeWidth, _activeHeight);

  const frontIndex = (_generation + (_generation < 0 ? 2 : 0)) % 2;
  _app.drawFramebuffer(_activeFramebuffer);

  _drawCalls.countActive.texture('u_state', _textures.state[frontIndex]);
  _drawCalls.countActive.draw();
}

function readCellState(texX, texY) {
  const { gl } = _app;
  const backIndex = (_generation + (_generation < 0 ? 2 : 0)) % 2;
  const frontIndex = (backIndex + 1) % 2;
  const stateTexture = _textures.state[frontIndex];

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, _readFramebuffer);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTexture.texture, 0);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);

  const pixel = new Int8Array(4);
  gl.readPixels(texX, texY, 1, 1, gl.RGBA_INTEGER, gl.BYTE, pixel);

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

  return { r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] };
}

function getActiveCells() {
  const { PicoGL } = window;
  const { gl } = _app;
  let active = 0;

  countActiveCells();

  const readX = _activeWidth;
  const readY = _activeHeight;
  const skipX = 0;
  const skipY = 0;

  // read the active counts back from the GPU
  const { framebuffer } = _activeFramebuffer;

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);

  // TODO: for some reason, firefox on mac only supports RGBA_INTEGER/UNSIGNED_INT (min spec), instead of
  //       RED_INTEGER/UNSIGNED_BYTE, so this read transfers 16x more data than is actually needed
  gl.readPixels(skipX, skipY, readX - skipX, readY - skipY, PicoGL.RGBA_INTEGER, PicoGL.UNSIGNED_INT, _activeCounts);

  // manually clear the read framebuffer, otherwise chrome flashes between the last 3 states after resizing
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

  // sum only the universe-covering blocks
  const len = (readX - skipX) * (readY - skipY) * 4;
  for (let i = 0; i < len; i++) {
    active += _activeCounts[i];
  }

  return active;
}

async function loadShaderSource(filename) {
  const res = await fetch(`shaders/${filename}`);
  return await res.text();
}

async function init(reInit = false) {
  const { PicoGL } = window;
  const { width: displayWidth, height: displayHeight } = screen;
  const width = displayWidth * window.devicePixelRatio;
  const height = displayHeight * window.devicePixelRatio;
  if (_gridWidth || _gridHeight) {
    if (_gridWidth && _gridHeight) {
      _stateWidth = _gridWidth;
      _stateHeight = _gridHeight;
    } else if (_gridWidth) {
      _stateWidth = _gridWidth;
      const cellSz = Math.floor(width / _stateWidth);
      _stateHeight = _ratio > 0
        ? Math.floor(_stateWidth / _ratio)
        : Math.floor(height / cellSz);
    } else {
      _stateHeight = _gridHeight;
      const cellSz = Math.floor(height / _stateHeight);
      _stateWidth = _ratio > 0
        ? Math.floor(_stateHeight * _ratio)
        : Math.floor(width / cellSz);
    }
    _cellSize = Math.floor(Math.min(width / _stateWidth, height / _stateHeight));
  } else {
    _stateWidth = Math.floor(width / _cellSize);
    _stateHeight = Math.floor(height / _cellSize);
    if (_ratio > 0) {
      if (_ratio > _stateWidth / _stateHeight) {
        _stateHeight = Math.floor(_stateWidth / _ratio);
      } else {
        _stateWidth = Math.floor(_stateHeight * _ratio);
      }
    }
  }

  // max texture size = full screen pixel resolution (1 cell per pixel at max zoom-out)
  _maxWidth = Math.floor(width);
  _maxHeight = Math.floor(height);

  // initial entropy region = stateWidth x stateHeight, centered in max-size texture
  _entropyX1 = (_maxWidth - _stateWidth) >> 1;
  _entropyY1 = (_maxHeight - _stateHeight) >> 1;
  _entropyX2 = _entropyX1 + _stateWidth;
  _entropyY2 = _entropyY1 + _stateHeight;

  if (!reInit) {
    const canvasEl = document.getElementById('c');

    if (!canvasEl.getContext('webgl2')) {
      document.getElementById('no-webgl2').style.display = 'flex';
      return;
    }

    _canvasWidth = _stateWidth * _cellSize;
    _canvasHeight = _stateHeight * _cellSize;
    canvasEl.width = _canvasWidth;
    canvasEl.height = _canvasHeight;
    canvasEl.style.width = `${_canvasWidth / window.devicePixelRatio}px`;
    canvasEl.style.height = `${_canvasHeight / window.devicePixelRatio}px`;

    _textureDescEl.innerText = TEXTURE_DESC[_textureMode];

    _app = PicoGL.createApp(canvasEl);

    _quad = _app.createVertexBuffer(PicoGL.FLOAT, 2, new Float32Array([
      -1,  1,
      -1, -1,
       1, -1,
      -1,  1,
       1, -1,
       1,  1,
    ]));

    _vao = _app.createVertexArray().vertexAttributeBuffer(0, _quad);

    const quadVertSource = await loadShaderSource('quad.vert');
    const quadVertShader = _app.createShader(PicoGL.VERTEX_SHADER, quadVertSource);

    const [
      golStep,
      screenColors,
      screenAlive,
      screenState,
      screenHue,
      screenOscCount,
      screenMinOscCount,
      screenActive,
      countActive
    ] = await Promise.all(
      [
        'gol-step',
        'screen-colors',
        'screen-alive',
        'screen-state',
        'screen-hue',
        'screen-osc-count',
        'screen-min-osc-count',
        'screen-active',
        'count-active'
      ].map(
        async shader => _app.createProgram(quadVertShader, await loadShaderSource(`${shader}.frag`))
      )
    );


    Object.assign(_programs, {
      golStep,
      screenColors,
      screenAlive,
      screenState,
      screenHue,
      screenOscCount,
      screenMinOscCount,
      screenActive,
      countActive
    });
  }

  if (reInit) {
    _textures.entropy.delete();
    // _textures.state.forEach(state => state.delete());
    _textures.history[0].delete();
    _textures.history[1].delete();
    _textures.oscCounts.forEach(oscCounts => oscCounts.forEach(oscCount => oscCount.delete()));
    _textures.minOscCount.delete();
    _textures.cellColors.delete();
    _textures.activeCounts.delete();
  }

  // create entropy texture, clear it, then upload initial region only (batch entropy model)
  _textures.entropy = _app.createTexture2D(_maxWidth, _maxHeight, {
    internalFormat: PicoGL.RGBA8I,
    format: PicoGL.RGBA_INTEGER,
    type: PicoGL.BYTE,
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  const { gl } = _app;

  const createStateTexture = () => _app.createTexture2D(_maxWidth, _maxHeight, {
    internalFormat: PicoGL.RGBA8I,
    format: PicoGL.RGBA_INTEGER,
    type: PicoGL.BYTE,
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  // empty back and front state buffers
  _textures.state = [createStateTexture(), createStateTexture()];

  const createHistoryTexture = () => _app.createTexture2D(_maxWidth, _maxHeight, {
    internalFormat: PicoGL.R32UI,
    format: PicoGL.RGBA_INTEGER,
    type: PicoGL.UNSIGNED_INT,
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  // front and back history buffers, tracking the last 32 states for oscillator detection
  _textures.history = [createHistoryTexture(), createHistoryTexture()];

  const createOscCountTexture = () => _app.createTexture2D(_maxWidth, _maxHeight, {
    internalFormat: PicoGL.RGBA8UI,
    format: PicoGL.RGBA_INTEGER,
    type: PicoGL.UNSIGNED_BYTE,
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  // front and back counts for oscillation counts across the most common oscillator periods
  _textures.oscCounts = [
    [createOscCountTexture(), createOscCountTexture()],
    [createOscCountTexture(), createOscCountTexture()]
  ];

  _textures.minOscCount = _app.createTexture2D(_maxWidth, _maxHeight, {
    internalFormat: PicoGL.RG8UI,
    format: PicoGL.RG_INTEGER,
    type: PicoGL.UNSIGNED_INT,
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  _textures.cellColors = _app.createTexture2D(_maxWidth, _maxHeight, {
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  _activeWidth = Math.ceil(_maxWidth / 16);
  _activeHeight = Math.ceil(_maxHeight / 16);

  _activeCounts = new Uint32Array(_activeWidth * _activeHeight * 4);

  _textures.activeCounts = _app.createTexture2D(_activeWidth, _activeHeight, {
    internalFormat: PicoGL.RGBA8UI,
    format: PicoGL.RGBA_INTEGER,
    type: PicoGL.UNSIGNED_INT
  });

  // initial zoom: 1 cell = _cellSize canvas pixels, so _zoom = 1/_cellSize cells per pixel
  _zoom = 1 / _cellSize;
  _maxZoom = Math.max(_maxWidth / _canvasWidth, _maxHeight / _canvasHeight);
  _panX = _maxWidth / 2;
  _panY = _maxHeight / 2;

  _drawCalls.golStep = _app.createDrawCall(_programs.golStep, _vao);
  _drawCalls.screenColors = _app.createDrawCall(_programs.screenColors, _vao)
    .texture('u_cell_colors', _textures.cellColors);
  _drawCalls.screenAlive = _app.createDrawCall(_programs.screenAlive, _vao);
  _drawCalls.screenState = _app.createDrawCall(_programs.screenState, _vao);
  _drawCalls.screenHue = _app.createDrawCall(_programs.screenHue, _vao);
  _drawCalls.screenOscCount = _app.createDrawCall(_programs.screenOscCount, _vao);
  _drawCalls.screenMinOscCount = _app.createDrawCall(_programs.screenMinOscCount, _vao)
    .texture('u_min_osc_count', _textures.minOscCount);
  _drawCalls.screenActive = _app.createDrawCall(_programs.screenActive, _vao)
    .texture('u_min_osc_count', _textures.minOscCount)
    .texture('u_active_counts', _textures.activeCounts)
    .uniform('u_show_active_counts', 0);
  _drawCalls.screenActiveCounts = _app.createDrawCall(_programs.screenActive, _vao)
    .texture('u_min_osc_count', _textures.minOscCount)
    .texture('u_active_counts', _textures.activeCounts)
    .uniform('u_show_active_counts', 1);
  _drawCalls.countActive = _app.createDrawCall(_programs.countActive, _vao)
    .texture('u_min_osc_count', _textures.minOscCount);

  if (!reInit) {
    _offscreen = _app.createFramebuffer();
    _activeFramebuffer = _app.createFramebuffer().colorTarget(0, _textures.activeCounts);
    _readFramebuffer = _app.gl.createFramebuffer();
    _clearFramebuffer = _app.gl.createFramebuffer();
  } else {
    _activeFramebuffer.colorTarget(0, _textures.activeCounts);
  }

  // clear all textures to avoid lazy initialization warnings
  const zeros_i = new Int32Array(4);
  const zeros_u = new Uint32Array(4);
  const zeros_f = new Float32Array(4);
  _textures.state.forEach(t => clearTexture(gl, _clearFramebuffer, t, 'iv', zeros_i));
  _textures.history.forEach(t => clearTexture(gl, _clearFramebuffer, t, 'uiv', zeros_u));
  _textures.oscCounts.forEach(pair => pair.forEach(t => clearTexture(gl, _clearFramebuffer, t, 'uiv', zeros_u)));
  clearTexture(gl, _clearFramebuffer, _textures.minOscCount, 'uiv', zeros_u);
  clearTexture(gl, _clearFramebuffer, _textures.cellColors, 'fv', zeros_f);
  clearTexture(gl, _clearFramebuffer, _textures.entropy, 'iv', zeros_i);
  _app.defaultDrawFramebuffer();

  const initialEntropy = generateRandomState(_stateWidth, _stateHeight);
  const prevUnit = gl.getParameter(gl.ACTIVE_TEXTURE);
  gl.activeTexture(gl.TEXTURE15);
  gl.bindTexture(gl.TEXTURE_2D, _textures.entropy.texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, _entropyX1, _entropyY1, _stateWidth, _stateHeight,
    PicoGL.RGBA_INTEGER, PicoGL.BYTE, initialEntropy);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(prevUnit);
}

function cleanup() {
  _programs.golStep.delete();
  _vao.delete();
  _quad.delete();
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => {
      _wakeLock = null;
    });
  } catch (e) {
    console.log('wake lock denied:', e.message);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});

function generateRandomState(width, height) {
  const length = width * height * CELL_STATE_BYTES;
  const state = new Int8Array(length);
  const randBuffer = new Int8Array(MAX_ENTROPY);
  let remaining = length;

  // keep requesting random data until we've filled the state
  let chunk = 0;
  while (remaining) {
    const randLength = Math.min(remaining, MAX_ENTROPY);
    crypto.getRandomValues(randBuffer);
    state.set(randBuffer.slice(0, randLength), chunk * MAX_ENTROPY);

    remaining -= randLength;
    chunk++;
  }

  // convert life state to 0/1 based on probability of being alive
  for (let i = 0; i < length; i += CELL_STATE_BYTES) {
    // assume life state is first byte of cell bytes
    const normalized = (state[i] + 128) / 255;
    state[i] = normalized <= _cellAliveProbability ? 1 : 0;
  }

  return state;
}

