# backend2 — (empty stub)

No backend implemented here yet. To build one, implement the two interface globals
described in `../README.md` — `StreamManager` (derived-state seam) and
`MatrixBridge` (transport/platform/intents) — as plain `<script>` IIFE globals,
then point `index.html`'s backend `<script>` tags at this folder instead of
`backend1/`.

A natural fit for this slot: a **centralized bot-run** backend (a trusted process
emits authoritative state) or another consensus variant. The app does not change.
