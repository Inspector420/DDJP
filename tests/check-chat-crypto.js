// tests/check-chat-crypto.js
// WALL: E2E chat must fail LOUD, never silent. When crypto didn't initialise, an encrypted
// room refuses the send — that used to throw out of Chat.send as an uncaught rejection and
// the typed message vanished. Chat.send must instead return a { ok:false, reason } STATUS so
// the UI can keep the message and show the "secure chat offline" banner. Also verifies the
// health proxies (cryptoReady / retryCrypto) that ui/ uses (it can't touch MatrixBridge — Rule D).

const { loadInContext } = require("./_load");

function fail(msg, got) {
  console.log("[chat-crypto] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}

// A fake MatrixBridge whose crypto availability + send behaviour we control.
function makeBridge(opts) {
  const state = { cryptoUp: opts.cryptoUp, sent: [], retryCalls: 0 };
  return {
    _state: state,
    onRawEvent() {}, offRawEvent() {},
    cryptoAvailable() { return state.cryptoUp; },
    async retryCrypto() { state.retryCalls++; state.cryptoUp = opts.retrySucceeds; return state.cryptoUp; },
    async sendMessage(roomId, text) {
      // Real matrix-js-sdk throws exactly this when the room is encrypted but the client has no crypto.
      if (!state.cryptoUp) throw new Error("This room is configured to use encryption, but your client does not support encryption.");
      state.sent.push({ roomId, text });
    },
  };
}

(async () => {
  // --- 1) crypto DOWN: send returns a status, does NOT throw, and no message goes out ---
  {
    const bridge = makeBridge({ cryptoUp: false });
    const sb = loadInContext(["core/logger.js", "features/chat.js"], { Date, MatrixBridge: bridge });
    sb.Chat.init("!room:hs");
    let res, threw = false;
    try { res = await sb.Chat.send("hello"); } catch (e) { threw = true; }
    if (threw) fail("Chat.send threw instead of returning a status when crypto is down");
    if (!res || res.ok !== false) fail("Chat.send should return { ok:false } when crypto is down", res);
    if (res.reason !== "no-crypto") fail("Chat.send reason should be 'no-crypto'", res);
    if (bridge._state.sent.length !== 0) fail("nothing should have been sent while crypto is down", bridge._state.sent);
    if (sb.Chat.cryptoReady() !== false) fail("cryptoReady() should be false when crypto is down");
    console.log("[chat-crypto] ok — crypto down: send surfaces { ok:false, reason:'no-crypto' }, no throw, nothing sent");
  }

  // --- 2) crypto UP: send goes through and reports ok ---
  {
    const bridge = makeBridge({ cryptoUp: true });
    const sb = loadInContext(["core/logger.js", "features/chat.js"], { Date, MatrixBridge: bridge });
    sb.Chat.init("!room:hs");
    const res = await sb.Chat.send("hello");
    if (!res || res.ok !== true) fail("Chat.send should return { ok:true } when crypto is up", res);
    if (bridge._state.sent.length !== 1 || bridge._state.sent[0].text !== "hello") fail("message should have been sent once", bridge._state.sent);
    if (sb.Chat.cryptoReady() !== true) fail("cryptoReady() should be true when crypto is up");
    console.log("[chat-crypto] ok — crypto up: send delivers and reports ok:true");
  }

  // --- 3) retryCrypto proxies MatrixBridge and reports the outcome ---
  {
    const bridge = makeBridge({ cryptoUp: false, retrySucceeds: true });
    const sb = loadInContext(["core/logger.js", "features/chat.js"], { Date, MatrixBridge: bridge });
    sb.Chat.init("!room:hs");
    const ok = await sb.Chat.retryCrypto();
    if (ok !== true) fail("Chat.retryCrypto should return true when the bridge recovers", ok);
    if (bridge._state.retryCalls !== 1) fail("retryCrypto should call the bridge exactly once", bridge._state.retryCalls);
    // and now a send should succeed
    const res = await sb.Chat.send("after-retry");
    if (!res || res.ok !== true) fail("send should succeed after a successful retry", res);
    console.log("[chat-crypto] ok — retryCrypto proxies the bridge; send works after recovery");
  }

  console.log("[chat-crypto] PASS — E2E chat fails loud (status, not throw) and recovers via the health proxies");
  process.exit(0);
})();
