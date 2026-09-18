# backends/ — the swappable consensus backend

The app (`features/`, `ui/`, `app.js`) is backend-agnostic. It talks to the
consensus/transport layer through the interface globals named below, and never
reaches into their internals. Everything under a `backends/<n>/` folder is one
implementation of that contract.

**THAT SAID "EXACTLY ONE BACKEND FOLDER IS LOADED AT A TIME" UNTIL J23, AND IT WAS THE
BUILD-TIME SWAP THIS SEAM REPLACED.** The old rule was: point `index.html`'s backend
`<script>` tags at one folder and leave the others empty. A room could not then choose,
because the choice was made when the page was built.

Now **every backend folder is loaded, and each registers itself** with
`Backends.register(modeId, { …four slots… })` (`core/backends.js`). A room declares its
engine in its Space's `m.room.create` content at creation, where it can never change, and
`Room.join` resolves that marker and binds the matching engine. Nothing in `features/` or
`ui/` changes or can tell which is bound — see `consensus/backend-selection.md` and
`tests/check-backends.js`, which drives the switch both ways.

A backend may register `ready: false`, which means it is a real position for the switch and
cannot yet run a room; a room marked for it is refused by name rather than half-run.
`backend2` is that today, until J24 fills it in.

To hand the project to an AI session token-efficiently: keep the app + the shared `core/` +
`docs/` + the backend folders you need, and empty `lib/`. Dropping a backend folder now means
dropping its `<script>` tag too, or the page loads a file that is not there.

- **`backend1/`** — the current backend: the **decentralized Matrix events model** (lean, with the unfinished-full integrity layer: hash-refs, vouchers, counts). Depends on `lib/` (the vendored matrix-js-sdk) at runtime.
- **`backend2/`, `backend3/`** — empty stubs for future backends (e.g. a centralized bot, or another variant). See each folder's README.

The boundary is enforced by `tests/check-boundaries.js`: features/ui may use **only**
the interface globals — `StreamManager` (state), `MatrixBridge` (transport),
`MatrixAccount` (login, session, account) and `Capabilities` (permissions); the
backend may **not** depend on the app.

> **THIS SENTENCE CARRIES NO NUMBER, AND THAT IS THE RULING RATHER THAN A STYLE CHOICE.**
> It said **two** until J05, when the count predated the capability seam. It said **three**
> until `ddjp_399`, when `MatrixAccount` had been in `check-boundaries` rules F and G since
> J59 and no doc had followed. At `ddjp_399` the count on the opening paragraph was moved to
> *four* and this list four lines below was left naming three — **the digit moved and the list
> did not**, which is the half-move, and it left the file contradicting itself with the
> authoritative half (the named list, which is an instruction) being the stale one.
> A count that has rotted three times will rot again, so it is deleted rather than corrected:
> **the list is the count.** Add a global here and the sentence stays true without anybody
> remembering to count. Keep extending this note rather than replacing it — a sentence that
> records its own history should go on recording it.

---

## The interface a backend MUST provide

A backend is loaded as plain `<script>` IIFE globals. It must define these, and they are
given in the order the app meets them rather than numbered — a numbered list is a count
wearing an ordinal's clothes, and this file has already paid for one of those. `index.html`
holds the authoritative load order; **see the load-order note at the end of this section
before reordering anything.**

### `StreamManager` — the derived-state seam

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

### `MatrixBridge` — the transport / platform / intent surface

How intents get out and events/platform data come in. (The name is historical —
backend1 is Matrix-based. A future backend implements the same method names with its
own transport; renaming this global to something neutral like `Transport` is an
optional later polish, and would touch every call site + this contract.)

**It OWNS the SDK `client`.** `MatrixAccount` creates it in the login flows and hands it
over through `_setClient`; nothing else keeps a copy, because two halves that can each
believe they hold the live client disagree with no symptom until a room does the wrong
thing.

The app calls these (grouped):

- **Intents & stream:** `sendEvent(roomId, type, content)` · `sendMessage(roomId, text)` · `onRawEvent(fn)` / `offRawEvent(fn)` · `replayRoom(roomId)` · `recentChatMessages(roomId, count)` · `seedClock(roomId)`
- **Sync lifecycle & identity:** `start` · `waitForSync` · `getUserId`
- **Rooms / spaces / upgrades:** `createDDJPSpace` · `discardCreation` · `joinDDJPSpace` · `inviteToSpace` · `createUpgradeBatch` · `highestPresentBatch` · `waitForSpaceChildren` · `setSpaceJoinRule` · `joinChannel` · `onProgress` · `onChannelAdded` · `onRoomsChanged`
- **Rank / channels:** `assignRank` · `getMyRank` · `getWriteChannelId` · `getRoster` · `getUserEffectiveRank` · `getRankInfo` · `onRankChange` · `channelName` · `channelKeyFromName` · `eventsKeyForLevel`
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

### `MatrixAccount` — login, session, account and DM scope

**Added at J59, and it had no section here until `ddjp_399`** — the split moved this surface
out of `MatrixBridge` and this contract was never updated, so the groups below were documented
as the transport's for several packages. It is the one backend file in **no layer**: it serves
neither the stream nor the reading (`PILLARS.md` §7), which is why `check-spine` PART A2 requires
it to reach nothing in the consensus stack.

A backend that is not Matrix-based still needs somewhere for *who am I and how did I get here*.
It may be a thin shim — a bot backend has no SSO and no recovery keys — but the app calls these
names, so they must resolve.

- **Session / auth:** `login` · `logout` · `restoreSession` · `hasSession` · `hasStoredSession` · `getLoginFlows` · `startSsoLogin` · `hasPendingSsoLogin` · `completeSsoLogin` · `listAccounts` · `getActiveUserId` · `switchAccount` · `forgetAccount`
- **Encryption & recovery:** `encryptionStatus` · `unlockEncryption` · `generateRecoveryKey` · `confirmRecoveryKeyMatches` · `commitNewRecoveryKey` · `cryptoAvailable` · `retryCrypto`
- **Avatars:** `getAvatarUrl` · `onAvatarChange` / `offAvatarChange` · `uploadAvatar`
- **DMs and DM scope:** `createDM` · `findDMRoom` · `dmRoomIds` · `dmInviteRoomIds` · `acceptDMInvite` · `declineDMInvite` · `addDMScope` · `setDMScope` · `clearDMScope` · `inDMScope`

  **The DM scope is a SECOND scope and deliberately not an entry in the room's.** `inDMScope`
  reaches the raw listeners and nothing else; adding a DM id to the room scope would make it a
  fold input, a held-here candidate and an eviction subject in one move (`roles.md` §6, §7b).
  Only `acceptDMInvite` BINDS — reporting an invite grants nothing, or anyone could put a room
  into this account's DM scope by inviting it.

### `Capabilities` — the permission seam

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

### Load order — read this before moving a `<script>` tag

Almost nothing here evaluates another module at the top level, so the shipped order in
`index.html` is mostly readability. The exceptions are real and they break loudly:
`roles.md` §0 carries the table, and **`matrixaccount` must load AFTER `matrixbridge`**,
because it calls `MatrixBridge._setAccountHost(...)` while its own IIFE is still running.
That one arrived with the J59 split and was absent from the table until `ddjp_399`.

**If you add a module, the only question is whether it evaluates another module's value at
the TOP level.** Inside a function, order does not matter — cross-module calls are property
lookups on globals resolved when the function runs.

---

## Shared infrastructure the backend may use (`core/`)

A backend may depend **downward** on shared, backend-agnostic infra in `core/`:
`Logger`, `Store`, `IDB`, `StorageIO`, `WindowedList`, `ChatPrefs`, `PlaylistDoc`.
It must **not** depend on anything in `features/` or `ui/` (rule G).
