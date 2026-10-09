// tests/check-history-audit.js
// SUBJECT: backends/backend1/history.js, backends/backend1/matrixbridge.js, features/room.js, ui/shell.js
// WALL: THE HISTORY AUDIT TELLS THE TRUTH AND CHANGES NOTHING (`ddjp_559`, the owner's three devices: 41, 40 and 22 songs). The
//   room's events, paged from its start, are folded by the app's own reducer; this device's table is compared row by row; every
//   missing and extra row is named by its pi, position, video and DJ, with its coverage reason or the path that produced it.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[history-audit] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"], {});
const H = sb.History; H.reset();
const S = sb.StateDeriver.defaultSettings(), P = F.RANK.player, O = F.RANK.owner, T0 = 1.7e12, MIN = 60000;
const E = [F.reducerEvent("$s", 1, T0, "@o:hs", O, { t: "ddjp.room.settings", s: S })]; let pv = null, ts = T0;
for (let l = 2; l <= 60; l++) { const id = "$r" + String(l).padStart(3, "0");
  if (l % 10 === 2) { ts += MIN; E.push(F.reducerEvent(id, l, ts, "@dj" + l + ":hs", P, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") })); }
  else if (l % 10 === 7) { ts += 5 * MIN; E.push(F.reducerEvent(id, l, ts, "@o:hs", O, { t: "ddjp.dj.play", p: pv })); pv = id; }
  else { ts += MIN; E.push(F.reducerEvent(id, l, ts, "@v:hs", P, { t: "ddjp.dj.vote", p: pv || "$none" })); } }
const truth = sb.StateDeriver.derive(E.slice()).history || [];
ok(truth.length >= 4, "PREMISE — the room has several finished songs", truth.length);
// this device: every true row but the first (missing), plus one extra from a stored table; covered from l=20 only
const rows = truth.slice(1).map((r) => Object.assign({}, r, { l: E.find((e) => e.eventId === r.pi).l, src: "refresh" }));
H.restore({ v: 2, rows: rows.concat([{ pi: "$ghost", l: 33, videoId: "vidGHOST0000", dj: "@x:hs", floorSig: "old" }]), ranges: [[20, 60]], adds: {} });
const before = JSON.stringify(H.recent(5000));
const rep = H.auditAgainst(E, { reachedFrom: 0 });
ok(rep.truthCount === truth.length && rep.deviceCount === truth.length, "the true count and this device's count", { truth: rep.truthCount, device: rep.deviceCount });
const m = rep.missing[0] || {};
ok(rep.missing.length === 1 && m.pi === truth[0].pi && typeof m.l === "number" && m.videoId && /below the first covered position/.test(m.why), "the missing row: its pi, position, video, and why (never fetched)", rep.missing);
const x = rep.extra[0] || {};
ok(rep.extra.length === 1 && x.pi === "$ghost" && x.l === 33 && x.videoId === "vidGHOST0000" && x.src === "stored", "the extra row: its pi, position, video, and the path that produced it (the stored table)", rep.extra);
ok(JSON.stringify(rep.coverage.ranges) === JSON.stringify([[20, 60]]) && rep.stored && rep.stored.rows === rows.length + 1, "the device's coverage ranges and its stored table's origin", { coverage: rep.coverage, stored: rep.stored });
ok(JSON.stringify(H.recent(5000)) === before, "READ-ONLY — the audit changes nothing in the table");
const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
const RM = fs.readFileSync(path.join(__dirname, "..", "features/room.js"), "utf8");
const SH = fs.readFileSync(path.join(__dirname, "..", "ui/shell.js"), "utf8");
ok(/async function historyAudit\(\)[\s\S]{0,400}pageRange\(0,/.test(MB) && /historyAudit,/.test(MB.slice(MB.lastIndexOf("  return {"))), "the bridge pages every channel FROM THE ROOM'S START, and exports the audit");
ok(/api\.historyAudit = historyAudit;/.test(RM) && /Room\.historyAudit\(\)/.test(SH) && !/MatrixBridge\.historyAudit/.test(SH), "the debug tools' button calls Room.historyAudit (UI → features → backend)");
// ── `ddjp_560`: THE TRUTH IS FLOOR-ANCHORED; ROWS WHOSE VIDEO DIFFERS ARE FLAGGED; A DERIVATION CORRECTS A WRONG ROW ──
(async () => {
  const sb2 = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"], {});
  const H2 = sb2.History; H2.reset();
  // the floor at l=40 accounts for a join (l=38) the paging device cannot read: one fold from the start diverges after it
  const hidden = F.reducerEvent("$hidden", 38, T0 + 38 * MIN, "@rank80:hs", O, { t: "ddjp.dj.join", v: "vidHIDDEN000" });
  const seed40 = sb2.StateDeriver.buildSeed(E.filter((e) => e.l <= 40).concat([hidden]).sort((a, b) => a.l - b.l), undefined);
  const anchors = [{ l: 40, seed: seed40 }];
  const anch = H2.deriveAnchored(E, anchors).rows;
  const raw = sb2.StateDeriver.derive(E.slice()).history || [];
  ok(anch.some((r) => r.videoId === "vidHIDDEN000") && !raw.some((r) => r.videoId === "vidHIDDEN000"), "PREMISE — the floor-anchored account differs from one fold from the start (the floor counts a join this device cannot read)");
  // this device: the anchored rows, one with the WRONG video
  const mine = anch.map((r, i) => Object.assign({}, r, { src: "stored" }, i === 1 ? { videoId: "vidWRONGVIDEO" } : {}));
  H2.restore({ v: 2, rows: mine, ranges: [[0, 60]], adds: {} });
  const rep2 = H2.auditAgainst(E, { anchors: anchors });
  ok(rep2.truthCount === anch.length, "the audit's truth is the FLOOR-ANCHORED derivation, not one fold from the start", { truth: rep2.truthCount, anchored: anch.length, raw: raw.length });
  ok(rep2.differs.length === 1 && rep2.differs[0].pi === anch[1].pi && rep2.differs[0].deviceVideoId === "vidWRONGVIDEO" && rep2.differs[0].videoId === anch[1].videoId, "a row whose VIDEO DIFFERS is flagged, with both videos", rep2.differs);
  ok(rep2.rawVsFloors.length > 0, "and every place one fold from the start disagrees with the floors is reported", rep2.rawVsFloors.length);
  // a derivation corrects a wrong row; a stored table never overrides a derived row
  H2.ingest(E.filter((e) => e.l <= 40), undefined, { from: 0, to: 40, src: "refresh" });
  const fixed = (H2.recent(5000) || []).find((r) => r.pi === anch[1].pi);
  ok(fixed && fixed.videoId === anch[1].videoId, "a DERIVATION replaces a wrong row with the same pi (the existing row no longer always wins)", fixed && fixed.videoId);
  H2.restore({ v: 2, rows: [Object.assign({}, fixed, { videoId: "vidSTALE0000" })], ranges: [[0, 40]], adds: {} });
  ok(((H2.recent(5000) || []).find((r) => r.pi === anch[1].pi) || {}).videoId === anch[1].videoId, "and a stored table never overrides a derived row");
  // the backfill from the room's start is floor-anchored
  const H3 = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"], {}).History; H3.reset();
  const cpEv = { type: "ddjp.checkpoint", l: 40.5, eventId: "$cp40", content: { floorL: 40, seed: seed40 } };
  H3.attach({ pageRange: async (a, b) => { const out = E.concat([cpEv]).filter((e) => e.l >= a && e.l <= b); out.reachedFrom = Math.max(0, a); return out; },
    anchorOf: (e) => (e && e.type === "ddjp.checkpoint") ? { l: e.content.floorL, seed: e.content.seed } : null });
  await H3.backfill(0, undefined, 61);
  ok((H3.recent(5000) || []).some((r) => r.videoId === "vidHIDDEN000"), "the backfill from the room's start is FLOOR-ANCHORED — after the floor it follows the floor's seed");
  // ADD RECORDS DO NOT DEPEND ON WHICH STEP RAN LAST (ddjp_558's rule, driven directly at ddjp_560): after a live refresh keeps
  // only queued or playing songs, a backfill's ingest records no add for a song that retain dropped.
  const H5 = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"], {}).History; H5.reset();
  H5.ingest(E.slice(), undefined, { retain: true, from: 0, to: 60, src: "refresh" });
  const kept = Object.keys((H5.snapshot() || {}).adds || {});
  H5.ingest(E.filter((e) => e.l <= 20), undefined, { from: 0, to: 20, src: "backfill" });
  const after5 = Object.keys((H5.snapshot() || {}).adds || {});
  ok(after5.length === kept.length && after5.every((k) => kept.indexOf(k) >= 0), "a backfill's ingest records adds only for songs the last retain kept", { kept: kept.length, after: after5.length });
  // VERIFIED KEYS DO NOT OUTLIVE THEIR ROWS (ddjp_562): a write that CHANGES a row inside a verified segment drops its key; an
  // identical write keeps it; adding the row of the song in progress at the segment's closing floor keeps it.
  const H6 = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"], {}).History; H6.reset();
  const seed30 = H6 && sb2.StateDeriver.buildSeed(E.filter((e) => e.l <= 30), undefined);
  H6.attach({ pageRange: async (a, b) => { const out = E.filter((e) => e.l >= a && e.l <= b); out.reachedFrom = Math.max(0, a); return out; } });
  await H6.verifyIncremental([{ h: "f30", l: 30, seed: seed30 }]);
  const keyOf = () => Object.keys((H6.snapshot() || {}).verified || {});
  ok(keyOf().length === 1, "PREMISE — the segment up to the floor at l=30 is verified", keyOf());
  const inSeg = (H6.recent(5000) || []).find((r) => typeof r.l === "number" && r.l <= 30);
  H6.ingest(E.filter((e) => e.l <= 30), undefined, { from: 0, to: 30, src: "refresh" });
  ok(keyOf().length === 1, "an IDENTICAL write inside a verified segment keeps its key (an unchanged room reads nothing)", keyOf());
  // a fold of the same events from a seed whose rotation puts another DJ first: the first play's VIDEO changes
  const forker = F.reducerEvent("$aForker", 1, T0 + 1, "@forker:hs", O, { t: "ddjp.dj.join", v: "vidFORKED000" });
  const seedX = sb2.StateDeriver.buildSeed(E.filter((e) => e.l <= 1).concat([forker]).sort((a, b) => (a.l - b.l) || String(a.eventId).localeCompare(String(b.eventId))), undefined);
  H6.ingest(E.filter((e) => e.l > 1 && e.l <= 30), seedX, { from: 2, to: 30, src: "cache" });
  ok(((H6.recent(5000) || []).some((r) => r.videoId === "vidFORKED000")), "PREMISE — that write changed a row inside the verified segment");
  ok(keyOf().length === 0, "a write that CHANGES a row in a verified segment drops its key — the next verify re-derives it from the room", keyOf());
  // THE BOT'S ORDER (ddjp_563): a trim hand-off from an incomplete drop (a join missing) BEFORE the device is settled and BEFORE the
  // restore; the restore then brings marks covering that segment; verify. The table must still equal the room.
  { let settled = false;
    const H7 = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"], {}).History; H7.reset();
    H7.attach({ settled: () => settled, pageRange: async (a, b) => { const out = E.filter((e) => e.l >= a && e.l <= b); out.reachedFrom = Math.max(0, a); return out; } });
    const seed30b = sb2.StateDeriver.buildSeed(E.filter((e) => e.l <= 30), undefined);
    const prevH = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"], {}).History; prevH.reset();
    prevH.attach({ pageRange: async (a, b) => { const out = E.filter((e) => e.l >= a && e.l <= b); out.reachedFrom = Math.max(0, a); return out; } });
    await prevH.verifyIncremental([{ h: "f30", l: 30, seed: seed30b }]);
    const SNAP7 = prevH.snapshot();                                                     // a previous, correct open: rows and marks
    H7.ingest(E.filter((e) => e.l > 1 && e.l <= 30), seedX, { from: 2, to: 30, src: "trim" });   // the burst's trim, from a wrong base, before settled
    ok((H7.recent(5000) || []).length === 0, "(a) the trim hand-off writes NOTHING before the device is settled", (H7.recent(5000) || []).length);
    settled = true; H7.restore(JSON.parse(JSON.stringify(SNAP7)));
    await H7.verifyIncremental([{ h: "f30", l: 30, seed: seed30b }]);
    const truth7 = H7.deriveAnchored(E.filter((e) => e.l <= 30), [{ l: 30, seed: seed30b }]).rows.filter((r) => typeof r.l === "number" && r.l <= 30).map((r) => r.pi + "=" + r.videoId).sort();
    const have7 = (H7.recent(5000) || []).filter((r) => typeof r.l === "number" && r.l <= 30).map((r) => r.pi + "=" + r.videoId).sort();
    { const H8 = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/history.js"], {}).History; H8.reset();
      H8.attach({ pageRange: async (a, b) => { const out = E.filter((e) => e.l >= a && e.l <= b); out.reachedFrom = Math.max(0, a); return out; } });
      H8.ingest(E.filter((e) => e.l > 1 && e.l <= 30), seedX, { from: 2, to: 30, src: "cache" });          // a writer touches the segment first
      H8.restore(JSON.parse(JSON.stringify(SNAP7)));
      const v8 = await H8.verifyIncremental([{ h: "f30", l: 30, seed: seed30b }]);
      ok(v8 && v8.verified === 1, "(b) marks a restore brings for a segment a writer already touched do NOT count — verify re-verifies it", v8); }
    ok(JSON.stringify(have7) === JSON.stringify(truth7), "the BOT'S ORDER — a trim hand-off before settled and before the restore, then restored marks — still ends equal to the room", { have: have7, truth: truth7 }); }
  if (failed) { console.log("[history-audit] " + failed + " failure(s)"); process.exit(1); }
  console.log("[history-audit] PASS — the audit derives the room's floor-anchored song history, names every missing, extra and differing row, and reports where one fold from the start disagrees, read-only (" + asserts + " assertions)");
  process.exit(0);
})().catch((e) => { console.log("[history-audit] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
