// tests/check-chat-buffer.js
// WALL: the RAM chat buffer must (1) upsert by event_id IN PLACE without ever
// downgrading real text to a decryption-failure placeholder (this is what stops
// the duplicate "real + Couldn't decrypt" rows), (2) evict the OLDEST when it
// overflows CAP, and (3) page older messages onto the front without duplicating
// ids. It now holds CONTENT ONLY — display classification (image/link/text) is a
// render-time concern tested in check-chat-prefs, not baked into the record.

const { loadInContext } = require("./_load");

let failed = 0;
function ok(c, m) { if (!c) { console.log("[chat-buffer] FAIL — " + m); failed++; } }
function eq(g, w, m) { const a = JSON.stringify(g), b = JSON.stringify(w); if (a !== b) { console.log("[chat-buffer] FAIL — " + m + "\n      got " + a + "\n      want " + b); failed++; } }

const { ChatBuffer } = loadInContext(["ui/chatbuffer.js"], { URL });

// ---- 0) records are content-only (no baked-in display fields) ----
const a0 = ChatBuffer.create();
a0.upsert("e0", "@a", "https://i.giphy.com/a.gif", false, 1000);
const rec0 = a0.get("e0");
// The record's shape is pinned EXACTLY, and this assertion has now earned that: J11b added a
// third state and this guard is what noticed. `redacted` is a STATE, not a display field — the
// point of this row is that `kind`/`src` (how a body is drawn) must stay out, because display is
// decided at render time from the viewer's live prefs. Whether the author took a message back is
// not a display decision and does not change with a pref, so it belongs here.
eq(Object.keys(rec0).sort(), ["body", "failed", "id", "redacted", "sender", "ts"],
  "record holds {id,sender,body,failed,redacted,ts} — content + state + order key, no kind/src");
ok(rec0.redacted === false,
  "and an ordinary message is not redacted, so the flag is a reading rather than a constant");

// ---- 2) upsert: insert + non-downgrading update (the duplicate-bug fix) ----
const b = ChatBuffer.create();
let r;
r = b.upsert("e1", "@a", "hello", false);
ok(r.type === "insert" && b.size() === 1, "first insert");

// placeholder arrives for a NEW id, then the real text upgrades it in place
r = b.upsert("e2", "@a", "Couldn't decrypt this message", true);
ok(r.type === "insert" && b.get("e2").failed === true, "placeholder inserts as failed");
r = b.upsert("e2", "@a", "real text now", false);
ok(r.type === "update" && b.get("e2").failed === false && b.get("e2").body === "real text now", "placeholder UPGRADES to real text in place");
ok(b.size() === 2, "upgrade did not add a second row");

// the reverse must NOT happen: a late placeholder cannot clobber real text
r = b.upsert("e2", "@a", "Couldn't decrypt this message", true);
ok(r.type === "noop" && b.get("e2").body === "real text now", "real text is NOT downgraded by a later placeholder");

// upsert with no id is a noop
ok(b.upsert(null, "@a", "x", false).type === "noop", "no-id upsert is noop");

// ---- 3) eviction: oldest (by ts) falls out at CAP ----
const c = ChatBuffer.create();
const CAP = ChatBuffer.CAP;
for (let i = 0; i < CAP; i++) c.upsert("k" + i, "@a", "m" + i, false, i + 1);   // ts increasing
ok(c.size() === CAP, "buffer fills to CAP");
const ev = c.upsert("kOVER", "@a", "overflow", false, CAP + 1);                  // newest
ok(c.size() === CAP, "stays at CAP after overflow");
eq(ev.evicted, ["k0"], "overflow evicts the OLDEST id");
ok(!c.has("k0") && c.has("kOVER"), "oldest gone, newest present");

// ---- 3b) ORDER IS BY ts, NOT ARRIVAL — the reversed-chat fix ----
// E2E history decrypts newest-first; the buffer must still read oldest->newest.
const o = ChatBuffer.create();
o.upsert("m3", "@a", "third",  false, 300);   // arrive NEWEST first
o.upsert("m1", "@a", "first",  false, 100);
o.upsert("m2", "@a", "second", false, 200);
eq(o.ids(), ["m1", "m2", "m3"], "newest-first arrival still yields oldest->newest ids()");
// a late re-decrypt (same id) updates in place WITHOUT moving the row
const u = o.upsert("m2", "@a", "second (rekeyed)", false, 200);
ok(u.type === "update" && o.get("m2").body === "second (rekeyed)", "same-id re-decrypt updates in place");
eq(o.ids(), ["m1", "m2", "m3"], "in-place update keeps chronological position");
// equal ts falls back to a deterministic id tiebreak (stable across arrival order)
const t = ChatBuffer.create();
t.upsert("zzz", "@a", "z", false, 500);
t.upsert("aaa", "@a", "a", false, 500);
eq(t.ids(), ["aaa", "zzz"], "equal ts -> deterministic id tiebreak");

// ---- 4) prependOlder: fold a history batch by ts, skip dupes, interleave ----
const d = ChatBuffer.create();
d.upsert("new1", "@a", "newest", false, 300);
const pr = d.prependOlder([
  { id: "old1", sender: "@a", body: "older-1", failed: false, ts: 100 },
  { id: "old2", sender: "@a", body: "older-2", failed: false, ts: 200 },
  { id: "new1", sender: "@a", body: "dupe",    failed: false, ts: 300 }   // already present -> skipped
]);
eq(d.ids(), ["old1", "old2", "new1"], "history folded into chronological order, dupe skipped");
ok(pr.inserted.length === 2, "prependOlder reports 2 inserted");
// a page that INTERLEAVES with an existing message lands in the right slots
const d2 = ChatBuffer.create();
d2.upsert("b", "@a", "b", false, 200);
d2.prependOlder([
  { id: "a", sender: "@a", body: "a", failed: false, ts: 100 },
  { id: "c", sender: "@a", body: "c", failed: false, ts: 300 }
]);
eq(d2.ids(), ["a", "b", "c"], "prependOlder interleaves by ts around existing messages");

if (!failed) console.log("[chat-buffer] PASS — content-only records, non-downgrading upsert, CAP eviction, and paging all hold");
process.exit(failed ? 1 : 0);
