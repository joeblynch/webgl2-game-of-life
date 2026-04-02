// NOTE: This code is ugly because it's uninteresting, so as little time was spent on it as possible.
//       The magic happens in gol-step.frag.

const DEFAULT_CELL_SIZE = Math.floor(2 * window.devicePixelRatio) + 1;
const DEFAULT_ALIVE_PROBABILITY = 0.5;
const DEFAULT_SPEED = -4;
const DEFAULT_SATURATION_ON = 0.98;
const DEFAULT_SATURATION_OFF = 1.0;
const DEFAULT_LIGHTNESS_ON = 0.76;
const DEFAULT_LIGHTNESS_OFF = 0.015;
const DEFAULT_HUE_SHIFT = 2.0;
const DEFAULT_TEXTURE_MODE = 0;

const MAX_ENTROPY = 65536;
const CELL_STATE_BYTES = 4;
const CELL_OSC_COUNT_BYTES = 4;

const TEXTURE_MODES = ['colors', 'alive', 'active', 'activeCounts', 'oscCount', 'minOscCount', 'state', 'hue'];
const TEXTURE_DESC = [
  '', // color composite
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

let _app;
const _programs = {};
const _drawCalls = {};
const _textures = {};
const options = parseHash();
let _cellAliveProbability = options.alive >= 0 && options.alive <= 1 ? options.alive : DEFAULT_ALIVE_PROBABILITY;
let _cellSize = options.size || DEFAULT_CELL_SIZE;
let _speed = typeof options.speed === 'number' ? options.speed : DEFAULT_SPEED;
let _saturation_on = typeof options.satOn === 'number' ? options.satOn : DEFAULT_SATURATION_ON;
let _saturation_off = typeof options.satOff === 'number' ? options.satOff : DEFAULT_SATURATION_OFF;
let _lightness_on = typeof options.liOn === 'number' ? options.liOn : DEFAULT_LIGHTNESS_ON;
let _lightness_off = typeof options.liOff === 'number' ? options.liOff : DEFAULT_LIGHTNESS_OFF;
let _hueShift = typeof options.hueShift === 'number' ? options.hueShift : DEFAULT_HUE_SHIFT;
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
let _universeWidth;
let _universeHeight;
let _universeOffsetX;
let _universeOffsetY;
let _canvasWidth;
let _canvasHeight;
let _activeWidth;
let _activeHeight;
let _activeFramebuffer;
let _generation = START_GENERATION;
let _xEdgeDist = START_GENERATION + 1;
let _yEdgeDist = START_GENERATION + 1;
let _maxGenerations = -1;
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
let _fps = 0;
const _fpsEl = document.getElementById('fps');
const _genEl = document.getElementById('gen');
const _activeEl = document.getElementById('active');
const _textureDescEl = document.getElementById('texture-desc');

(async function main() {
  await init();
  requestWakeLock();

  let frame = 0;

  requestAnimationFrame(function render(now) {
    requestAnimationFrame(render);

    if (!_running) {
      return;
    }

    frame++;
    if (_speed < 0) {
      if (frame % -_speed === 0) {
        _genEl.innerText = _generation;
        step();
        _fps++;
      } else {
        return;
      }
    } else {
      // start at -1 so that we always do an extra step. otherwise 1 step for speed -1 and speed 0.
      for (let i = -1; i <= _speed; i++) {
        step();
        _fps++;
      }

      _genEl.innerText = _generation - 1;
    }

    applyMomentum();
    draw();

    if (now - 1000 >= _lastFPSUpdate) {
      _fpsEl.innerText = _fps;

      _lastFPSUpdate = now;
      _fps = 0;
    }

    if (now - 250 >= _lastActiveUpdate && _generation > 0 && _endedGeneration < 0) {
      const active = getActiveCells();
      _activeEl.innerText = active;
      if (!active && _generation + 2 > Math.max(_universeWidth >> 1, _universeHeight >> 1)) {
        if (_generation > _maxGenerations) {
          _maxGenerations = _generation;
          console.log('max generations: ', _generation, _entropy);
        }

        _endedGeneration = _generation - 1;
      }

      _lastActiveUpdate = now;
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

  // TODO: probably a lot more performant to use an uniform buffer object
  _drawCalls.golStep.uniform('u_saturation_on', _saturation_on);
  _drawCalls.golStep.uniform('u_saturation_off', _saturation_off);
  _drawCalls.golStep.uniform('u_lightness_on', _lightness_on);
  _drawCalls.golStep.uniform('u_lightness_off', _lightness_off);
  _drawCalls.golStep.uniform('u_hue_shift', _hueShift);
  _drawCalls.golStep.uniform('u_existence', existence);
  _drawCalls.golStep.uniform('u_universe_offset_x', _universeOffsetX);
  _drawCalls.golStep.uniform('u_universe_offset_y', _universeOffsetY);
  _drawCalls.golStep.uniform('u_universe_w', _universeWidth);
  _drawCalls.golStep.uniform('u_universe_h', _universeHeight);
  _drawCalls.golStep.uniform('u_x_edge_dist', _xEdgeDist);
  _drawCalls.golStep.uniform('u_y_edge_dist', _yEdgeDist);
  _drawCalls.golStep.texture('u_state', _textures.state[backIndex]);
  _drawCalls.golStep.texture('u_history', _textures.history[backIndex]);
  _drawCalls.golStep.texture('u_entropy', _textures.entropy);
  _drawCalls.golStep.texture('u_osc_count_1', _textures.oscCounts[0][backIndex]);
  _drawCalls.golStep.texture('u_osc_count_2', _textures.oscCounts[1][backIndex]);

  _app.gl.viewport(_universeOffsetX, _universeOffsetY, _universeWidth, _universeHeight);
  _drawCalls.golStep.draw();

  _generation++;
  _xEdgeDist = Math.min(_xEdgeDist + 1, Math.floor(_universeWidth / 2) + 1);
  _yEdgeDist = Math.min(_yEdgeDist + 1, Math.floor(_universeHeight / 2) + 1);
}

function applyMomentum() {
  if (!_momentumActive) return;
  const dpr = window.devicePixelRatio;
  _panX -= _momentumVX * 16 * dpr * _zoom;
  _panY += _momentumVY * 16 * dpr * _zoom;
  _momentumVX *= 0.95;
  _momentumVY *= 0.95;
  if (Math.hypot(_momentumVX, _momentumVY) < 0.01) {
    _momentumActive = false;
  }
}

function computeViewport() {
  const viewW = _canvasWidth * _zoom;
  const viewH = _canvasHeight * _zoom;

  // clamp pan so viewport stays within max universe bounds (0..maxWidth, 0..maxHeight)
  _panX = Math.max(viewW / 2, Math.min(_panX, _maxWidth - viewW / 2));
  _panY = Math.max(viewH / 2, Math.min(_panY, _maxHeight - viewH / 2));

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
  dc.uniform('u_universe_offset_x', _universeOffsetX);
  dc.uniform('u_universe_offset_y', _universeOffsetY);
  dc.uniform('u_universe_w', _universeWidth);
  dc.uniform('u_universe_h', _universeHeight);
}

function maybeExpandUniverse() {
  const gapLeft = Math.max(0, -_viewX1);
  const gapRight = Math.max(0, _viewX2 - _universeWidth);
  const gapTop = Math.max(0, _viewY2 - _universeHeight);
  const gapBottom = Math.max(0, -_viewY1);
  const maxGap = Math.max(gapLeft, gapRight, gapTop, gapBottom);
  if (maxGap <= 0) return;

  const expand = Math.ceil(maxGap) * 2;
  const newW = Math.min(_universeWidth + expand, _maxWidth);
  const newH = Math.min(_universeHeight + expand, _maxHeight);
  if (newW === _universeWidth && newH === _universeHeight) return;

  // clamp edge distances to old universe half-sizes so the event horizon re-expands
  const oldHalfW = Math.floor(_universeWidth / 2);
  const oldHalfH = Math.floor(_universeHeight / 2);
  _xEdgeDist = Math.min(_xEdgeDist, oldHalfW + 1);
  _yEdgeDist = Math.min(_yEdgeDist, oldHalfH + 1);

  // adjust pan to account for universe origin shifting
  const newOffX = Math.floor((_maxWidth - newW) / 2);
  const newOffY = Math.floor((_maxHeight - newH) / 2);
  _panX += _universeOffsetX - newOffX;
  _panY += _universeOffsetY - newOffY;

  _universeWidth = newW;
  _universeHeight = newH;
  _universeOffsetX = newOffX;
  _universeOffsetY = newOffY;
}

function draw() {
  computeViewport();
  maybeExpandUniverse();
  computeViewport();  // recompute after expansion may have adjusted pan

  const frontIndex = (_generation + (_generation < 0 ? 2 : 0)) % 2;

  if (TEXTURE_MODES[_textureMode] === 'activeCounts') {
    countActiveCells();
  }

  _app.gl.viewport(0, 0, _canvasWidth, _canvasHeight);

  _app.defaultDrawFramebuffer();

  switch (TEXTURE_MODES[_textureMode]) {
    case 'colors':
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
  _xEdgeDist = START_GENERATION + 1;
  _yEdgeDist = START_GENERATION + 1;
  _endedGeneration = -1;

  // reset universe to initial size
  _universeWidth = _stateWidth;
  _universeHeight = _stateHeight;
  _universeOffsetX = Math.floor((_maxWidth - _universeWidth) / 2);
  _universeOffsetY = Math.floor((_maxHeight - _universeHeight) / 2);
  _panX = _universeWidth / 2;
  _panY = _universeHeight / 2;
  _zoom = 1 / _cellSize;

  _entropy = generateRandomState(_maxWidth, _maxHeight);

  _textures.entropy.delete();
  _textures.entropy = _app.createTexture2D(_entropy, _maxWidth, _maxHeight, {
    internalFormat: PicoGL.RGBA8I,
    format: PicoGL.RGBA_INTEGER,
    type: PicoGL.BYTE,
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  // _textures.entropy.data([initialState]);
  // _textures.state[1].data(new Int8Array(_stateHeight * _stateWidth * CELL_STATE_BYTES));
  // _textures.history.data(new Uint32Array(_stateHeight * _stateWidth));
  // _textures.oscCount[0].data(new Uint8Array(_stateHeight * _stateWidth * CELL_OSC_COUNT_BYTES));
}

function countActiveCells() {
  const { gl } = _app;

  gl.viewport(0, 0, _activeWidth, _activeHeight);

  const frontIndex = (_generation + (_generation < 0 ? 2 : 0)) % 2;
  _app.drawFramebuffer(_activeFramebuffer);

  _drawCalls.countActive.texture('u_state', _textures.state[frontIndex]);
  _drawCalls.countActive.draw();
}

function getActiveCells() {
  const { PicoGL } = window;
  const { gl } = _app;
  let active = 0;

  countActiveCells();
  
  // read the active counts back from the GPU
  const { framebuffer } = _activeFramebuffer;

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);

  // TODO: for some reason, firefox on mac only supports RGBA_INTEGER/UNSIGNED_INT (min spec), instead of
  //       RED_INTEGER/UNSIGNED_BYTE, so this read transfers 16x more data than is actually needed
  // const start = performance.now();
  gl.readPixels(0, 0, _activeWidth, _activeHeight, PicoGL.RGBA_INTEGER, PicoGL.UNSIGNED_INT, _activeCounts);
  // console.log(performance.now() - start);

  // manually clear the read framebuffer, otherwise chrome flashes between the last 3 states after resizing
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

  // sum the active blocks
  for (let i = 0, l = _activeCounts.length; i < l; i++) {
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

  // initial universe = stateWidth x stateHeight, centered in max-size texture
  _universeWidth = _stateWidth;
  _universeHeight = _stateHeight;
  _universeOffsetX = Math.floor((_maxWidth - _universeWidth) / 2);
  _universeOffsetY = Math.floor((_maxHeight - _universeHeight) / 2);

  console.log(width, height, _stateWidth, _stateHeight, 'max:', _maxWidth, _maxHeight);

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

  const entropy = generateRandomState(_maxWidth, _maxHeight);

  _textures.entropy = _app.createTexture2D(entropy, _maxWidth, _maxHeight, {
    internalFormat: PicoGL.RGBA8I,
    format: PicoGL.RGBA_INTEGER,
    type: PicoGL.BYTE,
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

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
  _panX = _universeWidth / 2;
  _panY = _universeHeight / 2;

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
  } else {
    _activeFramebuffer.colorTarget(0, _textures.activeCounts);
  }
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

