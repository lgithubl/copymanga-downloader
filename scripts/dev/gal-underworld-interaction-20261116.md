# Underworld character interaction — 2026-11-16

Entry: existing `catpaw::script` adapter → `角色互动` → 山葬冴 / 由纪. Each player also has a role selector. Update the unified image and rerun gal-layout 2.79.0; native cache version18 exports two additional interaction entries. No new adapter dependency or runtime download.

## Source-confirmed behavior

- Native roleConfig provides two roles, each with three clothConfig IDs, face states and six dbsmConfig tools.
- CubismDrawable serialized indices and CubismRaycastable precision come from the exact role prefab, resolved to its native CubismMoc identity. Both roles have four hit meshes. Precision0 means bounding box of current deformed mesh vertices; precision1 uses triangles. Invisible hit-area meshes remain eligible. Hit results are bounded to4 as in the native controller.
- `dbsm.Update` maps left click to `playSmAction`; it iterates hit results and current tool's touchArea records and uses the last match. The chosen key plays the Animator state; its talk list is cycled per tool ID. Opening a new reply closes the previous talk instance.
- `roleClothes` uses original cloth/sock definitions and face Animator layers. Accessory off state is formed with `key + '_off'` by `refreshRole.refresRoledDcorations`; cloth row key2 is not used to guess this mapping.
- Clothing parameters are applied after motion evaluation, as the native late-update tool controller does. A zero-value Param11 in YUI's socks0 definition is absent from its MOC and has no effect; nonzero parameters in all exposed choices were verified against the actual MOC.

## Implementation boundary

`gal-interaction/1` is an optional declarative scene extension. The ordinary scene player dispatches only these scenes to an independent interaction view. Renderer, animated hit detection and control state are reusable; game-specific mappings stay in the adapter. Ordinary dialogue / CG paths and other adapters retain their existing player.

The view supports role, outfit, intact/damaged body state, socks, accessories, facial expressions, tool selection, model-area click responses, subtitle/voice feedback, replay, audio levels, reset, details, list/back, fullscreen and immersive callbacks. Selections persist separately from dialogue progress. Explicitly opening a role card selects that role. Changing outfit/tool/role stops stale feedback audio. Clicking background never advances dialogue. Disposal pauses audio and destroys the model layers; hidden views pause animation/audio.

This is a local viewer, not the native game's progression/affection/unlock simulation. It does not execute the game assembly or modify its saves. No drag gameplay has been claimed.

## Evidence and tests

Source inputs are read-only. Exact texture/voice byte ranges were collected by versions2.70/2.71, hash-checked and applied only to local sparse `.cache` fixtures.

- Real import/layout/catalog contains `角色互动`; each original MOC resolves four authored hit meshes and six tool configurations.
- Native audit evaluates every exposed clothing choice against each actual MOC and checks all tool motions/reply mappings. No unresolved mapping remains.
- Browser test mounts the actual `createGalPlayer`, loads both native models/textures, scans for actual clickable hit areas, dispatches mouse clicks, verifies exact mapped action/reply, checks audio readiness/playback, changes outfits/accessories, and checks blank clicks do not advance. Captures/reports remain under `.cache/underworld-interaction-20261116/`.
- Unit tests cover bbox vs triangle precision, animation-deformed bounds, transformed canvas coordinates, validated restored selections, reply cycling/overlap precedence, clothing changes, optional scene extension forwarding and isolation from future.
- Targeted regression suite and all import presets are checked before release. Captured-fixture browser test: `scripts/dev/gal-underworld-interaction-browser-selftest.mjs`, with PLAYWRIGHT_PATH / CHROME_PATH pointing to already-installed test tools.

## 2026-11-17: region panel and HTTP preview

The right-hand, collapsible `可触发区域` panel derives its buttons from the selected tool's same declared areas used by stage pointer detection. Hover/focus highlights the current deformed native bbox/triangle geometry. List clicks and model clicks call one feedback path; no separate action mapping. Highlight projections follow canvas resizing, mirrored layouts and animation; overlays are pointer-transparent and their animation frame is disposed with the player. Panel expansion is remembered; narrow screens start collapsed.

Real-browser regression verifies both characters: native pointer click, hovered SVG geometry, list click to a second region with playable reply audio, collapse/reopen, all six tool lists, outfit/accessory changes, blank click isolation, and zero browser/resource errors. Pure tests check bbox/triangle projection and inverse coordinate mapping, plus current-tool list filtering.

The `Gal Interactive Demo` HTTP Action accepts an `underworld` captured-fixture kind. The fixture is materialized through the real resource API: original models, textures, motions, translations and all referenced interaction voices, two role scripts and an explicit container-free import profile. It includes no game executable/assemblies/archives, local storage or credentials. Fixture SHA256 is verified before bounded extraction. Connection information is uploaded as a short-lived Action artifact before the runner waits; this mode does not post commit comments. Public unified release assets still follow the standard image build workflow.

## 2026-11-17: compact icon controls

All role/outfit/sock/accessory/face/tool selections now live in a right-hand settings dock. Choice grids use authored icon resources where present, with a short text fallback, full hover titles, accessible labels and pressed selection state. Settings and trigger-region drawers have separate icon-only collapsible headers; no select elements remain. Their expansion state persists. The settings body scrolls independently so the trigger-region header remains reachable.

The original role records declare a paired dreamBoxBackground, but no independent selectable pose or scene table for this character module. The viewer exposes original background vs plain color. It does not manufacture a pose menu from unrelated Animator states or claim CG-scene switching. Model/region coordinates are unchanged by drawer expansion.

Captured exact referenced icons/background ranges were verified and applied only to local sparse fixtures. The actual browser test covers both roles, authored image loading, absence of dropdowns, right-hand drawer placement, icon-only region header, background switching, all six tools, list/model clicks and voice playback. It completes with zero browser errors or failed resource reads. The bounded HTTP fixture now includes the exact control icons and paired backgrounds too.

## 2026-11-17: per-game trigger modes and More settings

The right dock is three columns wide. Each tool has a default trigger mode and each target can override it: single, click-to-repeat (click again stops), or repeat while held. Target timers are independent. Switching role/tool/outfit, leaving/hiding the page, resetting or destroying the player cancels timers and queued requests. A visible stop button cancels everything. Native mode/area mappings remain one shared source for list and model inputs.

More contains a 0.2–10 second interval, text box opacity, text size, voice/sfx volume and a voice-ended gate (default off). Enabled gating serializes complete feedbacks and keeps one latest pending request per target; target FIFO order prevents starvation. Hold release removes its pending request. Disabled gating permits interrupting the current voice. Missing/failed voice playback unlocks the gate. Text opacity and audio settings initialize from existing player defaults/preferences once, then all changes are stored under this game's interaction key without writing global preference keys.

Fake-clock tests cover independent timers, voice/loading queue behavior, fairness, cancellation and valid preference ranges. A real-model browser test with controllable audio completion verifies all three input modes, release behavior, waiting/unrestricted voice behavior, opacity, three-column layout, per-game settings persistence/isolation and destruction. The separate original-voice browser regression also passes.
