const DEFAULT_CELL_SIZE = 4;

const MAX_ENTROPY = 65536;
const CELL_STATE_BYTES = 4;
const CELL_OSC_COUNT_BYTES = 4;

let _app;
const _programs = {};
const _drawCalls = {};
const _textures = {};
let _cellSize = DEFAULT_CELL_SIZE;
let _oscCounts_1;
let _oscCounts32_1;
let _oscCounts_2;
let _oscCounts32_2;
let _offscreen;
let _quad;
let _vao;
let _stateWidth;
let _stateHeight;
let _generation = -1;
let _maxGenerations = -1;
let _entropy;
let _speed = -5;
let _running = true;
let _lastFPSUpdate = 0;
let _lastActiveUpdate = 0;
let _fps = 0;
let _saturation_on = 0.98;
let _saturation_off = 0.4;
let _lightness_on = 0.6;
let _lightness_off = 0.04;
const _fpsEl = document.getElementById('fps');
const _genEl = document.getElementById('gen');
const _activeEl = document.getElementById('active');

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

    if (now - 100 >= _lastActiveUpdate) {
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
          if (_saturation_on >= 0.01) {
            _saturation_on -= 0.01;
          }
        } else {
          if (_saturation_off >= 0.01) {
            _saturation_off -= 0.01;
          }
        }
      } else {
        if (e.ctrlKey) {
          if (_lightness_on >= 0.01) {
            _lightness_on -= 0.01;
          }
        } else {
          if (_lightness_off >= 0.01) {
            _lightness_off -= 0.01;
          }
        }
      }

      break;
    case 38:  // UP
      _speed++;
      e.preventDefault();
      break;
    case 39:  // RIGHT
      e.preventDefault();
      if (e.shiftKey) {
        if (e.ctrlKey) {
          if (_saturation_on < 0.99) {
            _saturation_on += 0.01;
          }
        } else {
          if (_saturation_off < 0.99) {
            _saturation_off += 0.01;
          }
        }
      } else {
        if (e.ctrlKey) {
          if (_lightness_on < 0.99) {
            _lightness_on += 0.01;
          }
        } else {
          if (_lightness_off < 0.99) {
            _lightness_off += 0.01;
          }
        }
      }
      break;
    case 40:  // DOWN
      _speed--;
      e.preventDefault();
      break;
    case 82:  // r
      reset();
    case 61: // + (win on FF?)
    case 187: // +
      if (e.shiftKey) {
        _cellSize++;
        init(true);
        reset();
      }
      break;
    case 173: // + (win on FF?)
    case 189: // -
    if (e.shiftKey && _cellSize > 1) {
      _cellSize--;
      init(true);
      reset();
    }
    break;
    default:
      console.log(e.which);
  }
});

function step() {
  const backIndex = Math.max(0, _generation % 2);
  const frontIndex = (backIndex + 1) % 2;

  _offscreen.colorTarget(0, _textures.state[frontIndex]);
  _offscreen.colorTarget(1, _textures.history[frontIndex]);
  _offscreen.colorTarget(2, _textures.oscCounts[0][frontIndex]);
  _offscreen.colorTarget(3, _textures.cellColors);
  _offscreen.colorTarget(4, _textures.oscCounts[1][frontIndex]);
  _app.drawFramebuffer(_offscreen);

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
  _drawCalls.screen.texture('u_cell_colors', _textures.cellColors);
  // _drawCalls.screen.texture('u_cell_colors', _textures.oscCount[0]);
  _drawCalls.screen.draw();
}

function reset() {
  _generation = -1;

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
    active = 0;
    for (let i = 0, l = _oscCounts_1.length; i < l; i += 4) {
      if (
        _oscCounts_1[i] < 36 &&
        _oscCounts_1[i + 1] < 36 &&
        _oscCounts_1[i + 2] < 36 &&
        _oscCounts_1[i + 3] < 36 &&
        _oscCounts_2[i] < 36 &&
        _oscCounts_2[i + 1] < 36
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

async function init(reinit = false) {
  const { PicoGL } = window;
  const { width: displayWidth, height: displayHeight } = screen;
  const width = displayWidth; // * window.devicePixelRatio;
  const height = displayHeight; // * window.devicePixelRatio;
  _stateWidth = Math.floor(width / _cellSize);
  _stateHeight = Math.floor(height / _cellSize);

  console.log(width, height, _stateWidth, _stateHeight);

  if (!reinit) {
    const canvasEl = document.getElementById('c');
    canvasEl.width = width;
    canvasEl.height = height;
    canvasEl.style.width = `${displayWidth}px`;
    canvasEl.style.height = `${displayHeight}px`;

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
    _programs.golStep = _app.createProgram(quadVertShader, await loadShaderSource('gol-step.frag'));
    _programs.screen = _app.createProgram(quadVertShader, await loadShaderSource('screen.frag'));
  }

  const entropy = generateRandomState(_stateWidth, _stateHeight);

  if (reinit) {
    _textures.entropy.delete();
    // _textures.state.forEach(state => state.delete());
    _textures.history[0].delete();
    _textures.history[1].delete();
    _textures.oscCounts.forEach(oscCounts => oscCounts.forEach(oscCount => oscCount.delete()));
    _textures.cellColors.delete();
  }

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

  _textures.state = [
    // random back buffer
    createStateTexture(),

    // empty front buffer
    createStateTexture()
  ];

  const createHistoryTexture = () => _app.createTexture2D(_stateWidth, _stateHeight, {
    internalFormat: PicoGL.R32UI,
    format: PicoGL.RGBA_INTEGER,
    type: PicoGL.UNSIGNED_INT,
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  _textures.history = [createHistoryTexture(), createHistoryTexture()];

  const createOscCountTexture = () => _app.createTexture2D(_stateWidth, _stateHeight, {
    internalFormat: PicoGL.RGBA8UI,
    format: PicoGL.RGBA_INTEGER,
    type: PicoGL.UNSIGNED_BYTE,
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

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
  _drawCalls.screen = _app.createDrawCall(_programs.screen, _vao)
    .uniform('cell_size', _cellSize);

  if (!reinit) {
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
    state[i] = state[i] >= 0 ? 1 : 0;
  }

  return state;
}