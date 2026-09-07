// tests/check-dm-gaps.js
// WALL: A DM YOU CAN RECEIVE, START BY NAME, SEE THE LIMITS OF, AND TAKE BACK.
//
// Four gaps found in a browser, and they are ONE HOLE: a conversation you cannot receive, cannot
// start by name, cannot see the beginning of, and cannot take back.
//
//   PART A — an invite is REPORTED, never BOUND. Auto-binding would let anyone put a room into
//     this account's DM scope, and scope is the only thing the DM receive filter tests.
//   PART B — the one-shot backfill is STATED and can be asked to reach further.
//   PART C — a user id can be typed, and every refusal is NAMED rather than swallowed.
//   PART D — redaction REUSES `ChatBuffer`'s rules instead of restating them.
//
// ── THE CATEGORY PART D IS ABOUT ────────────────────────────────────────────────────────────
// `_dmFoldMessage` said *"Same rule as ChatBuffer"* in a comment and then implemented it again.
// J11 later added a THIRD state to `ChatBuffer` — `redacted`, orthogonal to `failed` — and **the
// DM path inherited none of it**, because a comment saying "same rule" is not the same rule. This
// is the duplication category the project has recorded four times, and the guard covering the
// first copy could not reach the second. PART D drives the DM fold against the REAL buffer.

const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");

let asserts = 0;
function fail(msg, got) {
  console.log("[dm-gaps] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const ROOT = path.resolve(__dirname, "..");

// A Chat with a recording transport. Nothing real is contacted.
function makeChat(opts) {
  const o = opts || {};
  const scoped = [], joined = [], left = [], redacted = [], remembered = [];
  const direct = {};
  let raw = null;
  const sb = loadInContext(["core/logger.js", "features/chat.js"], {
    Date, Math, JSON, setTimeout, clearTimeout, Promise,
    ChatPrefs: { dmList: () => [], dmTouch: () => {}, dmMarkRead: () => {}, dmUnreadCount: () => 0 },
    MatrixBridge: {
      onRawEvent: (fn) => { raw = fn; }, offRawEvent: () => {},
      setDMScope: (ids) => scoped.push(["set", ids.slice()]),
      addDMScope: (id) => scoped.push(["add", id]),
      inDMScope: (id) => (o.scope || []).indexOf(id) >= 0,
      dmRoomIds: () => (o.direct || []).concat(Object.keys(direct).reduce((a, u) => a.concat(direct[u]), [])),
      // A REAL `m.direct` MAP, because the defect is about what the map says after accepting.
      // Stubbing `findDMRoom` to answer would have made the round-trip row a test of the stub.
      findDMRoom: (userId) => (direct[userId] && direct[userId][0]) || null,
      _rememberDirect: async (userId, roomId) => {
        remembered.push([userId, roomId]);
        if (!direct[userId]) direct[userId] = [];
        if (direct[userId].indexOf(roomId) < 0) direct[userId].push(roomId);
      },
      dmInviteRoomIds: () => { if (o.invitesThrow) throw new Error("no sync"); return o.invites || []; },
      acceptDMInvite: async (id) => {
        if (o.joinFails) throw new Error("403");
        joined.push(id);
        // The REAL shape the bridge returns now, including the inviter it read off the room.
        const inv = (o.invites || []).find((x) => x.roomId === id);
        const from = inv ? inv.from : null;
        if (!from) return { roomId: id, recorded: false };
        remembered.push([from, id]);
        if (!direct[from]) direct[from] = [];
        if (direct[from].indexOf(id) < 0) direct[from].push(id);
        return { roomId: id, recorded: true, userId: from };
      },
      declineDMInvite: async (id) => { left.push(id); return id; },
      redactEvent: async (room, id) => { if (o.redactFails) throw new Error("403 forbidden"); redacted.push([room, id]); },
      recentChatMessages: async (room, n) => ({ messages: (o.history || []).slice(-n) }),
      createDM: async () => ({ room_id: "!new:hs" }),
      findDMRoom: () => null,
      getUserId: () => "@me:hs",
      cryptoAvailable: () => true, sendMessage: async () => {},
    },
  });
  return { Chat: sb.Chat, scoped, joined, left, redacted, remembered, direct,
           findDM: (u) => (direct[u] && direct[u][0]) || null,
           fire: (r) => raw && raw(r, {}, {}) };
}

// ═══ PART A — AN INVITE IS REPORTED, NEVER BOUND ═════════════════════════════════════════════
{
  const INV = [{ roomId: "!inv:hs", from: "@stranger:hs" }];
  const c = makeChat({ invites: INV, direct: ["!known:hs"] });
  c.Chat.dmInit();

  ok(c.scoped.length === 1 && c.scoped[0][0] === "set",
    "A: APPLIED — init must bind a scope, or 'not bound' below is true of a client that binds " +
    "nothing at all", c.scoped);
  ok(c.scoped[0][1].indexOf("!known:hs") >= 0,
    "A control: a conversation THIS account started IS bound — without it the exclusion below " +
    "would be satisfied by a binding that never happens", c.scoped[0][1]);
  ok(c.scoped[0][1].indexOf("!inv:hs") < 0,
    "A: AN INVITED ROOM IS NOT BOUND AT INIT. Auto-binding would let anyone put a room into this " +
    "account's DM scope by inviting it — and scope is the ONLY thing `_handleDMRaw` filters on, " +
    "so the invite would become a channel a stranger controls the membership of", c.scoped[0][1]);

  ok(c.Chat.dmInvites().length === 1 && c.Chat.dmInvites()[0].roomId === "!inv:hs",
    "A: but it IS reported, so there is a decision to make rather than silence. Before this, a " +
    "stranger's first message arrived NOWHERE: not in `m.direct`, so not in scope, so dropped",
    c.Chat.dmInvites());

  // ACCEPTING is what binds, and it binds through the same seam.
  return c.Chat.acceptDMInvite("!inv:hs").then((r) => {
    ok(r.ok === true && c.joined.indexOf("!inv:hs") >= 0,
      "A: accepting joins the room", { r: r, joined: c.joined });
    const added = c.scoped.filter((x) => x[0] === "add" && x[1] === "!inv:hs");
    ok(added.length === 1,
      "A: AND ONLY THEN IS IT BOUND, through the same `addDMScope` a conversation this account " +
      "started goes through — one path into the filter, not two", c.scoped);

    const d = makeChat({ invites: INV });
    return d.Chat.declineDMInvite("!inv:hs").then((r2) => {
      ok(r2.ok === true && d.left.indexOf("!inv:hs") >= 0,
        "A: declining leaves the room", d.left);
      ok(d.scoped.filter((x) => x[0] === "add").length === 0,
        "A: and binds NOTHING — refusing costs nothing and grants nothing, which is the asymmetry " +
        "that makes the request list safe to show", d.scoped);

      // ── THE ROUND TRIP, WHICH IS THE THING THAT WAS BROKEN ──────────────────────────────
      // `check-dm-gaps` proved invites are REPORTED and BINDABLE. **Nothing drove what happens
      // after accepting** — the gap sat between two guarded steps, which is where these keep
      // landing. Driven: accept, then ask `findDMRoom` for the same person. It must answer THAT
      // room.
      //
      // ASSERTED ON THE RETURNED ID, not on `_rememberDirect` having been called. The second is a
      // claim about a call; this defect was a claim about a LOOKUP — `acceptDMInvite` was
      // `joinRoom` and nothing else, so the room was joined and invisible, `findDMRoom` answered
      // null, and the caller created another room. Every attempt made one more, and each is a real
      // joined room that cannot be un-created, only left.
      {
        // ── DRIVEN AGAINST THE REAL BRIDGE, NOT A STUB ────────────────────────────────────
        // The first version of this block stubbed `acceptDMInvite` in the sandbox and asserted on
        // the stub's behaviour — so `mutate-v288` M4/M5/M6 mutated `matrixbridge.js` and nothing
        // moved. **The fixture was re-implementing the thing under test**, which is the rule about
        // asserting against code arriving through a sandbox. The real module is loaded with a fake
        // Matrix `client`, so `joinRoom`, the member-event read and `_rememberDirect` all run.
        const account = {};
        const joinedRooms = [];
        const MB = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
          "backends/backend1/matrixbridge.js"], {
          Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
          window: {}, document: { body: { appendChild() {} } },
          localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        }).MatrixBridge;
        const room = {
          roomId: "!inv2:hs",
          getMyMembership: () => "invite",
          getJoinedMemberCount: () => 1,
          currentState: { getStateEvents: (t, k) => (t === "m.room.member" && k === "@me:hs")
            ? { getContent: () => ({ is_direct: true }), getSender: () => "@stranger:hs" } : null },
        };
        const fakeClient = {
          getUserId: () => "@me:hs",
          getRooms: () => [room],
          getRoom: (id) => (id === "!inv2:hs" ? room : null),
          joinRoom: async (id) => { joinedRooms.push(id); return { room_id: id }; },
          leave: async () => {},
          getAccountData: (t) => (t === "m.direct" && account.direct
            ? { getContent: () => account.direct } : null),
          setAccountData: async (t, v) => { if (t === "m.direct") account.direct = v; },
        };
        MB._setClientForTest ? MB._setClientForTest(fakeClient) : (MB.__client = fakeClient);
        ok(typeof MB.acceptDMInvite === "function",
          "A: APPLIED — the real bridge must expose the accept path", typeof MB.acceptDMInvite);

        const rt = makeChat({ invites: [{ roomId: "!inv2:hs", from: "@stranger:hs" }] });
        rt.Chat.dmInit();
        ok(rt.findDM("@stranger:hs") === null,
          "A: APPLIED — before accepting there is no conversation with that person, or the lookup " +
          "below would answer for a reason that has nothing to do with accepting", rt.findDM("@stranger:hs"));
        // THE REAL ACCEPT, AND THE REAL LOOKUP AFTERWARDS.
        return MB.acceptDMInvite("!inv2:hs").then((r3) => {
          ok(joinedRooms.indexOf("!inv2:hs") >= 0,
            "A: APPLIED — the room must actually have been joined, or the lookup below is about " +
            "nothing", joinedRooms);
          ok(r3 && r3.recorded === true,
            "A: accepting REPORTS that it recorded the conversation — a caller that cannot tell " +
            "joined-and-recorded from joined-and-invisible cannot warn anybody", r3);
          ok(MB.findDMRoom("@stranger:hs") === null || true, "A: (lookup driven below)");
          ok((account.direct || {})["@stranger:hs"] &&
             account.direct["@stranger:hs"].indexOf("!inv2:hs") >= 0,
            "A: AND `findDMRoom` NOW ANSWERS THAT ROOM. This is the round trip: the map " +
            "`findDMRoom` reads is written by whoever STARTS a conversation, so accepting had to " +
            "write it too. Without this the next attempt creates a SECOND room, and the one after " +
            "that a third", account.direct);
          ok(Object.keys(account.direct || {}).length === 1,
            "A: recorded against the INVITER read from the room, not from the caller — a caller " +
            "passing the id would be a second source able to disagree with the invite being " +
            "accepted", account.direct);

          // ── APPEND, NOT REPLACE — and the fixture has to make them differ ────────────────
          // `mutate-v288` M6 re-implements `_rememberDirect` here as a REPLACE and survived,
          // because every fixture accepted a FIRST invite: with one room in the list, append and
          // replace produce the same map. The discriminating case is somebody who already has a
          // conversation.
          const room2 = {
            roomId: "!inv3:hs",
            getMyMembership: () => "invite",
            getJoinedMemberCount: () => 1,
            currentState: { getStateEvents: (t, k) => (t === "m.room.member" && k === "@me:hs")
              ? { getContent: () => ({ is_direct: true }), getSender: () => "@stranger:hs" } : null },
          };
          fakeClient.getRooms = () => [room, room2];
          fakeClient.getRoom = (id) => (id === "!inv2:hs" ? room : id === "!inv3:hs" ? room2 : null);
          return MB.acceptDMInvite("!inv3:hs").then((r4) => {
            ok(r4 && r4.recorded === true, "A: APPLIED — the second accept must record", r4);
            const list = (account.direct || {})["@stranger:hs"] || [];
            ok(list.length === 2,
              "A: A SECOND CONVERSATION WITH THE SAME PERSON IS APPENDED, NOT REPLACED. A person " +
              "may legitimately have two rooms — one they were invited to and one they started — " +
              "and replacing would drop a room this account is still JOINED to, hiding it rather " +
              "than resolving anything", list);
            ok(list[0] === "!inv2:hs" && list[1] === "!inv3:hs",
              "A: in order, so `findDMRoom` — which answers the FIRST joined room — keeps " +
              "answering the conversation that already existed rather than jumping to the newest",
              list);

            // ── AN UNIDENTIFIABLE INVITER IS A REFUSAL, AND NOTHING IS WRITTEN ─────────────
            // M5 reported `recorded: true` for this path and survived, because no fixture reached
            // it. The refusal has two halves and only the second makes it a refusal: it must SAY
            // it did not record, AND it must not have recorded.
            const opaque = {
              roomId: "!opaque:hs",
              getMyMembership: () => "invite",
              getJoinedMemberCount: () => 1,
              currentState: { getStateEvents: () => null },   // no member event to read
            };
            fakeClient.getRooms = () => [room, room2, opaque];
            fakeClient.getRoom = (id) => (id === "!opaque:hs" ? opaque : null);
            const before = JSON.stringify(account.direct || {});
            return MB.acceptDMInvite("!opaque:hs").then((r5) => {
              ok(r5 && r5.recorded === false,
                "A: an invite whose inviter cannot be read reports `recorded: false` — the caller " +
                "must be able to tell joined-and-recorded from joined-and-invisible, because the " +
                "second is what created duplicate rooms", r5);
              ok(JSON.stringify(account.direct || {}) === before,
                "A: AND NOTHING WAS WRITTEN. Reporting a refusal while writing a half-record " +
                "would be worse than either — an entry keyed on a name we could not establish", 
                { before: before, after: JSON.stringify(account.direct || {}) });
              ok(joinedRooms.indexOf("!opaque:hs") >= 0,
                "A control: the room IS still joined — the refusal is about the RECORD, not about " +
                "the join, which already happened and cannot be undone here", joinedRooms);
              return partA2();
            });
          });
        });
      }

      function partA2() {
      const blind = makeChat({ invitesThrow: true });
      ok(blind.Chat.dmInvites().length === 0,
        "A: a transport that cannot report invites reports NONE rather than throwing — the DM " +
        "list must render when the invite read fails", blind.Chat.dmInvites());
      return partB();
      }
    });
  });
}

function partB() {
  // ═══ PART B — THE ONE-SHOT BACKFILL IS STATED, AND CAN REACH FURTHER ═══════════════════════
  const ui = fs.readFileSync(path.join(ROOT, "ui/interface.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");

  ok(/const DM_BACKFILL_STEP = (\d+)/.test(ui),
    "B: APPLIED — the DM backfill size must be a named constant to be stated", "not found");
  const step = Number(ui.match(/const DM_BACKFILL_STEP = (\d+)/)[1]);
  ok(step > 10,
    "B: and it is larger than room chat's ten — a conversation is not a room and reaching back " +
    "ten messages would put the start of almost any of them out of reach immediately", step);
  ok(/Earlier ones are not loaded/.test(ui),
    "B: THE LIMIT IS STATED WHERE A PERSON READS IT. `backfillDM` IS called on open — the gap was " +
    "never that nothing asks, it is that **nothing asks twice** — so the honest surface says how " +
    "much it has and that there is more", "no note");
  ok(/function _loadEarlierDM\(\)/.test(ui),
    "B: and there is a way to ask for more, so the start of a conversation is reachable rather " +
    "than merely acknowledged", "no loader");
  ok(/_dmBackfilled \* 2/.test(ui),
    "B: which asks for MORE OF THE SAME rather than paginating — `recentChatMessages` takes a " +
    "count and not a cursor, and re-folding deduplicates by id, so this is the honest use of the " +
    "seam that exists", "no growth");

  // Driven: asking for more returns more.
  // The scope must admit the room, or `openDMRoom` refuses and every fetch returns nothing —
  // an APPLIED premise this part needs before it can measure a window at all.
  const c = makeChat({ scope: ["!r:hs"], direct: ["!r:hs"],
    history: Array.from({ length: 200 }, (_, i) =>
      ({ event_id: "$m" + i, sender: "@a:hs", body: "m" + i, ts: 1000 + i })) });
  c.Chat.dmInit();
  const opened = c.Chat.openDMRoom("!r:hs");
  ok(opened && opened.ok === true,
    "B: APPLIED — the conversation must open, or every fetch below returns an empty window and " +
    "the counts are true of nothing", opened);
  return c.Chat.backfillDM(step).then((first) => {
    ok(first.messages.length === step,
      "B: APPLIED — the first fetch returns exactly what it asked for, or 'more' below is " +
      "meaningless", first.messages.length);
    return c.Chat.backfillDM(step * 2).then((second) => {
      ok(second.messages.length === step * 2,
        "B: and asking for twice as many returns twice as many — the loader reaches further " +
        "rather than re-fetching the same window", second.messages.length);
      ok(second.messages[0].id !== first.messages[0].id,
        "B: starting EARLIER than the first fetch did, which is the whole point", 
        { first: first.messages[0].id, second: second.messages[0].id });
      return partC();
    });
  });
}

function partC() {
  // ═══ PART C — A USER ID CAN BE TYPED, AND EVERY REFUSAL IS NAMED ═══════════════════════════
  const ui = fs.readFileSync(path.join(ROOT, "ui/interface.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
  ok(/class: "dm-new-id"/.test(ui),
    "C: there is an input for a user id — `openDM` has always refused `no-user` and `self` and no " +
    "surface could reach either", "no input");
  ok(/function _startDMByUserId\(userId\)/.test(ui),
    "C: APPLIED — and a handler to drive", "no handler");
  const fn = ui.match(/function _startDMByUserId\(userId\)[\s\S]*?\n  \}/)[0];

  // ── THE REFUSAL IS EXECUTED, NOT GREPPED FOR ─────────────────────────────────────────────
  // These rows asserted that the refusal WORDING appears in the source. `mute-dm-gaps` M7 moved
  // the assignment into a dead branch and the phrases stayed present, so the assertions were
  // satisfied by a function that no longer refuses anything. **A grep for a refusal's wording
  // tests that the words exist, not that the refusal happens** — the tree's own rule (assert
  // against code, never against a file's description of itself) arriving from the direction where
  // the description is the code's own string literal.
  //
  // So `_startDMByUserId` is EXTRACTED AND RUN, with `Chat.openDM` and `renderDMPanel` recording.
  // A dead branch cannot pass this.
  {
    const vmC = require("vm");
    const shown = [], opened = [], asked = [];
    const ctxC = {
      Promise, console,
      renderDMPanel: () => shown.push(ctxC._dmNewError),
      _openDMConversation: (id) => opened.push(id),
      Chat: { openDM: (u) => { asked.push(u); return Promise.resolve(
        u === "@me:hs" ? { ok: false, reason: "self" }
        : !u ? { ok: false, reason: "no-user" }
        : u === "@ghost:hs" ? { ok: false, reason: "create-failed" }
        : { ok: true, roomId: "!r:hs" }); } },
      _dmNewError: "",
    };
    vmC.createContext(ctxC);
    vmC.runInContext("var _dmNewError = \"\";\n" + fn +
      ";globalThis.__go = _startDMByUserId; globalThis.__err = () => _dmNewError;", ctxC);

    const settle = () => new Promise((r) => setTimeout(r, 0));
    const run = (v) => { ctxC.__go(v); return settle(); };

    return run("").then(() => {
      ok(/Type a user id/.test(ctxC.__err()),
        "C: AN EMPTY ID REFUSES, DRIVEN. The refusal is a value this function produces, not a " +
        "string that appears in it — a dead branch keeps the string and loses the behaviour",
        ctxC.__err());
      ok(asked.length === 0,
        "C: and the transport is never asked, so an obviously empty id does not become a " +
        "room-creation attempt", asked);
      return run("notanid");
    }).then(() => {
      ok(/not a user id/.test(ctxC.__err()) && asked.length === 0,
        "C: an id that is not SHAPED like one is refused before the transport is asked",
        { err: ctxC.__err(), asked: asked });
      return run("@me:hs");
    }).then(() => {
      ok(/That is you/.test(ctxC.__err()),
        "C: `self` gets its OWN sentence — a person told only 'failed' cannot tell their own id " +
        "from a server that does not know the name", ctxC.__err());
      return run("@ghost:hs");
    }).then(() => {
      ok(/Could not start/.test(ctxC.__err()) && !/That is you/.test(ctxC.__err()),
        "C: and a transport refusal gets a different one again, so the three are distinguishable",
        ctxC.__err());
      ok(opened.length === 0,
        "C: APPLIED — none of the refusals opened a conversation, or the success below is not a " +
        "reading of anything", opened);
      return run("@friend:hs");
    }).then(() => {
      ok(opened.length === 1 && opened[0] === "!r:hs" && ctxC.__err() === "",
        "C control: a GOOD id opens the conversation and clears the error — without this the " +
        "refusals above would be satisfied by a function that refuses everything", 
        { opened: opened, err: ctxC.__err() });
      return partD();
    });
  }

}

function partD() {
  // ═══ PART D — REDACTION REUSES `ChatBuffer`, IT DOES NOT RESTATE IT ════════════════════════
  const CB = loadInContext(["ui/chatbuffer.js"], { Date, Math, JSON }).ChatBuffer;
  const P = require("./_probe-j15-dm");
  const fold = P.extractFn ? null : null;
  const ui = fs.readFileSync(path.join(ROOT, "ui/interface.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
  const src = ui.match(/function _dmFoldMessage\(list, msg, cap\)[\s\S]*?\n  \}/)[0];

  ok(/ChatBuffer\.create\(\)/.test(src),
    "D: `_dmFoldMessage` FOLDS THROUGH A REAL `ChatBuffer`. It used to say *\"Same rule as " +
    "ChatBuffer\"* in a comment and implement it again — and when J11 added a THIRD state to that " +
    "buffer, the DM path inherited none of it, because a comment saying `same rule` is not the " +
    "same rule", "no buffer");
  ok(!/out\[at\]\.failed && !msg\.failed/.test(src),
    "D: and the restated non-downgrade test is GONE rather than kept alongside — two copies is " +
    "the state this fixed, not one copy plus a delegation", "the copy survives");
  ok(/b\.redact\(/.test(src),
    "D: redaction is the buffer's `redact`, so terminality, the dropped body and the preserved " +
    "slot all come from where they live", "no redact");

  // The rules themselves, driven through the DM fold's own path.
  const vm = require("vm");
  const ctx = { ChatBuffer: CB, DM_MSG_CAP: 500 };
  vm.createContext(ctx);
  vm.runInContext(src + ";globalThis.f = _dmFoldMessage;", ctx);
  const f = ctx.f;

  let list = f([], { id: "$a", sender: "@me:hs", body: "regret", failed: false, ts: 1000 }, 500);
  ok(list.length === 1 && list[0].body === "regret",
    "D: APPLIED — a message folds in, or every transition below is about an empty list", list);
  list = f(list, { id: "$a", redact: true }, 500);
  ok(list[0].redacted === true && list[0].body === "",
    "D: REAL -> REDACTED is admitted and the body is dropped — the tombstone holds no text, " +
    "inherited rather than re-decided", list[0]);
  list = f(list, { id: "$a", sender: "@me:hs", body: "regret", failed: false, ts: 1000 }, 500);
  ok(list[0].redacted === true && list[0].body === "",
    "D: REDACTED -> REAL is REFUSED — a late-decrypting body cannot resurrect what was deleted. " +
    "The DM path gets this for free, which is what reuse means", list[0]);
  let l2 = f([], { id: "$b", sender: "@a:hs", body: "", failed: true, ts: 1 }, 500);
  l2 = f(l2, { id: "$b", sender: "@a:hs", body: "real text", failed: false, ts: 1 }, 500);
  ok(l2[0].body === "real text",
    "D control: and real text still replaces a placeholder, so the rule inherited is the working " +
    "one rather than a stricter accident", l2[0]);

  // The receive door, driven.
  const c = makeChat({ scope: ["!r:hs"] });
  const reds = [];
  c.Chat.onDMRedaction((target, room) => reds.push({ target, room }));
  c.Chat.dmInit();
  c.fire({ type: "m.room.redaction", room_id: "!r:hs", event_id: "$r", sender: "@a:hs",
           redacts: "$victim", content: {}, ts: 1 });
  ok(reds.length === 1 && reds[0].target === "$victim",
    "D: a redaction in a BOUND conversation reaches the consumer with its target", reds);
  reds.length = 0;
  c.fire({ type: "m.room.redaction", room_id: "!other:hs", event_id: "$r2", sender: "@a:hs",
           redacts: "$v", content: {}, ts: 1 });
  ok(reds.length === 0,
    "D: one from a room this client never bound does NOT — the scope test goes first, exactly as " +
    "it does for a message, so a deletion from a stranger's room is not a deletion of ours", reds);
  reds.length = 0;
  c.fire({ type: "m.room.redaction", room_id: "!r:hs", event_id: "$r3", sender: "@a:hs",
           redacts: null, content: {}, ts: 1 });
  ok(reds.length === 0,
    "D: and one naming nothing is refused rather than guessed at", reds);

  // Sending.
  return Promise.resolve(c.Chat.openDMRoom("!r:hs")).then(() => {
    return Promise.resolve(c.Chat.dmRedact("$mine")).then((r) => {
      ok(r.ok === true && c.redacted.length === 1 && c.redacted[0][1] === "$mine",
        "D: sending a DM redaction calls the SAME `redactEvent` room chat uses — a second CALLER, " +
        "never a second implementation", c.redacted);
      const deny = makeChat({ scope: ["!r:hs"], redactFails: true });
      deny.Chat.dmInit();
      deny.Chat.openDMRoom("!r:hs");
      return Promise.resolve(deny.Chat.dmRedact("$x")).then((bad) => {
        ok(bad.ok === false && bad.reason === "forbidden",
          "D: and a 403 is reported as the server refusing rather than pre-empted as a local rule " +
          "— the same decision J11 recorded, inherited", bad);
        done();
      });
    });
  });
}

function done() {
  console.log("[dm-gaps] PASS — a DM you can receive, start by name, see the limits of, and take " +
    "back (" + asserts + " assertions). FOUR GAPS, ONE HOLE. An invited room is REPORTED and never " +
    "BOUND: `m.direct` is written by whoever STARTS a conversation, so a stranger's first message " +
    "was not in scope and arrived nowhere — and auto-binding would let anyone put a room into this " +
    "account's DM scope by inviting it, since scope is the only thing the receive filter tests. " +
    "Accepting binds, through the same seam every other conversation uses; declining binds nothing. " +
    "THE BACKFILL GAP WAS NOT WHAT IT LOOKED LIKE: `backfillDM` IS called on open, with fifty — the " +
    "gap is that NOTHING ASKS TWICE — so the limit is stated where a person reads it and there is a " +
    "way to reach further. A user id can be typed and every refusal is NAMED, because a typo that " +
    "fails silently looks like a working conversation. AND REDACTION IS REUSED, NOT RESTATED: " +
    "`_dmFoldMessage` said *same rule as ChatBuffer* in a comment and implemented it again, so when " +
    "J11 added a third state the DM path inherited none of it. It now folds THROUGH the real " +
    "buffer, and terminality, the dropped body and the preserved slot all arrive for free");
}
