// tests/check-session-log.js
// SUBJECT: backends/backend1/session.js
// WALL: A TAB THAT STOPS OR STARTS BEING LIVE SAYS SO IN ITS LOG, ONCE, WITH THE REASON (ddjp_621).
//
// In the owner's test the bot's tab was not live on and off for about 25 minutes (14:57–15:39). Every sweep said
// "refused — not-live" and REP said "still catching up", and the log never said WHY. Session knew every time: each phase
// change goes through its one mutator with a reason. Nothing wrote it down.
//
//   PART A — every phase change is ONE info line naming the new phase, the one it left, and the reason in words: a sleep, with
//            the silence in seconds; the sign of life that ended it; the connection; the browser offline and online; the
//            replay; caught up.
//   PART B — ONCE PER CHANGE. A hidden tab's beats a minute apart while the server answers, a sign of life that is itself a
//            sleep while suspended, a repeated connection report, a beat while live: no change, so no line.
//   PART C — becoming live again says how long the tab was not live.
//   PART D — a tab in the lobby (no room) has no phase change and so no line (J83 keeps it cold).
// CHANGED AT J68, ON PURPOSE (the owner's decision 1, `ddjp_634`: no tab pauses because it is hidden): the lines for the tab
// hidden and shown are gone with the suspension they named, and the heartbeat's "came N s after the one before" is now the
// sleep's "nothing from its heartbeat or the server for N s". A sleep's suspension waits for a sign of life that is not
// itself a sleep, so the alternating "still late" run of lines no longer happens.
//
// Driven: the real Logger and the real Session in one sandbox, a controllable clock, lines read from the Logger's own
// subscription, as the app's debug log reads them.

const { loadInContext } = require("./_load");

let failures = 0, asserts = 0;
function ok(cond, msg, got) {
  asserts++;
  if (cond) return;
  failures++;
  console.log("[session-log] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

let NOW = 1000000, HEAD = 0;
const sb = loadInContext(["core/logger.js", "backends/backend1/session.js"], { Date: Date });
const { Session, Logger } = sb;
let net = null;
Session.attach({
  now: () => NOW, setInterval: () => 1, clearInterval: () => {}, headCount: () => HEAD, settleMs: () => 500,
  onConnectivity: (fn) => { net = fn; },
});
const lines = [];
Logger.on((e) => { if (/^Session: /.test(String(e.message))) lines.push({ level: e.level, text: String(e.message) }); });
const changes = [];
Session.onChange((ev) => changes.push(ev.from + ">" + ev.to));
Session.start();
const beat = (ms) => { NOW += ms; Session._beatForTest(); };
const answer = (ms) => { NOW += ms; Session.serverAnswered(); };
const since = (n) => lines.slice(n).map((l) => l.text);
const settle = () => { beat(5000); beat(5000); };   // the head stays put: the first beat opens the settle, the next closes it

// ═══ PART D — the lobby: no room, so nothing changes and nothing is said ═══
answer(20000); beat(120000); beat(5000); Session.connectionLost(); Session.connectionBack();
ok(lines.length === 0 && Session.phase() === "cold", "D: a tab with no room stays cold through an answer, a sleep and its connection, and logs nothing", lines);

// ═══ PART A — each change, one info line, with its reason ═══
let n = lines.length;
Session.enterRoom("!room:hs");
ok(since(n).length === 1 && /replaying/.test(since(n)[0]) && /entered the room/.test(since(n)[0]),
  "A: entering a room says it is replaying, because the room was entered", since(n));
n = lines.length; Session.replayFinished();
ok(since(n).length === 1 && /catching up/.test(since(n)[0]) && /replay/.test(since(n)[0]),
  "A: replay finishing says it is catching up, because the replay finished", since(n));
n = lines.length; settle();
ok(Session.phase() === "live" && since(n).length === 1 && /: live\b/.test(since(n)[0]) && /caught up/.test(since(n)[0]),
  "A: settling says it is LIVE, because it caught up", since(n));
ok(/was catching up/.test(since(n)[0]), "A: and names the phase it left", since(n));

// ═══ PART B — hidden, the beats a minute apart while the server answers every 30 s: no change, no line ═══
const nHidden = lines.length;
for (let i = 0; i < 4; i++) { answer(30000); beat(30000); }
ok(lines.length === nHidden && Session.phase() === "live",
  "B: a hidden tab's beats a minute apart, with the server answering between them, change nothing and log nothing", since(nHidden));

// The sleep: sixteen minutes with nothing from the heartbeat or the server.
n = lines.length; beat(16 * 60000);
ok(Session.phase() === "suspended" && since(n).length === 1 && /was live/.test(since(n)[0]) && /nothing from its heartbeat or the server for 960 s/.test(since(n)[0]) &&
  /slept|frozen/.test(since(n)[0]),
  "A: a sleep says it is suspended because nothing came from its heartbeat or the server for 960 s, and that it was live", since(n));
n = lines.length; beat(100000);
ok(lines.length === n && Session.phase() === "suspended",
  "B: a sign of life that is itself a sleep, while suspended, changes nothing and says nothing", since(n));
n = lines.length; answer(20000);
ok(since(n).length === 1 && /catching up/.test(since(n)[0]) && /the server answered again, 20 s after the last sign of life/.test(since(n)[0]),
  "A: the next sign — an answer — says it is catching up because the server answered again, 20 s after the last sign of life", since(n));
n = lines.length; answer(30000);
ok(since(n).length === 1 && /: live\b/.test(since(n)[0]),
  "A: and settling on the next answer makes it live again, in one line", since(n));
// ═══ PART C — the live line says how long it was not live ═══
ok(/not live for 2 min 30 s/.test(since(n)[0]),
  "C: becoming live again says how long the tab was not live (from the sleep seen to the settle: 100 s, 20 s and 30 s)", since(n));

// The heartbeat ends a sleep too.
n = lines.length; beat(100000);
ok(Session.phase() === "suspended" && since(n).length === 1 && /\b100 s\b/.test(since(n)[0]),
  "A: a shorter sleep says it, naming 100 s", since(n));
n = lines.length; beat(5000);
ok(since(n).length === 1 && /catching up/.test(since(n)[0]) && /the heartbeat ran again, 5 s after the last sign of life/.test(since(n)[0]),
  "A: a beat on time says it is catching up because the heartbeat ran again, 5 s after the last sign of life", since(n));
n = lines.length; settle();
ok(since(n).length === 1 && /: live\b/.test(since(n)[0]), "A: and then live", since(n));
n = lines.length; beat(5000); beat(5000);
ok(lines.length === n, "B: beats while live change nothing and say nothing", since(n));

// The connection.
n = lines.length; Session.connectionLost(); Session.connectionLost();
ok(since(n).length === 1 && /suspended/.test(since(n)[0]) && /connection/.test(since(n)[0]),
  "A+B: a lost connection says it is suspended because the connection dropped — once, though reported twice", since(n));
n = lines.length; Session.connectionBack(); Session.connectionBack();
ok(since(n).length === 1 && /catching up/.test(since(n)[0]) && /connection/.test(since(n)[0]),
  "A+B: and its return, once", since(n));
n = lines.length; net(false);
ok(since(n).length === 1 && /suspended/.test(since(n)[0]) && /offline/.test(since(n)[0]), "A: the browser going offline says so", since(n));
n = lines.length; net(true);
ok(since(n).length === 1 && /catching up/.test(since(n)[0]) && /online/.test(since(n)[0]), "A: and coming back online says so", since(n));
settle();
n = lines.length; Session.leaveRoom();
ok(since(n).length === 1 && /cold/.test(since(n)[0]) && /left the room/.test(since(n)[0]), "A: leaving says it is cold, because the room was left", since(n));

// The whole run: one line per change, every one at info.
ok(lines.length === changes.length, "B: EXACTLY ONE LINE PER PHASE CHANGE across the whole run", { lines: lines.length, changes: changes.length });
ok(lines.every((l) => l.level === "info"), "A: every line is at info level, so the owner's ordinary log shows it", lines.filter((l) => l.level !== "info"));

if (failures) { console.log("[session-log] " + failures + " FAILED of " + asserts); process.exit(1); }
console.log("[session-log] PASS — a tab says in its log when it stops or starts being live, once per change and with the reason (" +
  asserts + " assertions): entering a room, the replay finishing, catching up, a sleep with its silence in seconds, the answer " +
  "or the beat that ended it, the connection dropping and returning, the browser offline and online, and leaving — each one " +
  "info line naming the new phase and the one it left. A hidden tab's throttled beats with the server answering, a sleep while " +
  "already suspended, a repeated signal, and beats while live say nothing, and becoming live again says how long the tab was not live.");
