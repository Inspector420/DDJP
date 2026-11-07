// tests/check-chat-prefs.js
// SUBJECT: ui/chatbuffer.js, core/chatprefs.js
// WALL: chat display is OPT-IN and host-bounded. Two layers:
//  (A) ChatBuffer.classify(body, opts) is PURE and decides image | text-with-links
//      from the viewer's prefs. It must: render plain text when a toggle is off
//      (the DEFAULT), draw an inline image only when the WHOLE message is one bare
//      HTTPS image URL, make every https URL INSIDE a message a link when its host
//      is allowed (the owner, `ddjp_639`; CHANGED ON PURPOSE — this guard held the
//      one-token rule, under which only a message that was one bare URL linked),
//      leave trailing . , ) ! ? out of a link, accept a host ONLY via the injected
//      allowlist test, require an image extension for an image, and NEVER let a
//      non-https scheme (javascript:/data:/http:) become a live image/href.
//  (B) ChatPrefs models the toggles + host allowlists: images/links/background
//      now default ON (operator choice — load from allowlisted hosts only), the
//      effective allowlist is (defaults the user kept) + (custom hosts), a base
//      host covers its subdomains, mutations persist via Store.prefs and notify
//      onChange (which drives the live re-render). The seeded link hosts are the owner's
//      list (`ddjp_639`), grouped by kind, every one on for everyone; one turned off stays
//      off, and one added by hand before it became a default appears once.

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
// The links a message would draw, in order, as hrefs — [] when it draws none. A result that is not an image is text in
// PARTS (`{ text }` and `{ text, href }`), and the parts put back together are the message exactly.
const LINKS = (b, o) => { const c = ChatBuffer.classify(b, o); return c.kind === "text" && Array.isArray(c.parts) ? c.parts.filter((p) => p.href).map((p) => p.href) : null; };
const PLAIN = (b, o) => { const c = ChatBuffer.classify(b, o); return c.kind === "text" && Array.isArray(c.parts) && c.parts.every((p) => !p.href) && c.parts.map((p) => p.text).join("") === String(b == null ? "" : b); };

ok(K("https://i.giphy.com/a.gif", allOn) === "image", "image when imagesOn + host ok + extension");
// CHANGED ON PURPOSE (the owner, ddjp_639): a link is a link part of a text result, alone or in a sentence.
eq(LINKS("https://youtube.com/watch?v=x", allOn), ["https://youtube.com/watch?v=x"], "link when linksOn + host ok");
ok(PLAIN("https://i.giphy.com/a.gif", allOff), "both toggles off -> text (the DEFAULT)");
ok(PLAIN("https://i.giphy.com/a.gif", undefined), "no opts -> text");
ok(PLAIN("https://youtube.com/x", { imagesOn: true, linksOn: false, imageHostAllowed: () => true, linkHostAllowed: () => true }), "link host but linksOff -> text");

// scheme / token discipline
ok(PLAIN("http://i.giphy.com/a.gif", allOn), "http (non-https) -> text");
ok(PLAIN("javascript:alert(1)", allOn), "javascript: scheme can never become a live node");
ok(PLAIN("data:text/html,<b>x", allOn), "data: scheme -> text");
// CHANGED ON PURPOSE (the owner, ddjp_639): this row held "trailing text -> not a bare token -> text". An image URL
// inside a sentence is not an image now either — it is a link, when its host is a link host.
ok(K("https://i.giphy.com/a.gif extra", allOn) === "text" && JSON.stringify(LINKS("https://i.giphy.com/a.gif extra", allOn)) === JSON.stringify(["https://i.giphy.com/a.gif"]),
  "B: AN IMAGE URL INSIDE A SENTENCE IS NOT AN IMAGE — IT IS A LINK, ITS HOST BEING A LINK HOST (the owner, ddjp_639)");
ok(PLAIN("hello world", allOn), "plain prose -> text");
ok(PLAIN("", allOn), "empty -> text");

// host gating + precedence + payload shape
const giphyOnly = { imagesOn: true, linksOn: true, imageHostAllowed: (h) => h.endsWith("giphy.com"), linkHostAllowed: () => false };
ok(PLAIN("https://evil.com/a.gif", giphyOnly), "image host not on allowlist -> text");
ok(K("https://i.giphy.com/a.gif", giphyOnly) === "image", "allowlisted image host -> image");
ok(PLAIN("look https://i.giphy.com/a.gif", giphyOnly), "B: inside a sentence an image URL on an image host that is not a link host stays plain text");
ok(K("https://i.giphy.com/a.gif", allOn) === "image", "image wins over link for an image URL");
eq(ChatBuffer.classify("https://youtu.be/abc", allOn), { kind: "text", parts: [{ text: "https://youtu.be/abc", href: "https://youtu.be/abc" }] }, "link result carries href (CHANGED ON PURPOSE: in parts)");
eq(ChatBuffer.classify("https://i.giphy.com/a.gif", allOn), { kind: "image", src: "https://i.giphy.com/a.gif" }, "image result carries src");
ok(PLAIN("https://giphy.com/gifs/x", { imagesOn: true, linksOn: false, imageHostAllowed: () => true, linkHostAllowed: () => true }), "image host but no extension + linksOff -> text");

// ===== B: LINKS INSIDE SENTENCES (the owner, ddjp_639) =====
// Every https URL inside a message, on an allowed link host, is a link; the rest of the message is plain text.
const ytOnly = { imagesOn: true, linksOn: true, imageHostAllowed: () => false, linkHostAllowed: (h) => /(^|\.)youtube\.com$|^youtu\.be$/.test(h) };
{
  const body = "watch https://www.youtube.com/watch?v=dQw4w9WgXcQ and https://youtu.be/abc now";
  const c = ChatBuffer.classify(body, ytOnly);
  eq(c.parts, [{ text: "watch " }, { text: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", href: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    { text: " and " }, { text: "https://youtu.be/abc", href: "https://youtu.be/abc" }, { text: " now" }],
    "B: EVERY HTTPS URL INSIDE A MESSAGE, ON AN ALLOWED LINK HOST, IS A LINK — two in one sentence, the words around them plain");
}
for (const [p, label] of [[".", "a full stop"], [",", "a comma"], [")", "a closing bracket"], ["!", "an exclamation mark"], ["?", "a question mark"], ["?!", "two together"], [").", "a bracket then a full stop"]]) {
  const c = ChatBuffer.classify("see https://youtu.be/abc" + p + " ok", ytOnly);
  eq(c.parts, [{ text: "see " }, { text: "https://youtu.be/abc", href: "https://youtu.be/abc" }, { text: p + " ok" }],
    "B: TRAILING PUNCTUATION IS NOT PART OF THE LINK — " + label + " (" + p + ")");
}
eq(LINKS("(see https://youtu.be/abc)", ytOnly), ["https://youtu.be/abc"], "B: a link at the end of a bracketed aside leaves its bracket out");
eq(LINKS("https://youtu.be/abc?t=42.", ytOnly), ["https://youtu.be/abc?t=42"], "B: a link that ends the message leaves its full stop out");
ok(PLAIN("go to https://evil.com/x now", ytOnly), "B: A URL ON A HOST THAT IS NOT ALLOWED STAYS PLAIN TEXT inside a sentence");
ok(PLAIN("go http://youtube.com/x now", ytOnly), "B: http: never links, inside a sentence too");
ok(PLAIN("go javascript:alert(1) now", ytOnly) && PLAIN("go data:text/html,<b>x now", ytOnly), "B: javascript: and data: never link, inside a sentence");
ok(PLAIN("go xhttps://youtube.com/x now", ytOnly), "B: a link begins a word — https:// in the middle of a word is not one");
ok(PLAIN("go https://youtube.com.evil.com/x now", ytOnly) && PLAIN("go https://youtube.com@evil.com/x now", ytOnly),
  "B: the host is the URL's own host, read by the URL parser — a look-alike or a name before @ does not pass");
ok(PLAIN("watch https://youtu.be/abc now", { imagesOn: true, linksOn: false, imageHostAllowed: () => true, linkHostAllowed: () => true }),
  "B: with links off, nothing inside a sentence links either");
{
  const body = "  two  spaces https://youtu.be/abc\tand a tab ";
  const c = ChatBuffer.classify(body, ytOnly);
  ok(c.kind === "text" && c.parts.map((p) => p.text).join("") === body, "B: the parts put back together are the message exactly — its spacing kept", c.parts);
}
eq(LINKS("HTTPS://YOUTU.BE/abc", ytOnly), ["https://youtu.be/abc"], "B: the scheme and host are read case-blind, as the URL parser reads them");

// ===== B) ChatPrefs model =====
_saved = null;
ChatPrefs.load();
ok(ChatPrefs.imagesEnabled() === true, "images master toggle defaults ON (operator choice)");
ok(ChatPrefs.linksEnabled() === true, "links master toggle defaults ON (operator choice)");
ok(ChatPrefs.bgEnabled() === true, "room-background master toggle defaults ON (operator choice)");
eq(ChatPrefs.imageHosts().slice().sort(), ChatPrefs.DEFAULT_IMAGE_HOSTS.slice().sort(), "default effective image hosts = built-in image defaults");
ok(ChatPrefs.linkHosts().indexOf("youtube.com") >= 0, "youtube.com is a seeded default link host");

// ===== A: MORE LINK SITES, ALL ON BY DEFAULT (the owner, ddjp_639) =====
// The owner's list, grouped by kind. youtube.com and youtu.be were there already; the group they are drawn under (Video) was
// chosen in building and kept by the owner (ddjp_646).
const OWNER_LINK_HOSTS = {
  social: ["tiktok.com", "instagram.com", "x.com", "twitter.com", "rumble.com", "discord.com", "discord.gg", "streamable.com", "reddit.com", "redd.it"],
  music: ["soundcloud.com", "spotify.com", "spotify.link", "bandcamp.com"],
  streaming: ["twitch.tv"],
  games: ["skribbl.io", "lichess.org", "chess.com", "tetr.io"],
  stores: ["steampowered.com", "s.team", "humblebundle.com", "gog.com", "ea.com", "ubisoft.com", "epicgames.com"],
};
const wantAll = ["youtube.com", "youtu.be"].concat(...Object.values(OWNER_LINK_HOSTS));
_saved = null;
ChatPrefs.load();
eq((ChatPrefs.DEFAULT_LINK_HOSTS || []).slice().sort(), wantAll.slice().sort(),
  "A: THE DEFAULT LINK HOSTS ARE THE OWNER'S LIST — YouTube's two, and twenty-six more (ddjp_639)");
ok(wantAll.every((h) => ChatPrefs.linkHosts().indexOf(h) >= 0) && ChatPrefs.linkDefaults().every((d) => d.on === true),
  "A: EVERY NEW DEFAULT IS ON FOR EVERYONE — a fresh device allows all of them");
for (const no of ["t.co", "discordapp.com", "g2a.com"]) {
  ok(ChatPrefs.linkHosts().indexOf(no) < 0 && !ChatPrefs.classifyOpts().linkHostAllowed(no),
    "A: " + no + " IS DELIBERATELY NOT A LINK HOST (the owner's list says why)");
}
{
  const byGroup = {};
  for (const d of ChatPrefs.linkDefaults()) (byGroup[d.group] = byGroup[d.group] || []).push(d.host);
  ok(Object.keys(OWNER_LINK_HOSTS).every((g) => JSON.stringify((byGroup[g] || []).slice().sort()) === JSON.stringify(OWNER_LINK_HOSTS[g].slice().sort())),
    "A: AND EACH IS IN THE OWNER'S KIND — social, music, streaming, games, stores — for the settings list's groups", byGroup);
}
ok(ChatPrefs.classifyOpts().linkHostAllowed("vm.tiktok.com") && ChatPrefs.classifyOpts().linkHostAllowed("store.steampowered.com")
  && ChatPrefs.classifyOpts().linkHostAllowed("open.spotify.com"), "A: a base host covers its subdomains (vm.tiktok.com, store.steampowered.com, open.spotify.com)");
// A device carried over from before: YouTube turned off, and tiktok.com added by hand. YouTube stays off; tiktok.com is
// now a default and appears once — in the defaults, on, and no longer as a chip of its own.
_saved = { linksEnabled: true, linkOff: { "youtube.com": true }, linkCustom: ["tiktok.com", "vimeo.com"] };
ChatPrefs.load();
ok((ChatPrefs.linkDefaults().find((d) => d.host === "youtube.com") || {}).on === false && !ChatPrefs.classifyOpts().linkHostAllowed("youtube.com"),
  "A: A PERSON WHO TURNED A HOST OFF KEEPS IT OFF");
ok((ChatPrefs.linkDefaults().find((d) => d.host === "twitch.tv") || {}).on === true, "A: and the new ones are on for them too");
ok(ChatPrefs.linkCustomHosts().indexOf("tiktok.com") < 0 && ChatPrefs.linkDefaults().filter((d) => d.host === "tiktok.com").length === 1
  && ChatPrefs.linkHosts().filter((h) => h === "tiktok.com").length === 1,
  "A: A HOST SOMEONE ALREADY ADDED BY HAND DOES NOT APPEAR TWICE — it is a default now, shown once", { custom: ChatPrefs.linkCustomHosts(), hosts: ChatPrefs.linkHosts() });
ok(ChatPrefs.linkCustomHosts().indexOf("vimeo.com") >= 0, "A CONTROL: a host added by hand that is not a default stays theirs");
_saved = null;
ChatPrefs.load();

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

// THE SOUND AND TIER CHOICES SURVIVE A RELOAD (J115). Their setters saved only when a tier marker or the DM index moved,
// so each was lost on the next load unless something else happened to save. Each is set to a non-default value and read
// back after a reload. Before each, the markers are saved once (`tierClear`), as the app does as soon as chat draws: the
// first save after a load always wrote, which is what hid this.
const afterMarkers = () => { ChatPrefs.load(); ChatPrefs.tierClear(); ChatPrefs.tierClear(); };
afterMarkers(); ChatPrefs.setMentionSound(false); ChatPrefs.load();
ok(ChatPrefs.mentionSound() === false, "J115: the mention sound switched off survives a reload");
afterMarkers(); ChatPrefs.setMentionVolume(37); ChatPrefs.load();
ok(ChatPrefs.mentionVolume() === 37, "J115: the mention volume survives a reload");
afterMarkers(); ChatPrefs.setDMSound(false); ChatPrefs.load();
ok(ChatPrefs.dmSound() === false, "J115: the DM sound switched off survives a reload");
afterMarkers(); ChatPrefs.setDMVolume(41); ChatPrefs.load();
ok(ChatPrefs.dmVolume() === 41, "J115: the DM volume survives a reload");
afterMarkers(); ChatPrefs.setChatTier("staff"); ChatPrefs.load();
ok(ChatPrefs.chatTier() === "staff", "J115: the chosen chat tier survives a reload");
afterMarkers(); ChatPrefs.setChatTier(null); ChatPrefs.load();
ok(ChatPrefs.chatTier() === null, "J115: and going back to the room's setting survives a reload too");

// ROOM SETTINGS' "SHOW ADVANCED OPTIONS" (J127, the owner's): this device's and this account's, OFF by default; a reload
// keeps it; anything but a real `true` stored reads as off; and flipping it fires NO `onChange` — that signal rebuilds
// every chat row, the tier strip and both settings panels, and this changes one panel, which redraws itself (the shape
// the player's view controls have, `videoHidden`). Its panel half is `check-settings-rows` J and `check-settings-apply` R.
// The premise is asserted BY NAME first: without it the rows below would throw, and a crash names no row.
const hasAdv = typeof ChatPrefs.advancedShown === "function" && typeof ChatPrefs.setAdvancedShown === "function";
ok(hasAdv, "J127 PREMISE — ChatPrefs has the advanced toggle's reader and setter");
if (hasAdv) {
  _saved = null; ChatPrefs.load();
  ok(ChatPrefs.advancedShown() === false, "J127: advanced options are OFF by default");
  let advFired = 0;
  ChatPrefs.onChange(() => advFired++);
  ChatPrefs.setAdvancedShown(true);
  ok(ChatPrefs.advancedShown() === true && _saved && _saved.advancedShown === true, "J127: turning them on is stored through Store.prefs.save");
  ChatPrefs.load();
  ok(ChatPrefs.advancedShown() === true, "J127: and survives a reload");
  ChatPrefs.setAdvancedShown(false); ChatPrefs.load();
  ok(ChatPrefs.advancedShown() === false, "J127: as does turning them off again");
  ok(advFired === 0, "J127: FLIPPING IT FIRES NO onChange — no chat rebuild for a change to one panel");
  ChatPrefs.setImagesEnabled(ChatPrefs.imagesEnabled());
  ok(advFired === 1, "J127 CONTROL: the same listener does hear a display change, so the zero above is a reading");
  for (const v of ["true", 1, "yes", {}, null]) {
    _saved = Object.assign({}, _saved, { advancedShown: v }); ChatPrefs.load();
    ok(ChatPrefs.advancedShown() === false, "J127: a stored " + JSON.stringify(v) + " is not a real true, and reads as off");
  }
  // PER ACCOUNT: the store is namespaced by the account (StorageIO), and the module re-reads when the namespace moves.
  const ns = { cur: "@a:hs" }, blobs = {};
  const Store2 = { prefs: { load: () => blobs[ns.cur] || null, save: (o) => { blobs[ns.cur] = JSON.parse(JSON.stringify(o)); } } };
  const { ChatPrefs: CP2 } = loadInContext(["core/chatprefs.js"], { URL, Store: Store2, Logger, StorageIO: { currentNamespace: () => ns.cur } });
  CP2.load(); CP2.setAdvancedShown(true);
  ok(CP2.advancedShown() === true && blobs["@a:hs"] && blobs["@a:hs"].advancedShown === true, "J127 PREMISE — one account turned them on");
  ns.cur = "@b:hs";
  ok(CP2.advancedShown() === false, "J127: ANOTHER ACCOUNT on this device has its own choice — off until it turns them on");
  ns.cur = "@a:hs";
  ok(CP2.advancedShown() === true, "J127: and the first account's is still on");
  _saved = null; ChatPrefs.load();
}

// THE PLAYERS' SOUND AND THE PREVIEW'S MOUSE BLOCK SURVIVE A RELOAD (J134, the owner's: "they can bowth be set diffrently and
// survive reload tab."; asked whether the main player should remember its volume and mute: "yes"). Per device, in the same
// store as the rest. Before anything is saved: the main player at full and unmuted; the preview with NO level of its own (it
// starts at the main player's), unmuted, the block off. Each is bounded on load like the others, saves only when it moved
// (the J115 way, `_saveIfMoved`), and fires NO `onChange` — that signal rebuilds every chat row. The players' half (the
// sliders, the buttons, the preview's controls) is `check-preview-controls`.
const hasSound = ["playerVolume", "playerMuted", "setPlayerVolume", "setPlayerMuted", "previewVolume", "previewMuted", "previewBlocked",
  "setPreviewVolume", "setPreviewMuted", "setPreviewBlocked"].every((k) => typeof ChatPrefs[k] === "function");
ok(hasSound, "J134 PREMISE — ChatPrefs has the players' sound and the preview's block, readers and setters");
if (hasSound) {
  _saved = null; ChatPrefs.load();
  // CHANGED ON PURPOSE (`ddjp_680`, J135, the owner's: "by default the locking the mouse out of the song should be on for
  // preview"): the block read off before anything was saved; it reads ON now, until 🖱 is pressed.
  eq([ChatPrefs.playerVolume(), ChatPrefs.playerMuted(), ChatPrefs.previewVolume(), ChatPrefs.previewMuted(), ChatPrefs.previewBlocked()],
    [100, false, null, false, true], "J134: BEFORE ANYTHING IS SAVED — the main player full and unmuted; the preview no level of its own, unmuted, block ON (J135)");
  let sndFired = 0;
  ChatPrefs.onChange(() => sndFired++);
  afterMarkers(); ChatPrefs.setPlayerVolume(40); ChatPrefs.load();
  ok(ChatPrefs.playerVolume() === 40, "J134: THE MAIN PLAYER'S VOLUME SURVIVES A RELOAD");
  afterMarkers(); ChatPrefs.setPlayerMuted(true); ChatPrefs.load();
  ok(ChatPrefs.playerMuted() === true, "J134: AND ITS MUTE");
  afterMarkers(); ChatPrefs.setPreviewVolume(70); ChatPrefs.load();
  ok(ChatPrefs.previewVolume() === 70 && ChatPrefs.playerVolume() === 40, "J134: THE PREVIEW'S VOLUME SURVIVES A RELOAD, APART FROM THE MAIN PLAYER'S", [ChatPrefs.previewVolume(), ChatPrefs.playerVolume()]);
  afterMarkers(); ChatPrefs.setPreviewMuted(false); ChatPrefs.setPlayerMuted(true); ChatPrefs.load();
  ok(ChatPrefs.previewMuted() === false && ChatPrefs.playerMuted() === true, "J134: one muted and the other not — each its own");
  afterMarkers(); ChatPrefs.setPreviewMuted(true); ChatPrefs.setPlayerMuted(false); ChatPrefs.load();
  ok(ChatPrefs.previewMuted() === true && ChatPrefs.playerMuted() === false, "J134: and the other way round");
  afterMarkers(); ChatPrefs.setPreviewBlocked(true); ChatPrefs.load();
  ok(ChatPrefs.previewBlocked() === true, "J134: THE PREVIEW'S MOUSE BLOCK SURVIVES A RELOAD");
  ok(sndFired === 0, "J134: NONE OF THEM FIRES onChange — no chat rebuild for a slider's step");
  ChatPrefs.setImagesEnabled(ChatPrefs.imagesEnabled());
  ok(sndFired === 1, "J134 CONTROL: the same listener does hear a display change, so the zero above is a reading");
  // ONCE PER VALUE: a drag's repeated value writes nothing more.
  afterMarkers(); let writes = 0; const realSave = Store.prefs.save; Store.prefs.save = (o) => { writes++; realSave(o); };
  ChatPrefs.setPreviewVolume(55); ChatPrefs.setPreviewVolume(55); ChatPrefs.setPreviewVolume(55); ChatPrefs.setPlayerVolume(40);
  Store.prefs.save = realSave;
  ok(writes === 1, "J134: A VALUE SAVES ONCE — the same value again, and a value that did not move, write nothing", writes);
  // BOUNDED: the setters clamp, and a stored value of the wrong kind is normalised on load.
  ChatPrefs.setPlayerVolume(150); ok(ChatPrefs.playerVolume() === 100, "J134: a volume above 100 is 100");
  ChatPrefs.setPreviewVolume(-5); ok(ChatPrefs.previewVolume() === 0, "J134: a volume below 0 is 0");
  ChatPrefs.setPlayerVolume("loud"); ok(ChatPrefs.playerVolume() === 100, "J134: a volume that is not a number is the default");
  // CHANGED ON PURPOSE (`ddjp_680`, J135): a stored block that is not a real choice reads as not chosen — on — where it read off.
  for (const [k, v, want, read] of [["playerVolume", "abc", 100, "playerVolume"], ["playerVolume", 250, 100, "playerVolume"], ["previewVolume", 400, 100, "previewVolume"],
    ["previewVolume", undefined, null, "previewVolume"], ["playerMuted", "true", false, "playerMuted"], ["previewMuted", 1, false, "previewMuted"],
    ["previewBlockChoice", "yes", true, "previewBlocked"]]) {
    _saved = Object.assign({}, _saved, { [k]: v }); if (v === undefined) delete _saved[k]; ChatPrefs.load();
    ok(ChatPrefs[read]() === want, "J134: A STORED " + k + " OF " + JSON.stringify(v === undefined ? "nothing" : v) + " READS AS " + JSON.stringify(want));
  }
  _saved = null; ChatPrefs.load();
}

// THE PREVIEW'S NEW DEFAULTS REACH A DEVICE THAT RAN 679 (J135). 679 kept the block as `previewBlocked`, and its `_save()` wrote
// the whole store, so `previewBlocked: false` sits in every 679 store, chosen or not. The choice has its own key now,
// `previewBlockChoice`, none (null) until 🖱 is pressed: on load a stored true (only a press made it) becomes the choice, a stored
// false is not one, and the old key goes either way. The volume: none still means not chosen (the preview opens at half, J135).
const hasChoice = typeof ChatPrefs.previewBlocked === "function" && typeof ChatPrefs.setPreviewBlocked === "function";
ok(hasChoice, "J135 PREMISE — ChatPrefs has the preview's block, reader and setter");
if (hasChoice) {
  _saved = { previewVolume: null, previewMuted: false, previewBlocked: false, playerVolume: 100, playerMuted: false };   // what 679 left
  ChatPrefs.load();
  ok(ChatPrefs.previewBlocked() === true && ChatPrefs.previewVolume() === null && ChatPrefs.previewMuted() === false,
    "J135: A 679 DEVICE THAT NEVER PRESSED 🖱 GETS THE NEW DEFAULT — the block on, no level chosen, unmuted", [ChatPrefs.previewBlocked(), ChatPrefs.previewVolume(), ChatPrefs.previewMuted()]);
  ChatPrefs.tierClear(); ChatPrefs.tierClear(); ChatPrefs.setPreviewBlocked(true); ChatPrefs.setPreviewBlocked(false); ChatPrefs.setMentionVolume(ChatPrefs.mentionVolume());
  ok(_saved && !("previewBlocked" in _saved) && _saved.previewBlockChoice === false, "J135: THE OLD KEY IS GONE FROM WHAT IS SAVED, and the choice is its own key", _saved && { old: _saved.previewBlocked, choice: _saved.previewBlockChoice });
  _saved = { previewBlocked: true }; ChatPrefs.load();
  ok(ChatPrefs.previewBlocked() === true, "J135: a 679 device where 🖱 was pressed on keeps it on — a stored true was a press");
  afterMarkers(); ChatPrefs.setPreviewBlocked(false); ChatPrefs.load();
  ok(ChatPrefs.previewBlocked() === false, "J135: AND A CHOICE OF OFF MADE NOW SURVIVES A RELOAD — a saved choice wins");
  _saved = { previewBlocked: false, previewBlockChoice: false }; ChatPrefs.load();
  ok(ChatPrefs.previewBlocked() === false, "J135: a choice already made is not undone by the old key beside it");
  _saved = null; ChatPrefs.load();
  ok(ChatPrefs.previewBlocked() === true, "J135: a new device: on");
}

// onChange drives re-render
let fired = 0;
ChatPrefs.onChange(() => fired++);
ChatPrefs.setImagesEnabled(false);
ok(fired === 1, "onChange fires on mutation (re-render hook)");

if (failed) { console.log("[chat-prefs] " + failed + " failure(s)"); process.exit(1); }
console.log("[chat-prefs] PASS — classify honors toggles/hosts/https-only; a whole-message image, every allowed https link inside a sentence, trailing punctuation left out (ddjp_639); the owner's link hosts, grouped, on, one off stays off, none twice; prefs default ON, allowlist math, custom add/remove, persistence + onChange; the sound, volume and chat-tier choices survive a reload (J115); room settings' advanced toggle is per device and per account, off by default, kept by a reload, off for any stored value but a real true, and fires no onChange (J127); the main player's volume and mute and the preview's volume, mute and mouse block survive a reload, each apart, bounded, saved once per value, firing no onChange (J134); the preview's block defaults on, and a device that ran 679 gets that default — its stored unchosen off is dropped, a stored on kept, a choice made now kept (J135)");
process.exit(0);
