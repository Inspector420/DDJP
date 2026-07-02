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
a0.upsert("e0", "@a", "https://i.giphy.com/a.gif", false);
const rec0 = a0.get("e0");
eq(Object.keys(rec0).sort(), ["body", "failed", "id", "sender"], "record holds only {id,sender,body,failed} — no kind/src");

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

// ---- 3) eviction: oldest falls out at CAP ----
const c = ChatBuffer.create();
const CAP = ChatBuffer.CAP;
for (let i = 0; i < CAP; i++) c.upsert("k" + i, "@a", "m" + i, false);
ok(c.size() === CAP, "buffer fills to CAP");
const ev = c.upsert("kOVER", "@a", "overflow", false);
ok(c.size() === CAP, "stays at CAP after overflow");
eq(ev.evicted, ["k0"], "overflow evicts the OLDEST id");
ok(!c.has("k0") && c.has("kOVER"), "oldest gone, newest present");

// ---- 4) prependOlder: front-prepend, skip dupes, keep order ----
const d = ChatBuffer.create();
d.upsert("new1", "@a", "newest", false);
const pr = d.prependOlder([
  { id: "old1", sender: "@a", body: "older-1", failed: false },
  { id: "old2", sender: "@a", body: "older-2", failed: false },
  { id: "new1", sender: "@a", body: "dupe", failed: false }   // already present -> skipped
]);
eq(d.ids(), ["old1", "old2", "new1"], "older messages prepended in order, dupe skipped");
ok(pr.inserted.length === 2, "prependOlder reports 2 inserted");

if (!failed) console.log("[chat-buffer] PASS — content-only records, non-downgrading upsert, CAP eviction, and paging all hold");
process.exit(failed ? 1 : 0);
