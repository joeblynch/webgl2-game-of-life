const ADJ_STEP = 0.005;

const _toolbarEl = document.getElementById('toolbar');
const _settingsDrawerEl = document.getElementById('settings-drawer');
const _btnPlay = document.getElementById('btn-play');

let _uiHideDelay;
let _autoHideTimer = null;
let _cursorOverUI = false;

function updateLandscapeClass() {
  const canvas = document.getElementById('c');
  canvas.classList.remove('landscape-left', 'landscape-right');
  const type = screen.orientation?.type;
  if (type) {
    if (type.startsWith('landscape')) {
      canvas.classList.add(screen.orientation.angle === 270 ? 'landscape-right' : 'landscape-left');
    }
  } else if (Math.abs(window.orientation) === 90) {
    canvas.classList.add(window.orientation === -90 ? 'landscape-right' : 'landscape-left');
  }
}

if (screen.orientation) {
  screen.orientation.addEventListener('change', updateLandscapeClass);
} else {
  window.addEventListener('orientationchange', updateLandscapeClass);
}
updateLandscapeClass();

function updateConfig() {
  const options = parseHash();
  options.alive = _cellAliveProbability;
  if (!_gridWidth && !_gridHeight) options.size = _cellSize;
  options.speed = _speed;
  options.satOn = _saturation_on.toPrecision(3);
  options.satOff = _saturation_off.toPrecision(3);
  options.liOn = _lightness_on.toPrecision(3);
  options.liOff = _lightness_off.toPrecision(3);
  options.hueShift = _hueShift.toPrecision(2);
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
      ...(!_gridWidth && !_gridHeight && { size: _cellSize }),
      speed: _speed,
      satOn: parseFloat(_saturation_on.toPrecision(3)),
      satOff: parseFloat(_saturation_off.toPrecision(3)),
      liOn: parseFloat(_lightness_on.toPrecision(3)),
      liOff: parseFloat(_lightness_off.toPrecision(3)),
      hueShift: parseFloat(_hueShift.toPrecision(2)),
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
  if (_uiHideDelay > 0 && !isSettingsOpen() && !_cursorOverUI) {
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
  document.getElementById('range-hue-shift').value = _hueShift;
  document.getElementById('val-hue-shift').innerText = _hueShift.toPrecision(2);
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

const _canvasEl = document.getElementById('c');

_canvasEl.addEventListener('click', toggleToolbar);
_canvasEl.addEventListener('dblclick', toggleFullscreen);

// ─── Wheel/trackpad: pinch to zoom, scroll to pan ───

_canvasEl.addEventListener('wheel', (e) => {
  e.preventDefault();

  const dpr = window.devicePixelRatio;

  if (e.ctrlKey) {
    // trackpad pinch-to-zoom or ctrl+scroll wheel: zoom centered on cursor
    const rect = _canvasEl.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) * dpr;
    const canvasY = (e.clientY - rect.top) * dpr;
    const fracX = canvasX / _canvasWidth;
    const fracY = canvasY / _canvasHeight;
    const ux = _viewX1 + fracX * (_viewX2 - _viewX1);
    const uy = _viewY2 - fracY * (_viewY2 - _viewY1);

    const zoomFactor = Math.exp(e.deltaY * 0.01);
    _zoom = Math.max(1 / 40, Math.min(_zoom * zoomFactor, _maxZoom));

    const viewW = _canvasWidth * _zoom;
    const viewH = _canvasHeight * _zoom;
    _panX = ux - fracX * viewW + viewW / 2;
    _panY = uy + fracY * viewH - viewH / 2;
  } else {
    // two-finger scroll or mouse wheel: pan (content moves under fingers)
    _panX += e.deltaX * dpr * _zoom;
    _panY -= e.deltaY * dpr * _zoom;
  }
}, { passive: false });


// ─── Mouse drag to pan ───

let _dragStartX = 0, _dragStartY = 0;
let _dragStartPanX = 0, _dragStartPanY = 0;
let _isDragging = false;
let _mouseMoved = false;

_canvasEl.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    _isDragging = true;
    _mouseMoved = false;
    _dragStartX = e.clientX;
    _dragStartY = e.clientY;
    _dragStartPanX = _panX;
    _dragStartPanY = _panY;
  }
});

document.addEventListener('mousemove', (e) => {
  if (!_isDragging) return;
  const dx = e.clientX - _dragStartX;
  const dy = e.clientY - _dragStartY;
  if (!_mouseMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
    _mouseMoved = true;
  }
  if (_mouseMoved) {
    const dpr = window.devicePixelRatio;
    _panX = _dragStartPanX - dx * dpr * _zoom;
    _panY = _dragStartPanY + dy * dpr * _zoom;
  }
});

document.addEventListener('mouseup', () => {
  _isDragging = false;
});

// ─── Touch: tap to toggle toolbar, drag to pan, pinch to zoom ───

let _touchMoved = false;
let _pinchLastDist = 0;
let _pinchLastCenterX = 0, _pinchLastCenterY = 0;
let _touchStartX = 0, _touchStartY = 0;
let _touchStartPanX = 0, _touchStartPanY = 0;

_canvasEl.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    _pinchLastDist = Math.hypot(dx, dy);
    _pinchLastCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    _pinchLastCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
  } else if (e.touches.length === 1) {
    _touchStartX = e.touches[0].clientX;
    _touchStartY = e.touches[0].clientY;
    _touchStartPanX = _panX;
    _touchStartPanY = _panY;
    _touchMoved = false;
  }
}, { passive: false });

_canvasEl.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const rect = _canvasEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio;

    // current pinch center and distance
    const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);

    // universe point under PREVIOUS pinch center (from current viewport)
    const prevFracX = (_pinchLastCenterX - rect.left) * dpr / _canvasWidth;
    const prevFracY = (_pinchLastCenterY - rect.top) * dpr / _canvasHeight;
    const curViewW = _canvasWidth * _zoom;
    const curViewH = _canvasHeight * _zoom;
    const uniX = (_panX - curViewW / 2) + prevFracX * curViewW;
    const uniY = (_panY + curViewH / 2) - prevFracY * curViewH;

    // apply incremental zoom
    const scale = _pinchLastDist / dist;
    const newZoom = Math.max(1 / 40, Math.min(_zoom * scale, _maxZoom));

    // reposition so the same universe point is now under the CURRENT pinch center
    const curFracX = (centerX - rect.left) * dpr / _canvasWidth;
    const curFracY = (centerY - rect.top) * dpr / _canvasHeight;
    const newViewW = _canvasWidth * newZoom;
    const newViewH = _canvasHeight * newZoom;
    _panX = uniX + newViewW * (0.5 - curFracX);
    _panY = uniY + newViewH * (curFracY - 0.5);
    _zoom = newZoom;
    _pinchLastDist = dist;
    _pinchLastCenterX = centerX;
    _pinchLastCenterY = centerY;
  } else if (e.touches.length === 1) {
    const dx = e.touches[0].clientX - _touchStartX;
    const dy = e.touches[0].clientY - _touchStartY;
    if (!_touchMoved && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      _touchMoved = true;
    }
    if (_touchMoved) {
      e.preventDefault();
      const dpr = window.devicePixelRatio;
      _panX = _touchStartPanX - dx * dpr * _zoom;
      _panY = _touchStartPanY + dy * dpr * _zoom;
    }
  }
}, { passive: false });

// Override click handler: only toggle toolbar if no drag occurred
_canvasEl.removeEventListener('click', toggleToolbar);
_canvasEl.addEventListener('click', () => {
  if (!_touchMoved && !_mouseMoved) {
    toggleToolbar();
  }
});

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

document.getElementById('btn-defaults').addEventListener('click', (e) => {
  e.stopPropagation();
  const needsRestart = _cellSize !== DEFAULT_CELL_SIZE
    || _cellAliveProbability !== DEFAULT_ALIVE_PROBABILITY;

  _cellAliveProbability = DEFAULT_ALIVE_PROBABILITY;
  _cellSize = DEFAULT_CELL_SIZE;
  _speed = DEFAULT_SPEED;
  _saturation_on = DEFAULT_SATURATION_ON;
  _saturation_off = DEFAULT_SATURATION_OFF;
  _lightness_on = DEFAULT_LIGHTNESS_ON;
  _lightness_off = DEFAULT_LIGHTNESS_OFF;
  _hueShift = DEFAULT_HUE_SHIFT;
  _textureMode = DEFAULT_TEXTURE_MODE;
  _textureDescEl.innerText = TEXTURE_DESC[_textureMode];
  _zoom = 1 / _cellSize;
  _panX = _universeWidth / 2;
  _panY = _universeHeight / 2;
  updateConfig();

  if (needsRestart) {
    init(true);
    reset();
  } else {
    draw();
  }

  openSettings();
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

bindSlider('hue-shift',
  () => _hueShift,
  (v) => { _hueShift = v; },
  (v) => v.toPrecision(2)
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

// Pause auto-hide while cursor is over toolbar
_toolbarEl.addEventListener('mouseenter', () => { _cursorOverUI = true; clearAutoHide(); });
_toolbarEl.addEventListener('mouseleave', () => { _cursorOverUI = false; resetAutoHide(); });

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
