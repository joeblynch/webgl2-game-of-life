const ADJ_STEP = 0.005;

const _toolbarEl = document.getElementById('toolbar');
const _settingsDrawerEl = document.getElementById('settings-drawer');
const _btnPlay = document.getElementById('btn-play');

let _uiHideDelay;
let _autoHideTimer = null;

function updateConfig() {
  const options = parseHash();
  options.alive = _cellAliveProbability;
  options.size = _cellSize;
  options.speed = _speed;
  options.satOn = _saturation_on.toPrecision(3);
  options.satOff = _saturation_off.toPrecision(3);
  options.liOn = _lightness_on.toPrecision(3);
  options.liOff = _lightness_off.toPrecision(3);
  options.texture = _textureMode;
  if (_uiHideDelay !== 3000) {
    options.uiHide = _uiHideDelay / 1000;
  }

  location.hash = Object.keys(options)
    .map(key => `${key}=${options[key]}`)
    .join('&');

  saveConfig();
}

function saveConfig() {
  try {
    localStorage.setItem('gol-config', JSON.stringify({
      alive: _cellAliveProbability,
      size: _cellSize,
      speed: _speed,
      satOn: parseFloat(_saturation_on.toPrecision(3)),
      satOff: parseFloat(_saturation_off.toPrecision(3)),
      liOn: parseFloat(_lightness_on.toPrecision(3)),
      liOff: parseFloat(_lightness_off.toPrecision(3)),
      texture: _textureMode
    }));
  } catch (e) {}
}

// ─── Toolbar show/hide ───

function isToolbarVisible() {
  return _toolbarEl.classList.contains('visible');
}

function showToolbar() {
  _toolbarEl.classList.add('visible');
  syncPlayButton();
  resetAutoHide();
}

function hideToolbar() {
  _toolbarEl.classList.remove('visible');
  closeSettings();
  clearAutoHide();
}

function toggleToolbar() {
  if (isToolbarVisible()) {
    hideToolbar();
  } else {
    showToolbar();
  }
}

function resetAutoHide() {
  clearAutoHide();
  if (_uiHideDelay > 0 && !isSettingsOpen()) {
    _autoHideTimer = setTimeout(hideToolbar, _uiHideDelay);
  }
}

function clearAutoHide() {
  if (_autoHideTimer !== null) {
    clearTimeout(_autoHideTimer);
    _autoHideTimer = null;
  }
}

// ─── Settings drawer ───

function openSettings() {
  document.getElementById('range-li-off').value = _lightness_off;
  document.getElementById('val-li-off').innerText = _lightness_off.toPrecision(3);
  document.getElementById('range-sat-off').value = _saturation_off;
  document.getElementById('val-sat-off').innerText = _saturation_off.toPrecision(3);
  document.getElementById('range-li-on').value = _lightness_on;
  document.getElementById('val-li-on').innerText = _lightness_on.toPrecision(3);
  document.getElementById('range-sat-on').value = _saturation_on;
  document.getElementById('val-sat-on').innerText = _saturation_on.toPrecision(3);
  document.getElementById('range-cell-size').value = _cellSize;
  document.getElementById('val-cell-size').innerText = _cellSize;
  document.getElementById('range-alive').value = _cellAliveProbability;
  document.getElementById('val-alive').innerText = Math.round(_cellAliveProbability * 100) + '%';

  document.getElementById('chk-status').checked = !document.body.classList.contains('hide-status');

  _settingsDrawerEl.classList.add('visible');
  clearAutoHide();
}

function closeSettings() {
  _settingsDrawerEl.classList.remove('visible');
  resetAutoHide();
}

function isSettingsOpen() {
  return _settingsDrawerEl.classList.contains('visible');
}

// ─── Play button sync ───

function syncPlayButton() {
  _btnPlay.innerText = _running ? '⏸\uFE0E' : '▶\uFE0E';
}

// ─── UI functions (moved from main.js) ───

function toggleFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    try { screen.orientation.unlock(); } catch (e) {}
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    const el = document.body;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    request.call(el, { navigationUI: 'hide' }).then(() => {
      try { screen.orientation.lock('portrait'); } catch (e) {}
    }).catch(() => {});
  }
}

function toggleHelp() {
  const el = document.getElementById('help-container');
  el.classList.toggle('hidden');
}

function toggleStatus() {
  const hidden = document.body.classList.toggle('hide-status');
  document.getElementById('chk-status').checked = !hidden;
}

// ─── Keyboard handler (moved from main.js) ───

document.addEventListener('keydown', (e) => {
  switch (e.which) {
    case 32:  // SPACE
      _running = !_running;
      syncPlayButton();
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

      updateConfig();

      break;
    case 38:  // UP
      _speed++;
      updateConfig();
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

      updateConfig();

      break;
    case 40:  // DOWN
      _speed--;
      updateConfig();
      e.preventDefault();
      break;
    case 49:  // 1-8
    case 50:
    case 51:
    case 52:
    case 53:
    case 54:
    case 55:
    case 56:
      _textureMode = e.which - 49;
      _textureDescEl.innerText = TEXTURE_DESC[_textureMode];
      draw();
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
        _endedGeneration = -1;
      }
      break;
    case 84:  // t
      _textureMode = (_textureMode + 1) % TEXTURE_MODES.length;
      _textureDescEl.innerText = TEXTURE_DESC[_textureMode];
      updateConfig();
      draw();
      break;
    case 83: // s
      toggleStatus();
      break;
    case 61: // + (win on FF?)
    case 187: // +
      if (e.shiftKey) {
        _cellSize++;
        updateConfig();
        init(true);
        reset();
      }
      break;
    case 173: // + (win on FF?)
    case 189: // -
      if (e.shiftKey && _cellSize > 1) {
        _cellSize--;
        updateConfig();
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

// ─── Canvas click / double-click / mouse move ───

document.getElementById('c').addEventListener('click', toggleToolbar);
document.getElementById('c').addEventListener('dblclick', toggleFullscreen);

if (window.matchMedia('(pointer: fine)').matches) {
  document.addEventListener('mousemove', () => {
    if (!isToolbarVisible()) {
      showToolbar();
    } else {
      resetAutoHide();
    }
  });
}

// ─── Toolbar button handlers ───

document.getElementById('btn-play').addEventListener('click', (e) => {
  e.stopPropagation();
  _running = !_running;
  syncPlayButton();
  resetAutoHide();
});

document.getElementById('btn-slower').addEventListener('click', (e) => {
  e.stopPropagation();
  _speed--;
  updateConfig();
  resetAutoHide();
});

document.getElementById('btn-faster').addEventListener('click', (e) => {
  e.stopPropagation();
  _speed++;
  updateConfig();
  resetAutoHide();
});

document.getElementById('btn-restart').addEventListener('click', (e) => {
  e.stopPropagation();
  _generation = START_GENERATION;
  _endedGeneration = -1;
  resetAutoHide();
});

document.getElementById('btn-reset').addEventListener('click', (e) => {
  e.stopPropagation();
  reset();
  resetAutoHide();
});

document.getElementById('btn-texture').addEventListener('click', (e) => {
  e.stopPropagation();
  _textureMode = (_textureMode + 1) % TEXTURE_MODES.length;
  _textureDescEl.innerText = TEXTURE_DESC[_textureMode];
  updateConfig();
  draw();
  resetAutoHide();
});

document.getElementById('btn-settings').addEventListener('click', (e) => {
  e.stopPropagation();
  if (isSettingsOpen()) {
    closeSettings();
  } else {
    openSettings();
  }
  resetAutoHide();
});

document.getElementById('btn-fullscreen').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleFullscreen();
  resetAutoHide();
});

document.getElementById('btn-shortcuts').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleHelp();
  resetAutoHide();
});

document.getElementById('btn-close-settings').addEventListener('click', (e) => {
  e.stopPropagation();
  closeSettings();
  resetAutoHide();
});

document.getElementById('chk-status').addEventListener('change', (e) => {
  e.stopPropagation();
  document.body.classList.toggle('hide-status', !e.target.checked);
  resetAutoHide();
});

// ─── Settings drawer slider handlers ───

function bindSlider(id, getter, setter, formatter) {
  const range = document.getElementById('range-' + id);
  const val = document.getElementById('val-' + id);
  range.addEventListener('input', (e) => {
    e.stopPropagation();
    setter(parseFloat(range.value));
    val.innerText = formatter(getter());
    updateConfig();
    resetAutoHide();
  });
}

bindSlider('li-off',
  () => _lightness_off,
  (v) => { _lightness_off = v; },
  (v) => v.toPrecision(3)
);

bindSlider('sat-off',
  () => _saturation_off,
  (v) => { _saturation_off = v; },
  (v) => v.toPrecision(3)
);

bindSlider('li-on',
  () => _lightness_on,
  (v) => { _lightness_on = v; },
  (v) => v.toPrecision(3)
);

bindSlider('sat-on',
  () => _saturation_on,
  (v) => { _saturation_on = v; },
  (v) => v.toPrecision(3)
);

bindSlider('cell-size',
  () => _cellSize,
  (v) => { _cellSize = v; init(true); reset(); },
  (v) => v.toString()
);

bindSlider('alive',
  () => _cellAliveProbability,
  (v) => { _cellAliveProbability = v; reset(); },
  (v) => Math.round(v * 100) + '%'
);

// Stop clicks on toolbar/settings drawer from toggling toolbar
_toolbarEl.addEventListener('click', (e) => { e.stopPropagation(); });
_settingsDrawerEl.addEventListener('click', (e) => { e.stopPropagation(); });

// ─── Init ───

(function initUI() {
  const options = parseHash();
  const uiHide = typeof options.uiHide === 'number' ? options.uiHide : 3;
  _uiHideDelay = uiHide < 0 ? -1 : uiHide * 1000;

  const isPWA = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  if (isPWA) {
    document.body.classList.add('hide-status');
  }

  if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) {
    document.getElementById('btn-fullscreen').style.display = 'none';
  }

  resetAutoHide();
})();
