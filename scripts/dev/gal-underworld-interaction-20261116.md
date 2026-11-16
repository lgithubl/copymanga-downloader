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
