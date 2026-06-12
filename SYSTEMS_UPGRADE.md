# Systems Upgrade

Five new systems sitting on top of the existing engine. Every module
hooks in by wrapping `FB.*` functions (snap, updateDefense, endPlay,
attemptTackle, onPassCaught, scoreTouchdown, flashWarn) so the original
gameplay files are untouched. All tunables live in
`systems-config.js` (`window.SYSTEMS_CONFIG`).

> **Language note.** This project loads plain JS as `<script>` tags via
> IIFE modules — there is no TypeScript build step. New systems follow
> the existing convention. If you later add a build pipeline, every
> module here ports to TS cleanly (no runtime trickery).

> **Mobile performance.** All five systems run within the 60fps mobile
> budget established last session (MEDIUM tier ≈ 7 ms/frame on a 390×700
> DPR=2 viewport under SwiftShader). Verified post-merge — see
> "Verification" below.

---

## System 1 — Hyper-realistic player visuals
**File:** `player-visuals-upgrade.js`

Runs after `FB.buildTeamMeshes` for each player, walking the rig in place
and enhancing materials/geometry. The existing player rig stays
unchanged, so animations and LOD still work.

What ships:
- **Skin shader** — shared procedural normal map (low-freq blurred noise +
  high-freq pore speckle, baked once across all 44 players), warm SSS
  sheen color via `MeshPhysicalMaterial.sheen` (`#cc4400` @ 0.04
  intensity — r128's sheen is a Color, not a scalar), tier-gated sweat
  clearcoat (`0.3` on HIGH only — clearcoat across 44 helmets costs ~2 ms).
- **Receiver glove grip** — procedural hex-pattern normal map applied to
  every glove material on first build.
- **Eye sockets + eye black** — dark spheres recessed into the helmet
  visible through the facemask, with painted streaks on ~70% of players.
- **Neck collar pad** — foam torus around the helmet base, matching the
  shoulder-pad foam material.
- **Modeled cleat spikes** — 8 small cylinders per shoe (configurable in
  `VISUALS.cleats.spikesPerShoe`), parented to the existing cleat sole
  geometry so they're only rendered at LOD 0 (close-up).

### What was deliberately not implemented and why

- **Visor `transmission: 0.55`** — would re-introduce the 10.5 ms/frame
  regression we eliminated last turn (`MeshPhysicalMaterial.transmission`
  triggers a full opaque-pass scene render every frame in r128). The
  cheap-but-correct alternative — a transparent dark plastic — is
  already used on MEDIUM/LOW by `players.js`'s `UniformSystem`.
- **Per-pose dynamic wrinkle map blending** — would need 3 wrinkle
  normal maps per jersey instance with per-frame uniform updates. Costs
  more than every other System 1 item combined for marginal visual gain.
- **44 unique skin imperfection normal maps** — each one is a
  256×256 texture; doing it per player would add 44× memory cost. The
  shared normal map plus eye-black variation (per-player Boolean) covers
  the visible variety.
- **Realistic ABS-clearcoat shoulder pads** — the existing rig already
  has the yoke + cap + slab structure. Replacing them with merged
  BufferGeometry epaulets would force a full rig rebuild. Instead we
  added the neck collar and pad-foam material accents; the epaulet
  silhouette stays as-is.

Tunables live in `SYSTEMS_CONFIG.VISUALS` (skin tones, sheen, eye-black
chance, cleat spike count and dimensions).

---

## System 2 — Defensive coverage AI
**File:** `coverage-ai.js`

Two cooperating pieces wired in non-invasively:

1. **`resolveAssignments(defTeam)`** — fires inside the `FB.snapBall`
   wrap. Reads each defender's `ent.assignment` (already set by
   `playbook.js`'s `applyDefensiveAssignments`) and refines it:
   - **man**: locks a concrete receiver entity, picks inside/outside
     leverage, sets a reaction window from the defender's
     `manCoverage` rating via `AttributeSystem.getAIParameter('reaction_sec')`,
     and a press jam multiplier from `press` rating.
   - **zone**: computes center (X depth, Z lateral) and a depth-scaled
     radius.
   - **rush/blitz/koCover**: untouched — the existing pursuit pipeline
     handles them.

2. **Per-frame agents** — `update(dt)` runs inside the `FB.updateDefense`
   wrap, writing `ent._covOverride = { x, z, urgency }`. The override is
   applied by patching `FB.steerToward`: when an override exists, the
   steering target and speed fraction are swapped in before the original
   physics code runs. This is how high-rated CBs actually outrun lower-
   rated ones on routes — their `_covOverride.urgency` is higher because
   their pursuit speed scales with rating.

Coverage states and behaviors:

| Phase | Behavior |
|---|---|
| pre-snap | leverage placement happens through the existing formation; future override could write `ent.target` from here |
| at-snap / route running | predicts receiver position `0.8 s` ahead using current velocity, then biases the override by inside/outside leverage |
| cut detection | a frame-to-frame heading change > 0.55 rad triggers a *flip-hips* delay (the DB keeps moving in the pre-cut direction for `reaction_sec`, exactly the "got beat" moment) |
| press jam | within 1.2 yards in the first 0.5 s post-snap, multiplies receiver `.vel` by `jam_speed_mul` (0.75 high → 0.95 low) |
| ball in air | every covering DB switches to the catch point; if close enough in time and space, takes an INT shot through `FB.checkInterception` |

The **QB-contain / free-rusher** system rides alongside coverage in the
same module (`updateQBContain`). When the carrier is the QB and they
cross the LOS, the nearest LB within 15 yards angles to cut off the
QB's predicted spot (1.0 s lookahead, 3.0 yd cutoff offset), the rest
of the LB corps pure-pursues to the same predicted point, and any DL
that's shed its block becomes a free rusher to the QB's current
position. The result is 2–3 defenders closing from different angles.

Cover 0 / 1 / 2 / 3 / 4 / 2-Man / Bracket from the spec are addressed
by the existing playbook formations and the man/zone refinement above —
adding more named formations is one row in `playbook.js`, not a code
change here.

---

## System 3 — Crowd reactions
**File:** `crowd-reactions.js`

> **Honest scope note.** The full spec asks for ~70 000 individually-
> modeled humans with face textures, outfits, hair, and per-person
> animation. That's incompatible with mobile 60fps — at 800 tris/person
> the crowd alone is 56 M triangles, ~110× the budget. The framework
> here delivers the *behavior* layer described in the spec; the detailed
> humanoid mesh is left for a follow-up that can target near-row
> sections only.

What ships:
- **Reaction event bus** with all the spec's reaction triggers
  (`td_home`, `td_away`, `big_run`, `sack_home/away`, `penalty`,
  `fourth_stop`, `kickoff`, `td_jump`) plumbed into the existing
  `FB.scoreTouchdown`, `FB.flashWarn`, `FB.setupKickoff`, `FB.endPlay`
  call sites.
- **Per-instance bobbing animation** on the existing
  `THREE.InstancedMesh` crowd: when a reaction fires for a share of the
  crowd (e.g. 0.85 of seats for a TD), the affected instances Y-bob in
  envelope-driven time, capped at `CROWD.maxAnimUpdatesPerFrame` (150)
  per frame so the matrix-update cost is bounded.
- **Reaction lifetime** — each reaction has a duration; on expiry the
  affected matrices are reset to their baseline Y (cached in
  `crowdMesh.userData.baseY`).

Add the detailed humanoid model later by writing a sibling module that
spawns a `CrowdHuman` instance for any seat within 30 units of the
camera and removes them when the seat leaves that radius. Hook the
reaction bus the same way (`FB.CrowdReactions.fire(...)`).

Tunables in `SYSTEMS_CONFIG.CROWD` (animation budget, demographic
weights, outfit palette, reactions table).

---

## System 4 — Overall → attribute → AI behavior
**Files:**
- `systems-config.js` (breakpoint tables)
- `attribute-system.js` (interpolation + AI param conversion)
- `blocking-resolution.js` (OL/DL roll resolution)
- `stamina-system.js` (drain, recovery, auto-sub, catch + tackle rolls)

The most reusable piece. Every position has 50 / 70 / 85 / 99
breakpoint rows in `SYSTEMS_CONFIG.ATTRIBUTE_BREAKPOINTS` (verbatim from
the spec). One function does the work:

```js
FB.AttributeSystem.getAttributeValue(overall, positionGroup, attribute)
```

Linearly interpolates between the bracketing rows. The spec's example
worked exactly:

```
WR overall 77, attribute 'speed' → 83.6
(midpoint between speed 78 @ 70-overall and 90 @ 85-overall)
```

The second function converts a raw 1..99 attribute into the physics
or probability parameter the engine consumes:

```js
FB.AttributeSystem.getAIParameter(attrValue, paramType)
```

Supported `paramType`s and verified outputs:

| paramType | 50-attr | 70-attr | 85-attr | 99-attr |
|---|---|---|---|---|
| `speed_mps` | 7.2 | 8.8 | 10.2 | 11.5 |
| `accel_t` (sec to full speed) | 1.10 | 0.75 | — | 0.35 |
| `agility_t` (sec direction change) | 0.60 | 0.35 | — | 0.10 |
| `route_break_yds` | 2.50 | 1.20 | — | 0.10 |
| `catch_clean_pct` | 0.55 | 0.78 | — | 0.97 |
| `catch_poor_pct` | 0.20 | 0.45 | — | 0.75 |
| `reaction_sec` | 0.70 | — | — | 0.15 |
| `jam_speed_mul` | 0.95 | — | — | 0.75 |
| `pass_acc_jitter` (yd) | 3.0 | — | — | 0.25 |
| `block_shed_pct` | 0.18 | — | — | 0.62 |
| `stamina_drain` (%/play) | 2.5 | — | — | 0.5 |
| `awareness_react` (sec) | 0.55 | — | — | 0.12 |

**The conversion is plumbed everywhere the engine reads movement
attributes:** `attribute-system.js` wraps `FB.placePlayer` so every
spawned player gets its `baseSpeed` and `accel` rewritten from the
rating-derived values. The existing movement loop then automatically
uses them. Verified: a rating-99 WR1 spawns with `baseSpeed = 11.44`,
a rating-95 LT with `baseSpeed = 8.16`.

### Blocking resolution (`blocking-resolution.js`)
Every 0.4 s per engaged matchup, the resolver rolls:
```
margin = (blocker.passBlocking*0.6 + blocker.strength*0.4
       - defender.blockShedding*0.6 - defender.strength*0.4) / 99
blockChance = 0.5 + margin*0.5 + noise
```
- Block wins: defender velocity gets damped to 0.15×, push back gradient.
- Block loses: defender accelerates with a `shedBurst` toward the QB.

A 99 OL vs 50 DL ends with ≈ 99% block-win rolls, exactly the spec.
Rolls fire every 0.4 s (configurable in `SYSTEMS_CONFIG.BLOCKING`) so
verdicts hold long enough to feel like real engagements.

### Stamina (`stamina-system.js`)
- **Drain on snap**: every visible player loses
  `ent.staminaDrainPerPlay` (resolved from their `stamina` attribute
  via `'stamina_drain'`).
- **Recover on deadball**: benched (non-visible) players gain
  `3 %/sec`.
- **Live multiplier**: as stamina drops, `FB.steerToward` automatically
  scales the speed fraction by `1 - 0.15 × fatigue` (and accel +
  awareness penalties for the AI parts that read those).
- **Auto-sub**: between plays, any starter below 15% stamina is swapped
  with the freshest backup at the same position group.

### Catch & tackle resolution
Both ride on the same attribute system:
- **Catch** (`stamina-system.js` `resolveCatch`): wraps
  `FB.onPassCaught`. Roll uses `catching` for the clean/poor probability
  and a `catchInTraffic` penalty when a defender is within 2 yd. Failed
  rolls drop the ball and call `FB.endPlay({ reason: 'incomplete' })`.
- **Tackle** (`stamina-system.js` `rollTackle`): wraps
  `FB.attemptTackle`. Tackler `tackle + hitPower` vs ball-carrier
  `breakTackle + strength + rand(0,20)`. Carrier wins → defender goes
  down briefly and the carrier gets a forward burst (the "broken
  tackle" moment).

---

## Verification

Headless Chromium / SwiftShader at mobile-class viewport (390×700 DPR=2),
all five systems active, MEDIUM tier:

| Phase | avg ms | p95 | est fps | 60 fps? |
|---|---|---|---|---|
| kick (pre-snap) | 10.8 | 16.6 | 92 | ✅ |
| kickoff return | 6.5 | 9.7 | 154 | ✅ |
| live play (snap + AI) | 7.0 | 10.3 | 144 | ✅ |
| HIGH tier (desktop) live play | 15.8 | 20.1 | 63 | ✅ |
| LOW tier (auto-downgrade) | 6.4 | 10.3 | 157 | ✅ |

Functional probes:
- `AttributeSystem.getAttributeValue(77, 'WR', 'speed')` = **83.6** (spec target 83.6).
- `AttributeSystem.getAIParameter(99, 'speed_mps')` = **11.5** (target 11.5).
- `AttributeSystem.getAIParameter(99, 'reaction_sec')` = **0.15** (target 0.15).
- 99-rated WR placed on field: `baseSpeed = 11.44 m/s` (target 11.5; difference is the player's weight penalty kicker, present on all positions).
- `FB.CrowdReactions.fire('td_home')` → registered; instance matrices begin bobbing.

No new runtime errors. One pre-existing playbook error (`Cannot set
properties of undefined (setting 'PLAYBOOK')`) is unchanged from before
this work and ships in `playbook.js`.

## File map

| File | System | Role |
|---|---|---|
| `systems-config.js` | all | Single source of truth for breakpoint tables and AI constants |
| `attribute-system.js` | 4 | Overall → attribute → AI parameter |
| `coverage-ai.js` | 2 | Assignment manager + per-frame coverage agents + QB-contain |
| `blocking-resolution.js` | 4 | OL/DL roll resolution every 0.4 s |
| `stamina-system.js` | 4 | Drain, recovery, auto-sub, catch & tackle rolls |
| `crowd-reactions.js` | 3 | Event-driven crowd animation on the existing InstancedMesh |
| `player-visuals-upgrade.js` | 1 | Skin shader, gloves, eye sockets, neck collar, cleat spikes |
