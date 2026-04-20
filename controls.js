// controls.js — joystick, buttons, keyboard input.
(function (FB) {
  'use strict';

  FB.input = {
    joyX: 0, joyY: 0,
    sprint: false, juke: 0, dive: false,
    snapPressed: false, passPressed: false, handoffPressed: false,
    power: 0, powerHolding: false,
    chosenReceiver: null,
  };

  FB.initJoystick = function () {
    const stick = document.getElementById('joystick');
    const thumb = document.getElementById('joyThumb');
    const maxR = 50;
    let active = false, pid = null;
    const rect = () => stick.getBoundingClientRect();

    function update(px, py) {
      const r = rect();
      let dx = px - (r.left + r.width / 2);
      let dy = py - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > maxR) { dx = dx * maxR / d; dy = dy * maxR / d; }
      FB.input.joyX = dx / maxR;
      FB.input.joyY = dy / maxR;
      thumb.style.left = (50 + (dx / maxR) * 30) + '%';
      thumb.style.top = (50 + (dy / maxR) * 30) + '%';
    }
    function onDown(e) {
      const t = e.changedTouches ? e.changedTouches[0] : e;
      active = true; pid = t.identifier != null ? t.identifier : 'mouse';
      update(t.clientX, t.clientY);
    }
    function onMove(e) {
      if (!active) return;
      const touches = e.changedTouches || [e];
      for (const t of touches) {
        const id = t.identifier != null ? t.identifier : 'mouse';
        if (id === pid) { update(t.clientX, t.clientY); break; }
      }
    }
    function onUp() { active = false; pid = null; FB.input.joyX = 0; FB.input.joyY = 0; thumb.style.left = '50%'; thumb.style.top = '50%'; }

    stick.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(e); }, { passive: false });
    stick.addEventListener('touchmove', (e) => { e.preventDefault(); onMove(e); }, { passive: false });
    stick.addEventListener('touchend', (e) => { e.preventDefault(); onUp(); }, { passive: false });
    stick.addEventListener('touchcancel', (e) => { e.preventDefault(); onUp(); }, { passive: false });
    stick.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  FB.initButtons = function () {
    const tap = (id, fn) => {
      const el = document.getElementById(id);
      const handler = (e) => { e.preventDefault(); fn(); };
      el.addEventListener('click', handler);
    };
    tap('btnSnap', () => { FB.input.snapPressed = true; });
    tap('btnPass', () => { FB.input.passPressed = true; });
    tap('btnHandoff', () => { FB.input.handoffPressed = true; });
    tap('btnJuke', () => { FB.input.juke = 1; });
    tap('btnDive', () => { FB.input.dive = true; });
    tap('btnPause', () => FB.openPause && FB.openPause());

    const sprintBtn = document.getElementById('btnSprint');
    const setSprint = (v) => { FB.input.sprint = v; sprintBtn.classList.toggle('hot', v); };
    sprintBtn.addEventListener('touchstart', (e) => { e.preventDefault(); setSprint(true); }, { passive: false });
    sprintBtn.addEventListener('touchend', (e) => { e.preventDefault(); setSprint(false); }, { passive: false });
    sprintBtn.addEventListener('mousedown', () => setSprint(true));
    sprintBtn.addEventListener('mouseup', () => setSprint(false));
    sprintBtn.addEventListener('mouseleave', () => setSprint(false));

    const pw = document.getElementById('btnPower');
    const onPwDown = (e) => { e.preventDefault(); FB.input.powerHolding = true; FB.input.power = 0; };
    const onPwUp = (e) => {
      e.preventDefault();
      if (FB.input.powerHolding) {
        FB.input.powerHolding = false;
        if (FB.onKickRelease) FB.onKickRelease(FB.input.power);
        FB.input.power = 0;
      }
    };
    pw.addEventListener('touchstart', onPwDown, { passive: false });
    pw.addEventListener('touchend', onPwUp, { passive: false });
    pw.addEventListener('mousedown', onPwDown);
    pw.addEventListener('mouseup', onPwUp);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyW') FB.input.joyY = -1;
      if (e.code === 'KeyS') FB.input.joyY = 1;
      if (e.code === 'KeyA') FB.input.joyX = -1;
      if (e.code === 'KeyD') FB.input.joyX = 1;
      if (e.code === 'Space') { e.preventDefault(); FB.input.snapPressed = true; }
      if (e.code === 'KeyJ') FB.input.juke = 1;
      if (e.code === 'KeyP') FB.input.passPressed = true;
      if (e.code === 'KeyH') FB.input.handoffPressed = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') setSprint(true);
      if (e.code === 'Escape') FB.openPause && FB.openPause();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyW' || e.code === 'KeyS') FB.input.joyY = 0;
      if (e.code === 'KeyA' || e.code === 'KeyD') FB.input.joyX = 0;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') setSprint(false);
    });
  };

  // Toggle which HUD buttons are active for the current phase.
  FB.updateButtonStates = function () {
    const s = FB.state;
    const show = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !on); };
    const isPre = s.phase === 'presnap';
    const isPlay = s.phase === 'play';
    const isKick = s.phase === 'kick';
    show('btnSnap', isPre && s.playType !== 'kickoff' && s.playType !== 'fg' && s.playType !== 'punt');
    show('btnHandoff', isPre && (s.playType === 'run' || s.playType === 'pass'));
    show('btnPass', isPlay && FB.ballCarrier === FB.qb);
    show('btnJuke', isPlay && FB.ballCarrier && FB.ballCarrier.team === s.possession);
    show('btnDive', isPlay && FB.ballCarrier && FB.ballCarrier.team === s.possession);
    show('btnSprint', isPlay);
    show('btnPower', isKick);
  };

})(window.FB);
