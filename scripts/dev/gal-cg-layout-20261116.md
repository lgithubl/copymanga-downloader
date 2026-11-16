# Native recall layout and Fox room covers — 2026-11-16

## Confirmed causes

CatPaw recall Live2D specifications omitted placement. The renderer then filled both CSS dimensions in the 16:9 player. The actual MOC canvases differ: future replay 100023 (`asDoubleHapply2Prefab`, A和S双人故事CG2) is 5807×4201; underworld replay 100015 (`doubleStory2Prefab`, 双人CG2) also uses its own non-16:9 canvas. Retain the authored uniform model scale and offset relative to the validated centered recall container and 3840×2160 stage; preserve native viewport clipping. Unknown layouts use aspect-preserving contain. Actor placement and other adapters are unchanged.

The freshly collected RJ01562637 metadata explicitly sets `thumbRender.enabled=false`. Room covers require rendering the original Spine state. Do not override this preference automatically. Apply a game-scoped override after any global disable rule:

```json
{"path":"*RJ01562637*","config":{"thumbRender":{"enabled":true}}}
```

Room catalogue nodes now select a dedicated `::cover` scene. It initializes native body/face tracks without expanding dialogue or interaction menus. Disabled rendering produces an actionable thumbnail diagnostic. No new runtime dependencies/downloads.

## Validation

- Real original models/textures in the full browser player: future 100023 CSS 1020.703125×738.390625 / buffer1920×1389; underworld 100015 CSS1029.890625×687.46875 / buffer1920×1282. Both aspect errors <0.002, no browser exceptions.
- Sparse captured fixtures omit some audio; these checks establish CG display/proportion, not complete audio playback.
- Actual first Fox room `::cover` rendered with existing pinned Spine 4.2 runtime: nonblank JPEG33251bytes, no missing resource requests or browser exceptions.
- Actual handler config toggle: disabled supplies no render job and reports `thumbRender.enabled=false`; enabled supplies `s:Ch02_Hcg01_黃毛正常位.uspine::cover`. Enabled catalogue lookup81ms in the warm fixture.
- 23 targeted parser/native-import/layout/legacy regression checks pass. Import preset browser check separately passes all50presets /41adapters with the installed Chrome path.
- Local evidence: `.cache/cg-layout-20261116/` (browser logs, native prefab audit, captured config, config toggle, test logs). Source games remain read-only; only local sparse test cache receives the collected mip ranges.

## Upgrade

Update the unified image, apply the scoped thumbnail override if desired, and rerun gal-layout2.78.0 on future/underworld/RJ01562637. Unity native metadata cache version17 re-exports authored recall placement. No re-download of source games is required.
