// logic-clock.js — clock, down/distance, scoring, 4th down decisions, HUD.
(function (FB) {
  'use strict';

  FB.tickClock = function (dt) {
    const s = FB.state;
    if (s.phase === 'pregame' || s.phase === 'gameover' || s.phase === 'paused') return;
    if (s.phase !== 'play' && s.phase !== 'kick') return;
    s.clockSeconds = Math.max(0, s.clockSeconds - dt);
    const half = s.quarter <= 2 ? 'half1' : 'half2';
    if (s.clockSeconds <= 120 && !s.twoMinuteWarned[half]) {
      s.twoMinuteWarned[half] = true;
      flashWarn('2-MINUTE WARNING');
    }
    if (s.clockSeconds <= 0) quarterEnd();
  };

  function quarterEnd() {
    const s = FB.state;
    if (s.quarter >= 4) return FB.gameOverScreen && FB.gameOverScreen();
    s.quarter += 1;
    s.clockSeconds = s.quarterLen;
    flashWarn('END OF Q' + (s.quarter - 1));
    if (s.quarter === 3) {
      // Halftime — team that didn't receive opening KO gets the ball.
      s.possession = s.homeRecv ? 'away' : 'home';
      s.ballOn = 35; s.down = 1; s.distance = 10; s.los = 35;
      setTimeout(() => FB.setupPlay('kickoff'), 700);
    }
  }

  function flashWarn(text) {
    const el = document.getElementById('hudWarn');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(el._tm);
    el._tm = setTimeout(() => el.classList.add('hidden'), 2400);
  }
  FB.flashWarn = flashWarn;

  FB.advanceDown = function (gain) {
    const s = FB.state;
    s.distance -= gain;
    if (s.distance <= 0) {
      s.down = 1; s.distance = 10;
      s.los = s.ballOn;
      FB.state.log.push('First down.');
      nextSnap();
    } else if (s.down >= 4) {
      fourthDownPrompt();
    } else {
      s.down += 1; s.los = s.ballOn;
      nextSnap();
    }
  };

  function nextSnap() {
    setTimeout(() => {
      // Simple AI playcall if possession team isn't user — for MVP user always controls offense.
      const pt = Math.random() < 0.55 ? 'pass' : 'run';
      FB.setupPlay(pt);
    }, 700);
  }

  function fourthDownPrompt() {
    const s = FB.state;
    const modal = document.getElementById('fourthPrompt');
    const body = document.getElementById('fourthBody');
    const acts = document.getElementById('fourthActions');
    body.textContent = '4th & ' + s.distance + ' at the ' + s.ballOn + '.';
    acts.innerHTML = '';
    const addBtn = (label, fn, cls) => {
      const b = document.createElement('button');
      b.className = cls || 'btn-ghost';
      b.textContent = label;
      b.addEventListener('click', () => { modal.classList.add('hidden'); fn(); });
      acts.appendChild(b);
    };
    addBtn('PUNT', () => FB.setupPlay('punt'));
    if (s.ballOn >= 60) addBtn('FIELD GOAL', () => FB.setupPlay('fg'), 'btn-primary');
    addBtn('GO FOR IT', () => { s.down = 4; s.los = s.ballOn; FB.setupPlay(Math.random() < 0.5 ? 'pass' : 'run'); }, 'btn-primary');
    modal.classList.remove('hidden');
  }

  FB.scoreTouchdown = function () {
    const s = FB.state;
    s.score[s.possession] += 6;
    FB.state.log.push('TOUCHDOWN ' + FB.teams[s.possession].shortName + '!');
    FB.updateHUD && FB.updateHUD();
    const modal = document.getElementById('xpPrompt');
    modal.classList.remove('hidden');
    const kickBtn = document.getElementById('xpKick');
    const twoBtn = document.getElementById('xpTwo');
    const onKick = () => { modal.classList.add('hidden'); cleanup(); FB.setupPlay('xp'); };
    const onTwo = () => { modal.classList.add('hidden'); cleanup(); s.ballOn = 98; s.down = 1; s.distance = 2; s.los = 98; FB.setupPlay(Math.random() < 0.5 ? 'pass' : 'run'); };
    function cleanup() { kickBtn.removeEventListener('click', onKick); twoBtn.removeEventListener('click', onTwo); }
    kickBtn.addEventListener('click', onKick);
    twoBtn.addEventListener('click', onTwo);
  };

  FB.updateHUD = function () {
    const s = FB.state;
    document.getElementById('scoreHome').textContent = s.score.home;
    document.getElementById('scoreAway').textContent = s.score.away;
    document.getElementById('hudQtr').textContent = 'Q' + s.quarter;
    const m = Math.floor(s.clockSeconds / 60), sec = Math.floor(s.clockSeconds % 60);
    document.getElementById('hudClock').textContent = m + ':' + (sec < 10 ? '0' + sec : sec);
    const ord = ['1st','2nd','3rd','4th'][s.down - 1] || s.down + 'th';
    document.getElementById('hudDnD').textContent = ord + ' & ' + s.distance;
    const side = s.ballOn < 50 ? (s.possession === 'home' ? 'A' : 'S') : (s.possession === 'home' ? 'S' : 'A');
    const yd = s.ballOn < 50 ? s.ballOn : 100 - s.ballOn;
    document.getElementById('hudBallOn').textContent = side + ' ' + yd;
    const stam = FB.ballCarrier ? FB.ballCarrier.stamina : 100;
    const fill = document.getElementById('staminaFill');
    if (fill) fill.style.width = Math.max(0, Math.min(100, stam)) + '%';
    const play = document.getElementById('hudPlay');
    if (play) play.textContent = (s.playType || '').toUpperCase() + (s.phase === 'presnap' ? ' — PRESNAP' : s.phase === 'play' ? '' : s.phase === 'kick' ? ' — KICK' : '');
  };

})(window.FB);
