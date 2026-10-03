# Change list, ddjp_513 (J73 — live, one line per change)

*(Kept as the work happens, per the session protocol's second tier. Once the package ships it is a
dated record and is never corrected.)*

## Baseline, before any change (re-derived, not read)
- suite: 210 PASS verdicts, 0 FAIL, exit 0, 84 s; 208 `tests/check-*.js`; `?v=478` on all 65 tags; package dirs ddjp_512 / docs_512
- census: 72 entries; open = J08 J09 J21 J22 J29 J30 J33 J49 J68 J69 J71 J73
- doc budget 308,502 / 308,502 (0 spare); dated marks 82 / 89

## Changes
- docs main/09-roadmap.md J73: owner's `ddjp_512` brief decisions recorded as a dated ruling; title and Touches widened to both room types (Touches marked provisional); Open points at the plan; Done when = the three-subject standard (room / song history / activity), keeping the `ddjp_511` form. Census unchanged (diffed); doc guards green.
- docs INVENTORY.md J73 row: reworded to the widened scope, 2 bytes shorter (reading path has 0 spare).
- mutate-j67-j72 baseline (before any code change): 27 red as named, 0 not; all 63 source files md5-identical after
- docs main/09-roadmap.md J73: study findings recorded as a dated block, marked found-by-reading and not yet driven (History eviction vs coverage; one-range coverage + early return; history not persisted per advance; trimToFloor position-only; B2 noteActivity no legality check; backfill re-armed by trim; coverage vs current window). Census unchanged; doc guards green.
- study completed (owner's STOP 1 review): floor.js, settingsproof.js, eventcache.js, statederiver.js, backend1 checkpoint.js top to bottom; streammanager `_deriveBest` and its one caller (`_refold`). No code changed.
- tools/probes/probe-j73-trim-tie.js (new): DRIVEN — the tie recorded in check-floor-boundary's header leaves a trimmed client's queue different from a reader holding everything; two controls match.
- tools/probes/probe-j73-presence-reach.js (new): DRIVEN — after a trim to a 20-minute floor, Room.recentlyActive is bounded against the 1-hour default; three people active inside the hour drop out.
- tools/probes/probe-j73-refused-relay.js (new): DRIVEN — a VIP's stale skip is relayed (rank only) and refused (advance-locked); held-log fold skips it, noteActivity credits it. First run was VOID (the harness bound StreamManager to the bot door) and said so; fixed in the probe by naming B1StreamManager.
- docs main/09-roadmap.md J73: findings block rewritten — three marked driven with their probes, the tie's existing record cited, the rest still by reading; one new reading (EventCache banked tier never applies in a bot room). Census unchanged; doc guards green.
- docs main/09-roadmap.md J73: owner's answers to the STOP 2 plan recorded as a dated block (Q1 Q4 Q5 Q6 Q7 Q10; Q10's owed confirmation, with what reading already shows; Q2 Q3 Q8 Q9 Q11 still open). J67 and consensus/bot-backend.md §13: the held-log repeat rule marked SUPERSEDED in place, pointing at J73. roles.md's replay-cooldown row (reading path, 0 spare) still describes the running code and changes with the build. Census unchanged; doc guards green.
- docs main/09-roadmap.md J73: owner's Q10 settlement recorded as a dated block (added time from the history fill, not the save point; the most-recent-add link erring to play; take before dropping; clean-up limits; drive the fill first). The 'owed before building Q10' line removed as instructed. Census unchanged.
- tools/probes/probe-j73-fill-added.js (new): DRIVEN — the history fill (shipped pageRange, extracted and run) downloads every added event (join+video, declare) with who/video/stamp in both room types; History keeps none. First fixture's control folded 8 and 1 plays (its own chain broke); fixed so every play chains, control exact at 32. J73 records the result and, by reading, the fill's three limits (below coverage.fromL only, early return when complete, 250 pages).
- docs main/09-roadmap.md J73: owner's reload ruling recorded as a dated block (added times in the history store on Q9's cadence, kept only while queued; gap-aware coverage per Q8 with complete = no holes to the start; no separate fill; five cases to drive; Q8 settled in principle, Q9 open for both stores). Census unchanged; doc guards green.
- docs main/09-roadmap.md J73: owner's acceptance of Q2 Q3 Q8 Q9 Q11 recorded as a dated block, with the order (job 1 only, then audit).
- index.html: every ?v= tag 478 -> 479 (tools/bump-version.js; run by accident as `--help` — the tool takes no flags — and verified: 65 tags, one value). streammanager.js is tagged, so the bump was owed.
- J73 job 1 (code): backends/backend1/streammanager.js — `_atOrBeforeBoundary` (position, then id) is the one rule; `_coveredBy` and both `_settingsCovered` fallbacks use it; `trimToFloor` keeps exactly what `_aboveCut` folds; `_aboveCut`'s Floor-absent fallback states `Floor.afterBoundary`'s rule (unreachable; measured).
- tests/check-trim-boundary.js (new guard, SUBJECT streammanager.js): PARTs A–D against a reference reader with controls; red on the unfixed tree at A and D (4 rows), green after.
- tools/probes/mutate-j73-trim.js (new): T1–T4 red as named, T5 measured unreachable (stays green); streammanager restored byte-for-byte.
- suite 211 PASS / 0 FAIL (209 guard files); mutate-j67-j72 27 red as named, no row changed.
- docs: consensus/trust-cascade.md §8.1 trim rule corrected; tests/check-floor-boundary.js header and PASS text say the tie is fixed; J73 records job 1 and the sweep's classification (fixed / unobservable / protection held for the owner / cost-display / cautious / not affected).
- docs: HANDOFF re-headed (?v=479, ddjp_513; J73 job 1 unseen; owed and changed lines); INVENTORY §1 item 1 (dated v392, finished work) moved whole to ARCHIVE §Moved from `INVENTORY.md` at `ddjp_513` to pay for it; doc-budget CEILING 308502 -> 308304 (the ratchet only goes down).
- 🟢 for existing rooms: room surface 82004445a9 unchanged — no settings key, event type, seed shape, hash or channel changed.
- package directories renamed ddjp_513 / docs_513.
- ddjp_513/.last-bump (written by tools/bump-version.js as a local double-bump reminder, device-clock stamp, read by nothing) removed before packaging: the incoming package carried none.
- docs main/09-roadmap.md J73: owner's job 1b recorded as a dated block (protection-side floor ties; bump-version refuses unknown arguments).

## Job 1b (package ddjp_514)
- J73 job 1b (code): vouch.js `_bankedAt` (Floor.afterBoundary's rule, complemented; unknown id = nothing at the floor banked) used by `owed`, `_criticalPositions` and `mayRetire` (new trailing params eventId, floorId); continuity.js `aboveFloor(held, floorL, floorId)` and `mayAdvance(..., floorId)`; checkpoint.js `coverageVerdict` reads the boundary id from Floor and its `mayAdvance` call passes it; matrixbridge.js `_floorBoundaryId()` passed by the three Vouch.owed calls and the mayAdvance call; eventcache.js resolves `floorId` beside `floorL` and passes it to mayRetire. A first edit to eventcache.js broke its if/else chain (node --check caught it; the two guards do not load EventCache) — fixed by reading the id before the chain.
- tests/check-protect-boundary.js (new guard): A–E per site, F agreement grid with Floor.afterBoundary (known and unknown id), G every production caller passes the id; red on the job-1 tree at A–F (9 rows), G added with the fix.
- tests/check-retention-by-duty.js: the row asking mayRetire about an event AT the floor with no id now names the boundary event ("$b","$b") — with no id the new rule is careful (kept); reason recorded in the row.
- tools/bump-version.js: `--help`/`-h` print usage and exit 0; any other argument refused (exit 2); both before index.html is read. tests/check-bump-args.js (new guard) runs a copy in a temp dir; red before the fix on all five argument cases, no-argument control bumps.
- tools/probes/mutate-j73-protect.js (new): P1–P11 red as named; every file restored.
- suite 213 PASS / 0 FAIL (211 guard files); mutate-j67-j72 27 red as named; mutate-j73-trim 5 as expected.
- docs main/09-roadmap.md J73: job 1b's record. CLASSIFIED-SURVIVORS rows on the rewritten lines left as dated records.
- index.html: every ?v= tag 479 -> 480 (`node tools/bump-version.js`, no arguments); .last-bump removed.
- docs HANDOFF re-headed (?v=480, ddjp_514; jobs 1 and 1b unseen; owed line drops the protection item; changed line for 1b). First draft was 37 bytes over the ceiling; the new line was tightened (its roadmap pointer is already in HANDOFF). doc-budget CEILING 308304 -> 308262.
- package directories renamed ddjp_514 / docs_514; 🟢 for existing rooms (surface re-derived after the rename, below).

## Job 2 (IN PROGRESS — working tree ddjp_514, not packaged; suite not green)
- backends/backend1/activity.js (new): the one activity store. Registered in index.html (after capabilities.js), tests/_load.js KNOWN_GLOBALS, check-spine (meaning layer; consensus stack), MODULES.md, matrixbridge's room-entry reset block.
- backend1 streammanager: trimToFloor takes the dropped events (legality from `_heldAccepted()`, the held log on its own base; complete when the first trim's log begins at position 1); adoptFloor(f, opts) takes when asked; `_heldBase` tracked; olderActivity exported; reset clears Activity.
- backend2 streammanager: `_older` removed; noteActivity/olderActivity/activityCovered/setFoldScope use Activity; openFromSavePoint passes { take: "all" }.
- backend2 authority: evaluate(intent, state, rank, ctx) folds held log + committed acts (submit records them; 30 s, cleared on echo by src), judges rank on that state and asks the reducer; "too-early" passes. runner passes ctx when the door offers getLog.
- floor.js: remember refuses a checkpoint whose covers names no boundary id.
- guards: check-activity-taken, check-judge-reducer (new, red first); check-protect-boundary PART H. Rows changed with reasons: check-bot-open J (two rows), check-retention unchanged, mutate-j67-j72 J1 rehomed to activity.js. Load lists: check-bot-open, check-bot-relay, check-backends (vm context) load activity.js.
- breaks: tools/probes/mutate-j73-activity.js J1–J12 red as named. mutate-j67-j72 27/27, mutate-j73-trim 5/5, mutate-j73-protect 11/11, all restored.
- NOT DONE: suite 213 PASS lines / 2 guards failing (see the report). Not bumped, not re-headed, not renamed.
- (job 2, completed for ddjp_515) authority.js reset() clears `_committed` (room entry; B2Runner.start calls it). check-judge-reducer PART D now drives a real B2Runner through `_onRaw` (stub transport; Backends active; timers stubbed; batches unwrapped) instead of a text window; PART E: committed acts gone after stop + start. Break J13 added; J10 re-anchored to the runner's guarded line. check-backends: its hand-built bot-door context loads activity.js.
- tools/probes/probe-j73-judge-cost.js (new): judge cost linear, ~3 ms / 1,000 held events per judgement; day 18 ms (burst 0.2 s), week 120 ms (burst 1.5 s). Recorded in J73 with options; not chosen.
- suite 215 PASS verdicts / 0 FAIL, exit 0 (213 guard files); breaks 27/27, 5/5, 11/11, 13/13, all restored.
- index.html ?v=480 -> 481 (66 tags: activity.js added one; bump run with no arguments; .last-bump removed). HANDOFF re-headed for ddjp_515 (first draft 37 bytes over; the new lines tightened). doc-budget CEILING 308262 -> 308256.
- package directories renamed ddjp_515 / docs_515.
- docs main/09-roadmap.md J73: owner's reorder recorded (6, 7, then 4, 5, 8; no judge cache).

## Job 6 (package ddjp_516)
- history.js: ranges (_cover/_clipBelow/holes), eviction clips reach, ingest folds once (rows, accepted adds, state), refresh retains added times to queued/playing songs, noteAdds/addedAt, backfill reports reachedFrom and never claims an unreached start, fillGaps anchored on save points (whole hole covered when read from an anchor or the start), snapshot v2 (v1 restores as one range; ranges before rows so eviction clips).
- matrixbridge.js: pageRange skips rooms StreamManager.foldsRoom rejects and reports reachedFrom (first draft declared it inside the try: every read claimed the start — caught by E5, kept as break H7); historyAddedAt and persistHistoryNow exported; _persistSoon (2 s debounce) on every refresh; the fill is fillGaps; History.attach gets anchorOf.
- backend1 streammanager: trim and save-point door hand dropped adds to History.noteAdds (legality shared as `_legal`). backend2 door: foldsRoom.
- features: room.js playedWithin(videoId, nowTs, opts) — rows limited to the unbroken stretch from the head; returns addedAt. queue.js historyAddedAt; tab-hide listener → MatrixBridge.persistHistoryNow. botruntime.js: Q10 rule replaces _playedInHeld (removed; a first removal also cut sweepRepeat and REPEAT_DECIDE_MS, restored from the shipped copy before any run passed).
- guards: tests/check-history-reach.js (new). Rows changed with reasons: check-repeat-cooldown H3/H/H2, check-history-durable F, mutate-j67-j72 X1, mutate-j73-activity J1–J3/J12.
- breaks: tools/probes/mutate-j73-history.js H1–H12 red as named. The two guards fail on ddjp_515's modules.
- docs: J73 job 6 record; HANDOFF re-head.
- index.html ?v=481 -> 482 (66 tags; no arguments; .last-bump removed); doc-budget CEILING 308256 -> 308197; directories renamed ddjp_516 / docs_516.

## Job 6b (package ddjp_517)
- core/store.js: history persist/load accept the snapshot object (and an old array) via `_historyTable`; before, persist refused anything but an array and load returned only arrays — nothing was ever stored (defect older than J73, found by the audit).
- history.js: restore takes an old array as rows with no claimed reach.
- matrixbridge.js: pending save bound to its room (`_persistSid`); `_flushPendingPersist` at the top of resetCheckpoints; a timer firing in another room writes nothing; `_persistHistory(forSid)`.
- tests/check-history-store.js (new): A store round trip (real store, IDB stubbed) + legacy control; B room switch within the debounce, both orders; C added-time path end to end through the real bot, Room, Queue, bridge and History. Fails on ddjp_516's files at PART A.
- tests/check-history-reach.js G: harness declares `_currentSpaceId` (the debounce reads it now); H9–H11 re-run against a passing guard.
- tools/probes/mutate-j73-store.js (new): S1–S10 red as named.
- suite 217 PASS / 0 FAIL (215 guard files).
- index.html ?v=482 -> 483 (66 tags; no arguments; .last-bump removed); HANDOFF re-headed (first draft 40 bytes over; tightened); doc-budget CEILING 308197 -> 308196; directories renamed ddjp_517 / docs_517.
- docs J73 job 6b: the audit's correction recorded — timer-between leaves up to 2 s of the first room's rows unsaved (refilled next visit); 'both orders' held only for the second room.

## Job 7 (package ddjp_518)
- backend1 streammanager: `reproduces(f)` (held log on its base up to the cut vs the seed, by value — `_canonJson` — over nowPlaying, rotation, settings, live counts, advance); `adoptFloor(f, { prove })` refuses `does-not-reproduce` naming the field; adoptFloor and trimToFloor fold dropped events into History first; `adoptedFloor()` exported. First draft compared raw JSON and refused every honest save point (key order) — kept as break M4.
- backend2 door: `_opened`, `_moveOn()` on every observed save point after the first opening (take all, prove), `lastMoveOn()`; reset on a new room.
- eventcache.js: `_adoptedCut()` fallback where Floor holds no floor; the adoption is the licence there (`_fromAdopted`). First run withheld the resolved floor (licence = seed validation, which a bot room never has).
- tests/check-bot-move-on.js (new). tools/probes/mutate-j73-move-on.js (new), M1–M9 red as named; noteAdds-in-adoptFloor not a row (History.ingest covers it).
- probe-j73-judge-cost: WITH MOVING ON section — held max 39 to 50,000 relays; judgement ~0.05 ms; burst 1–2 ms.
- mutate-j67-j72 S2/S5/T1 unchanged (still red as named; anchors and meaning unchanged).
- suite 218 PASS / 0 FAIL (216 guard files); seven break files as expected.
- index.html ?v=483 -> 484 (66 tags; no arguments; .last-bump removed); HANDOFF re-headed; doc-budget CEILING 308196 -> 308184; directories renamed ddjp_518 / docs_518.
- docs J73: owner's answers recorded (keep past tallies in history rows; first opening unchecked, J67 authority) and job 7b ordered.

## Past tallies + job 7b (package ddjp_519)
- history.js: ingest offers ended plays' final { votes, saves } by play id (`_finals`) to `_mergeIn`, which gives them to rows lacking them; never the live play's. First draft attached only to rows the fold produced, so a song live at a save point never got its tally (caught by check-history-tallies B); the per-row loop then became redundant and was removed.
- ui/panels.js: `rowCounts(counts, h)` — the derived tally, else the row's own.
- backend1 streammanager: `_canon` uses REPRODUCE_FIELDS + `_field` (live counts) through `_canonAny`; `_canonJson` removed (one encoder); mutate-j73-move-on M4 re-anchored.
- tests/check-history-tallies.js, tests/check-licence-fields.js (new); check-bot-move-on B's counts tamper corrected to the ledger's shape (reason in it).
- tools/probes/mutate-j73-tallies.js (new): T1–T6, L1–L2 red as named. Both guards fail on ddjp_518's files.
- suite 220 PASS / 0 FAIL (218 guard files); eight break files as expected.
- index.html ?v=484 -> 485 (66 tags; no arguments; .last-bump removed); HANDOFF re-headed; doc-budget CEILING 308184 -> 308159; directories renamed ddjp_519 / docs_519.
- tools/probes/probe-j71-licence.js (new): J71's divergence vs the 7b licence — F1, F2 (same live song) refused, nothing trimmed; F3 licensed. More than one floor blocked: stopped before job 4 as instructed. Recurring case not measured (first attempt measured nothing; removed). Recorded in J73 and J71 with options (a)–(d), none chosen.
- docs J73 and J71: owner's ruling (d) accept recorded; (a) stays with J71 after the real-room check; J71 moves ahead if the divergence shows on most songs.

## Job 4 (package ddjp_520)
- matrixbridge.js: `_activityReadAt`/`_activityReadBusy`; `_readActivityBack` records its room and guards re-entry; `extendActivityRead()` (exported) reads further back only while the window is uncovered; resetCheckpoints clears the room.
- features/room.js: `_applySettings` calls `MatrixBridge.extendActivityRead` after listeners (generic).
- features/botruntime.js: `_onSettingsForChat` registered once via Room.onSettingsChange — re-reads chat only when the watch no longer covers the window; `_readChatBack` guarded by `_chatReadBusy` (reset in a finally — a first edit reset it after the catch, which an early return inside the try would skip).
- tests/check-settings-windows.js (new, A–G). check-bot-open N: harness declares the read-back's two new variables (reason in it).
- tools/probes/mutate-j73-windows.js (new): W1–W9 red as named.
- docs J73: job 4 record; the shrink rule read through the Q10 bound, with the alternative stated for the owner.
- suite green; nine break files as expected.
- index.html ?v=485 -> 486 (66 tags; no arguments; .last-bump removed); HANDOFF re-headed (first draft 44 bytes over; tightened); doc-budget CEILING 308159 -> 308127; directories renamed ddjp_520 / docs_520.

## Job 4 fix (package ddjp_521)
- docs J73: the owner confirmed the shrink reading (keep up to the longest allowed window).
- matrixbridge.js: `_activityReadGen` + `_releaseActivityRead()`; a read for another room releases the old one; the loop checks its generation after each wait; `finally` clears the flag only for the current read; resetCheckpoints releases a read in flight.
- tests/check-settings-windows.js PART H (the audit's case). tools/probes/mutate-j73-windows.js W10–W12.
- W12 first read GREEN: the mutation hung a promise and the async guard exited 0 without a verdict. The four async guards (check-history-reach, check-history-store, check-judge-reducer, check-settings-windows) now fail if they exit unfinished.
- Harness fixes: check-history-store B scope gains `_releaseActivityRead`; check-bot-open N cuts from the block's first line (shipped declarations, not copies). mutate-j67-j72 N1 re-run against a passing guard.
- suite 221 PASS / 0 FAIL; nine break files as expected (windows 12/12).
- index.html ?v=486 -> 487 (66 tags; no arguments; .last-bump removed); HANDOFF re-headed (first draft 18 bytes over; tightened); doc-budget CEILING 308127 -> 308109; directories renamed ddjp_521 / docs_521.

## Break-file rule + job 5 (package ddjp_522)
- tools/probes/_verdict.js (new): redAsNamed / staysGreen over run-all.js verdictOf. The nine break files converted; tests/check-break-verdict.js (new; the 35 older break files a list that only shrinks); tools/probes/mutate-j73-verdict.js V1–V4 (V4's planted text split so the file is not the pattern it plants).
- job 5: matrixbridge.js sendRoomState / roomStateOf / powerLevelOf; backend2 door publishPresence / presenceList (believed only at the runner's power level; type ddjp.presence); room.js presenceView + PRESENCE_LIST; ui/panels.js and ui/roster.js read the view; botruntime.js _publishPresence (not chat-blind; change or refresh), _pruneChat (longest allowed window), _chatSeenForTest. A first edit script stopped on a wrong anchor for room.js's export line; nothing half-written (each file written after its anchors check).
- tests/check-bot-presence.js (new, A–I); tools/probes/mutate-j73-presence.js P1–P9. C's refresh row first let a person age out, so it passed on a change (P4 green) — rewritten to keep the set unchanged.
- suite 223 PASS / 0 FAIL (221 guard files); eleven break files as expected.
- index.html ?v=487 -> 488 (66 tags; no arguments; .last-bump removed); HANDOFF re-headed (first draft 20 bytes over; tightened); doc-budget CEILING 308109 -> 308091; directories renamed ddjp_522 / docs_522.
- docs J73: owner's ruling on the 35 older break files recorded (shrinking list; convert when a job touches the area).

## Job 5b (package ddjp_523)
- docs J73: owner's ruling on the 35 older break files; job 5b record; job 5's 🟢 corrected (power levels refuse ddjp.presence in every existing room) with options (a)–(c), none chosen.
- backend1 streammanager: publishPresence (into the room's space) and presenceList (believed only from the single account at the bot's level; refused for the owner, others, two at the level, default at the level); exported. matrixbridge: currentSpaceId().
- tests/check-presence-decentralized.js (new, A–E; E measures the real _powerLevels). mutate-j73-presence Q1–Q5 (Q1's fixture fixed).
- check-boundaries false failure (an apostrophe in a trailing comment) avoided by moving the comment; the guard's weakness recorded.
- index.html ?v=488 -> 489 (66 tags; no arguments; .last-bump removed); HANDOFF re-headed (first draft 7 bytes over; tightened); doc-budget CEILING 308091 -> 308087; directories renamed ddjp_523 / docs_523.
- docs J73: owner's ruling (b) recorded — new rooms' template names ddjp.presence at the bot's level; no automatic power-level write; an owner-pressed enable may come later.

## Ruling (b) (package ddjp_524)
- docs J73: owner's ruling (b) and its build record.
- matrixbridge.js: `_powerLevels` names ddjp.presence when gates carry `presence`; `_spacePowerLevels(mode, creator)` — a non-bot-room space carries it at the bot's level; the space creation uses it. backend2/skeleton.js: events_owner row gates `presence: 99`.
- tests/check-presence-powerlevels.js (new). check-presence-decentralized E rewritten by the ruling (reason in it). mutate-j73-presence R1–R4.
- suite 225 PASS / 0 FAIL (223 guard files); eleven break files as expected; room surface unchanged.
- index.html ?v=489 -> 490 (66 tags; no arguments; .last-bump removed); HANDOFF re-headed; doc-budget CEILING 308087 -> 308076; directories renamed ddjp_524 / docs_524.
- tools/probes/probe-j73-sdk-memory.js (new, --expose-gc): ~1.5–1.6 MB per 1,000 events in the default configuration; bot tab ~54–59 MB a day, ~145–176 MB a week, unbounded. Recorded in J73 with the proposed daily quiet reload (not built) and EventCache's in-memory copy (not measured).
- docs J73 job 8: the reload's costs corrected (missed intents are not replayed; acts without a retry are lost, and with J69 open the user is not told).

## EventCache cleans as it goes (package ddjp_525)
- tools/probes/probe-j73-eventcache-memory.js (new): before — all raws kept and all restored on reload; after — 40 and 2 kept.
- eventcache.js: every non-pinned item asked `mayRetire`; `retireBanked(rooms)` (licensed floor only; this room only; memory and IndexedDB; any iterable — a cross-realm Set failed `instanceof`).
- backend1 streammanager: `_roomsSeen`; both forgetting doors announce `ddjp.local.forgot` (a first draft called EventCache directly; check-local-evidence refused it). matrixbridge: `_wireCacheRetire()` subscribes the cache, wired in _wireConcepts.
- tests/check-eventcache-retire.js (new, A–G); check-protect-boundary G counts two mayRetire callers (reason in it). tools/probes/mutate-j73-eventcache.js E1–E9.
- suite 226 PASS / 0 FAIL (224 guard files); twelve break files as expected.
- index.html ?v=490 -> 491 (66 tags; no arguments; .last-bump removed); HANDOFF re-headed (first draft 20 bytes over; tightened three times); doc-budget CEILING 308076 -> 308075; directories renamed ddjp_525 / docs_525.
- probe-j73-eventcache-memory: measures UNWIRED and WIRED (through the shipped _wireCacheRetire); J73's EventCache table corrected to what it prints at 4,000 (unwired 4,000/4,000 and 4,100/4,100, 579 banked; wired 40 and 2) — the first after-figures came from an unshipped intermediate state.

## The daily bot-tab reload (package ddjp_526)
- features/botruntime.js: quietMoment / maybeDailyReload (24 h up; once; song not just changed nor about to; no unsent acts; no queue or presence warning outstanding; history stored first), checked on the bot's tick; _setReloadForTest. backend2 authority `unsent()`; bot door `unsentCount`.
- tests/check-bot-reload.js (new, A–H); tools/probes/mutate-j73-reload.js L1–L11.
- docs J73: build record with the no-replay cost as corrected.
- index.html ?v=491 -> 492 (66 tags; no arguments; .last-bump removed); HANDOFF re-headed; doc-budget CEILING 308075 -> 308047; directories renamed ddjp_526 / docs_526.

## J73 close-out (package ddjp_527, no ?v= bump — docs, a probe and a guard row only)
- probe-j73-eventcache-memory prints both halves by default (UNWIRED, then WIRED); J73's table names it.
- docs J73: the reload's unawaited history write recorded as covered; the Done-when checked part by part — NOT DONE: agreement between the bot and the People tab fails in existing rooms (ruling (b)); the owner's browser checklist.
- tests/check-activity-taken.js A: AFK (Room.idleFor) after a trim equals the reference reader's, per person.
- HANDOFF re-headed (package ddjp_527, ?v=492 unchanged; first draft 31 bytes over; tightened); doc-budget CEILING 308047 -> 308038; directories renamed ddjp_527 / docs_527.

## J73 DONE (package ddjp_528, docs only — ?v=492)
- docs J73: Done-when amended by the owner (agreement in rooms made from ddjp_524 on; the existing-room limitation stated beside it); marked DONE; never watched in a real browser, carried to HANDOFF.
- docs J74 (new): the owner's one-time enable of the bot's published presence for existing rooms — its own job, as ruled. INVENTORY: J73 row removed (done), J74 row added.
- HANDOFF re-headed (package ddjp_528, ?v=492 unchanged; first draft 14 bytes over; tightened); doc-budget CEILING 308038 -> 308033; directories renamed ddjp_528 / docs_528.

## Rulings 1–3 recorded and planned (ddjp_529 study — not a package; no app file changed)
- docs J75 (ruling 1: People tab from each viewer's own view; the bot's list dropped), J76 (ruling 2: the security gate), J77 (ruling 3: 20 actions a message) as dated blocks; J74 closed as not needed (DONE heading, reason recorded); J73's Q5 and ruling (b) marked superseded in place. INVENTORY: J74 out, J75–J77 in; HANDOFF's owed line.
- tools/probes/probe-j76-j77-study.js (new, measurement only): the _sendInstant reorder (budget 1 left: $u ahead of $g1 $g2), instant acts skip the per-person limit (20/20 vs 12/20), the too-many refusal is silent, an early client play is relayed, #10 sorts before #2 (Floor.afterBoundary misjudges it), a 20-member batch ~5.8 KB (8.9% of 64 KiB), a 500 ms gate +250 ms mean / +500 ms worst (modelled).
- docs: INVENTORY's dated v331 note on rebuilding rooms moved whole to ARCHIVE §Moved from `INVENTORY.md` at `ddjp_529` (superseded by HANDOFF's ddjp_498 line), to pay for J75–J77's rows.
- doc-budget CEILING 308033 -> 307962.
- docs J75–J77: the plan audit's rulings recorded (J76: the only door out of events_owner, merges never reorder, bot rooms only, Q1 silence, Q2 play/skip/media.skip urgent, Q3 keep the budget; J77: Q4 reader support first; J75: Q5 the label; the order of work).

## J76 build — stopped on a conflict (ddjp_529, not a package)
- backend2 authority: one ordered queue (accept, never send); _open (gate opening: the due prefix in accepted order, messagesPerOpening, budget); flush = the closing opening; POLICY.gate from instantMinGapMs, validatePolicy's gate checks; per-person limit first for every act, silent over-limit (Q1); merges never reorder (latest-per-actor drops the earlier, also from _committed); media.len, play.len, play.blocked grouped (Q2); judge ignores a merely early client play in silence. runner: the gate's own timer (POLICY.gate.intervalMs) as the only caller of tick; announce and seal through submitRaw; the per-event tick removed; the too-many refusal removed; a silent verdict sends no refusal.
- STOPPED: check-backends H — Q2 grouping of ddjp.media.len breaks the length cascade (gaps below staff median ~1.0 s, low tail ~510–660 ms, vs 1,000 + 500 + round trip; first draft quoted one random draw). probe-j76-j77-study row 8. Recorded in J76 with options (a)–(c). Suite red: check-backends H, and four guards to change for ruled reasons (judge-reducer C, bot-relay A, bot-answers B, bot-songs A/D).
- tests/check-spine.js: the study probe classified (0 actions, measurement only) — its row 8 calls Capabilities.staggerMs, and the scan requires every such file to be classified.

## J76 build, second pass (ddjp_529, not a package)
- The conflict withdrawn (media.len is absorbed, never queued); check-backends H asserts that. J76: the open note on bot rooms' media.len traffic.
- authority: dueness kept as the existing system's (earliest member due or a full group); openIfDue (timer and arriving messages; openings at least gate.intervalMs apart). runner: the gate timer and _onRaw call openIfDue.
- Guards updated with reasons: check-backends H, L, M, T; check-judge-reducer C; check-bot-answers B, C, E. Still red: check-backends U2 onward, check-bot-relay A/B, check-bot-songs A/D. Not yet written: the gate guard and its break rows; the latency measurement.

## J76 build, third pass (ddjp_529, not a package)
- runner: openIfDue after the advance's and the intent path's submits; _advanceTick before openIfDue in _onRaw (auditor's fix). authority: an opening counts only when it sends (recorded in J76 for audit).
- Guards green with reasons: check-backends (H/L/M/T/U), check-bot-relay (A–D, F), check-bot-answers, check-judge-reducer; check-bot-songs all but D's retry row (L rewritten for the gate; helpers count batch members).
- Still to do: check-bot-songs D retry; the gate guard and break rows; the latency measurement (hidden-tab model); the package.

## J76 built (package ddjp_529, ?v=493)
- authority: queued acts get a promise resolved at send time with the id they received (carrier, or carrier#k); requeue still on .catch. runner: the advance's echo lookup uses the carrier; _noteOwnEcho matches a batch carrier holding the advance (the auditor's regression).
- tests/check-batch-play.js (new): a play as a batch member end to end against a reader holding everything — nothing broke. tests/check-bot-gate.js (new, A–J incl. the latency measurement). tools/probes/mutate-j76-gate.js G1–G13. Re-anchored: mutate-j67-j72 R3/R5/R6, mutate-j73-activity J9/J13, mutate-j73-reload L10.
- index.html ?v=492 -> 493; HANDOFF re-headed; doc-budget unchanged at 307,962 (0 to spare); directories renamed ddjp_529 / docs_529.

## J76 DONE (package ddjp_530, ?v=494)
- tests/check-bot-songs.js D3: a batched advance's carrier echo and the retry at ADVANCE_RETRY_MS. mutate-j76-gate G14.
- The one-shot opening: authority openIfDue reports waitMs and urgent when refused within the spacing; runner _openSoon (every gate call) schedules one opening for when the spacing ends, cleared on stop. check-bot-gate K and J re-measured (visible worst ~0.50 s, was ~0.93 s). mutate-j76-gate G15, G16; G4 and mutate-j67-j72 R5 re-anchored.
- docs: J76 marked DONE; INVENTORY drops J76, J77 unblocked; HANDOFF.
- index.html ?v=493 -> 494; HANDOFF re-headed; doc-budget CEILING 307962 -> 307852; directories renamed ddjp_530 / docs_530.

## J77 reader half (package ddjp_531, ?v=495)
- backend2 streammanager: memberId (two-digit ids over ten; ten or fewer unchanged), used by the unpack, exported. authority: names its sends with B2StreamManager.memberId; validatePolicy 1..20; maxPerMessage stays 10. runner: the advance's echo matched on its carrier.
- tests/check-batch20.js (new, A–G); tools/probes/mutate-j77-ids.js K1–K6; check-bot-gate H refuses 21 (was 11); mutate-j76-gate G14 and mutate-j67-j72 R3 re-anchored on the carrier match.
- index.html ?v=494 -> 495; HANDOFF re-headed (first draft 14 bytes over; tightened); doc-budget CEILING 307852 -> 307850; directories renamed ddjp_531 / docs_531.
- check-bot-songs D3: its world gets the shipped memberId so the batched advance learns carrier#k (G14 was GREEN — both echo halves coincided without the door); mutate-j76-gate G7 re-anchored on nameOf(k). Found by the full break run before hand-back.

## J75 built (package ddjp_532, ?v=496)
- Removed the bot's published presence list end to end (both doors, bot runtime, presenceView's bot branch, PRESENCE_LIST, the ddjp.presence power-level entry, _spacePowerLevels, the skeleton gate) and the now-unused bridge helpers.
- features/room.js: the viewer's own per-tier chat record behind presenceView; ui/panels.js: "counts chat you can see" (+ "can't fully tell yet for …"); lists that do not count chat keep "chat isn't counted here".
- tests/check-viewer-chat.js (new); tools/probes/mutate-j75-viewer.js V1, V3–V8. Retired with reasons: check-presence-decentralized, check-presence-powerlevels, check-bot-presence A–F/H, mutate-j73-presence P1–P6/P9/Q1–Q5/R1–R4.
- index.html ?v=495 -> 496; HANDOFF re-headed; doc-budget CEILING 307850 -> 307842; directories renamed ddjp_532 / docs_532.

## J75 DONE; the raise studied (package ddjp_533, docs and a probe only — ?v=496)
- docs J75: owner decisions (keep "chat isn't counted here" where chat does not count; no break row for the room switch); DONE, with the independent audit recorded. J73 checklist item 3 updated for J75. INVENTORY drops J75.
- docs J77: how long an older tab runs (bot ~24 h; viewer indefinitely — nothing notifies a running tab), how often the raise would bite, options (a)–(d), none chosen. tools/probes/probe-j77-raise.js (new, measurement only).
- HANDOFF re-headed (package ddjp_533, ?v=496 unchanged); doc-budget CEILING 307842 -> 307752; directories renamed ddjp_533 / docs_533.

## J77 DONE — the raise (package ddjp_534, ?v=497)
- authority: POLICY.maxPerMessage 20 (owner's pre-release rule: older app versions in open tabs are not supported).
- tests/check-batch20.js H (a real 20-member send end to end; a send of ten keeps today's ids); rows that pinned 10 changed with reasons (check-batch20 F/G, check-bot-answers B, check-bot-relay B, check-bot-gate H's undo); mutate-j77-ids K6/K7 put it back to 10.
- probe-j77-raise at the shipped value, five trials (the ddjp_533 "never" at 10 s corrected); check-bot-gate J re-measured. docs: J77 ruling (a general pre-release rule) and DONE; INVENTORY drops J77; HANDOFF: reload every open tab, the bot's included.
- index.html ?v=496 -> 497; HANDOFF re-headed; doc-budget CEILING 307752 -> 307694; directories renamed ddjp_534 / docs_534.

## J78 — the owner's bot-room test (package ddjp_535, ?v=498)
- docs J73: owner's ruling beside Q10 (turning the rule on does not apply it to songs already queued). J78 (new): the three fixes, the known join gap, the owed break rows, and the items recorded for later.
- backend1 streammanager: _droppedReach; both forgetting doors declare the dropped stretch from the previous cut. history.js: reconcileFloor keeps coverage to the cut. tests/check-history-floor-reach.js (new).
- playback.js: shouldEndOn / notifyEnded take the play. ui/player.js: a new play reloads even the same video; _loadingPi / _playingPi; ENDED reports the playing play. tests/check-ended-by-play.js (new; the player part source-checked).
- matrixbridge.js: _joinChildren retries every channel with backoff and names any it cannot join. tests/check-channel-join.js (new).
- Owed: break rows for the three new guards.
- index.html ?v=497 -> 498; HANDOFF re-headed; doc-budget CEILING 307694 -> 307687; directories renamed ddjp_535 / docs_535.
- J78 finished: the play rides on the player object (check-playback-end row 5 green); _needsLoad named; check-ended-by-play B driven from the shipped player functions against a fake YT player; the bridge's live m.space.child handler joins late-advertised channels (_joinAdvertised; check-channel-join C); tools/probes/mutate-j78-fixes.js (10 rows); mutate-j73-move-on M5 and mutate-j73-tallies T6 re-anchored on _droppedReach. INVENTORY: J78's row, paid by moving the dated v321 "No known wrong state" note to ARCHIVE.
- doc-budget CEILING 307687 -> 307530.

## J78 continued — the owner's re-test (package ddjp_536, ?v=499)
- docs J73: the owner's new repeat rule (supersedes Q10's test and J67's acceptance; the ddjp_534 ruling folded in), marked superseded in place — NOT YET BUILT. J78: the live reach fix, the vote finding (cause unfound), the compact-mode item.
- history.js refresh covers the held log from StreamManager.heldFrom (new, backend1); the bridge attaches it. tests/check-history-live-reach.js (new). authority: a duplicate vote/save from the same person for the same play is dropped in silence. tests/check-vote-dedupe.js, tests/check-vote-latch.js (new). mutate-j78-fixes L1–L3, V1–V3.
- index.html ?v=498 -> 499; HANDOFF re-headed; doc-budget CEILING 307530 -> 307530; directories renamed ddjp_536 / docs_536.

## ddjp_536 pass (not a package)
- G16 settled (time limit). reactions.js: diagnostic logging; the ledger (from the floor's seed) lights the buttons; check-vote-latch C. history.js: add positions (addedAtL, kept in the snapshot). botruntime: the owner's repeat rule by position (_addedBeforeChange) replacing Q10's test. check-history-store C rewritten to the rule (3 rows). check-repeat-cooldown H still red (botTree has no room sequence). Q10 marked superseded in J73.
- The repeat rule finished behind the interface: settingsproof.js heldSince; StreamManager.settingSince; MatrixBridge.historyAddedAtL (held log or history, the later); botruntime only compares. tests/check-repeat-rule.js (new, both room types); check-history-store C and check-repeat-cooldown H/H3 to the rule; mutate-j78-fixes R1–R5, L4 (ledger lighting), V3 re-anchored. Suite and break files green — packaged.
- Break rows re-aimed at the owner's rule after the old Q10 condition left: mutate-j67-j72 X1, mutate-j73-history H12, mutate-j73-store S6 (each red as named again).

## The owner's "loads forever" report (package ddjp_537, ?v=500)
- index.html ?v=499 -> 500; HANDOFF re-headed; directories renamed ddjp_537 / docs_537.
- ui/player.js: _loadReason (named branches); a load in flight for this play counts as loaded (_ddjpLoadingVid); rate-limited diagnostics (loads, states, errors, loads per play). tests/check-player-load-once.js (new: 60 loads per play before, on ddjp_534's player too; 1 after). check-ended-by-play B extracts _loadReason. mutate-j78-fixes P1; E2 re-anchored. docs J78: the finding, the error path, the 534->536 changes, the owner's checks.
- lint: the unused _needsLoad removed (guards use _loadReason); blocked-wire: the onError diagnostic is self-contained and names no play instance. Suite 237/0; all seventeen break files as expected.

## Votes answered "no" — refusals from the same fold (package ddjp_538, ?v=501)
- statederiver.js: deriveBoth returns refusals alongside state. backend1 streammanager: _refusalFor reads the winning fold's refusals (_foldRefusals) — the seedless re-derive is gone; rotationEntries folds from _heldBase. reactions.js: _follow keeps the latch when the room already holds my vote/save (_roomHolds).
- tests/check-answer-after-floor.js (new); check-vote-latch D. mutate-j78-fixes A1, F1. docs J78: the cause, the fix, every seedless re-derive listed.
- index.html ?v=500 -> 501; HANDOFF re-headed; directories renamed ddjp_538 / docs_538.
