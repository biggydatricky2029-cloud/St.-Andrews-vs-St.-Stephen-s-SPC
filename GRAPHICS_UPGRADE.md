# Graphics Upgrade — Broadcast Night-Game Overhaul

This document covers every change made in the broadcast-visuals overhaul:
what was done, where it lives, and what it changes on screen. **No game
logic was modified** — state, movement/input, physics, collision, scoring,
AI, and PvP networking files are untouched. New systems hook in by loading
after the gameplay files and overriding/wrapping `FB.*` functions.

Every tunable lives in one place: **`graphics-config.js`** (`GRAPHICS_CONFIG`).

## Quality tiers

`GRAPHICS_CONFIG.quality.mode` is `'AUTO'` by default: a device guess
(desktop → HIGH, mobile → MEDIUM) plus a runtime benchmark in `postfx.js`
that measures average frame time after a warmup and drops one tier (max
two drops) when frames exceed `downgradeMs`. Downgrading rebuilds the
post chain, sheds extra shadow maps, and lowers pixel ratio at LOW.

| Tier | Post passes | Shadow-casting spots | Player tessellation |
|------|-------------|----------------------|---------------------|
| LOW | gamma + FXAA | 1 | 10-segment lathes |
| MEDIUM | + bloom + color grade/vignette | 1 | 16-segment |
| HIGH | + SSAO + chromatic aberration (+ optional DOF) | 2 | 22-segment |

## Phase 1 — Player models & uniforms (`players.js`)

- **`FB.UniformSystem`**: one instance per player builds the full PBR
  wardrobe from (primary color, secondary color, skin tone, jersey number,
  last name, position, home/away variant). Per-player number/name canvas
  textures front and back; shared procedural detail maps.
- **Materials (all `MeshPhysicalMaterial`, values in config):**
  jersey 0.88 rough + procedural woven-knit normal map; helmet 0.12 rough /
  clearcoat 1.0 (hard shiny polycarbonate); facemask 0.95 metal (brushed
  steel); visor `transmission 0.6`, tint `#1a1a2e`, semi-transparent;
  skin 0.72 rough with warm `sheen` as an SSS stand-in; gloves 0.55 rough
  with micro-bump grip normal map; cleats split into 0.6-rough sole and
  0.8-rough upper.
- **Equipment added:** tinted eye-level visor inset in the helmet shell, a
  4-bar modeled facemask cage (perimeter hoop + 3 horizontal + 1 vertical
  bar), knee-pad and thigh-pad bumps reading through the pants, rounded
  glove mitts replacing hand boxes, defined cleat sole/upper/toe.
- **Skin tones:** 4 presets (`#f5c5a3 #c68642 #8d5524 #4a2912`) assigned
  deterministically per player (stable across games).
- The existing muscle-aware lathe rig (weight-driven limb radii, hip/knee/
  shoulder/elbow pivots) was kept — it's the bone tree the animation
  system drives — with tessellation now quality-tiered.

## Phase 2 — Field (`scene.js`)

- **Albedo bake (2048×1024):** mow stripes alternating `#3d6b33`/`#4f8f43`
  every 5 yards, dirt (`#6b4226`) blended along hash rows, mid-field, and
  goal-line fringes, compacted-center shading, 140k grass-blade noise px.
- **Dual-scale normal map:** coarse (heavily blurred) + fine (lightly
  blurred) noise heightfields blended in one bake — turf undulation plus
  per-blade micro detail.
- **Roughness map** (tiling noise) so patches catch the floods unevenly.
- **Wetness:** `FB.setFieldWetness(0–1)` lowers roughness / raises env
  reflections for a post-rain look (config `field.wetness` for the default).
- **Wind micro-sway:** `onBeforeCompile` vertex injection, amplitude 0.002.
- **Crown:** parabolic center-high crown (`field.crownHeight`, 0.10).
  `FB.fieldCrownY(z)` is the shared helper; turf, every yard line, the
  LOS/first-down overlays, the referee, and all players (via the animation
  system) sit on it.
- **Worn paint:** yard lines, hashes, and sidelines use a noise alpha mask
  (`field.paintWear`) so markings read as painted turf, not vectors.

## Phase 3 — Broadcast light rig (`scene.js`)

Replaced the old sun/sky daylight with a night rig:

- **4 corner SpotLights** (`#fff5e6` warm metal-halide, penumbra 0.3,
  no decay) whose sources sit exactly on the visible 48-unit pole
  clusters. Opposite corners cast PCFSoft shadows (count/size per tier)
  so shadows cross like a real stadium.
- **HemisphereLight** night sky `#1a1a3e` / grass bounce `#3d6b33` @ 0.4.
- **AmbientLight** `#102030` @ 0.12 — shadows never crush to black.
- **Camera fill** DirectionalLight @ 0.3, shadowless, repositioned every
  frame by the broadcast camera so faces never silhouette.

## Phase 4 — Post-processing (`postfx.js`, new file)

Pass order: scene render (SSAOPass on HIGH — it replaces RenderPass) →
UnrealBloom (threshold 0.82 / strength 0.18 / radius 0.35) → optional
BokehPass (config toggle, off by default) → custom **chromatic aberration**
(RGB separation confined to the outer frame so field lines never rainbow) →
custom **color grade** (contrast 1.08, saturation 1.12, warm-shadow/
cool-highlight split tone, 25% vignette) → gamma correction → **FXAA**
(always last; renderer MSAA is off in exchange). Includes the AUTO-quality
benchmark and the per-frame render entry point `FB.renderFrame(dt)`.

## Phase 5 — Environment & atmosphere (`scene.js`)

- **IBL:** synthetic night-stadium cubemap (dark sky, warm floodlit
  horizon band, green turf bounce) as `scene.environment` — helmets and
  visors pick up believable reflections. *Note:* a live
  `PMREMGenerator.fromScene` capture was implemented first and produced
  NaN samples on some GL stacks (verified under SwiftShader), which blacks
  out every Standard/Physical material in r128 — the procedural cubemap
  uses no render targets and cannot fail that way.
- **Night sky:** deep-navy clear color + 700-point star field. A geometric
  gradient sky dome was tried twice and read too bright on the verified
  pipeline, washing out the night contrast, so it was removed.
- **Lens flares** (`THREE.Lensflare`) with canvas-baked core/ghost sprites
  on each of the 4 light clusters.
- **Light shafts:** short additive gradient-faded cones hanging from each
  lamp head — a god-ray stand-in that can't veil the gameplay camera.
- The existing tiered stands, ~3.5k-instance colored crowd, jumbotron, and
  BECK STADIUM signage were kept (crowd was already an InstancedMesh).

## Phase 6 — Animation system (`animation.js`, new file)

Overrides `FB.updatePlayerRigs` with a blended state machine over the
existing pivot rig: **IDLE** (breathing chest-scale oscillation + weight
shift), **RUN** (speed-parameterized stride, opposite-side arm swing),
**THROW** (wind-up → release → follow-through, hooked on `FB.throwPass`),
**CATCH** (arms overhead while a pass targets the receiver), **BLOCK**
(lineman crouch working the block), **TACKLE** (collapse), **CELEBRATE**
(arms-up hop, hooked on `FB.scoreTouchdown`). All joints blend with a
0.15 s time constant — the procedural equivalent of `crossFadeTo(0.15)`.
`THREE.AnimationMixer` was evaluated and intentionally not used: the rig
is a plain `Group` hierarchy (not a `SkinnedMesh`), so direct blended
targets are cheaper per frame with identical results. Crouch states apply
a root-drop ground-lock approximation (the 2-bone-IK stand-in) so feet
stay planted, and every player is planted on the field crown each frame.

## Phase 7 — Performance

- **3-level `THREE.LOD` per player:** full articulated rig (near) →
  ~150-triangle team-colored stand-in @ 55 units → billboard sprite
  @ 120 units. Stand-in/billboard materials are cached per team. The
  animator skips all joint math when level 0 isn't displayed.
- **Object pooling:** all 44+ meshes built once per game and reused every
  play; rebuilding a pool disposes the previous pool's per-player
  materials/textures (shared caches are kept).
- Renderer: pixel ratio ≤ 2 (≤ 1.5 after a LOW downgrade), `antialias:
  false` (FXAA instead), quality-tiered shadow map counts/sizes,
  quality-tiered geometry tessellation. Crowd remains one InstancedMesh.

## Phase 8 — Broadcast camera (`camera-broadcast.js`, new file)

Overrides `FB.updateCamera`. The camera deliberately stays **behind the
controlled player** — the joystick mapping and receiver picking depend on
that framing, so a true sideline main camera would invert the controls —
but the lens itself is broadcast-grade: telephoto FOV with **auto-zoom
38–52°** driven by how spread out the play is, smooth tracking lerp,
continuous layered-sine **handheld wobble** (amplitude 0.03) on top of the
existing impact shake, and a **TD replay**: a ~2.6 s low-angle orbit
around the scorer (hooked on `FB.scoreTouchdown`). The camera fill light
rides with the lens.

## Files

| File | Status | Contents |
|------|--------|----------|
| `graphics-config.js` | new | every tunable parameter + quality tiers |
| `postfx.js` | new | post chain, custom shaders, AUTO benchmark, render entry |
| `animation.js` | new | player animation state machine + hooks |
| `camera-broadcast.js` | new | broadcast camera + TD replay |
| `scene.js` | modified | light rig, night sky, turf/markings, crown, IBL, flares, shafts |
| `players.js` | modified | UniformSystem, PBR wardrobe, equipment, LOD, pooling |
| `logic-loop.js` | modified | render handed to `FB.renderFrame` (fallbacks kept) |
| `index.html` | modified | extra r128 example passes (CDN), new scripts, cache-bust |

## Verified

Headless Chromium (SwiftShader) smoke test: game boots clean, HIGH-tier
composer active, 4 spots + IBL + 44 LOD players live, crown planting and
FOV auto-zoom confirmed, kickoff renders, no new console errors. The one
page error (`PLAYBOOK` set on undefined `FB` in `playbook.js` — a script
load-order issue) **pre-exists this work**, byte-identical on the previous
commit, and was left alone since fixing it changes gameplay behavior.
