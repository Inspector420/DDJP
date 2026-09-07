# backends/ — the swappable consensus backend

The app (`features/`, `ui/`, `app.js`) is backend-agnostic. It talks to the
consensus/transport layer through **exactly three globals**, and never reaches into
their internals. Everything under a `backends/<name>/` folder is one implementation
of that contract.

**Exactly one backend folder is loaded at a time.** `index.html` points its backend
`<script>` tags at one folder; the others stay empty. To hand the project to an AI
session token-efficiently: keep the app + the shared `core/` + `docs/` + **one**
`backends/backendN/` folder, and empty `lib/` and the other backend folders.

- **`backend1/`** — the current backend: the **decentralized Matrix events model** (lean, with the unfinished-full integrity layer: hash-refs, vouchers, counts). Depends on `lib/` (the vendored matrix-js-sdk) at runtime.
- **`backend2/`, `backend3/`** — empty stubs for future backends (e.g. a centralized bot, or another variant). See each folder's README.

The boundary is enforced by `tests/check-boundaries.js`: features/ui may use **only**
the **three** interface globals — `StreamManager`, `MatrixBridge` and `Capabilities`; the
backend may **not** depend on the app. (This sentence said "two" until J05, while the document
itself specified three — the count predated the capability seam.)

---

## The interface a backend MUST provide

A backend is loaded as plain `<script>` IIFE globals. It must define these:

### 3. `Capabilities` — the permission seam (added by the capability system)

Pure. Answers *"may this user do X to this room right now?"* for every gated action,
using the same rules the backend enforces on ingest — so the UI can show/enable
buttons without duplicating rules, and a different backend can answer differently.

| Method | Contract |
|---|---|
| `can(verb, state, ctx)` | → `{ permitted, reason, retryAt? }`. `ctx = { myId, myRank, now, target? }`. Pure. |
| `snapshot(state, ctx)` | → `{ [verb]: descriptor }` for the target-free verbs. |
| `VERBS` | the action vocabulary this backend answers. |

The feature-layer `Actions` adapter composes `can()` with state-availability into the
UI's render descriptor and routes clicks; the UI never calls `Capabilities` directly.

### 1. `StreamManager` — the derived-state seam

Turns the intent stream into agreed room state. The whole app reads state from here.

| Method | Contract |
|---|---|
| `ingest(raw)` | Feed one raw inbound event into the model. |
| `getState()` | → `{ nowPlaying, rotation, settings, history, counts }` — the current derived room state (see shape below). Deterministic: same inputs ⇒ same output on every client. |
| `on(type, fn)` / `off(type, fn)` | Subscribe/unsubscribe to a `ddjp.*` event type (or `"*"`). `fn` is called after each ingest that changed state. |
| `getLog()` | → the ordered event log (for replay/inspection). |
| `projectHistory(history, opts)` | Pure display-shaping of `history` (newest-first, optional `{limit}`). |
| `reset()` | Clear all state on room change. |

**Derived-state shape** (`getState()`):

```
nowPlaying : { dj, song:{videoId,videoUrl}, pi, startedAt, skipped } | null
             // startedAt is the playback-sync anchor every backend MUST provide, and it MUST be a
             // SERVER-side stamp — never the authoring client's clock. Everything time-based
             // computes from it (the playhead, the advance gate, the length ceiling), so a
             // local-clock value makes the author disagree with the room about when a song began
             // by its own latency and skew. A bot backend stamps from the bot; a peer backend must
             // wait for the server's echo rather than fold its own send. This is the single
             // easiest contract point to get wrong, and it fails silently.
rotation   : [ { user, pending:[{videoId, videoUrl}, …] }, … ]   // head first
settings   : { chat, vis, bg }                                    // owner-set, last-write-wins
history    : [ { videoId, dj, at, pi, skipped }, … ]              // oldest→newest, RAM-only
counts     : { <pi>: { votes, saves, votesAdjusted, savesAdjusted } }        // display-level
             // Keyed by PLAY INSTANCE, not by video. A playing is the unit of identity: the same
             // track played twice holds two figures, and a listener who reacted to an earlier
             // playing counts again on this one.
```

### 2. `MatrixBridge` — the transport / platform / intent surface

How intents get out and events/platform data come in. (The name is historical —
backend1 is Matrix-based. A future backend implements the same method names with its
own transport; renaming this global to something neutral like `Transport` is an
optional later polish, and would touch every call site + this contract.)

The app calls these (grouped):

- **Intents & stream:** `sendEvent(roomId, type, content)` · `sendMessage(roomId, text)` · `onRawEvent(fn)` / `offRawEvent(fn)` · `replayRoom(roomId)` · `recentChatMessages(roomId, count)` · `seedClock(roomId)`
- **Session / auth:** `login` · `logout` · `restoreSession` · `hasStoredSession` · `getLoginFlows` · `startSsoLogin` · `hasPendingSsoLogin` · `completeSsoLogin` · `start` · `waitForSync` · `listAccounts` · `getActiveUserId` · `switchAccount` · `forgetAccount` · `getUserId`
- **Encryption:** `encryptionStatus` · `unlockEncryption` · `generateRecoveryKey` · `confirmRecoveryKeyMatches` · `commitNewRecoveryKey` · `cryptoAvailable` · `retryCrypto`
- **Rooms / spaces / upgrades:** `createDDJPSpace` · `discardCreation` · `joinDDJPSpace` · `inviteToSpace` · `createUpgradeBatch` · `highestPresentBatch` · `waitForSpaceChildren` · `setSpaceJoinRule` · `joinChannel` · `onProgress` · `onChannelAdded` · `onRoomsChanged`
- **Rank / channels:** `assignRank` · `getMyRank` · `getWriteChannelId` · `getRoster` · `getUserEffectiveRank` · `getRankInfo` · `onRankChange` · `channelName` · `channelKeyFromName` · `eventsKeyForLevel`
- **Avatars:** `getAvatarUrl` · `onAvatarChange` / `offAvatarChange` · `uploadAvatar`
- **Consensus decisions & room reads:** `mayAuthor()` → `{ ok, reason, state?, because?, awaiting? }` (*am I caught up enough to say anything?*) · `mayAdvance()` → `{ ok, reason, state? }` (*and whole enough to chain an advance?*) · `onAuthorReady(fn)` (fires when a refused send may be retried, so a refusal is a deferral rather than a drop) · `roomHistory(limit)` → newest-first play history · `historyCoverage()` → `{ entries, fromL, toL, complete }` (*how much of the room can you account for?*) · `setRoomScope(channels)` · `setRoomLive(bool)` · `wireCheckpoints(channels)` · `resetCheckpoints()`

  These are the only genuinely consensus-shaped methods, and each is a QUESTION rather than a
  mechanism — which is what makes them answerable by a backend built on completely different
  principles. **A bot backend answers most of them trivially**: it is authoritative, so `mayAdvance`
  is *"yes unless I say otherwise"*, `historyCoverage` reports whatever its store holds, and
  `wireCheckpoints`/`resetCheckpoints` can be no-ops. Nothing here obliges a backend to have
  vouching, floors, a continuity restraint or checkpoints at all — those live entirely inside
  `backend1/` and no `features/` or `ui/` file references any of them.

- **SDK passthrough (one leak):** `getClient()` — hands back the raw client; the app uses it read-only, and `check-boundaries` forbids attaching `.on(` to it outside the backend.

A backend that doesn't use Matrix implements the same names against its own
transport (a bot server, a websocket, etc.); parts that don't apply can be no-ops
as long as the app's calls resolve sanely.

---

## Shared infrastructure the backend may use (`core/`)

A backend may depend **downward** on shared, backend-agnostic infra in `core/`:
`Logger`, `Store`, `IDB`, `StorageIO`, `WindowedList`, `ChatPrefs`, `PlaylistDoc`.
It must **not** depend on anything in `features/` or `ui/` (rule G).
