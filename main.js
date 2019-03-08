const CELL_SIZE = 4;

const MAX_ENTROPY = 65536;
const CELL_STATE_BYTES = 4;
const CELL_OSC_COUNT_BYTES = 4;

let _app;
const _programs = {};
const _drawCalls = {};
const _textures = {};
let _oscCounts;
let _oscCounts32;
let _offscreen;
let _quad;
let _vao;
let _stateWidth;
let _stateHeight;
let _generation = -1;
let _speed = -5;
let _running = true;
let _lastFPSUpdate = 0;
let _fps = 0;
const _fpsEl = document.getElementById('fps');
const _genEl = document.getElementById('gen');

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

      if (!hasActiveCells()) {
        reset();
      }
    }
  });
})();

document.addEventListener('keydown', (e) => {
  switch (e.which) {
    case 32:  // SPACE
      _running = !_running;
      break;
    case 38:  // UP
      _speed++;
      e.preventDefault();
      break;
    case 40:  // DOWN
      _speed--;
      e.preventDefault();
      break;
    case 82:  // r
      reset();
    default:
      console.log(e.which);
  }
});

function step() {
  const backIndex = Math.max(0, _generation % 2);
  const frontIndex = (backIndex + 1) % 2;

  _offscreen.colorTarget(0, _textures.state[frontIndex])
  _offscreen.colorTarget(1, _textures.history)
  _offscreen.colorTarget(2, _textures.oscCount[0])
  _offscreen.colorTarget(3, _textures.cellColors);
  _app.drawFramebuffer(_offscreen);

  _drawCalls.golStep.uniform('u_generation', _generation);
  _drawCalls.golStep.texture('u_state', _textures.state[backIndex]);
  _drawCalls.golStep.texture('u_history', _textures.history);
  _drawCalls.golStep.texture('u_entropy', _textures.entropy);
  _drawCalls.golStep.texture('u_osc_count', _textures.oscCount[0]);
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
  const initialState = generateRandomState(_stateWidth, _stateHeight);
  _textures.entropy.data([initialState]);
  // _textures.state[1].data(new Int8Array(_stateHeight * _stateWidth * CELL_STATE_BYTES));
  // _textures.history.data(new Uint32Array(_stateHeight * _stateWidth));
  // _textures.oscCount[0].data(new Uint8Array(_stateHeight * _stateWidth * CELL_OSC_COUNT_BYTES));
}

function hasActiveCells() {
  const { PicoGL } = window;
  const { gl } = _app;
  const { framebuffer } = _offscreen;

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
  gl.readBuffer(gl.COLOR_ATTACHMENT2);
  gl.readPixels(0, 0, _stateWidth, _stateHeight, PicoGL.RGBA_INTEGER, PicoGL.UNSIGNED_BYTE, _oscCounts);

  // _oscCounts32 is a uint32 view of the uint8 _oscCounts buffer, quicker to search through
  for (let i = 0, l = _oscCounts32.length; i < l; i++) {
    if (_oscCounts32[i] === 0) {
      return true;
    }
  }

  return false;
}

async function loadShaderSource(filename) {
  const res = await fetch(`shaders/${filename}`);
  return await res.text();
}

async function init() {
  const { PicoGL } = window;
  const { width: displayWidth, height: displayHeight } = screen;
  const width = displayWidth; // * window.devicePixelRatio;
  const height = displayHeight; // * window.devicePixelRatio;
  _stateWidth = Math.floor(width / CELL_SIZE);
  _stateHeight = Math.floor(height / CELL_SIZE);

  console.log(width, height, _stateWidth, _stateHeight);

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

  const entropy = generateRandomState(_stateWidth, _stateHeight);

  _textures.entropy = _app.createTexture2D(entropy, _stateWidth, _stateHeight, {
    internalFormat: PicoGL.RGBA8UI,
    format: PicoGL.RGBA_INTEGER,
    type: PicoGL.UNSIGNED_BYTE,
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  _textures.state = [
    // random back buffer
    _app.createTexture2D(_stateWidth, _stateHeight, {
      internalFormat: PicoGL.RGBA8I,
      format: PicoGL.RGBA_INTEGER,
      type: PicoGL.BYTE,
      minFilter: PicoGL.NEAREST,
      magFilter: PicoGL.NEAREST
    }),

    // empty front buffer
    _app.createTexture2D(_stateWidth, _stateHeight, {
      internalFormat: PicoGL.RGBA8I,
      format: PicoGL.RGBA_INTEGER,
      type: PicoGL.BYTE,
      minFilter: PicoGL.NEAREST,
      magFilter: PicoGL.NEAREST
    })
  ];

  _textures.history = _app.createTexture2D(_stateWidth, _stateHeight, {
    internalFormat: PicoGL.R32UI,
    format: PicoGL.RGBA_INTEGER,
    type: PicoGL.UNSIGNED_INT,
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  _textures.oscCount = [
    _app.createTexture2D(_stateWidth, _stateHeight, {
      internalFormat: PicoGL.RGBA8UI,
      format: PicoGL.RGBA_INTEGER,
      type: PicoGL.UNSIGNED_BYTE,
      minFilter: PicoGL.NEAREST,
      magFilter: PicoGL.NEAREST
    })
  ];

  _oscCounts = new Uint8Array(_stateWidth * _stateHeight * 4);
  _oscCounts32 = new Uint32Array(_oscCounts.buffer)

  _textures.cellColors = _app.createTexture2D(_stateWidth, _stateHeight, {
    minFilter: PicoGL.NEAREST,
    magFilter: PicoGL.NEAREST
  });

  _drawCalls.golStep = _app.createDrawCall(_programs.golStep, _vao);
  _drawCalls.screen = _app.createDrawCall(_programs.screen, _vao)
    .uniform('cell_size', CELL_SIZE);


  _offscreen = _app.createFramebuffer();
}

function cleanup() {
  _programs.golStep.delete();
  _vao.delete();
  _quad.delete();
}

function generateRandomState(width, height) {
  const length = width * height * CELL_STATE_BYTES;
  const state = new Uint8Array(length);
  const randBuffer = new Uint8Array(MAX_ENTROPY);
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