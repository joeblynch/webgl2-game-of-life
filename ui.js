const ADJ_STEP = 0.005;

const _toolbarEl = document.getElementById('toolbar');
const _settingsDrawerEl = document.getElementById('settings-drawer');
const _menuEl = document.getElementById('menu-popup');
const _btnPlay = document.getElementById('btn-play');

let _uiHideDelay;
let _autoHideTimer = null;
let _cursorOverUI = false;

// Convert screen coordinates to canvas pixel coordinates, accounting for CSS rotation
function screenToCanvas(clientX, clientY) {
  const dpr = window.devicePixelRatio;
  const canvas = _canvasEl;
  if (canvas.classList.contains('landscape-left')) {
    // rotated -90deg, origin top-left, canvas shifted down by 100%
    // screen X maps to canvas Y, screen Y (inverted) maps to canvas X
    const rect = canvas.getBoundingClientRect();
    return {
      x: (rect.bottom - clientY) * dpr,
      y: (clientX - rect.left) * dpr
    };
  } else if (canvas.classList.contains('landscape-right')) {
    // rotated 90deg, origin top-left, canvas shifted right by 100%
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientY - rect.top) * dpr,
      y: (rect.right - clientX) * dpr
    };
  } else {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * dpr,
      y: (clientY - rect.top) * dpr
    };
  }
}

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
  options.fps = _targetFPS;
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
      fps: _targetFPS,
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
  closeMenu();
  closeSettings();
  clearAutoHide();
}

function openMenu() {
  syncMenuStatus();
  _menuEl.classList.add('visible');
  document.getElementById('btn-menu').setAttribute('aria-expanded', 'true');
  clearAutoHide();
}

function closeMenu() {
  _menuEl.classList.remove('visible');
  document.getElementById('btn-menu').setAttribute('aria-expanded', 'false');
  resetAutoHide();
}

function isMenuOpen() {
  return _menuEl.classList.contains('visible');
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
  if (_uiHideDelay > 0 && !isSettingsOpen() && !isMenuOpen() && !_cursorOverUI) {
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

function toggleStatus() {
  document.body.classList.toggle('hide-status');
  syncMenuStatus();
}

function syncMenuStatus() {
  const hidden = document.body.classList.contains('hide-status');
  document.getElementById('menu-status').textContent = hidden
    ? 'Show status [s]'
    : 'Hide status [s]';
}

// ─── Keyboard handler (moved from main.js) ───

document.addEventListener('keydown', (e) => {
  switch (e.which) {
    case 32:  // SPACE
      _running = !_running;
      syncPlayButton();
      break;
    case 38:  // UP
    case 61:  // + (FF)
    case 187: // +
      if (e.shiftKey && (e.which === 61 || e.which === 187)) {
        _cellSize++;
        updateConfig();
        init(true);
        reset();
      } else if (!e.repeat && _speedUpPressedAt === null) {
        _speedUpPressedAt = performance.now();
      }
      e.preventDefault();
      break;
    case 40:  // DOWN
    case 173: // - (FF)
    case 189: // -
      if (e.shiftKey && (e.which === 173 || e.which === 189) && _cellSize > 1) {
        _cellSize--;
        updateConfig();
        init(true);
        reset();
      } else if (!e.repeat && _speedDownPressedAt === null) {
        _speedDownPressedAt = performance.now();
      }
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
    case 82:  // r
      if (e.shiftKey) {
        reset();
      } else {
        _generation = START_GENERATION;
        _xEdgeDist = START_GENERATION + 1;
        _yEdgeDist = START_GENERATION + 1;
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
    default:
      break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.which) {
    case 38:  // UP
    case 61:  // +
    case 187:
      if (!e.shiftKey && _speedUpPressedAt !== null) {
        if (performance.now() - _speedUpPressedAt <= INPUT_HOLD_DELAY) {
          speedClick(1);
        } else {
          _targetFPS = Math.max(1, Math.round(_targetFPS));
          updateConfig();
        }
        _speedUpPressedAt = null;
      }
      break;
    case 40:  // DOWN
    case 173: // -
    case 189:
      if (!e.shiftKey && _speedDownPressedAt !== null) {
        if (performance.now() - _speedDownPressedAt <= INPUT_HOLD_DELAY) {
          speedClick(-1);
        } else {
          _targetFPS = Math.max(1, Math.round(_targetFPS));
          updateConfig();
        }
        _speedDownPressedAt = null;
      }
      break;
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
    const { x: canvasX, y: canvasY } = screenToCanvas(e.clientX, e.clientY);
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
let _touchLastX = 0, _touchLastY = 0;
let _touchLastTime = 0;

_canvasEl.addEventListener('touchstart', (e) => {
  _momentumActive = false;
  if (e.touches.length === 2) {
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    _pinchLastDist = Math.hypot(dx, dy);
    const screenCX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const screenCY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const { x, y } = screenToCanvas(screenCX, screenCY);
    _pinchLastCenterX = x;
    _pinchLastCenterY = y;
  } else if (e.touches.length === 1) {
    const { x, y } = screenToCanvas(e.touches[0].clientX, e.touches[0].clientY);
    _touchStartX = x;
    _touchStartY = y;
    _touchLastX = x;
    _touchLastY = y;
    _touchLastTime = performance.now();
    _momentumVX = 0;
    _momentumVY = 0;
    _touchMoved = false;
  }
}, { passive: false });

_canvasEl.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();

    // current pinch center (in canvas pixels) and distance (screen pixels for scale)
    const screenCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const screenCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const { x: curCX, y: curCY } = screenToCanvas(screenCenterX, screenCenterY);
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);

    // universe point under PREVIOUS pinch center (from current viewport)
    const prevFracX = _pinchLastCenterX / _canvasWidth;
    const prevFracY = _pinchLastCenterY / _canvasHeight;
    const curViewW = _canvasWidth * _zoom;
    const curViewH = _canvasHeight * _zoom;
    const uniX = (_panX - curViewW / 2) + prevFracX * curViewW;
    const uniY = (_panY + curViewH / 2) - prevFracY * curViewH;

    // apply incremental zoom
    const scale = _pinchLastDist / dist;
    const newZoom = Math.max(1 / 40, Math.min(_zoom * scale, _maxZoom));

    // reposition so the same universe point is now under the CURRENT pinch center
    const curFracX = curCX / _canvasWidth;
    const curFracY = curCY / _canvasHeight;
    const newViewW = _canvasWidth * newZoom;
    const newViewH = _canvasHeight * newZoom;
    _panX = uniX + newViewW * (0.5 - curFracX);
    _panY = uniY + newViewH * (curFracY - 0.5);
    _zoom = newZoom;
    _pinchLastDist = dist;
    _pinchLastCenterX = curCX;
    _pinchLastCenterY = curCY;

  } else if (e.touches.length === 1) {
    const { x: curX, y: curY } = screenToCanvas(e.touches[0].clientX, e.touches[0].clientY);
    const dx = curX - _touchStartX;
    const dy = curY - _touchStartY;
    if (!_touchMoved && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      _touchMoved = true;
    }
    if (_touchMoved) {
      e.preventDefault();
      const moveX = curX - _touchLastX;
      const moveY = curY - _touchLastY;
      _panX -= moveX * _zoom;
      _panY += moveY * _zoom;

      const now = performance.now();
      const dt = now - _touchLastTime;
      if (dt > 0) {
        _momentumVX = moveX / dt;
        _momentumVY = moveY / dt;
      }
      _touchLastTime = now;
    }
    _touchLastX = curX;
    _touchLastY = curY;
  }
}, { passive: false });

_canvasEl.addEventListener('touchend', (e) => {
  if (e.touches.length === 0 && _touchMoved) {
    const speed = Math.hypot(_momentumVX, _momentumVY);
    if (speed > 0.15) {
      _momentumActive = true;
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

function speedClick(direction) {
  const displayed = Math.round(_targetFPS);
  _targetFPS = Math.max(1, displayed + direction);
  updateConfig();
}

const _btnSlower = document.getElementById('btn-slower');
const _btnFaster = document.getElementById('btn-faster');

_btnSlower.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  _speedDownPressedAt = performance.now();
  clearAutoHide();
});
_btnSlower.addEventListener('mouseup', () => {
  if (_speedDownPressedAt !== null) {
    if (performance.now() - _speedDownPressedAt <= INPUT_HOLD_DELAY) speedClick(-1);
    else { _targetFPS = Math.max(1, Math.round(_targetFPS)); updateConfig(); }
  }
  _speedDownPressedAt = null;
  resetAutoHide();
});
_btnSlower.addEventListener('mouseleave', () => { if (_speedDownPressedAt) { _targetFPS = Math.max(1, Math.round(_targetFPS)); updateConfig(); } _speedDownPressedAt = null; resetAutoHide(); });

_btnSlower.addEventListener('touchstart', (e) => {
  e.stopPropagation();
  e.preventDefault();
  _speedDownPressedAt = performance.now();
  clearAutoHide();
});
_btnSlower.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (_speedDownPressedAt !== null) {
    if (performance.now() - _speedDownPressedAt <= INPUT_HOLD_DELAY) speedClick(-1);
    else { _targetFPS = Math.max(1, Math.round(_targetFPS)); updateConfig(); }
  }
  _speedDownPressedAt = null;
  resetAutoHide();
});

_btnFaster.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  _speedUpPressedAt = performance.now();
  clearAutoHide();
});
_btnFaster.addEventListener('mouseup', () => {
  if (_speedUpPressedAt !== null) {
    if (performance.now() - _speedUpPressedAt <= INPUT_HOLD_DELAY) speedClick(1);
    else { _targetFPS = Math.max(1, Math.round(_targetFPS)); updateConfig(); }
  }
  _speedUpPressedAt = null;
  resetAutoHide();
});
_btnFaster.addEventListener('mouseleave', () => { if (_speedUpPressedAt) { _targetFPS = Math.max(1, Math.round(_targetFPS)); updateConfig(); } _speedUpPressedAt = null; resetAutoHide(); });

_btnFaster.addEventListener('touchstart', (e) => {
  e.stopPropagation();
  e.preventDefault();
  _speedUpPressedAt = performance.now();
  clearAutoHide();
});
_btnFaster.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (_speedUpPressedAt !== null) {
    if (performance.now() - _speedUpPressedAt <= INPUT_HOLD_DELAY) speedClick(1);
    else { _targetFPS = Math.max(1, Math.round(_targetFPS)); updateConfig(); }
  }
  _speedUpPressedAt = null;
  resetAutoHide();
});

document.getElementById('btn-reset').addEventListener('click', (e) => {
  e.stopPropagation();
  reset();
  _running = true;
  syncPlayButton();
  resetAutoHide();
});

document.getElementById('btn-fullscreen').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleFullscreen();
  resetAutoHide();
});

// ─── Hamburger menu ───

document.getElementById('btn-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  if (isMenuOpen()) {
    closeMenu();
  } else {
    openMenu();
  }
});

document.getElementById('menu-replay').addEventListener('click', (e) => {
  e.stopPropagation();
  _generation = START_GENERATION;
  _xEdgeDist = START_GENERATION + 1;
  _yEdgeDist = START_GENERATION + 1;
  _endedGeneration = -1;
  closeMenu();
});

document.getElementById('menu-texture').addEventListener('click', (e) => {
  e.stopPropagation();
  _textureMode = (_textureMode + 1) % TEXTURE_MODES.length;
  _textureDescEl.innerText = TEXTURE_DESC[_textureMode];
  updateConfig();
  draw();
});

document.getElementById('menu-status').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleStatus();
  closeMenu();
});

document.getElementById('menu-settings').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenu();
  openSettings();
});

// close menu on click outside
document.addEventListener('click', () => {
  if (isMenuOpen()) closeMenu();
});

// close menu on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isMenuOpen()) { closeMenu(); e.preventDefault(); }
    else if (isSettingsOpen()) { closeSettings(); e.preventDefault(); }
  }
});

// ─── PWA install prompt ───

let _deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  document.getElementById('menu-install').style.display = '';
});

document.getElementById('menu-install').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (_deferredInstallPrompt) {
    _deferredInstallPrompt.prompt();
    await _deferredInstallPrompt.userChoice;
    _deferredInstallPrompt = null;
    document.getElementById('menu-install').style.display = 'none';
  }
  closeMenu();
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
  _targetFPS = DEFAULT_TARGET_FPS;
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
_menuEl.addEventListener('click', (e) => { e.stopPropagation(); });

// Pause auto-hide while cursor is over toolbar or menu
_toolbarEl.addEventListener('mouseenter', () => { _cursorOverUI = true; clearAutoHide(); });
_toolbarEl.addEventListener('mouseleave', () => { _cursorOverUI = false; resetAutoHide(); });
_menuEl.addEventListener('mouseenter', () => { _cursorOverUI = true; clearAutoHide(); });
_menuEl.addEventListener('mouseleave', () => { _cursorOverUI = false; resetAutoHide(); });

// ─── Init ───

(function initUI() {
  const options = parseHash();
  const uiHide = typeof options.uiHide === 'number' ? options.uiHide : 3;
  _uiHideDelay = uiHide < 0 ? -1 : uiHide * 1000;

  // default status to hidden
  document.body.classList.add('hide-status');

  if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) {
    document.getElementById('btn-fullscreen').style.display = 'none';
  }

  syncMenuStatus();
  resetAutoHide();
})();
