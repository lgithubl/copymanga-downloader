# Interaction tree and native playback fixes — 2026-11-18

The existing interaction renderer now lists every tool and all of its regions in one tree. A sticky three-column icon bar focuses/enables a tool and scrolls to its group. Clicking a different already enabled tool focuses it; clicking the current enabled tool turns it off. Tool groups independently fold their regions, and each region independently folds its actions/voice choices. Folding never changes activation. Collapse state persists per game/role/tool/region. Existing tool/target multi-selection, independent timers and shared voice FIFO remain in use.

Alternative choices also support multiple enabled values. A selected reply pool cycles; native random command branches choose only from their selected pool. Empty selection means native/random behavior. Legacy scalar selections remain readable. Different tools and regions keep separate selections. The voice-ended gate defaults to enabled. Existing pre-change configurations receive a one-time per-game migration to enabled; after migration, an explicitly saved `false` remains the user's choice.

## RJ01562637 Ch02_Hcg01 onset sound

The real first action already contained its original activation, audio and deactivation commands. The presentation scheduler incorrectly required `running === false` to start these sound groups. Their owner action was still running, so the source was disabled before playback. Play-on-enable groups now evaluate immediately at their activation command; an action's own sound groups may run during that action, while the voice gate still blocks unrelated queued actions/voices. The captured actual-reader browser test failed before the fix and passed after it, checking real insertion audio resource decoding/playback rather than only an Audio constructor call.

## Underworld Yui CG6

The original prefab references Cubism MOC object 72276, while its model3 resource references 72624. They are byte-identical (SHA256 `23b7ef076161e0888dc02328558bcbe51300e2a325edb1a118670767f3649ce2`). The controller similarly references `basic/recall/yuistory_6` clips while the registered model resources live under `underworld/recall/yuistory_6`; all 13 animation clips have exact byte-identical counterparts. Native indexing now resolves only unique digest-identical MOC aliases and model-directory-scoped digest-identical clip aliases. It does not guess from an actor or animation name. Distinct old role MOCs remain unmatched.

The scene has 46 dialogue steps and 32 referenced available voices. The source also requests `socks_on`, which is absent from its native roleTool definitions; this remains a source-position diagnostic rather than guessing socks1/socks2. Optional voice IDs with no original resource remain reported. Neither issue removes the CG model or its real motions.

Native resource generation 33 and thumbnail generation r8 invalidate previous generated resources. No new runtime package/download or original save modification is involved. Collector 2.97 requests the three actual 4096 mip ranges (16MiB each), selected using the same mip policy as production. Initial 2.96 base-level samples remain local; the production decoder uses the existing smaller native mip rather than expanding 8192 RGBA textures. All ranges are for local real-pixel validation, source length/hash checked; originals on NAS remain read-only.

## Validation

- `gal-interaction-tree-browser-selftest.mjs`: actual captured model and interaction UI; all tools/regions listed before activation, sticky icons, independent fold, selected reply pool, enabled/current styling, default voice gate, serialized multi-target repeat queue and hold cancellation.
- `gal-fox-onset-sound-browser-selftest.mjs`: real Ch02_Hcg01 first action, original audio readiness/currentTime and no failed resource reads.
- `gal-underworld-cg6-browser-selftest.mjs`: original Yui CG6, exact native motion mapping and real visible model pixels at all 46 dialogue steps.
- Alternative/preference/selection/queue tests, Fox native room test, CatPaw original/native import/recall layout tests, and multi-game interaction tests.

Local artifacts: `.cache/interaction-tree-20261118/`. Only tests actually passing are reported as passed in the release response.


Completed regressions: real Kaiju interaction/CG rendering, original voice, native stage-three voice loop, meter lock/unlock and event SFX; real Future native import/layout/resource identity after restart; original Fox/CatPaw parsing and multi-game interaction state. The Kaiju meter test explicitly disables the new default voice gate during its rate assertions; queue behavior is independently exercised with controlled audio completion in the tree browser test.


Final Yui CG6 validation: all 46 dialogue positions rendered actual color pixels through the production Live2D renderer and real resource handler; first/middle/last screenshots visually checked. Zero missing model/texture/motion resources or browser errors. Browser checks use compositor screenshots (the ordinary WebGL backbuffer can be cleared after composition), not a false blank result from reading that cleared backbuffer.

Native texture-range collection completed through the automatic existing workflow. Each returned range passed its source-length and SHA256 guard before local fixture patching. No collected game asset is committed or included in the image.
