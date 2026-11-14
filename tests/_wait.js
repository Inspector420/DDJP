// tests/_wait.js
// THE ROOM'S ONE WAIT, CHANGED WHERE IT IS DEFINED — a harness, not a guard (`ddjp_711`). The owner's words: "can we build the
// machinery for the 3 second wait but set it to zero". The wait is one number in the reducer (`END_WAIT_MS`), read by every
// screen and by the bot through the advance view's `endsAt`; a guard proves turning it up is a one-number change by loading
// the REAL reducer with that number changed and nothing else, and folding a room through it.
//
//   reducerWithWait(ms) → the real StateDeriver with `END_WAIT_MS` = ms (null if the definition is not there exactly once)
//   foldedRoom(SD, sec, extraSettings, t0) → { state, pi }: one song from t0 (default T0), its length `sec` declared at staff
//                                            rank (none when `sec` is not a number), folded by SD
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeBackendsStub, ROOT } = require("./_load");
const F = require("./_fixtures");

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const ONE = "const END_WAIT_MS = 0;";
const T0 = 100000;
function reducerWithWait(ms) {
  const src = read("backends/backend1/statederiver.js");
  if (src.split(ONE).length !== 2) return null;
  const sb = { console, Date, Backends: makeBackendsStub() };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(["core/songs.js", "core/logger.js", "backends/backend1/ranks.js"].map(read).join("\n;\n") + "\n;\n" +
    src.replace(ONE, "const END_WAIT_MS = " + ms + ";") + "\n;globalThis.StateDeriver = StateDeriver; globalThis.Logger = Logger;", sb,
    { filename: "statederiver(wait " + ms + ")" });
  for (const k of ["info", "warn", "debug", "error"]) sb.Logger[k] = () => {};
  return sb.StateDeriver;
}
function foldedRoom(SD, sec, extra, t0) {
  const start = (typeof t0 === "number") ? t0 : T0;
  const room = F.playingRoom({ songs: 1, startTs: start });
  const pi = room.pi(0);
  const log = [F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: Object.assign(SD.defaultSettings(), extra || {}) })]
    .concat(room.log.map((e) => F.reducerEvent(e.eventId, e.l + 1, e.ts, e.sender, e.senderRank, e.content)));
  if (typeof sec === "number") log.push(F.lenDecl("$len", room.lastL + 2, start + 6000, pi, sec, F.RANK.staff, "@staff:hs"));
  return { state: SD.derive(log), pi };
}
module.exports = { ONE, T0, reducerWithWait, foldedRoom };
