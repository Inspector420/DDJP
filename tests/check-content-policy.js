// tests/check-content-policy.js
// WALL: the external-content allowlist. These validators are the LOAD GATE that
// enforces the privacy posture — "user -> trusted external provider only, never
// an attacker-controlled host." Nothing is ever fetched or rendered unless it
// passes here, so the gate must reject every non-https scheme, every host that
// isn't an exact allowlisted domain or a real subdomain of one (no lookalikes),
// embedded credentials, and every disallowed extension. Pure functions; this
// exercises Media.isAllowedBgUrl / isAllowedChatGifUrl directly.

const { loadInContext } = require("./_load");
const sb = loadInContext(["features/media.js"], { URL, MatrixBridge: {}, StorageIO: {} });
const M = sb.Media;

let failed = 0;
function check(desc, got, want) {
  if (got !== want) { console.log("  ✗ " + desc + " — got " + JSON.stringify(got) + ", want " + JSON.stringify(want)); failed++; }
}

// --- Background: PNG/JPEG from imgur / postimages only ---
check("bg imgur png ok",              M.isAllowedBgUrl("https://i.imgur.com/abc.png"), true);
check("bg imgur jpg ok",              M.isAllowedBgUrl("https://i.imgur.com/abc.jpg"), true);
check("bg imgur jpeg ok",             M.isAllowedBgUrl("https://i.imgur.com/abc.jpeg"), true);
check("bg postimg.cc png ok",         M.isAllowedBgUrl("https://i.postimg.cc/x/y.png"), true);
check("bg postimages.org png ok",     M.isAllowedBgUrl("https://postimages.org/x/y.png"), true);
check("bg query string tolerated",    M.isAllowedBgUrl("https://i.imgur.com/abc.png?cache=1"), true);
check("bg GIF rejected (bg=png/jpeg)",M.isAllowedBgUrl("https://i.imgur.com/abc.gif"), false);
check("bg tenor not a bg host",       M.isAllowedBgUrl("https://media.tenor.com/x.png"), false);
check("bg giphy not a bg host",       M.isAllowedBgUrl("https://media.giphy.com/x.png"), false);
check("bg svg rejected",              M.isAllowedBgUrl("https://i.imgur.com/x.svg"), false);
check("bg no extension rejected",     M.isAllowedBgUrl("https://i.imgur.com/abc"), false);

// --- Chat: GIF from imgur / postimages / tenor / giphy ---
check("chat imgur gif ok",            M.isAllowedChatGifUrl("https://i.imgur.com/abc.gif"), true);
check("chat tenor gif ok",            M.isAllowedChatGifUrl("https://media.tenor.com/abc.gif"), true);
check("chat giphy gif ok",            M.isAllowedChatGifUrl("https://media.giphy.com/media/x/giphy.gif"), true);
check("chat postimg gif ok",          M.isAllowedChatGifUrl("https://i.postimg.cc/x/y.gif"), true);
check("chat png not a chat gif",      M.isAllowedChatGifUrl("https://i.imgur.com/abc.png"), false);
check("chat tenor page (no .gif)",    M.isAllowedChatGifUrl("https://tenor.com/view/something-123"), false);
check("chat random host rejected",    M.isAllowedChatGifUrl("https://example.com/x.gif"), false);

// --- Scheme / host / injection hardening (applies to both) ---
check("javascript: scheme blocked",   M.isAllowedChatGifUrl("javascript:alert(1)//x.gif"), false);
check("data: uri blocked",            M.isAllowedChatGifUrl("data:image/gif;base64,AAAA"), false);
check("http (non-https) blocked",     M.isAllowedChatGifUrl("http://i.imgur.com/x.gif"), false);
check("lookalike suffix blocked",     M.isAllowedChatGifUrl("https://i.imgur.com.evil.com/x.gif"), false);
check("lookalike prefix blocked",     M.isAllowedChatGifUrl("https://evilimgur.com/x.gif"), false);
check("credentials in url blocked",   M.isAllowedChatGifUrl("https://user:pass@i.imgur.com/x.gif"), false);
check("garbage blocked",              M.isAllowedChatGifUrl("not a url"), false);
check("empty blocked",                M.isAllowedChatGifUrl(""), false);
check("non-string blocked",           M.isAllowedChatGifUrl(null), false);

// safeUrl returns the normalized href for valid input, null otherwise.
check("safeChatGifUrl returns href",  M.safeChatGifUrl("https://i.imgur.com/abc.gif"), "https://i.imgur.com/abc.gif");
check("safeBgUrl null on bad host",   M.safeBgUrl("https://evil.com/x.png"), null);

if (failed > 0) {
  console.log("[content-policy] FAIL — " + failed + " case(s) wrong");
  process.exit(1);
}
console.log("[content-policy] PASS — allowlist rejects bad scheme/host/extension; bg=png/jpeg, chat=gif, lookalikes blocked");
process.exit(0);
