# Interaction selections and card covers

Interaction tools are independent toggles. Their activation order is stored per game and role as `enabledTools`. The last enabled tool supplies hit areas, feedback alternatives and subsequent actions. Disabling it falls back to the previous enabled tool; disabling another tool leaves the current action and trigger schedule alone. Changing the active tool stops its old scheduled triggers. Legacy single-tool preferences migrate on load, and missing/disabled tools are discarded. The current tool has an extra outline; all enabled tools retain pressed styling.

This changes interaction-tool selection, not the original game's command semantics or mutually exclusive native animation tracks.

Fox interaction cards now declare the lightweight native `::cover` entry. Catalog script cards honor their explicit `coverScript`, including its render node, while keeping scene markers from the actual playback entry. Character folders continue to use several child covers. Existing thumbnail configuration still controls whether rendering is enabled.

Validation uses the captured Underworld models in the real browser: simultaneous selection, independent deselection, last-enabled fallback, persistence, single/repeat/hold scheduling and voice gates. Fox checks cover the real catalog interaction card, rendering its explicit cover to JPEG, and verifying nonblank pixels, alongside its native audio/meter/component browser checks. Targeted state/compiler/cover tests run without new dependencies.
