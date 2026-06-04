/**
 * Swipe-based kick input (replaces the POWER button for kickoffs,
 * punts, field goals, and extra points).
 * ----------------------------------------------------------------
 * Public API (exposed on window so controls.js can call it without
 * needing ES modules):
 *
 *   initKickSwipeUI(callback)
 *     callback receives { power, direction } where:
 *       power     in [0, 1] -- how hard the player swiped up
 *       direction in [-1, 1] -- how far they swiped sideways
 *
 *   showKickUI()  / hideKickUI()  / isKickUIVisible()
 *
 * The overlay listens for a single pointer drag. Vertical (upward)
 * travel maps to power; horizontal travel maps to direction. On
 * pointerup it fires the callback exactly once and hides itself.
 * Tap-without-drag is rejected (kept visible) so the UI is not
 * accidentally consumed by stray taps.
 * ----------------------------------------------------------------
 */

(function () {
  'use strict';

  const MAX_DRAG_Y = 240; // px of upward drag for full power
  const MAX_DRAG_X = 180; // px of lateral drag for full direction
  const MIN_DRAG   = 30;  // px below which the swipe is ignored

  let callback = null;
  let overlay = null;
  let startPt = null;
  let visible = false;

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'kickSwipeOverlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:200',
      'display:none', 'touch-action:none',
      'background:rgba(0,0,0,0.0)', 'cursor:crosshair',
    ].join(';');
    overlay.innerHTML = ''
      + '<div id="kickSwipeHint" style="'
      +   'position:absolute;left:50%;top:18%;transform:translateX(-50%);'
      +   'color:#fff;font-family:Arial,sans-serif;font-weight:bold;'
      +   'font-size:18px;background:rgba(10,36,99,0.78);'
      +   'padding:10px 18px;border-radius:10px;letter-spacing:1px;'
      +   'text-align:center;text-shadow:0 1px 2px rgba(0,0,0,0.8);'
      +   'border:2px solid #4fc3f7;'
      + '">SWIPE UP TO KICK<br>'
      +   '<span style="font-size:13px;font-weight:normal;opacity:0.85">'
      +   'longer swipe = more power &nbsp;&middot;&nbsp; angle = direction'
      +   '</span></div>'
      + '<svg id="kickSwipeArrow" width="100%" height="100%" '
      +   'style="position:absolute;inset:0;pointer-events:none">'
      +   '<line id="kickArrowLine" x1="0" y1="0" x2="0" y2="0" '
      +     'stroke="#4fc3f7" stroke-width="6" stroke-linecap="round" />'
      +   '<circle id="kickArrowStart" cx="0" cy="0" r="12" fill="#4fc3f7" />'
      +   '<circle id="kickArrowEnd" cx="0" cy="0" r="14" '
      +     'fill="#fff" stroke="#4fc3f7" stroke-width="3" />'
      + '</svg>'
      + '<div id="kickSwipePowerWrap" style="'
      +   'position:absolute;left:50%;bottom:80px;transform:translateX(-50%);'
      +   'text-align:center;color:#fff;font-family:Arial,sans-serif;'
      + '">'
      +   '<div style="font-size:12px;letter-spacing:2px;margin-bottom:6px;'
      +     'text-shadow:0 1px 2px rgba(0,0,0,0.8);">POWER</div>'
      +   '<div style="width:240px;height:14px;background:#1a1a2e;'
      +     'border:2px solid #4fc3f7;border-radius:7px;overflow:hidden">'
      +     '<div id="kickSwipePowerFill" style="height:100%;width:0%;'
      +       'background:linear-gradient(90deg,#4fc3f7,#ffeb3b,#f44336);'
      +       'transition:width 0.05s linear"></div>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup',   onUp);
    overlay.addEventListener('pointercancel', onUp);
    // Prevent the page from scrolling while swiping on touch devices.
    overlay.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  function setArrow(x1, y1, x2, y2, powerPct) {
    const line  = document.getElementById('kickArrowLine');
    const sCirc = document.getElementById('kickArrowStart');
    const eCirc = document.getElementById('kickArrowEnd');
    const fill  = document.getElementById('kickSwipePowerFill');
    if (!line) return;
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    sCirc.setAttribute('cx', x1); sCirc.setAttribute('cy', y1);
    eCirc.setAttribute('cx', x2); eCirc.setAttribute('cy', y2);
    if (fill) fill.style.width = Math.round(Math.max(0, Math.min(100, powerPct))) + '%';
  }

  function clearArrow() { setArrow(-100, -100, -100, -100, 0); }

  function computeFromDelta(dx, dy) {
    const upDrag = Math.max(0, -dy);
    const power = Math.min(1, upDrag / MAX_DRAG_Y);
    const direction = Math.max(-1, Math.min(1, dx / MAX_DRAG_X));
    return { power, direction };
  }

  function onDown(e) {
    startPt = { x: e.clientX, y: e.clientY, id: e.pointerId };
    setArrow(startPt.x, startPt.y, startPt.x, startPt.y, 0);
    try { overlay.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
  }

  function onMove(e) {
    if (!startPt || e.pointerId !== startPt.id) return;
    const dx = e.clientX - startPt.x;
    const dy = e.clientY - startPt.y;
    const { power } = computeFromDelta(dx, dy);
    setArrow(startPt.x, startPt.y, e.clientX, e.clientY, power * 100);
  }

  function onUp(e) {
    if (!startPt || e.pointerId !== startPt.id) return;
    const dx = e.clientX - startPt.x;
    const dy = e.clientY - startPt.y;
    const dist = Math.hypot(dx, dy);
    startPt = null;
    clearArrow();
    if (dist < MIN_DRAG) return; // ignore taps -- keep UI up for retry
    const { power, direction } = computeFromDelta(dx, dy);
    hide();
    if (callback) callback({ power, direction });
  }

  function show() {
    if (!overlay) build();
    overlay.style.display = 'block';
    visible = true;
    clearArrow();
  }

  function hide() {
    if (overlay) overlay.style.display = 'none';
    visible = false;
    startPt = null;
    clearArrow();
  }

  window.initKickSwipeUI = function (cb) {
    callback = cb;
    if (!overlay) build();
  };
  window.showKickUI       = show;
  window.hideKickUI       = hide;
  window.isKickUIVisible  = () => visible;
})();
