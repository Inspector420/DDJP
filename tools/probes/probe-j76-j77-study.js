// tools/probes/probe-j76-j77-study.js
// SUBJECT: J76 (the bot's security gate) and J77 (20 actions a message) — the study at `ddjp_529`, before any
// build. MEASUREMENT ONLY: drives today's real B2Authority, Floor and reducer and reports what they do.
//   node tools/probes/probe-j76-j77-study.js
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));
const F = require(path.join(__dirname, "..", "..", "tests", "_fixtures.js"));
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/checkpointformat.js",
  "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js", "backends/backend2/checkpoint.js",
  "backends/backend2/streammanager.js", "backends/backend2/authority.js"];
const fresh = () => { const sb = loadInContext(FILES, {}); const clock = { t: 1000000 }; const sent = [];
  sb.B2Authority.reset(); sb.B2Authority.attach((type, payload) => { sent.push({ type, at: clock.t, acts: type === "ddjp.batch" ? payload.evs.map((e) => e.src) : [payload.src] }); return Promise.resolve(); }, { now: () => clock.t });
  return { sb, A: sb.B2Authority, clock, sent }; };
const st = (A, t, actor, src, extra) => A.stamp(Object.assign({ t: t }, extra || {}), actor, 10, src, null);
// ── 1. _sendInstant's exception: an instant act overtakes the waiting group when the budget is nearly spent ──
for (const spend of [6, 7]) {
  const { A, clock, sent } = fresh();
  for (let i = 0; i < spend; i++) A.submit(st(A, "ddjp.dj.skip", "@s" + i + ":hs", "$pre" + i, { p: "$x" }));   // spend the 8-per-4-s budget
  A.submit(st(A, "ddjp.dj.join", "@g1:hs", "$g1")); A.submit(st(A, "ddjp.dj.join", "@g2:hs", "$g2"));         // accepted first, waiting
  A.submit(st(A, "ddjp.dj.skip", "@u:hs", "$u", { p: "$x" }));                                                  // accepted last, instant
  clock.t += 5000; A.tick();
  const order = [].concat(...sent.filter((s) => !/^\$pre/.test(s.acts[0])).map((s) => s.acts));
  console.log("1. budget " + (8 - spend) + " left: accepted $g1 $g2 $u → sent " + order.join(" ") +
    (order.indexOf("$u") < order.indexOf("$g1") ? "   REORDERED: the instant act went ahead of acts accepted before it" : "   in order"));
}
// ── 2. instant acts skip the per-person limit; grouped ones meet it ──
{
  const { A } = fresh(); let instant = 0, grouped = 0;
  for (let i = 0; i < 20; i++) { const r = A.submit(st(A, "ddjp.dj.skip", "@one:hs", "$i" + i, { p: "$x" })); if (r && !r.tooFast) instant++; }
  for (let i = 0; i < 20; i++) { const r = A.submit(st(A, "ddjp.dj.join", "@two:hs", "$j" + i)); if (r && !r.tooFast) grouped++; }
  console.log("2. one person, 20 acts in an instant: instant lane accepted " + instant + "/20, grouped lane " + grouped + "/20 (limit " + A.POLICY.perActor.acts + " per " + A.POLICY.perActor.perMs + " ms)");
}
// ── 3. the "too many acts at once" refusal hits the limit it reports ──
{
  const { A } = fresh();
  for (let i = 0; i < A.POLICY.perActor.acts; i++) A.submit(st(A, "ddjp.dj.join", "@p:hs", "$k" + i));
  const over = A.submit(st(A, "ddjp.dj.join", "@p:hs", "$over"));
  const ref = A.submit(A.refusal({ t: "ddjp.dj.join" }, "@p:hs", 10, "$over", "too many acts at once — wait a moment and try again"));
  console.log("3. over the limit: " + JSON.stringify(over) + "; its refusal: " + JSON.stringify(ref) + (ref && ref.tooFast ? "   SILENT: the refusal is refused by the same limit" : ""));
}
// ── 4. an early ddjp.dj.play from a client is let through (the judge's timing exemption) ──
{
  const sb = loadInContext(FILES, {}); const B1 = sb.B1StreamManager, P = F.RANK.player, O = F.RANK.owner;
  B1.reset();
  [F.reducerEvent("$s", 1, 1000, "@o:hs", O, { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() }),
   F.reducerEvent("$j1", 2, 2000, "@a:hs", P, { t: "ddjp.dj.join", v: "vid0000000A" }), F.reducerEvent("$j2", 3, 3000, "@b:hs", P, { t: "ddjp.dj.join", v: "vid0000000B" }),
   F.reducerEvent("$p1", 4, 10000, "@a:hs", P, { t: "ddjp.dj.play", p: null })].forEach((e) => B1.ingest(F.toRaw(e)));
  const v = sb.B2Authority.evaluate({ t: "ddjp.dj.play", p: "$p1", actor: "@b:hs" }, B1.getState(), P, { log: B1.getLog(), seed: undefined });
  console.log("4. a client's ddjp.dj.play one second into the song (far before its gate): judged " + JSON.stringify(v) + (v.ok ? "   RELAYED" : ""));
}
// ── 5. member ids sort as text: #10 before #2, at the door and at the floor's boundary ──
{
  const sb = loadInContext(FILES, {});
  const ids = Array.from({ length: 12 }, (_, i) => "$m#" + i);
  console.log("5. a 12-member batch's ids sorted as text: " + ids.slice().sort().join(" "));
  const after = sb.Floor.afterBoundary(ids.map((id) => ({ l: 9, eventId: id })), 9, "$m#2").map((e) => e.eventId);
  console.log("   Floor.afterBoundary at member #2: kept " + after.join(" ") + "   — #10 and #11 come after #2 in the message but are judged BEFORE it");
  const pad = Array.from({ length: 20 }, (_, i) => "$m#" + String(i).padStart(2, "0"));
  console.log("   zero-padded, 20 members: sorted " + (JSON.stringify(pad.slice().sort()) === JSON.stringify(pad) ? "in member order" : "OUT of order"));
}
// ── 6. a 20-member message's size ──
{
  const sb = loadInContext(FILES, {}); const A = sb.B2Authority;
  const evs = Array.from({ length: 20 }, (_, i) => A.stamp({ t: i % 3 ? "ddjp.dj.vote" : "ddjp.dj.join", p: "$" + "x".repeat(43), v: "dQw4w9WgXcQ" }, "@a-longer-user-name" + i + ":matrix.example.org", 10, "$" + "y".repeat(43), null));
  const body = JSON.stringify({ t: "ddjp.batch", evs: evs, l: 123456 });
  const envelope = 1500;   // event id, room id, sender, origin_server_ts, hashes, signatures, unsigned — generous
  console.log("6. a 20-member batch body: " + body.length + " bytes; with a generous envelope ~" + (body.length + envelope) + " of Matrix's 65,536-byte event limit (" + ((body.length + envelope) / 655.36).toFixed(1) + "%)");
}
// ── 7. what a 500 ms gate adds, modelled (the real gate does not exist yet) ──
{
  let sum = 0, max = 0; const n = 100000;
  for (let i = 0; i < n; i++) { const at = Math.random() * 500; const wait = 500 - at; sum += wait; if (wait > max) max = wait; }
  console.log("7. a 500 ms gate, acts arriving at random: mean +" + (sum / n).toFixed(0) + " ms, worst +" + max.toFixed(0) + " ms on top of today's instant send — to be measured on the built gate");
}
// ── 8. the media-length cascade against Q2's grouping (added at the J76 build, ddjp_529). Each slot carries a random
//    share of vouchJitter, so the gaps are SAMPLED — a single draw is not the cascade's spacing.
{
  const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js"], {});
  const jit = sb.StateDeriver.defaultSettings().vouchJitter, rungs = ["owner", "staff", "vip", "player", "guest"], below = [];
  let top = [];
  for (let n = 0; n < 5000; n++) {
    const at = rungs.map((r) => sb.Capabilities.staggerMs(sb.Ranks.levelOf(r), jit, null, 0));
    top.push(at[1] - at[0]); for (let i = 2; i < at.length; i++) below.push(at[i] - at[i - 1]);
  }
  const q = (a, p) => { const x = a.slice().sort((m, n) => m - n); return x[Math.floor(p * (x.length - 1))]; };
  console.log("8. media-length cascade gaps (5,000 samples, vouchJitter " + jit + "): owner→staff " + q(top, 0) + "–" + q(top, 1) + " ms; below staff min " +
    q(below, 0) + ", 5% " + q(below, 0.05) + ", median " + q(below, 0.5) + ", max " + q(below, 1) + " ms. Grouped (Q2): 1000 ms + up to 500 ms + the round trip — " +
    "over the median gap; urgent: up to 500 ms + the round trip — over the low tail");
}
console.log("MEASURED");
