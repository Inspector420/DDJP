// tests/check-chat-prefs.js
// WALL: chat display is OPT-IN and host-bounded. Two layers:
//  (A) ChatBuffer.classify(body, opts) is PURE and decides image | link | text
//      from the viewer's prefs. It must: render plain text when a toggle is off
//      (the DEFAULT), only treat a SINGLE bare HTTPS URL specially, accept a host
//      ONLY via the injected allowlist test, require an image extension for an
//      image, and NEVER let a non-https scheme (javascript:/data:/http:) become a
//      live image/href.
//  (B) ChatPrefs models the toggles + host allowlists: images/links/background
//      now default ON (operator choice — load from allowlisted hosts only), the
//      effective allowlist is (defaults the user kept) + (custom hosts), a base
//      host covers its subdomains, mutations persist via Store.prefs and notify
//      onChange (which drives the live re-render). YouTube is the seeded link host.

const { loadInContext } = require("./_load");

let failed = 0;
function ok(c, m) { if (!c) { console.log("[chat-prefs] FAIL — " + m); failed++; } }
function eq(g, w, m) { const a = JSON.stringify(g), b = JSON.stringify(w); if (a !== b) { console.log("[chat-prefs] FAIL — " + m + "\n      got " + a + "\n      want " + b); failed++; } }

// In-memory Store.prefs stub + quiet Logger.
let _saved = null;
const Store = { prefs: { load: () => _saved, save: (o) => { _saved = JSON.parse(JSON.stringify(o)); } } };
const Logger = { warn() {}, info() {}, error() {}, debug() {} };

const { ChatBuffer, ChatPrefs } = loadInContext(["ui/chatbuffer.js", "core/chatprefs.js"], { URL, Store, Logger });

// ===== A) classify is pure + honors opts =====
const allOn  = { imagesOn: true,  linksOn: true,  imageHostAllowed: () => true, linkHostAllowed: () => true };
const allOff = { imagesOn: false, linksOn: false, imageHostAllowed: () => true, linkHostAllowed: () => true };
const K = (b, o) => ChatBuffer.classify(b, o).kind;

ok(K("https://i.giphy.com/a.gif", allOn) === "image", "image when imagesOn + host ok + extension");
ok(K("https://youtube.com/watch?v=x", allOn) === "link", "link when linksOn + host ok");
ok(K("https://i.giphy.com/a.gif", allOff) === "text", "both toggles off -> text (the DEFAULT)");
ok(K("https://i.giphy.com/a.gif", undefined) === "text", "no opts -> text");
ok(K("https://youtube.com/x", { imagesOn: true, linksOn: false, imageHostAllowed: () => true, linkHostAllowed: () => true }) === "text", "link host but linksOff -> text");

// scheme / token discipline
ok(K("http://i.giphy.com/a.gif", allOn) === "text", "http (non-https) -> text");
ok(K("javascript:alert(1)", allOn) === "text", "javascript: scheme can never become a live node");
ok(K("data:text/html,<b>x", allOn) === "text", "data: scheme -> text");
ok(K("https://i.giphy.com/a.gif extra", allOn) === "text", "trailing text -> not a bare token -> text");
ok(K("hello world", allOn) === "text", "plain prose -> text");
ok(K("", allOn) === "text", "empty -> text");

// host gating + precedence + payload shape
const giphyOnly = { imagesOn: true, linksOn: true, imageHostAllowed: (h) => h.endsWith("giphy.com"), linkHostAllowed: () => false };
ok(K("https://evil.com/a.gif", giphyOnly) === "text", "image host not on allowlist -> text");
ok(K("https://i.giphy.com/a.gif", giphyOnly) === "image", "allowlisted image host -> image");
ok(K("https://i.giphy.com/a.gif", allOn) === "image", "image wins over link for an image URL");
eq(ChatBuffer.classify("https://youtu.be/abc", allOn), { kind: "link", href: "https://youtu.be/abc" }, "link result carries href");
eq(ChatBuffer.classify("https://i.giphy.com/a.gif", allOn), { kind: "image", src: "https://i.giphy.com/a.gif" }, "image result carries src");
ok(K("https://giphy.com/gifs/x", { imagesOn: true, linksOn: false, imageHostAllowed: () => true, linkHostAllowed: () => true }) === "text", "image host but no extension + linksOff -> text");

// ===== B) ChatPrefs model =====
_saved = null;
ChatPrefs.load();
ok(ChatPrefs.imagesEnabled() === true, "images master toggle defaults ON (operator choice)");
ok(ChatPrefs.linksEnabled() === true, "links master toggle defaults ON (operator choice)");
ok(ChatPrefs.bgEnabled() === true, "room-background master toggle defaults ON (operator choice)");
eq(ChatPrefs.imageHosts().slice().sort(), ChatPrefs.DEFAULT_IMAGE_HOSTS.slice().sort(), "default effective image hosts = built-in image defaults");
ok(ChatPrefs.linkHosts().indexOf("youtube.com") >= 0, "youtube.com is a seeded default link host");

// pure effective-allowlist math
eq(ChatPrefs.effectiveHosts(["a.com", "b.com"], { "a.com": true }, ["c.com"]).slice().sort(), ["b.com", "c.com"], "effective = defaults-minus-off + custom");

// host normalization
ok(ChatPrefs._normHost("https://www.Example.com/path?x=1") === "example.com", "_normHost: strips scheme/www/path, lowercases");
ok(ChatPrefs._normHost("  Foo.IO  ") === "foo.io", "_normHost: trims + lowercases a bare host");
ok(ChatPrefs._normHost("not a host") === "", "_normHost: rejects non-domain input");

// toggle persists
ChatPrefs.setImagesEnabled(true);
ok(ChatPrefs.imagesEnabled() === true, "setImagesEnabled flips state");
ok(_saved && _saved.imagesEnabled === true, "toggle written through Store.prefs.save");

// uncheck / re-check a default
ChatPrefs.setDefaultImageHost("giphy.com", false);
ok(ChatPrefs.imageHosts().indexOf("giphy.com") < 0, "unchecking a default removes it from the effective allowlist");
ChatPrefs.setDefaultImageHost("giphy.com", true);
ok(ChatPrefs.imageHosts().indexOf("giphy.com") >= 0, "re-checking a default restores it");

// custom add / dupe-guard / remove
ok(ChatPrefs.addImageHost("example.net") === true, "addImageHost accepts a new custom host");
ok(ChatPrefs.imageHosts().indexOf("example.net") >= 0, "custom host appears in the effective allowlist");
ok(ChatPrefs.addImageHost("giphy.com") === false, "adding an existing default as custom is a no-op");
ChatPrefs.removeImageHost("example.net");
ok(ChatPrefs.imageHosts().indexOf("example.net") < 0, "removeImageHost drops the custom host");

// classifyOpts wiring + subdomain matching
ChatPrefs.setLinksEnabled(true);
const opts = ChatPrefs.classifyOpts();
ok(opts.imagesOn === true && opts.linksOn === true, "classifyOpts mirrors the toggles");
ok(opts.imageHostAllowed("i.giphy.com") === true, "a subdomain of an allowed base host is allowed");
ok(opts.imageHostAllowed("evil.com") === false, "an unrelated host is rejected");
ok(opts.linkHostAllowed("youtube.com") === true, "youtube allowed for links");

// persistence across a reload
ChatPrefs.addLinkHost("vimeo.com");
ChatPrefs.load();   // re-hydrate from the persisted blob
ok(ChatPrefs.linkHosts().indexOf("vimeo.com") >= 0, "custom link host survives a reload");
ok(ChatPrefs.imagesEnabled() === true, "toggle survives a reload");

// dim sliders: numeric display levels, each clamped to its OWN range, persisted
_saved = null;
ChatPrefs.load();
ok(ChatPrefs.bgDim() === ChatPrefs.DIM_RANGES.bgDim.dflt, "bgDim defaults to its range default (0)");
ok(ChatPrefs.panelDim() === ChatPrefs.DIM_RANGES.panelDim.dflt, "panelDim defaults to its range default (75)");
ChatPrefs.setBgDim(150);
ok(ChatPrefs.bgDim() === ChatPrefs.DIM_RANGES.bgDim.max, "setBgDim clamps above-range to its max (100)");
ChatPrefs.setBgDim(-20);
ok(ChatPrefs.bgDim() === ChatPrefs.DIM_RANGES.bgDim.min, "setBgDim clamps below-range to its min (0)");
ChatPrefs.setPanelDim(10);
ok(ChatPrefs.panelDim() === ChatPrefs.DIM_RANGES.panelDim.min, "setPanelDim clamps below its min to 65 (cards stay readable)");
ChatPrefs.setPanelDim(200);
ok(ChatPrefs.panelDim() === ChatPrefs.DIM_RANGES.panelDim.max, "setPanelDim clamps above its max to 100");
ChatPrefs.setBgDim("not a number");
ok(ChatPrefs.bgDim() === ChatPrefs.DIM_RANGES.bgDim.dflt, "a non-numeric dim falls back to the default");
ChatPrefs.setPanelDim(80);
ok(ChatPrefs.panelDim() === 80, "setPanelDim stores an in-range value");
ok(_saved && _saved.panelDim === 80, "panelDim written through Store.prefs.save");
ChatPrefs.setPanelDim(72);
ChatPrefs.load();   // re-hydrate from the persisted blob
ok(ChatPrefs.panelDim() === 72, "dim level survives a reload");

// onChange drives re-render
let fired = 0;
ChatPrefs.onChange(() => fired++);
ChatPrefs.setImagesEnabled(false);
ok(fired === 1, "onChange fires on mutation (re-render hook)");

if (failed) { console.log("[chat-prefs] " + failed + " failure(s)"); process.exit(1); }
console.log("[chat-prefs] PASS — classify honors toggles/hosts/https-only/single-token; prefs default ON, allowlist math, custom add/remove, persistence + onChange");
process.exit(0);
