// tools/probes/probe-j12-tiers.js
// J12 — THE MEASUREMENTS THE JOB ENTRY'S DONE-WHEN AND OPEN DID NOT HAVE. Read-only.
//
//   R0  A TIER SWITCH DESTROYED THE BUFFER, and chat is RAM-only — the shape before J12
//   R1  what the only recovery is, and how far short of the buffer it falls
//   R2  the receive filter: why an unread badge was impossible IN PRINCIPLE, not merely unbuilt
//   R3  which definition the renderer obeys today, and how many writers it has
//   R4  `settings.chat` is room truth, so a read marker there would change this job's KIND
//   R5  the resolution: override vs room setting, and who wins
//
// Every row states its preconditions as SEPARATE checks and refuses a reading whose premise did
// not hold. `--selftest` shows the gate refusing and admitting.

const path = require("path");
const fs = require("fs");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "../..");
const { loadInContext } = require(path.join(ROOT, "tests/_load.js"));

let GATE_THROW = false;
function gate(row, checks) {
  for (const c of checks) {
    if (!c.ok) {
      const msg = "[probe-j12] INADMISSIBLE " + row + " — " + c.why +
        "\n      the reading never reached its subject, so nothing it says would mean anything";
      if (GATE_THROW) throw new Error(msg);
      console.log(msg);
      return false;
    }
  }
  return true;
}

const SRC = fs.readFileSync(path.join(ROOT, "ui/interface.js"), "utf8");
function fnSrc(name, src) {
  const s = src || SRC;
  const a = "function " + name + "(";
  const i = s.indexOf(a);
  if (i < 0) return null;
  const o = s.indexOf("{", s.indexOf(")", i));
  let d = 0;
  for (let j = o; j < s.length; j++) {
    if (s[j] === "{") d++;
    else if (s[j] === "}") { d--; if (!d) return s.slice(i, j + 1); }
  }
  return null;
}

function run() {
  console.log("=== J12 — per-tier chat views and unread badges. Read-only measurements. ===\n");

  // ── R0 / R1 — the buffer, and the recovery ────────────────────────────────────────────────
  {
    const cb = loadInContext(["ui/chatbuffer.js"], { Date, Math, JSON });
    const names = ["_newChatState", "_chatStates", "_chatState", "_allChatStates", "_resetChatState"];
    const srcs = names.map((n) => fnSrc(n));
    if (gate("R0", [
      { ok: srcs.every(Boolean), why: "one of the chat-state declarations could not be extracted" },
    ])) {
      const sb = { console, Math, JSON, Date, ChatBuffer: cb.ChatBuffer };
      sb.globalThis = sb; vm.createContext(sb);
      vm.runInContext(srcs.join("\n") + ";globalThis.__st=_chatState;globalThis.__reset=_resetChatState;", sb);
      const box = {};
      const main = sb.__st(box, "uncategorized");
      for (let i = 0; i < 120; i++) main.buf.upsert("$m" + i, "@a:hs", "m" + i, false, 1000 + i);
      const again = sb.__st(box, "uncategorized");
      console.log("R0  A TIER SWITCH, UNDER THE SHAPE J12 BUILT.");
      console.log("    120 messages in; ask for the same tier again -> " + again.buf.size() +
        " held, same buffer object? " + (again === main));
      sb.__reset(box);
      console.log("    and a ROOM change still clears it -> " + sb.__st(box, "uncategorized").buf.size() + " held");
      console.log("    >>> BEFORE J12 THIS WAS ONE BUFFER ON THE BOX, and a tier change ran");
      console.log("        `_resetChatState`, which replaced it. 120 in, 0 out, permanently.");

      const cap = (fs.readFileSync(path.join(ROOT, "ui/chatbuffer.js"), "utf8").match(/const CAP = (\d+)/) || [])[1];
      const bf = (SRC.match(/const CHAT_BACKFILL = (\d+)/) || [])[1];
      console.log("\nR1  THE ONLY RECOVERY, because chat is RAM-only and never written to Store.");
      console.log("    buffer CAP = " + cap + "   one-shot CHAT_BACKFILL = " + bf);
      console.log("    >>> a switch could destroy up to " + (Number(cap) - Number(bf)) +
        " messages with a " + bf + "-message recovery.");
      console.log("        THE DONE-WHEN — `switching tiers does not lose messages` — was asking");
      console.log("        for something the old shape could not give at any call site.");
    }
  }

  // ── R2 — the receive filter ───────────────────────────────────────────────────────────────
  {
    let captured = null;
    const sb = loadInContext(["core/logger.js", "features/chat.js"], {
      Date, Math, JSON, setTimeout, clearTimeout,
      MatrixBridge: { onRawEvent: (fn) => { captured = fn; }, offRawEvent: () => {},
                      sendMessage: async () => {}, cryptoAvailable: () => true,
                      recentChatMessages: async () => ({ messages: [] }) },
    });
    const seen = [];
    sb.Chat.onMessage((id, s2, b, f, ts, roomId) => seen.push({ id, roomId }));
    sb.Chat.init("!main:hs");
    if (gate("R2", [
      { ok: typeof captured === "function", why: "init registered no raw listener" },
    ])) {
      const msg = (id, room) => ({ type: "m.room.message", room_id: room, event_id: id,
                                   sender: "@a:hs", content: { body: "x" }, ts: 1 });
      captured(msg("$a", "!staff:hs"), {}, {});
      const beforeWiden = seen.length;
      sb.Chat.setReadableTiers(["!main:hs", "!staff:hs"]);
      captured(msg("$b", "!staff:hs"), {}, {});
      console.log("\nR2  WHY AN UNREAD BADGE WAS IMPOSSIBLE IN PRINCIPLE, NOT MERELY UNBUILT.");
      console.log("    active channel only, message from another tier -> forwarded: " + beforeWiden);
      console.log("    readable set widened,   same message           -> forwarded: " + (seen.length - beforeWiden));
      const routeSrc = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
      const fanoutOutside = /if \(!_isChatChannel\(room\) && inScope\(room\.roomId\)\) \{[\s\S]*?\n      \}\n\n      for \(const fn of _rawListeners\)/.test(routeSrc);
      console.log("    and the raw fan-out sits OUTSIDE the in-scope branch: " + fanoutOutside);
      console.log("    >>> THE PLUMBING WAS ALWAYS THERE. `_routeEvent` fans every routed event out");
      console.log("        to the raw listeners unconditionally, so chat from every joined tier was");
      console.log("        ARRIVING and being discarded one line later by `_handleRaw`'s single-");
      console.log("        channel filter. The entry's Open does not mention this, and it is the");
      console.log("        thing that actually blocked the job.");
    }
  }

  // ── R3 — which definition the renderer obeys, and how many writers ────────────────────────
  {
    const chatSrc = fs.readFileSync(path.join(ROOT, "features/chat.js"), "utf8");
    const roomSrc = fs.readFileSync(path.join(ROOT, "features/room.js"), "utf8");
    const setRoomCalls = [...roomSrc.matchAll(/Chat\.setRoom\(([^)]*)\)/g)].map((m) => m[1]);
    if (gate("R3", [
      { ok: setRoomCalls.length > 0, why: "no Chat.setRoom caller found, so there is nothing to count" },
    ])) {
      console.log("\nR3  WHICH DEFINITION THE RENDERER OBEYS.");
      console.log("    Chat._handleRaw filters on the readable set: " + /_readable\.indexOf/.test(chatSrc));
      console.log("    Chat.setRoom callers in features/room.js: " + JSON.stringify(setRoomCalls));
      console.log("    resolver present (`chatTiers`): " + /function chatTiers\(/.test(roomSrc));
      console.log("    >>> ONE writer, reached from TWO callers (a settings change and a view");
      console.log("        switch). Before J12 the channel expression was inline in `_applySettings`");
      console.log("        and a second caller would have needed its own copy — which is exactly");
      console.log("        the P7 collision the Open warns about.");
    }
  }

  // ── R4 — `chat` is room truth ────────────────────────────────────────────────────────────
  {
    const sd = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
      "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
      "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js"], { Date, Math, JSON });
    const d = sd.StateDeriver.defaultSettings();
    const F = require(path.join(ROOT, "tests/_fixtures.js"));
    const seg = F.sortLog(F.playingRoom({ songs: 2 }).log);
    const seed = sd.StateDeriver.buildSeed(seg, null);
    if (gate("R4", [
      { ok: !!d && typeof d.chat === "string", why: "defaultSettings carries no `chat`" },
      { ok: !!(seed && seed.settings), why: "the seed carries no settings blob to fingerprint" },
    ])) {
      const fp = (x) => sd.CheckpointFormat.fingerprint(1, null, x, 10, false, "$a..$b");
      const base = fp(seed);
      const added = JSON.parse(JSON.stringify(seed));
      added.settings.chatReadTs = 5000;
      console.log("\nR4  `settings.chat` IS ROOM TRUTH, AND THAT DECIDES WHERE READ STATE CANNOT GO.");
      console.log("    defaultSettings().chat = " + JSON.stringify(d.chat));
      console.log("    adding ONE settings key moves the checkpoint fingerprint: " + (fp(added) !== base));
      console.log("    >>> a read marker as a room setting reopens the dead-checkpoint window (J45),");
      console.log("        makes this job `derivation`, and puts it on a gate Phase 6 has closed.");
      console.log("        `dials.js` is not an escape — it reads defaultSettings(). So the markers");
      console.log("        live in ChatPrefs, which no backend module references.");
    }
  }

  // ── R5 — the resolution ──────────────────────────────────────────────────────────────────
  {
    const CP = loadInContext(["core/logger.js", "core/storageio.js", "core/idb.js", "core/store.js",
                              "core/chatprefs.js"], {
      localStorage: { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; },
                      setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } },
      Date, Math, JSON, indexedDB: undefined });
    const sb = loadInContext(["core/logger.js", "features/room.js"], {
      Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
      window: {}, document: { body: { appendChild() {} } },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      ChatPrefs: CP.ChatPrefs,
      Chat: { setRoom() {}, setReadableTiers() {}, init() {}, dmInit() {} },
      StreamManager: { getState: () => ({ settings: { chat: "guest" } }), on() {}, getLog: () => [] },
      MatrixBridge: { getUserId: () => "@me:hs", getMyRank: () => 0, getRoster: () => [] },
    });
    sb.Room._setCurrentForTest({ spaceId: "!s:hs",
      channels: { chat_uncategorized: "!u:hs", chat_guest: "!g:hs", chat_staff: "!st:hs" } });
    CP.ChatPrefs.load();
    const rows = [];
    CP.ChatPrefs.setChatTier(null);      rows.push(["no override", sb.Room.chatTiers()]);
    CP.ChatPrefs.setChatTier("staff");   rows.push(["override: staff", sb.Room.chatTiers()]);
    CP.ChatPrefs.setChatTier("nosuch");  rows.push(["override: unreadable", sb.Room.chatTiers()]);
    if (gate("R5", [
      { ok: rows.every((r) => r[1] && r[1].tiers.length === 3), why: "the resolver did not see the room's three chat channels" },
      { ok: new Set(rows.map((r) => r[1].activeTier)).size >= 2, why: "the three cases produced one answer, so nothing is being resolved" },
    ])) {
      console.log("\nR5  THE OPEN, RESOLVED. Two questions, one resolver.");
      for (const [name, r] of rows) {
        console.log("    " + name.padEnd(24) + " mainTier=" + String(r.mainTier).padEnd(14) +
          " activeTier=" + r.activeTier);
      }
      console.log("    >>> `settings.chat` answers WHICH TIER IS THE ROOM'S MAIN CHAT and is never");
      console.log("        written by a view. The device's view is a NULL-ABLE OVERRIDE where null");
      console.log("        means follow the room — so it READS the setting rather than restating it,");
      console.log("        and an override naming a tier this client cannot read falls back rather");
      console.log("        than emptying the view.");
      console.log("\n=== done. The Done-when's first clause and the Open's real blocker are above. ===");
    }
  }
}

function selfTest() {
  GATE_THROW = true;
  const out = [];
  const t = (name, checks, expect) => {
    let refused = false;
    try { gate(name, checks); } catch (e) { refused = true; }
    out.push({ row: name, refused, asExpected: refused === expect });
  };
  t("a premise that failed", [{ ok: false, why: "deliberately false" }], true);
  t("the SECOND premise failed", [{ ok: true, why: "" }, { ok: false, why: "deliberately false" }], true);
  t("an empty-buffer premise, which R0 legitimately has", [{ ok: 0 > 0, why: "held nothing" }], true);
  t("every premise held", [{ ok: true, why: "" }, { ok: true, why: "" }], false);
  t("a sound single premise", [{ ok: 1 > 0, why: "" }], false);
  GATE_THROW = false;
  const bad = out.filter((r) => !r.asExpected);
  console.log("=== probe-j12-tiers --selftest ===");
  for (const r of out) console.log("  " + (r.refused ? "REFUSED " : "ADMITTED") + "  " + r.row +
    (r.asExpected ? "" : "   <<< NOT AS EXPECTED"));
  console.log(bad.length === 0
    ? "  the gate refuses failed premises and admits sound ones — both directions shown."
    : "  GATE IS BROKEN: " + bad.length + " row(s) behaved unexpectedly.");
  process.exit(bad.length === 0 ? 0 : 1);
}

if (process.argv.indexOf("--selftest") >= 0) selfTest();
else run();
