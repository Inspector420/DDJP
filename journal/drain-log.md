# Drain log — §6 Phase 1, pass 2 (the v267–v283 release-narrative block)

**Why this file exists.** The entry-list diff is a rail for entry IDENTITY and is structurally blind
to a cut inside a span — driven here, not assumed (`journal/mutate-v275-delete.js`). The block holds
**zero job-entry start tokens**, so no rail in this tree can see any of these cuts. **The written
defence below is the instrument.** If a cut cannot be defended in prose, it is not made.

**Unit.** One `#### vNNN — …` release section, bounded by the em-dash token AND the range between
`#### v283` and `#### J17`. `^#### v\d+ — ` matches **19 sections file-wide**, not 17: the extra two
are both `#### v266` and sit inside J17's entry, which carries a `Kind` and three `Touches` and is a
different unit under the four-clause keep-list. `journal/drain-section.js` asserts 17-in-block and
19-file-wide before every cut and refuses otherwise.

**Keep-list, and it collapses from four clauses to two here.** The block holds **0 `**Kind.**` and 0
`**Open`**, so *keep the Kind verbatim* and *keep any live Open* are vacuous. What survives is **the
decision and its reason** and **the guard's name**. Dropped: `Touches` (17 blocks), row counts,
mutation tables, and the account of how the session got there.

**Rails run either side of every cut.** `journal/entry-list.js` — expected and observed unchanged at
52 lines throughout, byte-identical to the pre-pass baseline. `journal/drain-check.js` — anchor
SURVIVAL, not anchor existence.

---

## The measurement that bounds the pass

Re-driven at the top of this session rather than inherited. Deleting the entire 111-line `#### v275`
section left `entry-list` **byte-identical**, `check-roadmap-gate` **PASS**, and all **143 guards
green**. `journal/mutate-j50-dup-first.js` was re-driven in both directions: FIRST names the injected
and real `#### J17` six lines apart, SECOND (the control) names the real J17 and J18. Rails
known-good before the first cut.

## The interaction that the anchor check exists for

`#### v275`'s only two occurrences in the roadmap were its heading and `**Touches (v275).**`, and
`Touches` is on the drop list — so draining the Touches AND dropping the heading would have made
`v275` vanish and turned `FAILURE-SIGNATURES.md`'s *"recorded in the v275 entry"* into a stale
citation. **Broken by two rules interacting, neither wrong alone.** Headings are therefore kept, all
17, at a cost of 17 lines.

**It fired again on the first real cut.** Draining v281 dropped `v292`, whose only roadmap home was
that section and which `check-origin-fold.js` cites by name (*"v292's M7"*). Restored. Same shape,
found by instrument rather than by luck.

---

## Per section — what was kept, and why

| section | lines | kept | notes |
|---|---|---|---|
| **v283** | 47 → 34 | The default-change cost, the fingerprint pair, the two-seal recovery, why it was payable (test rooms) and that it is not a precedent; where the cost is recorded (`check-setting-endpoints` and the defaults themselves). | The fingerprint measurement is kept **once**, here, and v282 cites it — two copies of a number is invisible drift. |
| **v282** | 60 → 34 | `values` appears in no seed so a range change is free; the ladder-derived offer; `check-min-dj-rank` taught not loosened; `BARS[0]` → computed `STRICTEST` and *an index naming a position is not a name*; why item 2 was stopped; what taking it would need; item 3 not-started. | Row counts and the duplicated fingerprint block dropped. |
| **v281** | 112 → 62 | The decline-to-conclude decision and its reason; why NOT seeded from the oldest trusted checkpoint; the seven-verdict-site enumeration; the coverage from four directions with all four guard names; the real remaining gap; the `check-cascade-simulation` route; *do not anchor on `_trimmedBelow`* (ten sites); item 2's device-in-seal-log-not-in-checkpoint decision; the three unmeasured things. | Densest section (9 guard names). The measurement table and mutation table dropped — `FAILURE-SIGNATURES.md` already carries which shape each guard catches. `v292` restored after the anchor check refused the first attempt. `_canon` dropped (recoverable by reading the site); `check-floor-pairing` and `check-override-*` dropped **because they were the WRONG verdict list** — keeping them would keep the error. |
| **v280** | 86 → 53 | Both halves of the false premise; the derived-globals decision; `Interface` and the deliberately-narrow PART F boundary; `no-use-before-define` declined **with its number**; the disjoint-classes reason `check-ui-refs` survives; not-installed-is-a-failure and the changed extraction standard; `_resetChatState` parked not exempted. | Folded the `#### v280 IS OUTSIDE ANY LINTER'S REACH` sub-heading into prose, which retires the naive-regex hazard rather than merely avoiding it. |
| **v279** | 74 → 53 | 46 coded refusal sites; **a reason is diagnostic output, never derived state** and the seed control; the honest-fingerprint assertion rule; the derived vocabulary and `uncoded` asserted absent; the 47th-site exclusion; the precise-message standard; all three re-asked items with their differing reasons. | Assertion counts dropped. |
| **v278** | 65 → 44 | Genesis is not a hole and why the premise misread the rule; the log's tense and `finalAtIngest`; one cause not two; the total-order convergence answer; **item 4 first** and its reason; the still-open seed-diverges warning. | Sparsest section — **names no guard at all**, so of the two surviving clauses only one applied. The format holds at that end too. |
| **v277** | 72 → 44 | Write rows against REACHABILITY; the clamp that made the branch unreachable; detect-announce-repair as a pairing; `check-cascade-seeds` abandoned, why a harness that repairs the condition cannot sample its space, and the three reusable parts. | Dropped *"items 2, 3 and 4 remain unstarted"*: true when written, superseded by v279 above, which took item 4. Dropping rather than correcting avoids both a stale-reading claim and a falsified record. |
| **v276** | 111 → 64 | A count is not stable under a trim, a position is; the full mechanism; the comment as the finding; why `Math.max(0, …)` was rejected; no version mixing needed; the tally sweep's single instance; CLAIM 2 recorded known-unmet **with its 70/66 → 15/5 numbers**; the owner's open cascade-cadence question with both sides. | The numbers stay because `REVIEWER-HANDOFF.md` §9 cites them. Same dated-items drop as v277. |
| **v275** | 111 → 77 | The TDZ mechanism and `v287`; the two-symptoms-one-line chain; `_delegationOpen` and *a correct search for the wrong word*; why `check-ui-refs` passes correctly; **the one-at-a-time decision and its measured cost** (the content `FAILURE-SIGNATURES.md:298` cites); item 2's destination-not-menu decision; item 3's whole DM-invite finding; what existing duplicates mean; `declineDMInvite`'s reason; the stubbed-subject fixture. | Kept `v287` and `mutate-v288` explicitly — both cited from the tree and otherwise stranded by the Touches drop. Heading kept verbatim although its *"no linter runs"* claim was answered at v280; the body now says so rather than reading as live. |
| **v274** | 96 → 67 | The half-move shape; the guard that could not fail and the premise-counted-at-collection rule; **the empty `#export-section` mount kept on purpose** for `check-import`; the collapsed-table decision; reaching for three nonexistent classes while fixing nonexistent classes; the one-row-builder merge and the both-boxes avatar sweep; PART C inverted not deleted; the two DM navigation decisions. | Row counts dropped. |
| **v273** | 93 → 65 | A control reusing nothing is invisible to a reuse check; the styled-by-own-class-or-ancestor rule and the cry-wolf threshold; exemptions carry reasons and the list is asserted exhausted; all three near-misses; the self-mutation inversion; the five changes' decisions; a class is a SET not a SEQUENCE; the `check-export` caller move. | The 13-row breakdown table dropped; its content is the rule above it. |
| **v272** | 86 → 59 | The refinement-not-reversal framing and *a preference is a preference until the surface becomes the basis for an action*; the before/after with its control; **no parameter to disagree through**; it cost no settings key and why that made it affordable; the full removal including the probes; the discrimination rule; the genuinely-dominated row with the site that would notice; the VOID anchor behaviour. | Row counts dropped. |
| **v271** | 78 → 52 | Borrowed-not-re-declared and the source-order reason; both callers checked, one changed; the dead ladder rung removed; parameterised marquee and the three fixes a copy would not inherit; per-fit state on the element; own observer each; the DM composer's removed duplicate declarations; what is unverifiable headlessly. | Assertion/row counts dropped. |
| **v270** | 79 → 55 | Reachability was the gap and hidden-is-indistinguishable-from-absent; **a per-room list cannot be built** with the seed-carries-no-room-id reason; the empty case naming which empty; the older-keyset path; create-from-file needed no function; the tier strip reusing the queue's classes; `check-chat-tiers` refuses on rename; an absence found by grepping one file is not an absence; both guard repairs. | Row counts dropped. |
| **v269** | 80 → 63 | All four gaps and the two the report guessed wrong; REPORTED-never-BOUND and why auto-binding is unsafe; nothing-asks-twice; per-refusal sentences; **the whole copied-rule finding and the one-implementation fix**; VOID-is-not-a-survivor; the grep-tests-words-not-behaviour row; the harness gate catching the harness. | Row counts dropped. |
| **v268** | 82 → 61 | The P7 collision; `botPresenceChat` is not a missing filter but data the fold will never have; `unobservable` and decided-not-merged; the defaults agreeing by coincidence; refused acts count for nobody; fail-closed sources and the indexed table; the six-of-eight *every one was the checking* finding; the keys-must-disagree fixture rule; **the self-test whose mutation silently stopped applying**, which is where applied-checking comes from. | Noted that v272 above refined the window half; the sources half is what this entry settles. |
| **v267** | 108 → 81 | The first browser run and the 133-guard gap; `refs.settingsBody`; the seven-skipped chain and *rendered but never arranged*; the seam proved innocent; the fake `el()` refuted by driving; **five of forty executed, thirty-five by none**; why `check-ui-refs` takes the total property; both of its own controls; the tier picker and the rank picker's identical earlier defect; the fixture describing an impossible room; the three deliberately-unfixed observations; the DOM-node method rule. | **Dropped the stale `interface.js:2241` locator** from the crash trace — one of open correction (3)'s twelve, retired as a side effect of the drain. |

**Block: 1,440 → 968 lines. File: 5,309 → 4,837. All 17 sections present; all 17 headings kept.**

---

## Verification, every pass

- `entry-list`: 52 lines, unchanged after every single cut and byte-identical to the pre-pass
  baseline at the end.
- `check-roadmap-gate`: PASS, 52 job entries, `outstanding: (none)`, throughout. The J18/J19/J20
  unattributed print is the designed loud direction and is unchanged.
- `node tests/run-all.js`: 143 guards, 0 FAIL, after the pilots and at the end.
- `drain-check`: 0 stranded on every accepted cut; the one refusal (`v292`) was repaired, not
  overridden.
