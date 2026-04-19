// ratings.js — size- and sample-aware overall ratings + depth-chart assignment.
// Original code for St. Andrew's vs St. Stephen's game. No licensed source material.

(function (global) {
  'use strict';

  const CLAMP = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const parseHeightInches = (h) => {
    if (!h) return 0;
    const m = /^(\d+)'(\d+)"?$/.exec(h.trim());
    if (!m) return 0;
    return parseInt(m[1], 10) * 12 + parseInt(m[2], 10);
  };

  const DEFENSE_POS = new Set(['LB', 'MLB', 'OLB', 'SLB', 'WLB', 'DL', 'DT', 'DE', 'NT', 'NG', 'T', 'CB', 'FS', 'SS', 'S']);
  const OFFENSE_POS = new Set(['QB', 'RB', 'FB', 'WR', 'TE', 'OL', 'C', 'G']);

  function sideOf(pos) {
    if (DEFENSE_POS.has(pos)) return 'DEF';
    if (OFFENSE_POS.has(pos)) return 'OFF';
    return 'ST';
  }

  // Sample-aware scaling: short-season players get perGame*10 extrapolation,
  // capped at raw+25 so a 3-game hot streak can't reach 99.
  function scaleCounting(val, gp) {
    if (!gp || gp <= 0) return val || 0;
    if (gp >= 6) return val || 0;
    return (val || 0) * (10 / gp);
  }

  function placeholderRating(player) {
    const base = { Fr: 62, So: 67, Jr: 72, Sr: 75 }[player.class] || 65;
    const w = player.weight || 0;
    const h = parseHeightInches(player.height);
    let bonus = 0;
    const isLine = player.positions.some((p) => ['OL', 'DL', 'DT', 'DE', 'NT', 'NG', 'T', 'C', 'G'].includes(p));
    if (isLine) {
      if (w >= 240) bonus += 4;
      else if (w >= 220) bonus += 3;
      else if (w >= 200) bonus += 2;
      else if (w >= 180) bonus += 1;
    } else {
      if (h >= 72 && w >= 180) bonus += 2;
    }
    if (player.stats && player.stats._note) bonus += 2;
    return CLAMP(base + bonus, 55, 78);
  }

  function rateQB(p, s, gp) {
    const yds = scaleCounting(s.passingYards, gp);
    const tds = scaleCounting(s.passingTDs, gp);
    const comp = s.completions || 0, att = s.attempts || 0;
    const compPct = att > 0 ? comp / att : 0;
    const qbr = s.qbRating || 0;
    const ints = scaleCounting(s.interceptionsThrown, gp);
    const rushYds = scaleCounting(s.rushingYards, gp);
    const yptAtt = att > 0 ? (s.passingYards || 0) / att : 0;
    return 40 + 25 * Math.min(yds / 2000, 1) + 20 * Math.min(tds / 25, 1)
      + 15 * Math.min(compPct / 0.65, 1) + 10 * Math.min(qbr / 110, 1)
      - 10 * Math.min(ints / 10, 1) + 5 * Math.min(rushYds / 400, 1)
      + 5 * Math.min(yptAtt / 10, 1);
  }

  function rateRB(p, s, gp) {
    const rY = scaleCounting(s.rushingYards, gp);
    const rTD = scaleCounting(s.rushingTDs, gp);
    const carries = s.carries || 0;
    const ypc = carries > 0 ? (s.rushingYards || 0) / carries : 0;
    const hundreds = scaleCounting(s.rushes100plus, gp);
    const recY = scaleCounting(s.receivingYards, gp);
    const fl = s.fumblesLost || 0;
    return 40 + 30 * Math.min(rY / 1500, 1) + 20 * Math.min(rTD / 18, 1)
      + 15 * Math.min(ypc / 7, 1) + 10 * Math.min(hundreds / 5, 1)
      + 5 * Math.min(recY / 300, 1) - 5 * Math.min(fl / 3, 1);
  }

  function rateWR(p, s, gp) {
    const rY = scaleCounting(s.receivingYards, gp);
    const rTD = scaleCounting(s.receivingTDs, gp);
    const rec = scaleCounting(s.receptions, gp);
    const ypr = (s.receptions || 0) > 0 ? (s.receivingYards || 0) / s.receptions : 0;
    const lr = s.longRec || 0;
    return 40 + 30 * Math.min(rY / 800, 1) + 20 * Math.min(rTD / 10, 1)
      + 15 * Math.min(rec / 40, 1) + 10 * Math.min(ypr / 20, 1)
      + 5 * Math.min(lr / 60, 1);
  }

  function rateOL(p, s, gp, ctx) {
    const pan = scaleCounting(s.pancakes, gp);
    const rushYPG = (ctx && ctx.teamRushYPG) || 100;
    let r = 55 + 20 * Math.min(pan / 5, 1) + 15 * Math.min((s.gp || 0) / 10, 1)
      + 10 * Math.min(rushYPG / 150, 1);
    const w = p.weight || 0;
    if (w >= 240) r += 4;
    else if (w >= 220) r += 3;
    else if (w >= 200) r += 2;
    return r;
  }

  function rateTE(p, s, gp, ctx) {
    const wr = rateWR(p, s, gp);
    const ol = rateOL(p, s, gp, ctx);
    let r = (wr + ol) / 2;
    if ((s.gp || 0) >= 8) r += 3;
    return r;
  }

  function rateDLLB(p, s, gp) {
    const core = (s.tackles || 0) + (s.sacks || 0) + (s.interceptions || 0) + (s.forcedFumbles || 0);
    if (core === 0 && (s.gp || 0) > 0) return placeholderRating(p);
    const tk = scaleCounting(s.tackles, gp);
    const sk = scaleCounting(s.sacks, gp);
    const ff = scaleCounting(s.forcedFumbles, gp);
    const ints = scaleCounting(s.interceptions, gp);
    const pd = scaleCounting(s.passesDefended, gp);
    let r = 40 + 25 * Math.min(tk / 80, 1) + 25 * Math.min(sk / 10, 1)
      + 15 * Math.min(ff / 4, 1) + 10 * Math.min(ints / 3, 1)
      + 10 * Math.min(pd / 6, 1);
    const primary = p.positions[0];
    if ((primary === 'DL' || primary === 'DT' || primary === 'DE' || primary === 'NT' || primary === 'NG') && (p.weight || 0) >= 220) r += 2;
    return r;
  }

  function rateDB(p, s, gp) {
    const ints = scaleCounting(s.interceptions, gp);
    const pd = scaleCounting(s.passesDefended, gp);
    const tk = scaleCounting(s.tackles, gp);
    const iry = scaleCounting(s.interceptionReturnYards, gp);
    const ff = scaleCounting(s.forcedFumbles, gp);
    let r = 40 + 25 * Math.min(ints / 5, 1) + 20 * Math.min(pd / 8, 1)
      + 20 * Math.min(tk / 60, 1) + 15 * Math.min(iry / 100, 1)
      + 10 * Math.min(ff / 3, 1);
    if (parseHeightInches(p.height) >= 72) r += 2;
    return r;
  }

  function rateK(p, s) {
    const fgM = s.fieldGoalsMade || 0, fgA = s.fieldGoalsAttempted || 0;
    const koAvg = s.kickoffAvg || 0, kos = s.kickoffs || 0;
    const tbs = s.touchbacks || 0;
    const xpM = s.xpMade || 0, xpA = s.xpAttempted || 0;
    const longFG = s.longFG || 0;
    if (fgA === 0 && kos > 0) {
      return 40 + 35 * Math.min(koAvg / 55, 1) + 25 * Math.min((tbs / kos) * 4, 1)
        + 20 * Math.min((s.longKickoff || 0) / 70, 1) + 20 * Math.min(kos / 30, 1);
    }
    return 40 + 30 * (fgM / Math.max(fgA, 1)) + 20 * Math.min(fgM / 12, 1)
      + 15 * Math.min(koAvg / 55, 1) + 15 * Math.min((tbs / Math.max(kos, 1)) * 4, 1)
      + 10 * Math.min(longFG / 45, 1) + 10 * Math.min(xpM / Math.max(xpA, 1), 1);
  }

  function rateP(p, s) {
    const avg = s.puntAverage || 0;
    const punts = s.punts || 0;
    const in20 = s.puntsInside20 || 0;
    const lp = s.longPunt || 0;
    return 40 + 35 * Math.min(avg / 42, 1)
      + 25 * Math.min((in20 / Math.max(punts, 1)) * 5, 1)
      + 20 * Math.min(lp / 55, 1) + 20 * Math.min(punts / 25, 1);
  }

  function returnerBonus(s) {
    const yds = (s.kickReturnYards || 0) + (s.puntReturnYards || 0);
    const td = (s.kickReturnTDs || 0) + (s.puntReturnTDs || 0);
    let b = 0;
    if (yds > 300) b += 3;
    if (td > 0) b += 5;
    return b;
  }

  // Maps a listed position string to a rating function.
  function rateByPosition(pos, p, s, gp, ctx) {
    if (pos === 'QB') return rateQB(p, s, gp);
    if (pos === 'RB' || pos === 'FB') return rateRB(p, s, gp);
    if (pos === 'WR') return rateWR(p, s, gp);
    if (pos === 'TE') return rateTE(p, s, gp, ctx);
    if (pos === 'OL' || pos === 'C' || pos === 'G' || pos === 'T') return rateOL(p, s, gp, ctx);
    if (pos === 'K') return rateK(p, s);
    if (pos === 'P') return rateP(p, s);
    if (pos === 'CB' || pos === 'FS' || pos === 'SS' || pos === 'S') return rateDB(p, s, gp);
    if (pos === 'LB' || pos === 'MLB' || pos === 'OLB' || pos === 'SLB' || pos === 'WLB'
        || pos === 'DL' || pos === 'DT' || pos === 'DE' || pos === 'NT' || pos === 'NG') return rateDLLB(p, s, gp);
    return 50;
  }

  function computeOverall(player, teamContext) {
    const s = player.stats || {};
    const gp = s.gp || 0;
    const ratings = {};

    if (s._placeholder || gp === 0) {
      const rPh = placeholderRating(player);
      for (const pos of player.positions) ratings[pos] = rPh;
      player.ratings = ratings;
      player.overall = rPh;
      player.isPlaceholder = true;
      player.returnerRating = 0;
      return rPh;
    }

    for (const pos of player.positions) {
      let raw = rateByPosition(pos, player, s, gp, teamContext);
      // Extrapolation cap: compute raw w/ real totals (no scaling), use as floor+25 ceiling for extrapolated.
      if (gp > 0 && gp < 6) {
        const rawReal = rateByPosition(pos, player, s, 10, teamContext); // gp>=6 path = no scaling
        raw = Math.min(raw, rawReal + 25);
      }
      ratings[pos] = CLAMP(Math.round(raw), 40, 99);
    }

    player.ratings = ratings;
    const subList = Object.entries(ratings).sort((a, b) => b[1] - a[1]);
    player.overall = subList[0][1];
    player.isPlaceholder = false;
    player.isSmallSample = gp > 0 && gp < 5;

    // Two-way flag: top 2 sub-ratings both >=65 on opposite sides.
    if (subList.length >= 2 && subList[0][1] >= 65 && subList[1][1] >= 65) {
      const s1 = sideOf(subList[0][0]), s2 = sideOf(subList[1][0]);
      if (s1 !== s2 && s1 !== 'ST' && s2 !== 'ST') player.isTwoWay = true;
    }

    player.returnerRating = returnerBonus(s);
    return player.overall;
  }

  // --- Depth chart ---------------------------------------------------------
  // Slot → list of position tags that can fill it, in priority order.
  const OFFENSE_SLOTS = [
    { slot: 'QB', pos: ['QB'] },
    { slot: 'RB', pos: ['RB', 'FB'] },
    { slot: 'WR1', pos: ['WR'] },
    { slot: 'WR2', pos: ['WR'] },
    { slot: 'WR3', pos: ['WR'] },
    { slot: 'TE', pos: ['TE'] },
    { slot: 'LT', pos: ['T', 'OL'] },
    { slot: 'LG', pos: ['G', 'OL'] },
    { slot: 'C', pos: ['C', 'OL'] },
    { slot: 'RG', pos: ['G', 'OL'] },
    { slot: 'RT', pos: ['T', 'OL'] },
  ];
  const DEFENSE_SLOTS = [
    { slot: 'LE', pos: ['DE', 'DL'] },
    { slot: 'DT', pos: ['DT', 'DL', 'NT'] },
    { slot: 'NT', pos: ['NT', 'NG', 'DT', 'DL'] },
    { slot: 'RE', pos: ['DE', 'DL'] },
    { slot: 'MLB', pos: ['MLB', 'LB'] },
    { slot: 'WLB', pos: ['WLB', 'OLB', 'LB'] },
    { slot: 'SLB', pos: ['SLB', 'OLB', 'LB'] },
    { slot: 'LCB', pos: ['CB'] },
    { slot: 'RCB', pos: ['CB'] },
    { slot: 'FS', pos: ['FS', 'S'] },
    { slot: 'SS', pos: ['SS', 'S'] },
  ];
  const ST_SLOTS = [
    { slot: 'K', pos: ['K'] },
    { slot: 'P', pos: ['P'] },
    { slot: 'KR1', pos: null, isReturner: true },
    { slot: 'KR2', pos: null, isReturner: true },
    { slot: 'PR', pos: null, isReturner: true },
    { slot: 'LS', pos: ['C', 'OL', 'TE'] },
    { slot: 'Gunner1', pos: ['CB', 'WR', 'S', 'FS', 'SS'] },
    { slot: 'Gunner2', pos: ['CB', 'WR', 'S', 'FS', 'SS'] },
  ];

  function bestFor(slot, roster, used, teamContext) {
    if (slot.isReturner) {
      return [...roster].filter((p) => !used.has(p.number))
        .sort((a, b) => {
          const ar = (a.returnerRating || 0) * 10 + (a.overall || 0);
          const br = (b.returnerRating || 0) * 10 + (b.overall || 0);
          return br - ar;
        })[0];
    }
    const candidates = roster.filter((p) => {
      if (used.has(p.number)) return false;
      return p.positions.some((pp) => slot.pos.includes(pp));
    });
    candidates.sort((a, b) => {
      const aR = Math.max(...slot.pos.map((pp) => a.ratings[pp] || 0));
      const bR = Math.max(...slot.pos.map((pp) => b.ratings[pp] || 0));
      return bR - aR;
    });
    return candidates[0];
  }

  function assignLineup(teamRoster, teamContext) {
    // Two-way: player can appear once on O, once on D, plus ST.
    const usedOff = new Set(), usedDef = new Set(), usedST = new Set();
    const lineup = { OFF: {}, DEF: {}, ST: {}, notes: [] };

    for (const slot of OFFENSE_SLOTS) {
      const p = bestFor(slot, teamRoster, usedOff, teamContext);
      if (p) { lineup.OFF[slot.slot] = p.number; usedOff.add(p.number); }
      else lineup.notes.push(`OFF ${slot.slot}: no eligible player — promoting placeholder.`);
    }
    for (const slot of DEFENSE_SLOTS) {
      const p = bestFor(slot, teamRoster, usedDef, teamContext);
      if (p) { lineup.DEF[slot.slot] = p.number; usedDef.add(p.number); }
      else lineup.notes.push(`DEF ${slot.slot}: no eligible player — promoting placeholder.`);
    }
    for (const slot of ST_SLOTS) {
      const p = bestFor(slot, teamRoster, usedST, teamContext);
      if (p) { lineup.ST[slot.slot] = p.number; usedST.add(p.number); }
      else lineup.notes.push(`ST ${slot.slot}: no eligible player.`);
    }
    return lineup;
  }

  function computeTeamContext(team) {
    const totalRush = team.players.reduce((sum, p) => sum + ((p.stats && p.stats.rushingYards) || 0), 0);
    const gp = team.gamesPlayed || 1;
    return { teamRushYPG: totalRush / gp };
  }

  function rateTeam(team) {
    const ctx = computeTeamContext(team);
    for (const p of team.players) computeOverall(p, ctx);
    team.lineup = assignLineup(team.players, ctx);
    team._teamContext = ctx;
    return team;
  }

  global.Ratings = { computeOverall, assignLineup, rateTeam, computeTeamContext, parseHeightInches, sideOf, OFFENSE_SLOTS, DEFENSE_SLOTS, ST_SLOTS };
})(window);
