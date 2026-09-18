# backend1 — Decentralized Matrix events model (ACTIVE)

The current backend. Clients derive room state from an ordered event log carried
over Matrix channels — the **decentralized lean** model, with the **unfinished-full**
integrity layer building on top (hash-ref chain emission, vouchers, per-song counts).
See `../../docs/consensus/consensus-models.md`.

Implements the interface in `../README.md`:
- **`StreamManager`** (state seam) + **`StateDeriver`** (the pure reducer, internal).
- **`MatrixBridge`** (transport/platform/intents) over the vendored matrix-js-sdk in `lib/`.
- **`Capabilities`** (the permission seam) — the third interface global.
- Internals, one concept each: `Ranks` (the ladder, gates and the one stagger), `ConsensusHash`
  (canonical bytes), `TrustPolicy` (the one trust seam), `EventCache` (the raw store / voucher
  seam), `CheckpointFormat` (what a checkpoint IS), `Dials` (every room default),
  `Session` (the phase machine), `Scheduler` (taking a turn), `Vouch` (protection, records,
  repair, tombstones), `Floor` (where I compute from), `Checkpoint` (emitting a snapshot),
  `Continuity` (am I whole), `History` (what has played), `SettingsProof` (what the rules were).

  *(This list named `VouchVerify`, `VouchPolicy`, `CompactRecord`, `CheckpointEngine` and
  `Recovery` until J05. None of them exists — zero definitions across `backends/`, `core/` and
  `features/`. They are pre-consolidation names, and that work is now split across `Vouch`,
  `Checkpoint`, `Floor` and `Continuity`. `matrixbridge.js` already carried a note that there is
  no `Recovery` module and that the name survived "only here and in one boundaries list"; this
  README was a third place, so that note was wrong about its own count. A README naming a module
  nobody wrote is the same failure as a comment naming a consumer that does not exist.)*

Runtime dependency: `lib/` (the Matrix SDK). When `lib/` is emptied for a
token-efficient handoff, this backend can't *run*, but it stays fully readable and
editable — the app depends only on the interface, not on the SDK.
