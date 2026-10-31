// tools/probes/mutate-j122-chat-links.js
// SUBJECT: J122 (`ddjp_640`) — the owner's decisions at `ddjp_639`: A, more link sites, all on by default, grouped by kind in
// Settings, one turned off staying off, none listed twice; B, every allowed https link inside a message is a link, wherever a
// chat body is drawn; C, the sender's device takes the ID, tracking and referral codes out of its own links before sending,
// by a per-host table, with no network; D, room settings changes, strikes, removals, resets and moves show in chat by
// default; F, "＋ All to Q" in two steps behind a green ✔; G, a fully upgraded room's header slot empty and taking no space;
// H, new rooms start with the owner's settings, the built-in defaults unchanged; I, the alarm banner's second line.
// (E — Import / Export right of Create — is PI2 in `mutate-j118-owner-screens.js`, re-targeted on purpose.)
// Held by `check-chat-links`, `check-chat-prefs` (changed on purpose for the one-token rule and the link defaults),
// `check-chat-view` PART E (changed on purpose for the feed defaults), `check-owner-screens` H and I, `check-genesis-settings`
// (changed on purpose for the genesis blob) and `check-bot-alarm` E.
// One row per site, each naming the failure it must cause in its guard, and a control per guard. Each row plants its edit(s),
// confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule (`_verdict.js`); everything
// is restored after every row, and checked restored. Run it in a fresh copy of the tree.
//   node tools/probes/mutate-j122-chat-links.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const CB = "ui/chatbuffer.js", CH = "ui/chat.js", CP = "core/chatprefs.js", ST = "ui/settings.js", FC = "features/chat.js";
const RM = "features/room.js", PL = "ui/playlists.js", SH = "ui/shell.js", RO = "ui/roster.js", IX = "index.html";
const SD = "backends/backend1/statederiver.js", SM = "backends/backend1/streammanager.js";
const LK = "check-chat-links", PR = "check-chat-prefs", CV = "check-chat-view", OS = "check-owner-screens", GS = "check-genesis-settings", AL = "check-bot-alarm";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── A: THE LINK SITES ──
  ["A1", [[CP, `    { kind: "streaming", label: "Streaming", hosts: ["twitch.tv"] },`, `    { kind: "streaming", label: "Streaming", hosts: [] },`]],
    PR, "FAIL — A: THE DEFAULT LINK HOSTS ARE THE OWNER'S LIST", "RED"],
  ["A2", [[CP, `"discord.gg", "streamable.com", "reddit.com", "redd.it"] },`, `"discord.gg", "streamable.com", "reddit.com", "redd.it", "t.co"] },`]],
    PR, "FAIL — A: t.co IS DELIBERATELY NOT A LINK HOST", "RED"],
  ["A3", [[CP, `    _state.linkCustom  = (Array.isArray(_state.linkCustom) ? _state.linkCustom : []).filter((h) => DEFAULT_LINK_HOSTS.indexOf(h) < 0);`,
           `    _state.linkCustom  = Array.isArray(_state.linkCustom) ? _state.linkCustom : [];`]],
    PR, "FAIL — A: A HOST SOMEONE ALREADY ADDED BY HAND DOES NOT APPEAR TWICE", "RED"],
  ["A4", [[CP, `    { kind: "games",     label: "Games",     hosts: ["skribbl.io", "lichess.org", "chess.com", "tetr.io"] },`,
           `    { kind: "games",     label: "Games",     hosts: ["skribbl.io", "lichess.org", "chess.com"] },`],
          [CP, `"ubisoft.com",\n                                                     "epicgames.com"] },`, `"ubisoft.com",\n                                                     "epicgames.com", "tetr.io"] },`]],
    PR, "FAIL — A: AND EACH IS IN THE OWNER'S KIND", "RED"],
  ["A5", [[CP, `out.push({ host: h, on: !_st().linkOff[h], group: g.kind, groupLabel: g.label });`, `out.push({ host: h, on: g.kind === "video" ? !_st().linkOff[h] : false, group: g.kind, groupLabel: g.label });`]],
    PR, "FAIL — A: EVERY NEW DEFAULT IS ON FOR EVERYONE", "RED"],
  ["A6", [[ST, `        hosts.appendChild(H.el("div", { class: "set-group-label pref-host-group", text: group }));`, `        void group;`]],
    LK, "FAIL — A: THE LONG LIST IS GROUPED BY THE OWNER'S KINDS", "RED"],
  // ── B: LINKS INSIDE SENTENCES ──
  ["B1", [[CB, `    const linkOk = !!opts.linksOn && typeof opts.linkHostAllowed === "function";`,
           `    const linkOk = !!opts.linksOn && typeof opts.linkHostAllowed === "function" && !/\\s/.test(text.trim());`]],
    PR, "FAIL — B: EVERY HTTPS URL INSIDE A MESSAGE, ON AN ALLOWED LINK HOST, IS A LINK", "RED"],
  ["B2", [[CB, `  const LINK_TRAIL = /[.,)!?]+$/;`, `  const LINK_TRAIL = /[.,!?]+$/;`]], PR, "FAIL — B: TRAILING PUNCTUATION IS NOT PART OF THE LINK — a closing bracket", "RED"],
  ["B3", [[CB, `  const LINK_TRAIL = /[.,)!?]+$/;`, `  const LINK_TRAIL = /(?!)/;`]], PR, "FAIL — B: TRAILING PUNCTUATION IS NOT PART OF THE LINK — a full stop", "RED"],
  ["B4", [[CB, `      if (u && opts.linkHostAllowed((u.hostname || "").toLowerCase())) {`, `      if (u) {`]],
    PR, "FAIL — B: A URL ON A HOST THAT IS NOT ALLOWED STAYS PLAIN TEXT", "RED"],
  ["B5", [[CB, `    return u.protocol === "https:" ? u : null;`, `    return (u.protocol === "https:" || u.protocol === "http:") ? u : null;`]],
    PR, "FAIL — http (non-https) -> text", "RED"],
  ["B6", [[CB, `    const linkOk = !!opts.linksOn && typeof opts.linkHostAllowed === "function";`, `    const linkOk = typeof opts.linkHostAllowed === "function";`]],
    PR, "FAIL — B: with links off, nothing inside a sentence links either", "RED"],
  ["B7", [[CH, `      a.rel = "noopener noreferrer nofollow";              // no window.opener, no referrer, no SEO transfer\n      a.setAttribute("referrerpolicy", "no-referrer");\n      span.appendChild(a);`,
           `      span.appendChild(a);`]],
    LK, "FAIL — B: ROOM CHAT — EACH KEEPS TODAY'S ATTRIBUTES", "RED"],
  ["B8", [[CH, `      if (!p.href) { span.appendChild(_textWithLongRuns(p.text)); continue; }`, `      if (!p.href) { span.appendChild(document.createTextNode(p.text)); continue; }`]],
    LK, "FAIL — B: THE PLAIN PARTS STILL GET THEIR LONG-RUN BREAKS", "RED"],
  ["B9", [[CH, `    const c = ChatBuffer.classify(record.body, ChatPrefs.classifyOpts());`,
           `    if (box && /dm-msgs/.test(box.className || "")) return _textWithLongRuns(" " + record.body);\n    const c = ChatBuffer.classify(record.body, ChatPrefs.classifyOpts());`]],
    LK, "FAIL — B: DMs, THE ROOM'S DM TAB", "RED"],
  // ── C: LINKS LEAVE CLEAN ──
  ["C1", [[FC, `      return k.indexOf("utm_") === 0 || LINK_TRACKING_ANY.indexOf(k) >= 0 || table.indexOf(k) >= 0; };`,
           `      return LINK_TRACKING_ANY.indexOf(k) >= 0 || table.indexOf(k) >= 0; };`]],
    LK, "FAIL — C: utm_*, fbclid AND gclid GO EVERYWHERE", "RED"],
  ["C2", [[FC, `    "youtu.be": ["si", "is", "feature"],`, `    "youtu.be": ["is", "feature"],`]], LK, "FAIL — C STRIP: https://youtu.be/k_-6KI3m31M?si=", "RED"],
  ["C3", [[FC, `    "youtube.com": ["si", "is", "feature"],`, `    "youtube.com": ["si", "is", "feature", "pp"],`]], LK, "FAIL — C KEEP: https://m.youtube.com/watch?v=EU1KWuGWy1o", "RED"],
  ["C4", [[FC, `    if (kept.length === segs.length) return raw;\n    return head.slice(0, qAt) + (kept.length ? "?" + kept.join("&") : "") + frag;`,
           `    return head.slice(0, qAt) + (kept.length ? "?" + kept.map((x) => x.indexOf("=") < 0 ? x + "=" : x).join("&") : "") + frag;`]],
    LK, "FAIL — C KEEP: https://skribbl.io/?XvCVTn2Z", "RED"],
  ["C5", [[FC, `    const hashAt = raw.indexOf("#");`, `    const hashAt = -1;`]], LK, "FAIL — C: THE FRAGMENT IS KEPT WHEN THE QUERY BEFORE IT IS CLEANED", "RED"],
  ["C6", [[FC, `    if (_linkOpaque(host, u.pathname || "")) return raw;\n`, ``]], LK, "FAIL — C: A SHORT LINK IS LEFT EXACTLY AS TYPED", "RED"],
  ["C7", [[FC, `    for (const base of Object.keys(LINK_TRACKING)) if (host === base || host.endsWith("." + base)) return LINK_TRACKING[base];`,
           `    for (const base of Object.keys(LINK_TRACKING)) if (host.indexOf(base) >= 0) return LINK_TRACKING[base];`]],
    LK, "FAIL — C: a host is matched exactly or as a subdomain", "RED"],
  ["C8", [[FC, `    const safe = cleanLinks(_sanitize(String(text == null ? "" : text).trim()));   // links leave clean (ddjp_639)`,
           `    const safe = _sanitize(String(text == null ? "" : text).trim());`]],
    LK, "FAIL — C: ROOM CHAT SENDS THE CLEAN LINK", "RED"],
  ["C9", [[FC, `    const safe = cleanLinks(_sanitize((text == null ? "" : String(text)).trim()));   // links leave clean (ddjp_639)`,
           `    const safe = _sanitize((text == null ? "" : String(text)).trim());`]],
    LK, "FAIL — C: A DM SENDS THE CLEAN LINK TOO", "RED"],
  ["C10", [[FC, `    return String(text == null ? "" : text).replace(/https:\\/\\/\\S+/gi, (m) => {`, `    return String(text == null ? "" : text).replace(/^https:\\/\\/\\S+/gi, (m) => {`]],
    LK, "FAIL — C: EVERY LINK DRAWN FROM A CLEANED MESSAGE IS ALREADY CLEAN", "RED"],
  ["C11", [[FC, `  function cleanLink(word) {\n    const raw = String(word == null ? "" : word);`,
            `  function cleanLink(word) {\n    const raw = String(word == null ? "" : word);\n    try { fetch(raw); } catch (e) {}`]],
    LK, "FAIL — C: NO NETWORK CALL IS EVER MADE TO CLEAN A LINK", "RED"],
  // C12, C13 — a youtube.com start time and playlist place are kept (`ddjp_641`, the supervisor's correction: the `t` plant
  // stayed green on `ddjp_640`; real keep-cases since).
  ["C12", [[FC, `    "youtube.com": ["si", "is", "feature"],`, `    "youtube.com": ["si", "is", "feature", "t"],`]], LK, "FAIL — C KEEP: https://www.youtube.com/watch?v=F6va6tg62qg&t=14s", "RED"],
  ["C13", [[FC, `    "youtube.com": ["si", "is", "feature"],`, `    "youtube.com": ["si", "is", "feature", "index"],`]], LK, "FAIL — C KEEP: https://www.youtube.com/watch?v=47dtFZ8CFo8&list=", "RED"],
  // ── D: THE FIVE ROOM EVENTS ON BY DEFAULT ──
  ["D1", [[RM, `    "ddjp.dj.reset":      { verb: "reset the rotation",         group: "moderation", shownByDefault: true  },`,
           `    "ddjp.dj.reset":      { verb: "reset the rotation",         group: "moderation", shownByDefault: false },`]],
    CV, "FAIL — E: THE DEFAULTS ARE THE OWNER'S RULING", "RED"],
  ["D2", [[CP, `      if (k && typeof fs[k] === "boolean") _state.feedShow[String(k)] = fs[k];`,
           `      if (k && typeof fs[k] === "boolean" && ["ddjp.dj.move", "ddjp.dj.strike"].indexOf(k) < 0) _state.feedShow[String(k)] = fs[k];`]],
    CV, "FAIL — E: A DEVICE WITH ITS OWN STORED CHOICE FOR A KIND KEEPS IT", "RED"],
  // ── F: "＋ ALL TO Q" IN TWO STEPS ──
  ["F1", [[PL, `    const addAll = H.el("button", { class: "mini", text: "＋ All to Q",`, `    const addAll = H.el("button", { class: "mini", text: "＋ All to my queue",`]],
    OS, `FAIL — H: "＋ ALL TO MY QUEUE" IS "＋ ALL TO Q"`, "RED"],
  ["F2", [[PL, `    addAll.onclick = () => { _plConfirmAll = armedAll ? null : id; QueuePanels.renderQueuePanel(); };`,
           `    addAll.onclick = () => { Playlists.addWholeToQueue(id); };`]],
    OS, `FAIL — H: CLICKING "＋ ALL TO Q" SHOWS A ✔ TO ITS LEFT`, "RED"],
  ["F3", [[PL, `[back, titleEl, H.el("span", { class: "uq-actions" }, [addAllOk, addAll, detailLock])]`, `[back, titleEl, H.el("span", { class: "uq-actions" }, [addAll, addAllOk, detailLock])]`]],
    OS, `FAIL — H: CLICKING "＋ ALL TO Q" SHOWS A ✔ TO ITS LEFT`, "RED"],
  ["F4", [[IX, `.pl-detail-head .mini.ico.dconfirm.pl-all-ok { width: 30px; min-width: 30px; background: #1f5a2e; color: #d9ffe0; }`,
           `.pl-detail-head .mini.ico.dconfirm.pl-all-ok { width: 30px; min-width: 30px; }`]],
    OS, "FAIL — H: AND IT IS GREEN", "RED"],
  ["F5", [[IX, `.pl-detail-head .mini.ico.dconfirm.pl-all-ok { width: 30px; min-width: 30px; background: #1f5a2e; color: #d9ffe0; }`,
           `.pl-detail-head .mini.ico.dconfirm.pl-all-ok { background: #1f5a2e; color: #d9ffe0; }`]],
    OS, "FAIL — H: THE ✔ IS THE RED CONFIRM SQUARES' KIND", "RED"],
  ["F6", [[PL, `    addAll.onclick = () => { _plConfirmAll = armedAll ? null : id; QueuePanels.renderQueuePanel(); };`,
           `    addAll.onclick = () => { _plConfirmAll = id; QueuePanels.renderQueuePanel(); };`]],
    OS, `FAIL — H: CLICKING "＋ ALL TO Q" AGAIN CANCELS`, "RED"],
  ["F7", [[PL, `  function _plDisarm() { _plConfirmDelete = null; _plConfirmAll = null; }`, `  function _plDisarm() { _plConfirmDelete = null; }`]],
    OS, "FAIL — H: THE LOCK DISARMS IT", "RED"],
  ["F8", [[SH, `    PlaylistPanels.disarm();   // the delete confirm and "＋ All to Q"'s ✔ alike (ddjp_639)`, `    void 0;`]],
    OS, "FAIL — H: LEAVING THE VIEW FOR ANOTHER QUEUE TAB DISARMS IT", "RED"],
  ["F9", [[PL, `    addAll.onclick = () => { _plConfirmAll = armedAll ? null : id; QueuePanels.renderQueuePanel(); };`,
           `    addAll.disabled = H.plLocked();\n    addAll.onclick = () => { if (H.plLocked()) return; _plConfirmAll = armedAll ? null : id; QueuePanels.renderQueuePanel(); };`]],
    OS, "FAIL — H: IT IS NOT BEHIND THE LOCK", "RED"],
  ["F10", [[PL, `    const armedAll = (_plConfirmAll === id);`, `    const armedAll = (_plConfirmAll === id); _plConfirmAll = null;`]],
    OS, "FAIL — H: A REDRAW KEEPS IT", "RED"],
  // ── G: A FULLY UPGRADED ROOM ──
  ["G1", [[RO, `    if (st.currentBatch >= st.maxBatch) return;`, `    if (st.currentBatch >= st.maxBatch) { slot.appendChild(H.el("span", { class: "upgrade-note", text: "All ranks unlocked" })); return; }`]],
    OS, "FAIL — I: A FULLY UPGRADED ROOM SAYS NOTHING THERE", "RED"],
  ["G2", [[IX, `    .upgrade-slot:empty { display: none; }\n`, ``]], OS, "FAIL — I: AND THE SLOT TAKES NO SPACE AT ALL", "RED"],
  // ── H: NEW ROOMS START WITH THE OWNER'S SETTINGS ──
  // H1 and H2 RE-ANCHORED ON PURPOSE (the owner, `ddjp_644`: a new room's REP interval is 1 h, the default's; the "differs" row
  // names the owner's keys that differ, seven).
  ["H1", [[SD, `    checkpointCooldownMs: 30 * 60 * 1000, checkpointEvery: 200, repSummaryMs: 60 * 60 * 1000,`, `    checkpointCooldownMs: 30 * 60 * 1000, checkpointEvery: 100, repSummaryMs: 60 * 60 * 1000,`]],
    GS, "A: AND EACH CARRIES THE OWNER'S VALUE", "RED"],
  ["H2", [[SD, `    queueIdleMs: 120 * 60 * 1000, botPingMs: 1800 * 1000,`, `    queueIdleMs: 30 * 1000, botPingMs: 1800 * 1000,`]],
    GS, "A: IT DIFFERS FROM THE BUILT-IN DEFAULTS IN THE OWNER'S KEYS AND NO OTHER", "RED"],
  ["H3", [[RM, `await MatrixBridge.sendEvent(ch, "ddjp.room.settings", { s: StreamManager.newRoomSettings() });`, `await MatrixBridge.sendEvent(ch, "ddjp.room.settings", { s: StreamManager.defaultSettings() });`]],
    GS, "C: create() posts the genesis settings, carrying a NEW ROOM'S settings", "RED"],
  ["H4", [[SD, `      checkpointEvery: 40,                    // new events since our last seal that make one due`, `      checkpointEvery: 41,                    // new events since our last seal that make one due`]],
    GS, "D: THE BUILT-IN DEFAULTS ARE UNCHANGED", "RED"],
  ["H5", [[SM, `  function newRoomSettings() { return StateDeriver.newRoomSettings(); }`, `  function newRoomSettings() { return StateDeriver.defaultSettings(); }`]],
    GS, "A: APPLIED — and it PASSES THROUGH the reducer's own", "RED"],
  // ── I: THE BANNER'S SECOND LINE ──
  ["I1", [[CH, `        H.el("div", { class: "bot-alarm-why",\n          text: "Browsers only let a tab play sound after you click it once. Without that click, the alarm can't wake the bot." }),\n`, ``]],
    AL, `FAIL — E: UNDER "CLICK ANYWHERE TO ARM THE BOT'S ALARM", A SECOND LINE`, "RED"],
  ["I2", [[IX, `    .bot-alarm-banner .bot-alarm-why { font-size: 11px; font-weight: 400; margin-top: 3px; }`, `    .bot-alarm-banner .bot-alarm-why { font-size: 13px; font-weight: 400; margin-top: 3px; }`]],
    AL, "FAIL — E: AND IT IS SMALLER", "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[CB, `  function linkParts(body, opts) {`, `  function linkParts(body, opts)  {`]], LK, "", "GREEN"],
  ["N2", [[CP, `  function linkDefaults()  {`, `  function linkDefaults()   {`]], PR, "", "GREEN"],
  ["N3", [[RM, `  const FEED_KINDS = {`, `  const FEED_KINDS =  {`]], CV, "", "GREEN"],
  ["N4", [[PL, `  function _plDisarm() {`, `  function _plDisarm()  {`]], OS, "", "GREEN"],
  ["N5", [[SD, `  function newRoomSettings() {`, `  function newRoomSettings()  {`]], GS, "", "GREEN"],
  ["N6", [[CH, `  function _alarmBanner(show) {`, `  function _alarmBanner(show)  {`]], AL, "", "GREEN"],
];
let planted = [];
function restore() { for (const p of planted) fs.writeFileSync(p.file, p.original); planted = []; }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, edits, guard, expect, want] of ROWS) {
  // EVERY EDIT IS CHECKED BEFORE ANY IS WRITTEN: an anchor gone or doubled VOIDs the row and nothing is planted.
  const plan = [];
  let voided = null;
  const after = new Map();
  for (const [rel, oldS, newS] of edits) {
    const file = path.join(ROOT, rel);
    const original = after.has(file) ? after.get(file).original : fs.readFileSync(file, "utf8");
    const cur = after.has(file) ? after.get(file).mutated : original;
    const n = cur.split(oldS).length - 1;
    if (n !== 1) { voided = "anchor occurs " + n + " times in " + rel; break; }
    const mutated = cur.replace(oldS, () => newS);
    if (mutated === cur) { voided = "the edit changed nothing in " + rel; break; }
    after.set(file, { original, mutated });
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  for (const [file, v] of after) plan.push({ file, original: v.original, mutated: v.mutated });
  let out = "", code = 0;
  try {
    for (const p of plan) { planted.push({ file: p.file, original: p.original }); fs.writeFileSync(p.file, p.mutated); }
    if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.mutated)) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
    out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
  } finally { restore(); }
  if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.original)) { console.log("ABORT — a file of row " + id + " was not restored"); process.exit(2); }
  if (want === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — the control"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — the control went red: the guard is not reading what the rows think it is"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
