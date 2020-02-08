// NOTE: This code is ugly because it's uninteresting, so as little time was spent on it as possible.
//       The magic is happens in gol-step.frag.

const DEFAULT_CELL_SIZE = Math.floor(3 * window.devicePixelRatio);

const MAX_ENTROPY = 65536;
const CELL_STATE_BYTES = 4;
const CELL_OSC_COUNT_BYTES = 4;

const TEXTURE_MODES = ['colors', 'alive', 'active', 'oscCount', 'state', 'hue'];
const TEXTURE_DESC = [
  '' /* color composite */,
  'alive bit',
  'active (non-oscillating) alive cells',
  'oscillator counters',
  'raw state (r: alive, gb: xy hue vector)',
  'hue state'
];

function parseHash() {
  return location.hash
    .substr(1)
    .split('&')
    .map(kv => kv.split('='))
    .reduce((hash, [key, value]) => {
      if (key) {
        if (value && value.match(/^-?\d+(?:\.\d+)?$/)) {
          value = parseFloat(value);
        }

        hash[key] = value;
      }

      return hash;
    }, {});
}

function updateHash() {
  const options = parseHash();
  options.alive = _cellAliveProbability;
  options.size = _cellSize;
  options.speed = _speed;
  options.satOn = _saturation_on.toPrecision(3);
  options.satOff = _saturation_off.toPrecision(3);
  options.liOn = _lightness_on.toPrecision(3);
  options.liOff = _lightness_off.toPrecision(3);
  options.texture = _textureMode;

  location.hash = Object.keys(options)
    .map(key => `${key}=${options[key]}`)
    .join('&');
}

// NOTE: seed entropy saved before 2019/11/08 uses a start generation of -1
const START_GENERATION = -2;

let _app;
const _programs = {};
const _drawCalls = {};
const _textures = {};
const options = parseHash();
let _cellAliveProbability = options.alive >= 0 && options.alive <= 1 ? options.alive : 0.5;
let _cellSize = options.size || DEFAULT_CELL_SIZE;
let _speed = typeof options.speed === 'number' ? options.speed : -5;
let _saturation_on = typeof options.satOn === 'number' ? options.satOn : 0.98;
let _saturation_off = typeof options.satOff === 'number' ? options.satOff : 0.4;
let _lightness_on = typeof options.liOn === 'number' ? options.liOn : 0.76;
let _lightness_off = typeof options.liOff === 'number' ? options.liOff : 0.045;
let _textureMode = options.texture >= 0 && options.texture < TEXTURE_MODES.length ? options.texture : 0;
let _oscCounts_1;
let _oscCounts32_1;
let _oscCounts_2;
let _oscCounts32_2;
let _offscreen;
let _quad;
let _vao;
let _stateWidth;
let _stateHeight;
let _generation = START_GENERATION;
let _maxGenerations = -1;
let _entropy;
let _running = true;
let _lastFPSUpdate = 0;
let _lastActiveUpdate = 0;
let _fps = 0;
const _fpsEl = document.getElementById('fps');
const _genEl = document.getElementById('gen');
const _activeEl = document.getElementById('active');
const _textureDescEl = document.getElementById('texture-desc');

const ADJ_STEP = 0.005;

(async function main() {
  await init();

  let frame = 0;

  requestAnimationFrame(function render(now) {
    requestAnimationFrame(render);

    if (!_running) {
      return;
    }

    frame++;
    if (_speed < 0) {
      if (frame % -_speed === 0) {
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
    }

    _genEl.innerText = _generation;

    draw();

    if (now - 1000 >= _lastFPSUpdate) {
      _fpsEl.innerText = _fps;

      _lastFPSUpdate = now;
      _fps = 0;
    }

    if (now - 250 >= _lastActiveUpdate) {
      const active = getActiveCells();
      _activeEl.innerText = active;
      if (!active) {
        if (_generation > _maxGenerations) {
          _maxGenerations = _generation;
          console.log('max generations: ', _generation, _entropy);
        }
        reset();
      }
      _lastActiveUpdate = now;
    }
  });
})();

document.addEventListener('keydown', (e) => {
  switch (e.which) {
    case 32:  // SPACE
      _running = !_running;
      break;
    case 37:  // LEFT
      e.preventDefault();
      if (e.shiftKey) {
        if (e.ctrlKey) {
          if (_saturation_on >= ADJ_STEP) {
            _saturation_on -= ADJ_STEP;
          } else {
            _saturation_on = 0;
          }
        } else {
          if (_saturation_off >= ADJ_STEP) {
            _saturation_off -= ADJ_STEP;
          } else {
            _saturation_off = 0;
          }
        }
      } else {
        if (e.ctrlKey) {
          if (_lightness_on >= ADJ_STEP) {
            _lightness_on -= ADJ_STEP;
          } else {
            _lightness_on = 0;
          }
        } else {
          if (_lightness_off >= ADJ_STEP) {
            _lightness_off -= ADJ_STEP;
          } else {
            _lightness_off = 0;
          }
        }
      }

      updateHash();

      break;
    case 38:  // UP
      _speed++;
      updateHash();
      e.preventDefault();
      break;
    case 39:  // RIGHT
      e.preventDefault();
      if (e.shiftKey) {
        if (e.ctrlKey) {
          if (_saturation_on < 1 - ADJ_STEP) {
            _saturation_on += ADJ_STEP;
          } else {
            _saturation_on = 1;
          }
        } else {
          if (_saturation_off < 1 - ADJ_STEP) {
            _saturation_off += ADJ_STEP;
          } else {
            _saturation_off = 1;
          }
        }
      } else {
        if (e.ctrlKey) {
          if (_lightness_on < 1 - ADJ_STEP) {
            _lightness_on += ADJ_STEP;
          } else {
            _lightness_on = 1;
          }
        } else {
          if (_lightness_off < 1 - ADJ_STEP) {
            _lightness_off += ADJ_STEP;
          } else {
            _lightness_off = 1;
          }
        }
      }

      updateHash();

      break;
    case 40:  // DOWN
      _speed--;
      updateHash();
      e.preventDefault();
      break;
    case 49:  // 1-6
    case 50:
    case 51:
    case 52:
    case 53:
    case 54:
      _textureMode = e.which - 49;
      _textureDescEl.innerText = TEXTURE_DESC[_textureMode];
      break;
    case 70:  // f
      toggleFullscreen();
      break;
    case 72:  // h
      toggleHelp();
      break;
    case 82:  // r
      if (e.shiftKey) {
        reset();
      } else {
        _generation = START_GENERATION;
      }
      break;
    case 84:  // t
      _textureMode = (_textureMode + 1) % TEXTURE_MODES.length;
      _textureDescEl.innerText = TEXTURE_DESC[_textureMode];
      updateHash();
      break;
    case 85: // u
      toggleUI();
      break;
    case 61: // + (win on FF?)
    case 187: // +
      if (e.shiftKey) {
        _cellSize++;
        updateHash();
        init(true);
        reset();
      }
      break;
    case 173: // + (win on FF?)
    case 189: // -
      if (e.shiftKey && _cellSize > 1) {
        _cellSize--;
        updateHash();
        init(true);
        reset();
      }
      break;
    case 191:  // ?
      if (e.shiftKey) {
        toggleHelp();
      }
      break;
    default:
      console.log(e.which);
  }
});

function toggleFullscreen() {
  if (document.fullscreenElement) { 
    document.exitFullscreen();
  } else {
    document.body.requestFullscreen({ navigationUI: 'hide' });
  }
}

document.addEventListener('dblclick', toggleFullscreen);

function step() {
  const backIndex = Math.max(0, _generation % 2);
  const frontIndex = (backIndex + 1) % 2;

  _offscreen.colorTarget(0, _textures.state[frontIndex]);
  _offscreen.colorTarget(1, _textures.history[frontIndex]);
  _offscreen.colorTarget(2, _textures.oscCounts[0][frontIndex]);
  _offscreen.colorTarget(3, _textures.cellColors);
  _offscreen.colorTarget(4, _textures.oscCounts[1][frontIndex]);
  _app.drawFramebuffer(_offscreen);

  // TODO: probably a lot more performant to use an uniform buffer object
  _drawCalls.golStep.uniform('u_generation', _generation);
  _drawCalls.golStep.uniform('u_saturation_on', _saturation_on);
  _drawCalls.golStep.uniform('u_saturation_off', _saturation_off);
  _drawCalls.golStep.uniform('u_lightness_on', _lightness_on);
  _drawCalls.golStep.uniform('u_lightness_off', _lightness_off);
  _drawCalls.golStep.texture('u_state', _textures.state[backIndex]);
  _drawCalls.golStep.texture('u_history', _textures.history[backIndex]);
  _drawCalls.golStep.texture('u_entropy', _textures.entropy);
  _drawCalls.golStep.texture('u_osc_count_1', _textures.oscCounts[0][backIndex]);
  _drawCalls.golStep.texture('u_osc_count_2', _textures.oscCounts[1][backIndex]);
  _drawCalls.golStep.draw();

  _generation++;
}

function draw() {
  _app.defaultDrawFramebuffer();

  switch (TEXTURE_MODES[_textureMode]) {
    case 'colors':
      _drawCalls.screenColors.texture('u_cell_colors', _textures.cellColors);
      _drawCalls.screenColors.draw();
      break;
    case 'alive':
      _drawCalls.screenAlive.texture('u_state', _textures.state[_generation % 2]);
      _drawCalls.screenAlive.draw();
      break;
    case 'state':
      _drawCalls.screenState.texture('u_state', _textures.state[_generation % 2]);
      _drawCalls.screenState.draw();
      break;
    case 'hue':
      _drawCalls.screenHue.texture('u_state', _textures.state[_generation % 2]);
      _drawCalls.screenHue.draw();
      break;
    case 'oscCount':
      _drawCalls.screenOscCount.texture('u_osc_count', _textures.oscCounts[0][_generation % 2]);
      _drawCalls.screenOscCount.draw();
      break;
    case 'active':
      _drawCalls.screenActive.texture('u_osc_count', _textures.oscCounts[0][_generation % 2]);
      _drawCalls.screenActive.draw();
      break;
  }
}

function reset() {
  _generation = START_GENERATION;

  _entropy = generateRandomState(_stateWidth, _stateHeight);

  _textures.entropy.delete();
  _textures.entropy = _app.createTexture2D(_entropy, _stateWidth, _stateHeight, {
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

function getActiveCells() {
  const { PicoGL } = window;
  const { gl } = _app;
  const { framebuffer } = _offscreen;
  let active = 0;

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
  gl.readBuffer(gl.COLOR_ATTACHMENT2);
  // FIXME: this fails in firefox on mac for some reason, with `readPixels: Incompatible format or type.`
  gl.readPixels(0, 0, _stateWidth, _stateHeight, PicoGL.RGBA_INTEGER, PicoGL.UNSIGNED_BYTE, _oscCounts_1);

  gl.readBuffer(gl.COLOR_ATTACHMENT4);
  gl.readPixels(0, 0, _stateWidth, _stateHeight, PicoGL.RGBA_INTEGER, PicoGL.UNSIGNED_BYTE, _oscCounts_2);

  // _oscCounts32 is a uint32 view of the uint8 _oscCounts buffer, quicker to search through
  for (let i = 0, l = _oscCounts32_1.length; i < l; i++) {
    if (_oscCounts32_1[i] === 0 && _oscCounts32_2[i] === 0) {
      active++;
    }
  }

  if (!active) {
    // no cells are active, but lets give everything a chance to fade out for a bit
    const MIN_FADE_ACTIVE_COUNT = 36;
    active = 0;
    for (let i = 0, l = _oscCounts_1.length; i < l; i += 4) {
      if (
        _oscCounts_1[i] < MIN_FADE_ACTIVE_COUNT &&
        _oscCounts_1[i + 1] < MIN_FADE_ACTIVE_COUNT &&
        _oscCounts_1[i + 2] < MIN_FADE_ACTIVE_COUNT &&
        _oscCounts_1[i + 3] < MIN_FADE_ACTIVE_COUNT &&
        _oscCounts_2[i] < MIN_FADE_ACTIVE_COUNT &&
        _oscCounts_2[i + 1] < MIN_FADE_ACTIVE_COUNT
      ) {
        active++;
      }
    }
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
  _stateWidth = Math.floor(width / _cellSize);
  _stateHeight = Math.floor(height / _cellSize);

  console.log(width, height, _stateWidth, _stateHeight);

  if (!reInit) {
    const canvasEl = document.getElementById('c');
    canvasEl.width = width;
    canvasEl.height = height;
    canvasEl.style.width = `${displayWidth}px`;
    canvasEl.style.height = `${displayHeight}pzx`;

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
      screenActive
    ] = await Promise.all(
      [
        'gol-step',
        'screen-colors',
        'screen-alive',
        'screen-state',
        'screen-hue',
        'screen-osc-count',
        'screen-active'
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
      screenActive
    });
  }

  if (reInit) {
    _textures.entropy.delete();
    // _textures.state.forEach(state => state.delete());
    _textures.history[0].delete();
    _textures.history[1].delete();
    _textures.oscCounts.forEach(oscCounts => oscCounts.forEach(oscCount => oscCount.delete()));
    _textures.cellColors.delete();
  }

  const entropy = generateRandomState(_stateWidth, _stateHeight);

  _textures.entropy = _app.createTexture2D(entropy, _stateWidth, _stateHeight, {
    internalFormat: PicoGL.RGBA8I,
    format: PicoGL.RGBA_INTEGER,
    type: PicoGL.BYTE,
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  const createStateTexture = () => _app.createTexture2D(_stateWidth, _stateHeight, {
    internalFormat: PicoGL.RGBA8I,
    format: PicoGL.RGBA_INTEGER,
    type: PicoGL.BYTE,
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  // empty back and front state buffers
  _textures.state = [createStateTexture(), createStateTexture()];

  const createHistoryTexture = () => _app.createTexture2D(_stateWidth, _stateHeight, {
    internalFormat: PicoGL.R32UI,
    format: PicoGL.RGBA_INTEGER,
    type: PicoGL.UNSIGNED_INT,
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  // front and back history buffers, tracking the last 32 states for oscillator detection
  _textures.history = [createHistoryTexture(), createHistoryTexture()];

  const createOscCountTexture = () => _app.createTexture2D(_stateWidth, _stateHeight, {
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

  _oscCounts_1 = new Uint8Array(_stateWidth * _stateHeight * 4);
  _oscCounts32_1 = new Uint32Array(_oscCounts_1.buffer)
  _oscCounts_2 = new Uint8Array(_stateWidth * _stateHeight * 4);
  _oscCounts32_2 = new Uint32Array(_oscCounts_2.buffer)

  _textures.cellColors = _app.createTexture2D(_stateWidth, _stateHeight, {
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  _drawCalls.golStep = _app.createDrawCall(_programs.golStep, _vao);
  _drawCalls.screenColors = _app.createDrawCall(_programs.screenColors, _vao)
    .uniform('cell_size', _cellSize);
  _drawCalls.screenAlive = _app.createDrawCall(_programs.screenAlive, _vao)
    .uniform('cell_size', _cellSize);
  _drawCalls.screenState = _app.createDrawCall(_programs.screenState, _vao)
    .uniform('cell_size', _cellSize);
  _drawCalls.screenHue = _app.createDrawCall(_programs.screenHue, _vao)
    .uniform('cell_size', _cellSize);
  _drawCalls.screenOscCount = _app.createDrawCall(_programs.screenOscCount, _vao)
    .uniform('cell_size', _cellSize);
  _drawCalls.screenActive = _app.createDrawCall(_programs.screenActive, _vao)
    .uniform('cell_size', _cellSize);

  if (!reInit) {
    _offscreen = _app.createFramebuffer();
  }
}

function cleanup() {
  _programs.golStep.delete();
  _vao.delete();
  _quad.delete();
}

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

function toggleHelp() {
  const el = document.getElementById('help-container');
  el.classList.toggle('hidden');
}

function toggleUI() {
  document.body.classList.toggle('hide-ui');
}