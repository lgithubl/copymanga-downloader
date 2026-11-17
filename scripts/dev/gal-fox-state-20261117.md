# RJ01562637 interaction state

Existing dialogue rows already resolve their original AudioClip references. This change also keeps room audio sources synchronized with native GameObject branches. MultiSound controllers resolve by exact AudioSource references; direct loop sources remain direct loops. The first captured room uses direct sources, not a fabricated random playlist.

Auxiliary SkeletonGraphic components have per-room Auto / Show / Hide overrides in the right state panel. Auto follows native hierarchy state. Overrides change presentation only, preserving the underlying command state, rates and audio branches.

The girl meter follows the statically inspected `SetGirlPartHigh` rate table and `ValueObjectBGW` update. Rates accumulate continuously by elapsed time. A full meter increments the stage count, calls the room's authored `iku` function, applies the native cooldown and heart increment, then resumes. Sustained zero can reduce the stage and call authored `riku` when present. Seeking via slider or percentage buttons changes the current value once; it does not replace the rate table. Saved values are scoped by game and room; there is no offline catch-up.

This is the girl progress / stage path, not a complete emulation of the original game save, boy meter, dislike meter or arbitrary save-dependent conditions. Unknown save conditions retain explicit state controls. No original game code executes, and no decoder or dependency downloads at runtime.

Validation:

- All 28 captured room manager payloads export with strict typed meter parsing; Unity native export version 22 invalidates old generated metadata.
- Meter tests cover continuous rate, one-time seek, cooldown, stage decrease and busy deferral; audio tests cover branch activation, sequence order and cursor retention.
- Real first-room browser test covers rendered Spine, native audio playback, component Auto / Show / Hide and the full-meter stage trigger. Shared RPG interaction browser regression covers voices, conditions and outfit controls.
- Local sparse audio fixtures were supplemented with 25 read-only source ranges, approximately 2.7 MB. NAS originals are unchanged. Evidence and screenshots are local under `.cache/fox-state-20261117` and `.cache/multi-interaction-20261117`.
