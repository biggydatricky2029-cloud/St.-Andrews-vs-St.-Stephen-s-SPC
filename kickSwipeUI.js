/**
 * kickSwipeUI.js
 * -------------------------------------------------------
 * Drop this file into your project and call:
 *   initKickSwipeUI(onKickComplete)
 *
 * onKickComplete is a callback that receives:
 *   { power: 0-1, direction: -1 (left) to 1 (right) }
 *
 * Call showKickUI() whenever a kickoff, punt, or extra
 * point is about to happen. The UI hides itself after
 * the player completes the swipe.
 *
 * NOTE: this file is loaded as a plain (non-module) script
 * to match the rest of the project, so the original ES
 * module `export` keywords have been replaced with
 * `window.X = ...` assignments. API surface is unchanged.
 * -------------------------------------------------------
 */

let kickUIContainer = null;
let kickBar = null;
let kickFill = null;

let swipeStartY = null;
let swipeStartX = null;
let swipeActive = false;

const BAR_HEIGHT = 300; // px — tall enough for a comfortable swipe

/**
 * Call once at game startup.
 * @param {function} onKickComplete - called with { power, direction }
 */
function initKickSwipeUI(onKickComplete) {
  _buildDOM();
  _attachTouchListeners(onKickComplete);
}

/** Show the kick UI (call before kickoff / punt / extra point) */
function showKickUI() {
  _resetFill();
  kickUIContainer.style.display = 'flex';
}

/** Hide the kick UI manually if needed */
function hideKickUI() {
  kickUIContainer.style.display = 'none';
}

// ─── DOM Construction ────────────────────────────────────────────────────────

function _buildDOM() {
  // Outer wrapper — covers the full screen so touches don't bleed through
  kickUIContainer = document.createElement('div');
  Object.assign(kickUIContainer.style, {
    position:       'fixed',
    inset:          '0',
    display:        'none',           // hidden until showKickUI()
    alignItems:     'center',
    justifyContent: 'center',
    zIndex:         '1000',
    pointerEvents:  'none',           // let game canvas receive non-swipe touches
  });

  // The grey swipe bar
  kickBar = document.createElement('div');
  Object.assign(kickBar.style, {
    position:     'relative',
    width:        '80px',
    height:       `${BAR_HEIGHT}px`,
    background:   '#6b6b6b',
    borderRadius: '12px',
    overflow:     'hidden',
    pointerEvents: 'all',            // only this element captures touches
    boxShadow:    '0 4px 20px rgba(0,0,0,0.5)',
    border:       '2px solid #999',
  });

  // Green fill — grows upward from the bottom as the player swipes
  kickFill = document.createElement('div');
  Object.assign(kickFill.style, {
    position:   'absolute',
    bottom:     '0',
    left:       '0',
    width:      '100%',
    height:     '0%',
    background: '#4caf50',
    transition: 'height 0.03s linear',
    borderRadius: '0 0 10px 10px',
  });

  // "KICK" label above the bar
  const label = document.createElement('div');
  label.textContent = 'KICK';
  Object.assign(label.style, {
    position:   'absolute',
    top:        '-30px',
    width:      '100%',
    textAlign:  'center',
    color:      '#fff',
    fontFamily: 'Arial, sans-serif',
    fontWeight: 'bold',
    fontSize:   '14px',
    letterSpacing: '2px',
  });

  // Swipe arrow hint inside the bar
  const hint = document.createElement('div');
  hint.textContent = '↑';
  Object.assign(hint.style, {
    position:   'absolute',
    bottom:     '10px',
    width:      '100%',
    textAlign:  'center',
    color:      'rgba(255,255,255,0.4)',
    fontSize:   '22px',
    pointerEvents: 'none',
  });

  kickBar.appendChild(kickFill);
  kickBar.appendChild(label);
  kickBar.appendChild(hint);

  // Wrapper to allow label to sit above bar without clipping
  const inner = document.createElement('div');
  Object.assign(inner.style, { position: 'relative', marginTop: '30px' });
  inner.appendChild(kickBar);

  kickUIContainer.appendChild(inner);
  document.body.appendChild(kickUIContainer);
}

// ─── Touch Handling ──────────────────────────────────────────────────────────

function _attachTouchListeners(onKickComplete) {
  kickBar.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    const rect  = kickBar.getBoundingClientRect();

    // Only start if the touch begins in the BOTTOM half of the bar
    const relY = touch.clientY - rect.top;
    if (relY < BAR_HEIGHT * 0.5) return; // must start low

    swipeStartY  = touch.clientY;
    swipeStartX  = touch.clientX;
    swipeActive  = true;
    _resetFillKeepActive();
  }, { passive: false });

  kickBar.addEventListener('touchmove', (e) => {
    if (!swipeActive) return;
    e.preventDefault();

    const touch = e.changedTouches[0];
    const deltaY = swipeStartY - touch.clientY; // positive = swiping up

    // Power: how far up they've swiped relative to bar height (0–1)
    const power = Math.min(Math.max(deltaY / BAR_HEIGHT, 0), 1);

    // Update green fill
    kickFill.style.height = `${power * 100}%`;
  }, { passive: false });

  kickBar.addEventListener('touchend', (e) => {
    if (!swipeActive) return;
    swipeActive = false;

    const touch  = e.changedTouches[0];
    const deltaY = swipeStartY - touch.clientY;
    const deltaX = touch.clientX - swipeStartX;

    // Power clamped 0–1
    const power = Math.min(Math.max(deltaY / BAR_HEIGHT, 0), 1);

    // Direction: normalise horizontal drift relative to bar height
    // -1 = hard left, 0 = straight, 1 = hard right
    const direction = Math.min(Math.max(deltaX / (BAR_HEIGHT * 0.5), -1), 1);

    // Hide UI after a brief moment so the player sees the filled bar
    setTimeout(() => hideKickUI(), 300);

    // Fire the callback with kick data
    onKickComplete({ power, direction });
  }, { passive: false });

  // Also support mouse for desktop testing -- mirrors the touch handlers.
  let mouseDown = false;
  kickBar.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const rect = kickBar.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    if (relY < BAR_HEIGHT * 0.5) return;
    swipeStartY = e.clientY;
    swipeStartX = e.clientX;
    swipeActive = true;
    mouseDown = true;
    _resetFillKeepActive();
  });
  window.addEventListener('mousemove', (e) => {
    if (!mouseDown || !swipeActive) return;
    const deltaY = swipeStartY - e.clientY;
    const power = Math.min(Math.max(deltaY / BAR_HEIGHT, 0), 1);
    kickFill.style.height = `${power * 100}%`;
  });
  window.addEventListener('mouseup', (e) => {
    if (!mouseDown || !swipeActive) return;
    mouseDown = false;
    swipeActive = false;
    const deltaY = swipeStartY - e.clientY;
    const deltaX = e.clientX - swipeStartX;
    const power = Math.min(Math.max(deltaY / BAR_HEIGHT, 0), 1);
    const direction = Math.min(Math.max(deltaX / (BAR_HEIGHT * 0.5), -1), 1);
    setTimeout(() => hideKickUI(), 300);
    onKickComplete({ power, direction });
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _resetFill() {
  swipeActive  = false;
  swipeStartY  = null;
  swipeStartX  = null;
  if (kickFill) kickFill.style.height = '0%';
}

// Reset the visual fill at the start of a fresh swipe without clobbering the
// swipeActive=true flag that touchstart just set.
function _resetFillKeepActive() {
  if (kickFill) kickFill.style.height = '0%';
}

// Expose API on window (project does not use ES modules).
window.initKickSwipeUI = initKickSwipeUI;
window.showKickUI      = showKickUI;
window.hideKickUI      = hideKickUI;
