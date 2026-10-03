// tests/check-activity-taken.js
// SUBJECT: backends/backend1/activity.js, backends/backend1/streammanager.js, backends/backend2/streammanager.js
// WALL: ACTIVITY IS TAKEN BEFORE ANYTHING IS DROPPED, COUNTING ONLY ACCEPTED ACTS (J73 job 2).
//
// `tools/probes/probe-j73-presence-reach.js` drove it: a shared room that trimmed to a floor 20
// minutes old answered presence `bounded` against the 1-hour default, and people active inside the
// hour dropped out of the People tab — the trim took their evidence with it. The owner's rule: take
// what activity needs before anything is dropped, in both engines, into ONE module (Q2), counting only
// acts the room accepted (Q3). Every row compares with a reader that folded everything.
//   PART A — shared room: after a trim, presence is the same answer as reading everything.
//   PART B — a refused act in what was dropped counts for nobody, as the held-log fold treats it.
//   PART C — bot room: what opening from a save point drops is taken too.
//   PART D — it cleans up: an entry older than the longest window the settings allow is pruned.
//   PART E — one module: neither engine keeps a store or a rule of its own.
//   PART F — the bot room's background read still credits the person, not the bot.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
const ROOT = path.join(__dirname, "..");
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[activity-taken] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const B1F = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
  "backends/backend1/activity.js", "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
  "backends/backend1/floor.js", "backends/backend1/streammanager.js"];
const MIN = 60000, N = 50 * 60 * MIN;
const ids = (f) => f.people.map((p) => p.userId).sort().join(",");

// ── PARTs A, B — shared room ────────────────────────────────────────────────────────────────
{
  const tree = () => loadInContext(B1F.concat(["features/room.js"]), {});
  const S0 = tree();
  const O = F.RANK.owner, P = F.RANK.player;
  const bare = (id, l, ts, who) => F.reducerEvent(id, l, ts, who, P, { t: "ddjp.dj.join" });
  const LOG = [
    F.reducerEvent("$s1", 1, N - 120 * MIN, "@owner:hs", O, { t: "ddjp.room.settings", s: S0.StateDeriver.defaultSettings() }),
    bare("$p", 2, N - 50 * MIN, "@p:hs"),
    F.reducerEvent("$x", 3, N - 45 * MIN, "@x:hs", P, { t: "ddjp.dj.leave" }),    // not a member: REFUSED
    bare("$q", 4, N - 30 * MIN, "@q:hs"),
    bare("$r", 5, N - 20 * MIN - 1000, "@r:hs"),                                  // the floor's boundary
    bare("$s", 6, N - 20 * MIN, "@s:hs"),
    bare("$t", 7, N - 2 * MIN, "@t:hs"),
  ];
  const R = tree(); R.Floor.reset(); R.StreamManager.reset();
  LOG.forEach((e) => R.StreamManager.ingest(F.toRaw(e)));
  const ref = R.Room.recentlyActive(N);
  ok(R.StreamManager.isLegal("$x") === false, "A PREMISE — @x's leave is refused by the reducer");
  ok(ref.bounded === false && ids(ref) === "@p:hs,@q:hs,@r:hs,@s:hs,@t:hs",
    "A PREMISE — the reference reader answers the hour and lists the five", { bounded: ref.bounded, people: ids(ref) });
  const D = tree(); D.Floor.reset(); D.StreamManager.reset();
  LOG.forEach((e) => D.StreamManager.ingest(F.toRaw(e)));
  const ord = D.StreamManager.getLog();
  const seed = D.StateDeriver.buildSeed(ord.slice(0, ord.findIndex((e) => e.eventId === "$r") + 1), undefined);
  D.Floor._setTrustedForTest({ n: 1, h: "h1", floorL: 5, grade: "verified", covers: "$s1..$r", seed: seed, prev: null, thin: false });
  const dropped = D.StreamManager.trimToFloor();
  ok(dropped > 0, "A PREMISE — the trim happens", { dropped, licence: D.StreamManager.seedValidation() });
  const got = D.Room.recentlyActive(N);
  ok(got.bounded === false, "A: after the trim presence still answers the hour — the dropped evidence was taken first", got.bounded);
  ok(ids(got) === ids(ref), "A: after the trim the People list is the reference reader's", { reference: ids(ref), trimmed: ids(got) });
  const older = (typeof D.StreamManager.olderActivity === "function") ? D.StreamManager.olderActivity() : null;
  ok(!!older && older.complete === true, "A: what was taken reaches the room's start, so it says so", older && { since: older.since, complete: older.complete });
  ok(!!older && !older.by["@x:hs"], "B: a REFUSED act in what was dropped counts for nobody", older && Object.keys(older.by));
  ok(!!older && !!older.by["@p:hs"], "B CONTROL: an accepted act in what was dropped is taken", older && Object.keys(older.by));
  // AFK, TOO (J73's Done-when, checked at `ddjp_527`): a shared room that has trimmed answers AFK from the same
  // evidence as reading everything — `Room.idleFor`, which the bot's queue sweep reads, per person.
  const afk = (S, who) => { const r = S.Room.idleFor(who, N); return r && { known: r.known, overdue: r.overdue, lastTs: r.lastTs }; };
  const same = ["@p:hs", "@q:hs", "@t:hs"].filter((u) => JSON.stringify(afk(D, u)) === JSON.stringify(afk(R, u)));
  ok(same.length === 3 && afk(D, "@p:hs").known === true, "A: after the trim AFK (idleFor) gives the reference reader's answer for each person, a dropped act included",
    ["@p:hs", "@q:hs", "@t:hs"].map((u) => [u, afk(R, u), afk(D, u)]));
}
// ── PART C — bot room: opening from a save point ────────────────────────────────────────────
{
  const sb = loadInContext(B1F.concat(["backends/backend2/checkpoint.js", "backends/backend2/streammanager.js", "features/room.js"]), {});
  const B1 = sb.B1StreamManager, B2 = sb.B2StreamManager, PLY = sb.Ranks.levelOf("player"), OWN = sb.Ranks.levelOf("owner");
  B2.setFoldScope({ events_owner: "!ev:hs", settings_owner: "!set:hs" });
  const relay = (id, l, ts, actor, rank, body) => ({ event_id: id, type: "m.room.message", room_id: "!ev:hs", sender: "@bot:hs", ts: ts,
    content: { body: JSON.stringify(Object.assign({ l: l, actor: actor, rank: rank }, body)) } });
  const raws = [
    relay("$c1", 1, N - 90 * MIN, "@owner:hs", OWN, { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() }),
    relay("$c2", 2, N - 40 * MIN, "@o:hs", PLY, { t: "ddjp.dj.join" }),          // only below the save point
    relay("$c3", 3, N - 30 * MIN, "@b:hs", PLY, { t: "ddjp.dj.join" }),          // the save point's boundary
    relay("$c4", 4, N - 5 * MIN, "@k:hs", PLY, { t: "ddjp.dj.join" }),
  ];
  raws.forEach((r) => B2.ingest(r));
  const ord = B1.getLog();
  ok(ord.length === 4, "C PREMISE — the bot door folded the relays", ord.map((e) => e.eventId));
  const seed = sb.StateDeriver.buildSeed(ord.slice(0, 3), undefined);
  const src = fs.readFileSync(path.join(ROOT, "backends/backend2/streammanager.js"), "utf8");
  const m = /adoptFloor\(([^)]*)\)/.exec(src.slice(src.indexOf("function openFromSavePoint")));
  ok(!!m && /take:\s*"all"/.test(m[1]), "C: the bot door's openFromSavePoint asks adoptFloor to take EVERY act first (Q3)", m && m[0]);
  const r = B1.adoptFloor({ floorL: 3, seed: seed, covers: "$c1..$c3" }, { take: "all" });
  ok(r.ok === true && r.dropped === 3, "C PREMISE — the save point is adopted and drops what it covers", r);
  const older = B2.olderActivity();
  const f = sb.Room.foldActivity(B1.getLog(), N, 60 * MIN, { spine: true, chat: false }, (id) => B1.isLegal(id),
    sb.StreamManager.getState().settings.activityPresence, sb.Capabilities.activityGroupOf, older);
  ok(f.people.some((p) => p.userId === "@o:hs"), "C: a person whose only act sat below the save point is still seen", ids(f));
}
// ── PART D — it cleans up after itself ──────────────────────────────────────────────────────
{
  const sb = loadInContext(B1F, {});
  const A = sb.Activity; A.reset();
  ok(A.maxWindowMs() === 25 * 60 * MIN, "D PREMISE — the longest window the settings allow is 24 h + 1 h", A.maxWindowMs());
  const T = 400 * 60 * MIN;
  A.take([{ eventId: "$old", ts: T - 26 * 60 * MIN, sender: "@old:hs", type: "ddjp.dj.join", content: { t: "ddjp.dj.join" } },
          { eventId: "$new", ts: T, sender: "@new:hs", type: "ddjp.dj.join", content: { t: "ddjp.dj.join" } }], null);
  const rd = A.read();
  ok(!rd.by["@old:hs"] && !!rd.by["@new:hs"], "D: an entry older than the longest window is dropped; a recent one is kept", Object.keys(rd.by));
}
// ── PART E — one module, no copy ────────────────────────────────────────────────────────────
{
  const b2 = fs.readFileSync(path.join(ROOT, "backends/backend2/streammanager.js"), "utf8");
  const b1 = fs.readFileSync(path.join(ROOT, "backends/backend1/streammanager.js"), "utf8");
  ok(!/\b_older\b/.test(b2), "E: the bot door keeps no activity store of its own");
  ok(/Activity\.noteRaws\(/.test(b2) && /Activity\.read\(/.test(b2), "E: the bot door's read-back and its list are the one module's");
  const trim = b1.slice(b1.indexOf("function trimToFloor"), b1.indexOf("function trimToFloor") + 6000);
  ok(/Activity\.take\(/.test(trim), "E: the shared door's trim takes into the one module before dropping");
  ok(/olderActivity/.test(b1.slice(b1.lastIndexOf("return {"))), "E: the shared door offers what it took, behind the seam");
}
// ── PART F — the background read still credits the person ───────────────────────────────────
{
  const sb = loadInContext(B1F.concat(["backends/backend2/checkpoint.js", "backends/backend2/streammanager.js"]), {});
  sb.B2StreamManager.setFoldScope({ events_owner: "!ev:hs", settings_owner: "!set:hs" });
  sb.B2StreamManager.noteActivity([{ event_id: "$k", room_id: "!ev:hs", sender: "@bot:hs", ts: 21000, type: "m.room.message",
    content: { body: JSON.stringify({ t: "ddjp.dj.skip", p: "$x", actor: "@v:hs", rank: 50 }) } }]);
  const o = sb.B2StreamManager.olderActivity();
  ok(!!o && o.by["@v:hs"] && o.by["@v:hs"].skip === 21000 && !o.by["@bot:hs"], "F: the read-back credits the actor, not the bot", o && o.by);
}
if (failed) { console.log("[activity-taken] " + failed + " failure(s)"); process.exit(1); }
console.log("[activity-taken] PASS — activity is taken before anything is dropped, into one module, counting only acts the " +
  "room accepted (J73 job 2): a trimmed shared room answers presence as a reader holding everything does, a refused act " +
  "counts for nobody, a bot room's save point drops nothing unseen, entries past the longest allowed window go, and " +
  "neither engine keeps a store of its own (" + asserts + " assertions)");
