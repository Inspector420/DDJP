// tests/check-upgrade-reconcile.js
// SUBJECT: backends/backend1/matrixbridge.js
// WALL: RANKS AND UPGRADED CHANNELS (owner's decentralized test, `ddjp_539`). An upgrade batch created channels but invited
//   nobody; only assignRank reconciled membership, so a bot ranked before upgrade n=2 was missing channels it belonged in.
//   Now: a level is assignable only when every channel it belongs in exists, and after each upgrade batch every current
//   member of the space is INVITED (never kicked) to the batch's channels their level belongs in — the level read from the
//   space's own power levels, the rule `_desiredMembership` shared with assignRank, an unreadable level skipped.
//   Driven with the shipped functions against a scripted client and the REAL plan (read from the bridge's plan table).
//   PART A — nobody below a channel's level is ever invited (every level; a non-member; an unreadable level).
//   PART B — a bot and a staff member ranked between batches are each invited to exactly the new channels their levels allow.
//   PART C — an assignment to a level whose channels do not all exist is refused.     PART D — each batch reconciles.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[upgrade-reconcile] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
const fnSrc = (name) => { const m = MB.match(new RegExp("\\n  (async )?function " + name + "\\(")); if (!m) return ""; const i = m.index + 1; return MB.slice(i, MB.indexOf("\n  }\n", i) + 4); };
// The real plan rows of the decentralized engine, read from its table.
const ROWS = [];
for (const m of MB.matchAll(/\{ kind: "(\w+)",\s+slug: "([\w-]+)",\s+key: "(\w+)",\s+level: (\d+),\s+batch: (\d+)/g)) ROWS.push({ kind: m[1], slug: m[2], key: m[3], level: +m[4], batch: +m[5] });
const R = loadInContext(["backends/backend1/ranks.js"], {}).Ranks;
// The assignRank block (its retry state and helpers, `ddjp_546`) is extracted whole: from its constants to its end.
const BLOCK = (() => { const a = MB.indexOf("  const RANK_PL_RETRY_MS = "), b = MB.indexOf("\n  }\n", MB.indexOf("  async function assignRank(spaceId, channels, userId, level) {")); return (a >= 0 && b > a) ? MB.slice(a, b + 4) : ""; })();
const SRC = ["_rankFromKey", "_presenceChatKey", "_desiredMembership", "ownChannelKeys", "rankAssignable", "_reconcileAfterUpgrade"].map(fnSrc).join("") + BLOCK + "\n_rankSleep = () => Promise.resolve(); _rankLater = () => 0;\n";
function world(members, users, usersDefault, existing) {
  const invites = [], kicks = [], plWrites = [], logs = [];
  const rooms = {};
  const room = (id) => rooms[id] || (rooms[id] = { members: {}, currentState: { getStateEvents: (t) => (t === "m.room.power_levels" && id === "!space:hs" && users) ? { getContent: () => ({ users, users_default: usersDefault }) } : null },
    getMember(u) { return this.members[u] ? { membership: this.members[u] } : null; }, getMembersWithMembership: (ms) => Object.keys(members).filter((u) => members[u] === ms).map((u) => ({ userId: u })) });
  room("!space:hs");
  const client = { getRoom: room, invite: async (r, u) => { invites.push([r, u]); room(r).members[u] = "invite"; }, kick: async (r, u) => { kicks.push([r, u]); },
    sendStateEvent: async (r, t) => { plWrites.push([r, t]); } };
  const Logger = { info: (m) => logs.push(m), warn: (m) => logs.push(m), debug() {}, error() {} };
  const derived = { levelBySlug: Object.fromEntries(ROWS.map((r) => [r.slug, r.level])), eventsKeyByLevel: {} };   // from the same real plan
  const api = new Function("client", "Logger", "Ranks", "_channels", "_liveChannelMap", "_derived", SRC + "\nreturn { rankAssignable, _reconcileAfterUpgrade, assignRank, _desiredMembership };")(
    client, Logger, R, () => ROWS, () => existing || {}, () => derived);
  return Object.assign({ invites, kicks, plWrites, logs }, api);
}
// The expected answer, from each channel's OWN level in the plan (not from the rule under test).
const want = (key, level) => { const row = ROWS.find((r) => r.key === key); if (!row) return false;
  if (/^chat_/.test(key)) return row.level <= level; return !/presence/.test(key); };
ok(ROWS.length >= 8 && ROWS.some((r) => r.batch > 1), "PREMISE — the real plan was read, with upgrade batches", ROWS.length);
const all = {}; for (const r of ROWS) all[r.key] = "!" + r.key + ":hs";
const batch2 = {}; for (const r of ROWS.filter((r) => r.batch === 2)) batch2[r.key] = all[r.key];
const LV = { owner: 100, bot: R.levelOf("owner"), staff: R.levelOf("staff"), player: R.levelOf("player"), guest: 0 };
// ── A ──
{
  const members = { "@owner:hs": "join", "@bot:hs": "join", "@staff:hs": "join", "@player:hs": "join", "@guest:hs": "join", "@weird:hs": "join", "@outsider:hs": "leave" };
  const users = { "@owner:hs": LV.owner, "@bot:hs": LV.bot, "@staff:hs": LV.staff, "@player:hs": LV.player, "@weird:hs": "high", "@outsider:hs": LV.staff };
  const w = world(members, users, 0, all);
  (async () => {
    await w._reconcileAfterUpgrade("!space:hs", batch2);
    const lvOf = { "@owner:hs": LV.owner, "@bot:hs": LV.bot, "@staff:hs": LV.staff, "@player:hs": LV.player, "@guest:hs": 0 };
    const keyOf = (rid) => Object.keys(all).find((k) => all[k] === rid);
    const below = w.invites.filter(([rid, u]) => !(u in lvOf) || !want(keyOf(rid), lvOf[u]));
    ok(below.length === 0, "A: nobody is invited to a channel below — or outside — their level", below);
    ok(!w.invites.some(([, u]) => u === "@outsider:hs") && !w.invites.some(([, u]) => u === "@weird:hs"), "A: a non-member of the space and an unreadable level are never invited", w.invites.filter(([, u]) => /outsider|weird/.test(u)));
    ok(w.kicks.length === 0, "A: and nobody is kicked — invite only", w.kicks);
    for (const u of Object.keys(lvOf)) {
      const got = w.invites.filter(([, x]) => x === u).map(([rid]) => keyOf(rid)).sort();
      const exp = Object.keys(batch2).filter((k) => want(k, lvOf[u])).sort();
      ok(JSON.stringify(got) === JSON.stringify(exp), "A: " + u + " (level " + lvOf[u] + ") is invited to exactly the batch's channels its level belongs in", { got, exp });
    }
    // ── B ── a bot and a staff member ranked between batches
    const w2 = world({ "@bot:hs": "join", "@staff:hs": "join" }, { "@bot:hs": LV.bot, "@staff:hs": LV.staff }, 0, all);
    await w2._reconcileAfterUpgrade("!space:hs", batch2);
    for (const [u, lv] of [["@bot:hs", LV.bot], ["@staff:hs", LV.staff]]) {
      const got = w2.invites.filter(([, x]) => x === u).map(([rid]) => keyOf(rid)).sort(), exp = Object.keys(batch2).filter((k) => want(k, lv)).sort();
      ok(got.length > 0 && JSON.stringify(got) === JSON.stringify(exp), "B: " + u + ", ranked between batches, is invited to exactly the new channels its level allows", { got, exp });
    }
    // ── C ── NARROWED (owner's decision at the ddjp_540 audit): a level's OWN channels gate it; demotion is always possible.
    const partial = {}; for (const r of ROWS.filter((r) => r.batch <= 2)) partial[r.key] = all[r.key];   // upgraded through batch 2
    const w3 = world({ "@x:hs": "join", "@s:hs": "join" }, { "@x:hs": 0, "@s:hs": LV.staff }, 0, partial);
    const down = await w3.assignRank("!space:hs", partial, "@s:hs", 0);
    ok(!(down && down.ok === false), "C: in a partially upgraded room, demoting a staff member to 0 succeeds", down);
    const up = await w3.assignRank("!space:hs", partial, "@x:hs", LV.staff);
    ok(up && up.ok === false && up.reason === "upgrade-first" && up.missing.length > 0 && up.missing.every((k) => ROWS.find((r) => r.key === k).level === LV.staff),
      "C: promoting to a level whose OWN channel is missing is refused — upgrade the room first", up);
    const vip = R.levelOf("vip"), okUp = await w3.assignRank("!space:hs", partial, "@x:hs", vip);
    ok(!(okUp && okUp.ok === false), "C: promoting to a level whose own channels all exist succeeds", okUp);
    // The roster offers a level exactly when the gate does: Room.isRankUnlocked delegates to this same function.
    const refused = [0, 10, 20, 40, 60, 80, 99].filter((lv) => !w3.rankAssignable("!space:hs", partial, lv).ok);
    ok(JSON.stringify(refused) === JSON.stringify([60, 80]), "C: in that room exactly the batch-3 levels (60, 80) are refused — and so disabled", refused);
    const RS = fs.readFileSync(path.join(__dirname, "..", "features/room.js"), "utf8"), RO = fs.readFileSync(path.join(__dirname, "..", "ui/roster.js"), "utf8");
    ok(/MatrixBridge\.rankAssignable\(current && current\.spaceId, channels, level\)\.ok === true/.test(RS) && /if \(!Room\.isRankUnlocked\(channels, r\.level\)\) \{/.test(RO),
      "C: the roster disables a level through Room.isRankUnlocked, which asks the same gate");
    // ── P ── the presence chat's manager: owner-tier accounts (the bot) are invited; everyone else is the activity rule's
    const pkey = (ROWS.find((r) => /presence/.test(r.key)) || {}).key;
    const b3 = {}; for (const r of ROWS.filter((r) => r.batch === 3)) b3[r.key] = all[r.key];
    const w5 = world({ "@bot:hs": "join", "@guest:hs": "join" }, { "@bot:hs": LV.bot, "@guest:hs": 0 }, 0, all);
    await w5._reconcileAfterUpgrade("!space:hs", b3);
    const toPres = w5.invites.filter(([rid]) => rid === all[pkey]).map(([, u]) => u);
    ok(!!pkey && toPres.length === 1 && toPres[0] === "@bot:hs", "P: the upgrade reconcile invites the bot (owner tier) to the presence chat, and not a guest", toPres);
    const w6 = world({ "@b2:hs": "join", "@s2:hs": "join" }, { "@b2:hs": 0, "@s2:hs": 0 }, 0, all);
    await w6.assignRank("!space:hs", all, "@b2:hs", LV.bot); await w6.assignRank("!space:hs", all, "@s2:hs", LV.staff);
    const p6 = w6.invites.filter(([rid]) => rid === all[pkey]).map(([, u]) => u);
    ok(p6.length === 1 && p6[0] === "@b2:hs", "P: and assignRank to the owner tier invites to the presence chat; to staff it does not", p6);
    // ── D ──
    const cub = fnSrc("createUpgradeBatch");
    ok(/await _reconcileAfterUpgrade\(spaceId, added\)/.test(cub), "D: each upgrade batch reconciles membership when it finishes");
    if (failed) { console.log("[upgrade-reconcile] " + failed + " failure(s)"); process.exit(1); }
    console.log("[upgrade-reconcile] PASS — ranks wait for their channels, and every upgrade batch invites — never kicks — each member to exactly the channels its level belongs in, skipping non-members and unreadable levels (" + asserts + " assertions)");
    process.exit(0);
  })().catch((e) => { console.log("[upgrade-reconcile] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
}
