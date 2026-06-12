// systems-config.js — single source of truth for the SYSTEMS UPGRADE
// (attributes, coverage AI, blocking resolution, stamina, visuals).
// Loaded BEFORE attribute-system.js so the breakpoint tables and AI
// constants are available to every downstream module.
//
// NOTE: this file lives alongside graphics-config.js. graphics-config.js
// owns rendering quality settings; this file owns gameplay simulation
// constants. They are deliberately separate so a render-quality downgrade
// (e.g. AUTO HIGH → MEDIUM) doesn't affect gameplay numbers.
(function () {
  'use strict';

  // =========================================================================
  //  ATTRIBUTE BREAKPOINTS — overall → per-attribute lookup per position.
  //  attribute-system.js linearly interpolates between adjacent rows for any
  //  overall rating in [1, 99]. Values are the spec's numbers verbatim.
  // =========================================================================
  const ATTRIBUTE_BREAKPOINTS = {
    QB: {
      99: { throwPower: 99, throwAccuracy: 99, throwAccuracyShort: 99, throwAccuracyMid: 98, throwAccuracyDeep: 97, throwOnRun: 92, throwUnderPressure: 95, decisionMaking: 99, awareness: 99, speed: 78, agility: 75, strength: 65, stamina: 92 },
      85: { throwPower: 87, throwAccuracy: 84, throwAccuracyShort: 88, throwAccuracyMid: 83, throwAccuracyDeep: 78, throwOnRun: 72, throwUnderPressure: 80, decisionMaking: 84, awareness: 86, speed: 72, agility: 70, strength: 62, stamina: 85 },
      70: { throwPower: 74, throwAccuracy: 69, throwAccuracyShort: 72, throwAccuracyMid: 68, throwAccuracyDeep: 60, throwOnRun: 55, throwUnderPressure: 62, decisionMaking: 68, awareness: 70, speed: 68, agility: 66, strength: 60, stamina: 76 },
      50: { throwPower: 58, throwAccuracy: 48, throwAccuracyShort: 52, throwAccuracyMid: 46, throwAccuracyDeep: 38, throwOnRun: 35, throwUnderPressure: 40, decisionMaking: 45, awareness: 50, speed: 62, agility: 60, strength: 55, stamina: 64 },
    },
    WR: {
      99: { speed: 99, acceleration: 99, agility: 98, catching: 99, catchInTraffic: 96, spectacularCatch: 95, routeRunning: 99, release: 98, jumpingAbility: 95, strength: 65, awareness: 92, stamina: 92 },
      85: { speed: 90, acceleration: 88, agility: 86, catching: 85, catchInTraffic: 80, spectacularCatch: 78, routeRunning: 84, release: 82, jumpingAbility: 82, strength: 58, awareness: 80, stamina: 85 },
      70: { speed: 78, acceleration: 75, agility: 72, catching: 70, catchInTraffic: 64, spectacularCatch: 60, routeRunning: 68, release: 65, jumpingAbility: 70, strength: 52, awareness: 65, stamina: 76 },
      50: { speed: 62, acceleration: 58, agility: 55, catching: 50, catchInTraffic: 44, spectacularCatch: 38, routeRunning: 48, release: 45, jumpingAbility: 55, strength: 45, awareness: 48, stamina: 64 },
    },
    RB: {
      99: { speed: 97, acceleration: 99, agility: 99, carrying: 96, trucking: 88, spinMove: 92, jukeMove: 95, stiffArm: 85, breakTackle: 90, catching: 85, passBlocking: 72, strength: 82, awareness: 90, stamina: 92 },
      85: { speed: 88, acceleration: 90, agility: 87, carrying: 85, trucking: 75, spinMove: 78, jukeMove: 82, stiffArm: 72, breakTackle: 76, catching: 72, passBlocking: 60, strength: 72, awareness: 80, stamina: 85 },
      70: { speed: 75, acceleration: 76, agility: 72, carrying: 70, trucking: 62, spinMove: 62, jukeMove: 68, stiffArm: 58, breakTackle: 62, catching: 60, passBlocking: 48, strength: 62, awareness: 66, stamina: 76 },
      50: { speed: 60, acceleration: 60, agility: 55, carrying: 52, trucking: 45, spinMove: 44, jukeMove: 50, stiffArm: 40, breakTackle: 44, catching: 45, passBlocking: 35, strength: 50, awareness: 50, stamina: 64 },
    },
    OL: {
      99: { passBlocking: 99, runBlocking: 99, strength: 99, awareness: 95, agility: 72, acceleration: 68, impactBlocking: 98, leadBlocking: 92, stamina: 96, speed: 62 },
      85: { passBlocking: 86, runBlocking: 85, strength: 88, awareness: 82, agility: 62, acceleration: 58, impactBlocking: 84, leadBlocking: 78, stamina: 85, speed: 58 },
      70: { passBlocking: 70, runBlocking: 70, strength: 74, awareness: 68, agility: 52, acceleration: 48, impactBlocking: 68, leadBlocking: 62, stamina: 72, speed: 54 },
      50: { passBlocking: 50, runBlocking: 48, strength: 58, awareness: 50, agility: 42, acceleration: 38, impactBlocking: 48, leadBlocking: 44, stamina: 58, speed: 50 },
    },
    DL: {
      99: { speed: 82, strength: 99, powerMove: 99, finessMove: 95, blockShedding: 98, tackle: 95, pursuit: 92, awareness: 90, acceleration: 88, hitPower: 95, stamina: 90 },
      85: { speed: 74, strength: 88, powerMove: 86, finessMove: 80, blockShedding: 84, tackle: 82, pursuit: 80, awareness: 78, acceleration: 78, hitPower: 84, stamina: 82 },
      70: { speed: 66, strength: 74, powerMove: 70, finessMove: 64, blockShedding: 68, tackle: 68, pursuit: 66, awareness: 64, acceleration: 66, hitPower: 70, stamina: 72 },
      50: { speed: 58, strength: 58, powerMove: 52, finessMove: 48, blockShedding: 50, tackle: 52, pursuit: 50, awareness: 50, acceleration: 52, hitPower: 55, stamina: 60 },
    },
    LB: {
      99: { speed: 88, strength: 92, tackle: 99, pursuit: 98, manCoverage: 82, zoneCoverage: 90, blockShedding: 95, awareness: 98, hitPower: 99, acceleration: 90, agility: 88, stamina: 92 },
      85: { speed: 80, strength: 82, tackle: 86, pursuit: 84, manCoverage: 70, zoneCoverage: 78, blockShedding: 82, awareness: 84, hitPower: 86, acceleration: 82, agility: 78, stamina: 84 },
      70: { speed: 72, strength: 70, tackle: 72, pursuit: 70, manCoverage: 58, zoneCoverage: 64, blockShedding: 68, awareness: 70, hitPower: 72, acceleration: 70, agility: 68, stamina: 74 },
      50: { speed: 62, strength: 58, tackle: 56, pursuit: 54, manCoverage: 42, zoneCoverage: 50, blockShedding: 52, awareness: 54, hitPower: 58, acceleration: 58, agility: 58, stamina: 62 },
    },
    CB: {
      99: { speed: 97, acceleration: 98, agility: 98, manCoverage: 99, zoneCoverage: 95, press: 96, catching: 80, awareness: 96, jumpingAbility: 92, strength: 62, tackle: 70, pursuit: 90, stamina: 92 },
      85: { speed: 88, acceleration: 87, agility: 86, manCoverage: 84, zoneCoverage: 80, press: 80, catching: 68, awareness: 82, jumpingAbility: 80, strength: 55, tackle: 64, pursuit: 80, stamina: 84 },
      70: { speed: 76, acceleration: 74, agility: 72, manCoverage: 68, zoneCoverage: 65, press: 64, catching: 56, awareness: 68, jumpingAbility: 68, strength: 48, tackle: 58, pursuit: 70, stamina: 74 },
      50: { speed: 62, acceleration: 60, agility: 58, manCoverage: 48, zoneCoverage: 50, press: 45, catching: 44, awareness: 50, jumpingAbility: 55, strength: 40, tackle: 50, pursuit: 60, stamina: 62 },
    },
    S: {
      99: { speed: 93, acceleration: 92, agility: 92, manCoverage: 88, zoneCoverage: 99, tackle: 95, hitPower: 96, awareness: 99, catching: 82, pursuit: 96, jumpingAbility: 85, strength: 70, press: 75, stamina: 92 },
      85: { speed: 84, acceleration: 82, agility: 82, manCoverage: 76, zoneCoverage: 86, tackle: 84, hitPower: 86, awareness: 84, catching: 72, pursuit: 84, jumpingAbility: 76, strength: 62, press: 65, stamina: 84 },
      70: { speed: 74, acceleration: 72, agility: 70, manCoverage: 64, zoneCoverage: 72, tackle: 72, hitPower: 72, awareness: 70, catching: 60, pursuit: 72, jumpingAbility: 64, strength: 54, press: 56, stamina: 74 },
      50: { speed: 62, acceleration: 60, agility: 58, manCoverage: 48, zoneCoverage: 56, tackle: 58, hitPower: 58, awareness: 54, catching: 48, pursuit: 58, jumpingAbility: 54, strength: 46, press: 44, stamina: 62 },
    },
  };

  // Roster slots map to position groups for attribute lookup.
  const POSITION_GROUP_OF_SLOT = {
    QB: 'QB',
    RB: 'RB', FB: 'RB',
    WR1: 'WR', WR2: 'WR', WR3: 'WR', TE: 'WR',
    LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL',
    LE: 'DL', RE: 'DL', DT: 'DL', NT: 'DL',
    MLB: 'LB', WLB: 'LB', SLB: 'LB',
    LCB: 'CB', RCB: 'CB',
    FS: 'S', SS: 'S',
    K: 'QB', P: 'QB', LS: 'OL',
    KR1: 'WR', KR2: 'WR', PR: 'WR', Gunner1: 'CB', Gunner2: 'CB',
  };

  // =========================================================================
  //  AI BEHAVIOR CONSTANTS
  // =========================================================================
  const COVERAGE = {
    // Pre-snap cushion in yards. Press = on the LOS w/ outside leverage.
    cushionYards: { off: 6.0, press: 0.8 },
    // Reaction delay (seconds) interpolated from coverage rating.
    reactionSec: { hi: 0.15, lo: 0.70 },
    // How far ahead in time we predict receiver position (seconds).
    routePredictSec: 0.8,
    // Press jam slowdown applied to receiver velocity.
    jamSpeedMul: { hi: 0.75, lo: 0.95 },
    // Catch radius for an interception attempt while ball is in flight.
    interceptRadius: 1.6,
    // PBU (pass break-up) radius — slightly tighter than catch.
    pbuRadius: 1.4,
  };

  const QB_CONTAIN = {
    // QB is past LOS by this much before contain kicks in.
    scrambleDepthYards: 0.5,
    // Nearest LB within this many units enters contain mode.
    containRadius: 15,
    // Pursuit lookahead: aim where QB will be in N seconds.
    pursuitLeadSec: 1.0,
    // Containment angle: cut off the QB's velocity vector at this offset.
    cutoffYards: 3.0,
  };

  const BLOCKING = {
    // How often a blocker-defender pair re-rolls the matchup.
    rerollEverySec: 0.4,
    // Random noise added to each roll so outcomes aren't fully deterministic.
    rollNoise: 0.18,
    // Multiplier on shed velocity burst when defender wins a roll.
    shedBurst: 1.4,
    // Velocity damp applied to defender while engaged.
    engagedDamp: 0.15,
  };

  const STAMINA = {
    // Per-play baseline drain at stamina=70 (lerps with stamina attribute).
    drainPerPlay: { hi: 0.5, lo: 2.5 },
    // Recovery rate on the sideline (% per second).
    recoverPerSec: 3.0,
    // Auto-sub threshold (% stamina).
    subThreshold: 15,
    // Speed/accel/awareness penalties at 0% stamina (linear scaling).
    speedPenalty: 0.15,
    accelPenalty: 0.20,
    awarenessPenalty: 0.25,
  };

  // =========================================================================
  //  VISUAL UPGRADES — gated by per-tier effects flag from graphics-config.
  //  Anything in here that costs notable perf is OFF on MEDIUM/LOW.
  // =========================================================================
  const VISUALS = {
    skin: {
      // 6 realistic tone presets (spec).
      tones: ['#f5c5a3', '#e8a87c', '#c68642', '#a0693a', '#8d5524', '#4a2912'],
      // Subsurface scattering approximation: warm sheen color.
      sheenColorHex: 0xcc4400, sheenIntensity: 0.04,
      // Sweat clearcoat (HIGH only).
      sweatClearcoat: 0.3, sweatClearcoatRoughness: 0.25,
      // Forehead/nose shinier, cheeks matter than the base rough.
      shinyAreaRoughness: 0.45,
      mattAreaRoughness: 0.72,
    },
    shoulderPads: {
      // Hard ABS plastic outer shell.
      shell:  { roughness: 0.18, metalness: 0.05, clearcoat: 0.7 },
      foam:   { roughness: 0.95, metalness: 0.0, color: 0x1a1a1a },
      strap:  { roughness: 0.80, metalness: 0.0, color: 0x222226 },
      // Epaulet (arm cap) dimensions.
      epauletRadius: 0.30,
      epauletWidth: 0.40,
      // Neck collar around helmet base.
      collarRadius: 0.20,
      collarHeight: 0.07,
    },
    eyes: {
      socketColor: 0x050505,
      eyeBlackColor: 0x0a0a0a,
      // Eye black is applied to 70% of players (skill positions especially).
      eyeBlackChance: 0.7,
    },
    cleats: {
      // Spike count modeled per shoe at LOD 0.
      spikesPerShoe: 8,
      spikeHeight: 0.025,
      spikeRadius: 0.018,
    },
  };

  // =========================================================================
  //  CROWD UPGRADE — tiered. The full 70k-human spec is impossible at 60fps
  //  on mobile, so we run a layered LOD: detailed humans in the closest
  //  rows, simplified figures mid-stadium, sprites far. Numbers below are
  //  PER SECTION (the stadium has ~12 sections in the existing scene.js).
  // =========================================================================
  const CROWD = {
    // Maximum animation matrix updates per frame (closest people first).
    maxAnimUpdatesPerFrame: 150,
    // Demographic mix.
    skinToneWeights: [0.18, 0.20, 0.18, 0.16, 0.18, 0.10],
    // Outfit color buckets (no neon).
    outfitColors: [
      '#1a1a1a', '#2c2c30', '#3a3a40', '#4a3a2a', '#3a4a6a',
      '#5a3a3a', '#4a4a4a', '#6a5a4a', '#3a5a3a', '#2a3a5a',
      '#8a6a4a', '#6a4a3a',
    ],
    // Home/away jersey share.
    homeJerseyShare: 0.30,
    awayJerseyShare: 0.20,
    // Animation states (used by CrowdReactionManager).
    states: ['SITTING', 'STANDING_WATCHING', 'CHEERING', 'BOOING', 'EXCITED_JUMP'],
    // Event → (state, duration s, share-of-crowd).
    reactions: {
      td_home:        { state: 'CHEERING', dur: 4.0, share: 0.85 },
      td_away:        { state: 'BOOING',   dur: 2.0, share: 0.60 },
      big_run:        { state: 'CHEERING', dur: 2.0, share: 0.70 },
      sack_home:      { state: 'CHEERING', dur: 2.0, share: 0.75 },
      sack_away:      { state: 'BOOING',   dur: 2.0, share: 0.75 },
      penalty:        { state: 'BOOING',   dur: 2.5, share: 0.60 },
      fourth_stop:    { state: 'CHEERING', dur: 5.0, share: 0.90 },
      kickoff:        { state: 'STANDING_WATCHING', dur: 4.0, share: 0.50 },
      td_jump:        { state: 'EXCITED_JUMP', dur: 0.4, share: 0.85 },
    },
  };

  window.SYSTEMS_CONFIG = {
    ATTRIBUTE_BREAKPOINTS,
    POSITION_GROUP_OF_SLOT,
    COVERAGE, QB_CONTAIN, BLOCKING, STAMINA, VISUALS, CROWD,
  };
})();
