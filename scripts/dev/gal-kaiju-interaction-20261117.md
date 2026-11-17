# Kaiju Princess 2 and multi-selection interaction verification

Implementation: `kaiju::unity`; import preset → Kaiju Princess 原生 Unity. `gal-layout` 2.88.0; Unity native cache generation 27. Update the unified image and tag package, then rerun layout. Existing originals remain read-only; generated scripts/resources/cache live in the normal media container cache. No original assembly/JavaScript execution, save modification, new runtime package, or runtime decoder download.

```json
{
  "rootDir": "/data/library/gal/Kaiju Princess 2",
  "adapters": ["kaiju::unity"],
  "defaultMetadataActions": ["gal-layout"],
  "dryRun": false,
  "config": {"game": {"id": "kaiju::princess2", "title": "Kaiju Princess 2"}}
}
```

Native sources: Unity 2020.3.49f1 `data.unity3d`, ResourceManager exact paths, Drama XML, CSV localization/recollection/action/skin/emotion/level tables, JSON Spine 4.1.17, local external `resources.resource` audio. Static IL inspection established argument positions and native level/click rules; DLLs never execute. Collection uses bounded read-only ranges plus source length/SHA256 validation, not a full archive upload.

## Interaction behavior

- Both tools and numbered targets support independent enabled sets. Enabled tint and current outline are distinct. Clicking a different enabled item focuses it; clicking the current enabled item turns it off. Tool icon + target number replaces anonymous 1/2/3 labels. Hover/title retains the full native target name.
- With repeat and wait-for-voice enabled, all active tools/targets share one FIFO. Each target has at most one pending repeat (repeats coalesce while blocked). Native meter events join the same queue. Native automatic sound groups also defer behind active voice/command playback, rotate fairly, and notify the shared queue when audio ends or fails. Only one voice/command sequence runs at a time; closing one target cancels that target's pending repeat. Hold stops on release; disabling wait-for-voice permits interruption as before.
- Kaiju has Normal, Cowgirl and DoggyStyle entries and pose navigation. Original equipment, compatible action sets, animation priority, skins, clothing controls, local animated cut-ins and Auto/Show/Hide controls are normalized to the shared interaction UI. Cut-ins use preview screen rectangles rather than reproducing the original game HUD layout.
- Native M/B/C/V/A experience, lubrication, dislike and accumulation meters are per game/heroine. One-time seek changes the current value, not the subsequent rate. Each meter has its own persistent lock button: while locked, automatic increments/decrements, resets and queued threshold events cannot change that meter. Manual slider/percentage changes remain available. Unlocking resumes the native rate. Locks are saved per game (Kaiju shares a heroine's locks between poses; Fox keeps each room's meter separately). Native table thresholds change expression/voice pools; crossing a sensitivity threshold records climax flags and selects the native climax animation/voice. No artificial condition-true/false chooser is inserted for Kaiju.
- This is a presentation preview with no inventory/buffs/save data. Game economy, stamina costs and consumable buffs are not simulated. Original source tables choose the base rates and thresholds. Unknown presentation commands remain visible as diagnostics.

## Expression, layer and audio completion (initial native cache 25)

- Actor expression replacement now closes the original `SLOT_Emo` bone group (including immediate children), and clears the native `Talk_Mouth` group. It no longer guesses groups from slot names. New actors start with the native `Face_Normal` default.
- References resolve inside the current skeleton only: exact, unique case correction, complete whitespace/slash-separated slot lists, or unique reordered underscore tokens. All 40 special scripts were audited: nine normalized references; 34 absent off references are recorded as native no-ops. Fifteen on-reference uses (14 unique scene/name pairs) genuinely have no slot in the selected original skeleton. These retain source-event diagnostics. In particular 995/996 request Lv3 hat slots on a lower-stage model; no unrelated model is substituted.
- Hidden slots detach their attachment as well as setting alpha to zero, matching the native code and preventing invisible clipping attachments from cutting other layers. Overrides restore attachments before skin/animation changes.
- Real Spine timeline callbacks now dispatch the original HCG/HMode EventName tables. HCG callbacks require the original prefab's `SpineSoundEvent` component; unmapped timeline names remain silent, as in the native table. Audio gain, pause, scene changes and destruction apply to these clips.
- Interaction actions play the original direct short voice/SFX, followed by native emotion-stage voice pools. Stage loops wait for completion and share the existing voice queue; model/action changes cancel stale requests. Existing meter locks remain effective.
- Actual Drama 5011 step 35: both blush layers have real attachments; toggling them changes 9,593 pixel channels. Native `JJNormal_Sound` repeatedly decodes/plays real audio. Pause and destruction stop new events. Step 13 ends in `Idle_0` with no sound event; sound is not fabricated there.

## Pose face / Memories 28 / thumbnail corrections

- Regression reproduced on the native Cowgirl skeleton: `Face` is a fixed attachment on bone `01_PIC`, not an expression toggle. The previous `/face|emo/i` reset hid it (and some fixed face decorations). The interaction reset now uses the original emotion table's declared `OpenSlots`, matching `HModeEmotionExcelManager.Initialize/GetAllEmotionByFlag`; fixed face geometry retains its original draw order. All three poses are checked against the original toggle lists.
- `Memories_EventTitle_28` is Drama **10007**. Original event 48, opcode 49 has `isStreamMode=1` and closes `BG` only in streamer mode. Normal native playback skips it (`UI_Drama.DoSpineSlot`). The adapter previously applied it unconditionally, exposing the plain white backdrop. Streamer-only slot commands now remain skipped/recorded in normal playback; the native CG background stays attached. No fabricated background or different scene is substituted.
- Opening standing actor had a second, independent white-screen cause: the stored atlas material points at a 2×2 white placeholder. The native game binds its real texture through `SpinePathExcelEntity.MaterailPath/TexturePath`; the index now follows that exact material-name/path pairing. All 31 indexed skeletons / 347 pages were audited (346 native-table bindings), with no unresolved placeholders. The actual Type-V texture was decoded and visually verified. Native prefab child offset/scale (Type-V: y=-350, scale≈0.5) now composes inside the script root transform rather than being discarded.
- Non-mipmapped RGBA atlases now honor the already requested preview size, avoiding a 4096² RGBA allocation/upload for each of seven actor pages; raw channels and orientation have regression coverage. Existing full-resolution callers keep their behavior. Native cache generation 27 automatically rebuilds generated bindings/resources; no original files are removed.
- Actual thumbnail pipeline verified for Normal/Cowgirl/DoggyStyle cover scripts and Drama 10007. Existing cards already request composited Spine thumbnails; their raw background fallback is shown until rendering completes. Fixed selection of hidden actors (four original dramas: 821/1004/1024/1087), and prevented the expression look-ahead from advancing into a frame after the actor disappears. Render cache version `r3` refreshes previous incorrect thumbnails without deleting originals.
- Additional capture: only bounded original ranges for the two remaining pose atlases and Drama 10007's referenced images/audio, 163.15 MiB source reads, plus 28.40 MiB compressed bundle ranges for the real Type-V texture pages, SHA256 verified; no complete archive, source modification or executable execution.
- Regression entry: `node scripts/dev/gal-kaiju-pose-browser-selftest.mjs`, plus `gal-kaiju-texture-bindings-selftest.mjs` (set `KAIJU_VERIFY_TEXTURE_PIXELS=1` for captured image decoding), Kaiju presentation tests and the shared thumbnail inner/film regression. First-dialogue validation waits for nontransparent skeleton pixels and checks actual frame colors, rather than treating a created canvas or visible background as success.

## RJ01562637 correction

`database/girl` supplies 90 original numeric state defaults, including the native 0..3 stage bound. Known states now execute their original comparisons rather than exposing manual true/false switches. Authored inverse functions are paired with their matching action, preserving stable target IDs and independently closing supported actions. Missing inverses are not invented. Original component visibility controls and rendered interaction covers remain available. Three obsolete/absent durability state names in some room functions still use explicit unknown-state diagnostics; this is not claimed as emulating every game function.

## Evidence

Local fixtures/reports stay under `.cache/kaiju-20261117` and `.cache/interaction-queue-20261117` (not distributed):

- Real import → layout → handler restart/resource path: 365 scripts (362 Drama XML + three interaction poses), 31 Spine models, 40 recollection/special-scene entries.
- All 40 special scripts statically parsed. Dynamic and static CG mappings come from the original recollection/event tables. Not every image of every scene has been visually verified.
- Browser rendered the real Normal pose with complete limbs/clothes/face and native cut-in; two captured frames differ. Real Japanese audio plays. Seeking mouth to Lv.3 changes the next clip from the original level-zero pool to `se904_ja`. Cut-in visibility override works.
- Real special Drama 5011, first CG at displayed step 13: original animated Spine CG renders; captured frames differ. Whole drama has 67 text lines, 38 voice references; silent lines have no AudioClip in the native mapping.
- Shared real Underworld model: two tools/two targets stay enabled, focus-before-close, serial FIFO voices, fair repeat rotation, cancellation and hold release.
- Real Fox first room: no manual conditions for known states, two independently paired toggles, closing insertion preserves the other active layer, real audio, meter event and thumbnail pixels.
- Regression: old TSK Ch10340034 step 45→46 skin/eye attachment; sequential and direct entry match. Import dropdown test covers the new preset and preserves existing options; layout default-rule guard passes.

Commands: `node scripts/dev/gal-kaiju-presentation-selftest.mjs`; `node scripts/dev/gal-kaiju-layer-browser-selftest.mjs`; `node scripts/dev/gal-kaiju-state-selftest.mjs`; `node scripts/dev/gal-kaiju-browser-selftest.mjs`; queue/selection/Fox selftests; `gal-interaction-modes-browser-selftest.mjs`; `fe-gal-import-presets-selftest.mjs`; `fe-gal-spine-skin-selftest.mjs`; `gal-layout-rules-selftest.mjs`. Browser fixtures need the existing pinned local Spine runtime and local Playwright/Chrome; tests never download runtimes.

## Presentation limits

Screen fades 11/12 and background color are supported. Shader transitions 19/20 use a plain fade and report that fallback. Some shake/flash effects, static-image camera transforms, 3D rotation projection, genuinely absent source slot references, and gameplay events are not reproduced exactly. Those are reported in raw-command diagnostics instead of silently declaring full original-game fidelity. Continuation 200 follows original referenced Drama with a cycle/depth guard. The generated adapter is isolated; existing Unity/krkr/BGI layout IDs are not reassigned.

## Static schema provenance

`web/library/gal/unity-2020-types.json` contains only eight serialized class field layouts (1, 4, 21, 28, 82, 83, 213, 224), derived from the structural type-tree dump for Unity 2020.3.49f1:
https://github.com/AssetRipper/TypeTreeDumps/blob/main/InfoJson/2020.3.49f1.json

Original full dump SHA256: `e7a0aebfdd233e178dd76cb40b20d26fd2a621f6138545aec6149d6476300487`. No AssetRipper executable/library or game asset is bundled. This adds static field data to the existing decoder; existing build-time Spine 4.1 runtime is reused.
