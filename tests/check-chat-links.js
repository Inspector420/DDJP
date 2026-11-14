// tests/check-chat-links.js
// SUBJECT: ui/chatbuffer.js, ui/chat.js, features/chat.js, core/chatprefs.js
// WALL: J122 — LINKS IN CHAT (the owner, `ddjp_639`). Every https URL inside a message, on an allowed link host, is a link
// wherever a chat body is drawn; and a link leaves the sender's device without its tracking, ID and referral codes.
//
//   PART A — the Settings list: every new site listed and on, under the owner's kinds, a host added by hand before it
//            became a default shown once. `_prefSection` and `_prefCard` are executed from `ui/settings.js` by name over
//            the real `ChatPrefs`; which hosts are defaults is held by `check-chat-prefs` PART B.
//   PART B — links inside sentences, on screen. Every place a chat body is drawn — room chat (every tier) and DMs (the
//            room's DM tab and the lobby's) — goes through ONE function, `_chatContent`, which draws
//            `ChatBuffer.classify`'s parts. Driven through the real `ui/chat.js` over the real `Chat`, `ChatPrefs` and
//            `ChatBuffer` (`tests/_chat-world.js`): a sentence with links in it draws each as a link with today's
//            attributes, the words around it plain, its trailing punctuation outside it; a host not allowed stays plain; an
//            image URL inside a sentence is a link; a whole-message image is still an image; long plain runs still break.
//            The rule itself (what a link is) is held by `check-chat-prefs` PART A, which drives `classify` as a pure
//            function.
//   PART C — a link leaves clean (the owner, `ddjp_639`). The sender's device takes the ID, tracking and referral codes out of
//            every https link in its OWN outgoing message before it is sent — room chat and DMs — by `Chat.cleanLinks`, a
//            pure function with a per-host table and no network. Held by a table of REAL share links, before → after, with
//            keep-cases as well as strip-cases (each from a public page, named beside it), by the shapes that must come
//            through byte for byte, by the send paths, and by a tie to the display: every link drawn from a cleaned message
//            is already clean.
//
// Every part states its premise before its rows: a part whose premise fails FAILS by name.

const W = require("./_chat-world");
const tick = W.tick;

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[chat-links] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}

// Every element under `n`, in document order.
function all(n) { const out = []; (function w(x) { for (const c of (x.children || [])) { out.push(c); w(c); } })(n); return out; }
// What a row draws: its links (label, href, the three attributes) and its words, the sender's name and the × left out.
function drawn(row) {
  const body = all(row).find((x) => x.className === "chat-body");
  const links = all(row).filter((x) => x.tag === "a").map((a) => ({ text: a.textContent, href: a.href, target: a.target, rel: a.rel,
    referrerpolicy: a.getAttribute("referrerpolicy"), cls: a.className }));
  const imgs = all(row).filter((x) => x.tag === "img").length;
  const longs = all(row).filter((x) => x.className === "chat-long").map((x) => x.textContent);
  return { links, imgs, longs, text: body ? body.textContent : null };
}
const ATTRS = { target: "_blank", rel: "noopener noreferrer nofollow", referrerpolicy: "no-referrer", cls: "chat-link" };
const keepsAttrs = (l) => l.target === ATTRS.target && l.rel === ATTRS.rel && l.referrerpolicy === ATTRS.referrerpolicy && l.cls === ATTRS.cls;

const SENTENCE = "watch https://www.youtube.com/watch?v=dQw4w9WgXcQ, then https://youtu.be/abc! and https://evil.example/x too";
const WANT = [{ text: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", href: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
              { text: "https://youtu.be/abc", href: "https://youtu.be/abc" }];

(async () => {
  // ═══ PART A — the Settings list ════════════════════════════════════════════════════════════════════════════════════
  {
    const J16 = require("./_probe-j16-active"), vm = require("vm");
    const fns = ["_prefCard", "_prefSection"].map((n) => J16.extractFn("ui/settings.js", n));
    ok(fns.every((f) => f.ok), "A PREMISE — `_prefCard` and `_prefSection` read from ui/settings.js by name", fns.map((f) => f.stage || "ok"));
    if (fns.every((f) => f.ok)) {
      // A device carried over: tiktok.com added by hand before it was a default, and YouTube turned off.
      const ls = { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; }, setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } };
      const w = W.world({ extras: { URL }, localStorage: ls });
      const P = w.sb.ChatPrefs;
      P.setDefaultLinkHost("youtube.com", false);
      ls._v = JSON.parse(JSON.stringify(ls._v));
      for (const k of Object.keys(ls._v)) { try { const o = JSON.parse(ls._v[k]); if (o && Array.isArray(o.linkCustom)) { o.linkCustom = ["tiktok.com", "vimeo.com"]; ls._v[k] = JSON.stringify(o); } } catch (e) {} }
      P.load();
      const sbx = { H: { el: W.el }, console };
      vm.createContext(sbx);
      vm.runInContext(fns.map((f) => f.source).join("\n") + ";globalThis.__s = _prefSection;", sbx);
      const sec = sbx.__s({ heading: "Links", title: "Links in chat", note: "", enabled: P.linksEnabled(), onToggle() {},
        defaults: P.linkDefaults(), onDefault() {}, custom: P.linkCustomHosts(), onAdd() {}, onRemove() {} });
      const list = all(sec).find((x) => /\bpref-hosts\b/.test(x.className));
      ok(!!list, "A PREMISE — the Links card drew its host list", sec.textContent);
      const seq = list ? list.children.map((c) => /pref-host-group/.test(c.className) ? "# " + c.textContent
        : /\bpref-host\b/.test(c.className) ? (all(c).find((x) => x.tag === "input").checked ? "on " : "off ") + c.textContent
        : /pref-chip\b/.test(c.className) ? "chip " + c.children[0].textContent : null).filter(Boolean) : [];
      const heads = seq.filter((x) => x[0] === "#");
      ok(JSON.stringify(heads) === JSON.stringify(["# Video", "# Social", "# Music", "# Streaming", "# Games", "# Stores"]),
        "A: THE LONG LIST IS GROUPED BY THE OWNER'S KINDS — social, music, streaming, games, stores (YouTube under Video)", heads);
      const listed = seq.filter((x) => /^(on|off) /.test(x)).map((x) => x.replace(/^(on|off) /, ""));
      ok(JSON.stringify(listed.slice().sort()) === JSON.stringify((P.DEFAULT_LINK_HOSTS || []).slice().sort()) && listed.length === 28,
        "A: SETTINGS LISTS EVERY SITE, each with its own toggle", listed);
      ok(seq.filter((x) => /^on /.test(x)).length === 27 && seq.indexOf("off youtube.com") >= 0,
        "A: EVERY NEW SITE IS ON; the one this person turned off stays off", seq.filter((x) => /^off /.test(x)));
      ok(seq.filter((x) => /tiktok\.com$/.test(x)).length === 1 && seq.indexOf("on tiktok.com") >= 0 && seq.indexOf("chip vimeo.com") >= 0,
        "A: A HOST ADDED BY HAND BEFORE IT WAS A DEFAULT IS LISTED ONCE, on, among the defaults; another added by hand is still its chip", seq);
      // Each kind's sites sit under its own heading.
      let under = null; const at = {};
      for (const x of seq) { if (x[0] === "#") under = x.slice(2); else if (/^(on|off) /.test(x)) at[x.replace(/^(on|off) /, "")] = under; }
      ok(at["twitch.tv"] === "Streaming" && at["tetr.io"] === "Games" && at["s.team"] === "Stores" && at["redd.it"] === "Social" && at["spotify.link"] === "Music",
        "A: and each site sits under its own kind's heading", at);
    }
  }

  // ═══ PART B — every surface a chat body is drawn on ═══════════════════════════════════════════════════════════════
  // ROOM CHAT — a message arriving live on the main tier, and one on the staff tier.
  {
    // `URL` laid over the world (its opt-in), as a browser has it: `classify` reads a URL with the platform's parser, and a
    // world without one draws every body as text — which would pass "a host not allowed stays plain" for the wrong reason.
    const w = W.world({ extras: { URL } });
    await w.CP.startChat(w.box); await tick();
    w.raw("$s1", "!u:hs", 100, SENTENCE, "@b:hs");
    await tick(); w.CP.renderChat();
    const row = w.box.children.find((n) => n.dataset && n.dataset.eid === "$s1");
    ok(!!row, "B PREMISE — the room chat drew the message", W.screen(w.box));
    const d = row ? drawn(row) : null;
    ok(d && JSON.stringify(d.links.map((l) => ({ text: l.text, href: l.href }))) === JSON.stringify(WANT),
      "B: ROOM CHAT — EVERY HTTPS URL INSIDE THE SENTENCE ON AN ALLOWED HOST IS A LINK, its trailing , and ! outside it; the other host stays plain", d);
    ok(d && d.links.length && d.links.every(keepsAttrs),
      "B: ROOM CHAT — EACH KEEPS TODAY'S ATTRIBUTES: target=_blank, rel=\"noopener noreferrer nofollow\", referrerpolicy=no-referrer", d && d.links);
    ok(d && d.text === "@b:hs " + SENTENCE,
      "B: ROOM CHAT — and the row reads as the message, word for word (the links in place)", d && d.text);
    // A message that is one image URL on an image host is still an image; inside a sentence it is a link, its host being
    // a link host — giphy is not one by default, so it is plain there. With giphy added as a link host, it links.
    w.raw("$i1", "!u:hs", 101, "https://i.giphy.com/a.gif", "@b:hs");
    w.raw("$i2", "!u:hs", 102, "look https://i.giphy.com/a.gif", "@b:hs");
    await tick(); w.CP.renderChat();
    const r1 = w.box.children.find((n) => n.dataset && n.dataset.eid === "$i1"), r2 = w.box.children.find((n) => n.dataset && n.dataset.eid === "$i2");
    ok(r1 && drawn(r1).imgs === 1 && drawn(r1).links.length === 0, "B: A WHOLE MESSAGE THAT IS ONE IMAGE URL IS STILL AN IMAGE", r1 && drawn(r1));
    ok(r2 && drawn(r2).imgs === 0 && drawn(r2).links.length === 0, "B: INSIDE A SENTENCE IT IS NOT AN IMAGE — and not a link while its host is not a link host", r2 && drawn(r2));
    w.sb.ChatPrefs.addLinkHost("giphy.com");
    w.CP._repaintChat(w.box);
    const r2b = w.box.children.find((n) => n.dataset && n.dataset.eid === "$i2");
    ok(r2b && drawn(r2b).imgs === 0 && drawn(r2b).links.length === 1 && drawn(r2b).links[0].href === "https://i.giphy.com/a.gif",
      "B: AND A LINK ONCE ITS HOST IS A LINK HOST — just a link, never an image", r2b && drawn(r2b));
    // The plain parts still break their long runs.
    w.raw("$l1", "!u:hs", 103, "x".repeat(40) + " https://youtu.be/abc " + "y".repeat(35), "@b:hs");
    await tick(); w.CP.renderChat();
    const rl = w.box.children.find((n) => n.dataset && n.dataset.eid === "$l1");
    ok(rl && JSON.stringify(drawn(rl).longs) === JSON.stringify(["x".repeat(40), "y".repeat(35)]) && drawn(rl).links.length === 1,
      "B: THE PLAIN PARTS STILL GET THEIR LONG-RUN BREAKS beside a link", rl && drawn(rl));
    // Links off: nothing inside a sentence links either.
    w.sb.ChatPrefs.setLinksEnabled(false);
    w.CP._repaintChat(w.box);
    const roff = w.box.children.find((n) => n.dataset && n.dataset.eid === "$s1");
    ok(roff && drawn(roff).links.length === 0 && drawn(roff).text.indexOf(SENTENCE) >= 0, "B: WITH LINKS TURNED OFF THE SENTENCE IS PLAIN TEXT", roff && drawn(roff));
    w.sb.ChatPrefs.setLinksEnabled(true);
  }
  // DMs — the room's DM tab, and the lobby's DM panel: the same row builder, so the same parts.
  for (const where of ["the room's DM tab", "the lobby"]) {
    const dw = W.world({ extras: { URL } });
    dw.refs.tabDM = W.el("button");
    dw.sb.Chat.dmInit();
    if (where === "the lobby") { const host = W.el("div"); dw.CP.openLobbyDM(host); }
    else { dw.refs.dmBox = W.el("div"); dw.CP._wireDMPanel(); }
    dw.rawDM("$d0", 90, "hi", "@a:hs");
    dw.CP._openDMFromAction("!dm:hs");
    await tick();
    dw.rawDM("$d1", 100, SENTENCE, "@a:hs");                        // arriving in the open conversation
    await tick(); dw.CP.renderDMPanel();
    const box = dw.refs.dmBox;
    const row = box ? all(box).find((n) => n.dataset && n.dataset.eid === "$d1") : null;
    ok(!!row, "B PREMISE — " + where + " drew the DM", box && box.textContent);
    const d = row ? drawn(row) : null;
    ok(d && JSON.stringify(d.links.map((l) => ({ text: l.text, href: l.href }))) === JSON.stringify(WANT) && d.links.every(keepsAttrs),
      "B: DMs, " + where.toUpperCase() + " — THE SAME LINKS, WITH THE SAME ATTRIBUTES, AS ROOM CHAT", d);
  }

  // ═══ PART C — a link leaves clean ═════════════════════════════════════════════════════════════════════════════════
  // REAL SHARE LINKS, collected for ddjp_639's job from public pages (named beside each). [before, after]; after === before
  // is a KEEP case. Long values are as found; nothing here is made up unless it says "constructed".
  const SAMPLES = [
    // YouTube — `si` and `is` (its 2026 successor) name the sharer; `feature=share` the share button. `v`, `t`, `list`,
    // `index`, `start_radio` work the link; `pp` is not proven tracking (it encodes a search term) and stays.
    ["https://youtu.be/k_-6KI3m31M?si=JDZTHRDTs-unM34A", "https://youtu.be/k_-6KI3m31M"],                         // rust-lang/this-week-in-rust PR #8881
    ["https://youtu.be/B2gmKy3pHkw?si=4QRLux5X55fTx8c8&t=196", "https://youtu.be/B2gmKy3pHkw?t=196"],               // same PR
    ["https://youtu.be/_Hrtqouqtds?is=ilkmkEDUQw-gf4Iq", "https://youtu.be/_Hrtqouqtds"],                         // YouTube community post
    ["https://youtube.com/shorts/SXPOmuGspYE?si=6cy15X_OzXII-tIs", "https://youtube.com/shorts/SXPOmuGspYE"],       // AdguardFilters #159953
    ["https://youtube.com/@MrBean?si=NfKwyJWbjJUss7uY", "https://youtube.com/@MrBean"],                             // same issue
    ["https://youtube.com/shorts/Dft9Iw7FG6k?feature=share", "https://youtube.com/shorts/Dft9Iw7FG6k"],             // Samsung community
    ["https://youtube.com/clip/UgkxzEYqyqbtoM1QSIjDkTWtIoTDhZtpP1CY?si=Aex5m4xEjqOOR9-2", "https://youtube.com/clip/UgkxzEYqyqbtoM1QSIjDkTWtIoTDhZtpP1CY"],   // yt-dlp #13721
    ["https://music.youtube.com/watch?v=-04BgqiZ5a0&si=WduchNxnp8PKSPNt", "https://music.youtube.com/watch?v=-04BgqiZ5a0"],   // gllogs #2275
    // youtube.com's own start time and playlist place (`ddjp_641`, the supervisor's correction: only youtu.be's `t` had a
    // keep-case, so stripping youtube.com's `t` or `index` left this guard green). bbaovanc.com, "YouTube URL structures".
    ["https://www.youtube.com/watch?v=F6va6tg62qg&t=14s", "https://www.youtube.com/watch?v=F6va6tg62qg&t=14s"],   // KEEP
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3m14s", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3m14s"],   // KEEP
    ["https://www.youtube.com/watch?v=47dtFZ8CFo8&list=PLwxnUUM01nt2nMh9DPq09e6fIDbumybgt&index=166",
     "https://www.youtube.com/watch?v=47dtFZ8CFo8&list=PLwxnUUM01nt2nMh9DPq09e6fIDbumybgt&index=166"],   // KEEP
    ["https://m.youtube.com/watch?v=EU1KWuGWy1o&list=RDEU1KWuGWy1o&start_radio=1&pp=ygULRmxhdmlhIHRhc2igBwE%3D",
     "https://m.youtube.com/watch?v=EU1KWuGWy1o&list=RDEU1KWuGWy1o&start_radio=1&pp=ygULRmxhdmlhIHRhc2igBwE%3D"],   // Hazel #126 — KEEP
    // TikTok — the web's copy link and the app's resolved link; the app's short links are opaque and stay as typed.
    ["https://www.tiktok.com/@thereiruinedit/video/7078499218352131371?_t=8R5zFHrp38o&_r=1", "https://www.tiktok.com/@thereiruinedit/video/7078499218352131371"],   // jamietanna/tiktok-mf2 #2
    ["https://www.tiktok.com/@fall.in.love_uu/video/7638679746745978130?is_from_webapp=1&sender_device=pc&web_id=7587760923134625296",
     "https://www.tiktok.com/@fall.in.love_uu/video/7638679746745978130"],                                          // Threads @fl1nh.ng
    ["https://www.tiktok.com/@littleqb/video/6933443770679610629?sender_device=pc&sender_web_id=6926592317659874822&is_from_webapp=v2&is_copy_url=0",
     "https://www.tiktok.com/@littleqb/video/6933443770679610629"],                                                 // Obsidian forum
    ["https://vm.tiktok.com/ZML9MrEa6/", "https://vm.tiktok.com/ZML9MrEa6/"],                                       // short — KEEP
    ["https://www.tiktok.com/t/ZTRC5xgJp", "https://www.tiktok.com/t/ZTRC5xgJp"],                                   // short (yt-dlp tests) — KEEP
    ["https://vt.tiktok.com/ZSe4FqkKd", "https://vt.tiktok.com/ZSe4FqkKd"],                                         // short (yt-dlp tests) — KEEP
    // Instagram — `igsh`, `igshid`; `img_index` picks the carousel item and stays.
    ["https://www.instagram.com/p/C9krqVutcxc/?igsh=MWlwMG1oaHlxOWE2Yg==", "https://www.instagram.com/p/C9krqVutcxc/"],   // t.me/s/NativeScandinavia/491
    ["https://www.instagram.com/reel/DTxiATzEbfT/?igsh=MWNiM2J3Z21haGZoNA==", "https://www.instagram.com/reel/DTxiATzEbfT/"],
    ["https://www.instagram.com/p/Bwo_YEwpRKX/?utm_source=ig_twitter_share&igshid=ci2tnjf01ahi", "https://www.instagram.com/p/Bwo_YEwpRKX/"],   // Goodreads
    ["https://www.instagram.com/p/BysOqenB1v7/?utm_source=ig_web_copy_link", "https://www.instagram.com/p/BysOqenB1v7/"],   // APA Style
    ["https://www.instagram.com/p/DIqghhpok2K/?img_index=2", "https://www.instagram.com/p/DIqghhpok2K/?img_index=2"],   // yt-dlp #12983 — KEEP
    // X / Twitter — `s` (which app copied it), `t` (the sharer), `ref_src`.
    ["https://x.com/kimtzutzu/status/2054462764098228326?s=20", "https://x.com/kimtzutzu/status/2054462764098228326"],
    ["https://twitter.com/chrissteinplays/status/1461003062936547331?t=CXBXxSiUKI8wPAkoGMH7zg", "https://twitter.com/chrissteinplays/status/1461003062936547331"],   // ClearURLs #203
    ["https://twitter.com/colegleason/status/1100432199793496064?ref_src=twsrc%5Etfw", "https://twitter.com/colegleason/status/1100432199793496064"],   // adrianroselli.com
    // Rumble — `e9s` and `sci` look like source and session codes, but nothing documents them: LEFT ALONE.
    ["https://rumble.com/v2o2oe5-synthwave-radio-beats-to-chillgame-to.html?e9s=src_v1_s%2Csrc_v1_s_o&sci=d4855fe5-3484-4b32-bc42-2c324fe6b3b9",
     "https://rumble.com/v2o2oe5-synthwave-radio-beats-to-chillgame-to.html?e9s=src_v1_s%2Csrc_v1_s_o&sci=d4855fe5-3484-4b32-bc42-2c324fe6b3b9"],   // AdguardFilters #240640 — KEEP
    ["https://discord.gg/UVzSQNBPm8", "https://discord.gg/UVzSQNBPm8"],                                             // KEEP
    ["https://streamable.com/dnd1", "https://streamable.com/dnd1"],                                                 // KEEP
    // Reddit — `share_id` and the `utm_` set; `context` works the link. The app's /s/ links are opaque.
    ["https://www.reddit.com/r/privacy/comments/1kpib8z/comment/msy0s0f/?context=3&share_id=6RPEXUF79Gc6bFdoorJFB&utm_content=1&utm_medium=ios_app&utm_name=ioscss&utm_source=share&utm_term=1",
     "https://www.reddit.com/r/privacy/comments/1kpib8z/comment/msy0s0f/?context=3"],                              // r/privacy thread
    ["https://www.reddit.com/r/privacy/s/SDstOAlLkg", "https://www.reddit.com/r/privacy/s/SDstOAlLkg"],             // short — KEEP
    // SoundCloud — `si` and `utm_`; `secret_token` opens a private track.
    ["https://soundcloud.com/c418/dreiton?si=ce7ef5e4c38a4024bfda6035e7f764bd&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing",
     "https://soundcloud.com/c418/dreiton"],                                                                        // imputnet/cobalt #1564
    ["https://on.soundcloud.com/9TqpUbrnArHjKNAq6", "https://on.soundcloud.com/9TqpUbrnArHjKNAq6"],                 // short — KEEP
    ["https://api.soundcloud.com/tracks/123998367?secret_token=s-8Pjrp", "https://api.soundcloud.com/tracks/123998367?secret_token=s-8Pjrp"],   // KEEP
    // Spotify — `si`; `context` and `t` work the link; spotify.link is opaque.
    ["https://open.spotify.com/track/1BQGm9ihveYD4JWpG8TAMQ?si=fc3177acf3a24145", "https://open.spotify.com/track/1BQGm9ihveYD4JWpG8TAMQ"],   // SubmitHub
    ["https://open.spotify.com/track/1BQGm9ihveYD4JWpG8TAMQ?context=spotify:playlist:37i9dQZF1DZ06evO3S88FQ&si=4318bd9c8baa4224",
     "https://open.spotify.com/track/1BQGm9ihveYD4JWpG8TAMQ?context=spotify:playlist:37i9dQZF1DZ06evO3S88FQ"],
    ["https://spotify.link/hRkBrwub9xb", "https://spotify.link/hRkBrwub9xb"],                                       // short — KEEP
    ["https://open.spotify.com/episode/24GvJqPbc7MEi7JqN2IBJb?t=1450", "https://open.spotify.com/episode/24GvJqPbc7MEi7JqN2IBJb?t=1450"],   // KEEP
    ["https://bandcamp.com/recommended/stevelawson?from=sbarrec", "https://bandcamp.com/recommended/stevelawson?from=sbarrec"],   // KEEP
    // Twitch — `tt_medium` is listed by ClearURLs only: LEFT ALONE. Clip filters work the link.
    ["https://inspector.twitch.tv/?tt_medium=dashboard_stream_health_pill", "https://inspector.twitch.tv/?tt_medium=dashboard_stream_health_pill"],   // KEEP
    ["https://www.twitch.tv/staryuuki/clip/CloudySavageMarjoramRuleFive--ErzsYbE7UWvgCMQ?filter=clips&range=all&sort=time",
     "https://www.twitch.tv/staryuuki/clip/CloudySavageMarjoramRuleFive--ErzsYbE7UWvgCMQ?filter=clips&range=all&sort=time"],   // KEEP
    // Games — a room or game is in a bare key or a fragment; they come through byte for byte. chess.com's `ref_id` is its
    // affiliate code (chess.com "Affiliate Program: Best Practices").
    ["https://skribbl.io/?XvCVTn2Z", "https://skribbl.io/?XvCVTn2Z"],                                               // vlr.gg — KEEP
    ["https://lichess.org/82nLhHja/black#3", "https://lichess.org/82nLhHja/black#3"],                               // KEEP
    ["https://lichess.org/game/V8syDAOR/black#3", "https://lichess.org/game/V8syDAOR/black#3"],                     // lila #22223 — KEEP
    ["https://lichess.org/?user=SergioGlorias&variant=crazyhouse&time=realTime&minutesPerSide=3&increment=2#friend",
     "https://lichess.org/?user=SergioGlorias&variant=crazyhouse&time=realTime&minutesPerSide=3&increment=2#friend"],   // lichess blog — KEEP
    ["https://www.chess.com/game/live/14976982609", "https://www.chess.com/game/live/14976982609"],                 // KEEP
    ["https://chess.com/register?ref_id=64602858", "https://chess.com/register"],                                   // chess.com forum
    ["https://tetr.io/#R:eNBCPZ57a@6", "https://tetr.io/#R:eNBCPZ57a@6"],                                           // tetrio/issues #965 — KEEP
    // Stores — Steam's `snr`, Humble's `partner` and `refc`, GOG's `pp`; Humble's `charity` chooses the charity.
    ["https://store.steampowered.com/app/959490/?snr=1_25_4__318", "https://store.steampowered.com/app/959490/"],   // Steam forum
    ["https://store.steampowered.com/app/480?utm_source=homepage&utm_campaign=summer_sale&utm_medium=web", "https://store.steampowered.com/app/480"],   // Valve's UTM page
    ["https://www.humblebundle.com?partner=gamegrin&charity=15796", "https://www.humblebundle.com?charity=15796"],   // GameGrin
    ["https://www.humblebundle.com/membership?refc=tuTRtP", "https://www.humblebundle.com/membership"],             // Threads @gabo_pavo
    ["https://www.gog.com/galaxy?pp=ffb4ad28cfc1d2fec2591aef120bfab99dd35307", "https://www.gog.com/galaxy"],
    ["https://www.gog.com/?utm_campaign=adtraction&utm_medium=affiliate&utm_source=adtraction", "https://www.gog.com/"],   // Heroic #3602
    ["https://af.gog.com/en/promo/2022_the_gog_sale_1usd?as=1636858786", "https://af.gog.com/en/promo/2022_the_gog_sale_1usd?as=1636858786"],   // KEEP
    ["https://store.ubisoft.com/us/ubisoftplus?lang=en_US&ucid=DDP-ID_163787&maltcode=brand_leads_DDP_other___STORE____",
     "https://store.ubisoft.com/us/ubisoftplus?lang=en_US&ucid=DDP-ID_163787&maltcode=brand_leads_DDP_other___STORE____"],   // KEEP: not proven
  ];
  {
    // `fetch`, XHR, WebSocket and the beacon laid over the world as tripwires: cleaning must reach none of them.
    const net = [];
    const trip = (n) => function () { net.push(n); throw new Error(n + " reached"); };
    const w = W.world({ extras: { URL, fetch: trip("fetch"), XMLHttpRequest: trip("XMLHttpRequest"), WebSocket: trip("WebSocket"),
      navigator: { sendBeacon: trip("sendBeacon") } } });
    const C = w.sb.Chat;
    ok(typeof C.cleanLinks === "function", "C PREMISE — `Chat.cleanLinks` exists: the one function a message's links are cleaned by", typeof C.cleanLinks);
    const clean = (t) => (typeof C.cleanLinks === "function" ? C.cleanLinks(t) : null);
    const strips = SAMPLES.filter(([a, b]) => a !== b).length, keeps = SAMPLES.length - strips;
    ok(strips >= 25 && keeps >= 20, "C PREMISE — the table holds strip-cases AND keep-cases", { strips, keeps });
    for (const [before, after] of SAMPLES) {
      const got = clean(before);
      ok(got === after, (after === before ? "C KEEP: " : "C STRIP: ") + before + "  →  " + after, got);
    }
    // Inside a sentence, with punctuation around the links and the words left exactly as typed.
    const msg = "look https://youtu.be/k_-6KI3m31M?si=JDZTHRDTs-unM34A, and (https://open.spotify.com/track/1BQGm9ihveYD4JWpG8TAMQ?si=fc3177acf3a24145). ok!";
    ok(clean(msg) === "look https://youtu.be/k_-6KI3m31M, and (https://open.spotify.com/track/1BQGm9ihveYD4JWpG8TAMQ). ok!",
      "C: INSIDE A SENTENCE EVERY LINK IS CLEANED, its punctuation and the words around it untouched — a bracket before it too", clean(msg));
    // The shapes that must come through byte for byte.
    const SAME = [
      "https://skribbl.io/?XvCVTn2Z", "http://www.humblebundle.com/?thq", "https://www.humblebundle.com/?thq",
      "http://youtu.be/abc?si=x",                                        // http: is not cleaned, as it is not linked
      "https://youtu.be/abc#si=x",                                       // a fragment is never touched
      "https://open.spotify.com/track/1?context=spotify%3Aplaylist%3Ax", // an encoded value stays encoded
      "https://example.com/a?q=a+b&si=x&ref=y&pp=1&s=2&t=3",            // a host with no table: only the globals go, and there are none
      "plain words, no link at all.",
    ];
    for (const t of SAME) ok(clean(t) === t, "C: NEVER BREAK A LINK — comes through byte for byte: " + t, clean(t));
    // The owner's globals, on any host (constructed: the owner named them, and they are the same on every site).
    ok(clean("https://example.com/a?id=1&utm_source=x&fbclid=IwAR0abc&gclid=Cj0K") === "https://example.com/a?id=1",
      "C: utm_*, fbclid AND gclid GO EVERYWHERE — the one rule that is not per host (constructed)", clean("https://example.com/a?id=1&utm_source=x&fbclid=IwAR0abc&gclid=Cj0K"));
    // A name is only stripped where that host's table names it (constructed controls).
    ok(clean("https://www.gog.com/x?pp=1") === "https://www.gog.com/x" && clean("https://youtube.com/watch?v=a&pp=1") === "https://youtube.com/watch?v=a&pp=1",
      "C: THE SAME NAME, TWO HOSTS — `pp` is GOG's affiliate code and stays on YouTube (constructed)");
    ok(clean("https://x.com/a/status/1?t=abc") === "https://x.com/a/status/1" && clean("https://youtu.be/a?t=42") === "https://youtu.be/a?t=42",
      "C: `t` is X's sharer and YouTube's time (constructed)");
    ok(clean("https://www.youtube.com/watch?v=F6va6tg62qg&t=14s&si=abc&index=3&list=PLx") === "https://www.youtube.com/watch?v=F6va6tg62qg&t=14s&index=3&list=PLx",
      "C: ON youtube.com TOO, `t` AND `index` STAY WHEN `si` GOES (constructed; `ddjp_641`)");
    ok(clean("https://youtube.com.evil.example/watch?v=a&si=b") === "https://youtube.com.evil.example/watch?v=a&si=b",
      "C: a host is matched exactly or as a subdomain — a look-alike gets no table (constructed)");
    ok(clean("HTTPS://YOUTU.BE/abc?si=x") === "HTTPS://YOUTU.BE/abc", "C: the host is read case-blind, the rest kept as typed (constructed)");
    ok(clean("https://soundcloud.com/c418/dreiton?si=ce7ef5e4&utm_source=clipboard#t=54:00") === "https://soundcloud.com/c418/dreiton#t=54:00",
      "C: THE FRAGMENT IS KEPT WHEN THE QUERY BEFORE IT IS CLEANED — a SoundCloud time stays (constructed)");
    ok(clean("https://vm.tiktok.com/ZML9MrEa6/?_r=1&utm_source=copy") === "https://vm.tiktok.com/ZML9MrEa6/?_r=1&utm_source=copy"
       && clean("https://www.reddit.com/r/privacy/s/SDstOAlLkg?utm_source=share") === "https://www.reddit.com/r/privacy/s/SDstOAlLkg?utm_source=share",
      "C: A SHORT LINK IS LEFT EXACTLY AS TYPED — its code is the link, so nothing in it is touched (constructed)");
    ok(net.length === 0, "C: NO NETWORK CALL IS EVER MADE TO CLEAN A LINK — fetch, XHR, WebSocket and the beacon untouched", net);
    ok(typeof clean(msg) === "string", "C: and it answers at once, a string — nothing awaited", typeof clean(msg));
    // TIED TO THE DISPLAY: every link the chat draws from a cleaned message is already clean, so no code is shown to the
    // others that the sender's device could have taken out.
    const allOpts = { imagesOn: false, linksOn: true, imageHostAllowed: () => false, linkHostAllowed: () => true };
    const drawnLinks = SAMPLES.map(([b]) => "see " + b + ", then (" + b + ")! " + b + ".")
      .map((m) => w.sb.ChatBuffer.classify(clean(m) || "", allOpts).parts.filter((p) => p.href).map((p) => p.text))
      .reduce((a, b) => a.concat(b), []);
    ok(drawnLinks.length >= SAMPLES.length * 2 && drawnLinks.every((t) => clean(t) === t),
      "C: EVERY LINK DRAWN FROM A CLEANED MESSAGE IS ALREADY CLEAN — the cleaner reaches every link the chat draws", drawnLinks.filter((t) => clean(t) !== t).slice(0, 3));
    // THE SEND PATHS: what reaches the transport is the clean text — room chat and a DM.
    await C.send("look " + SAMPLES[0][0] + " now");
    const roomSent = w.sent[w.sent.length - 1];
    ok(roomSent && roomSent.text === "look " + SAMPLES[0][1] + " now", "C: ROOM CHAT SENDS THE CLEAN LINK — the code never leaves the device", roomSent);
    C.dmInit(); C.openDMRoom("!dm:hs");
    const rd = SAMPLES.find(([b]) => /share_id=/.test(b));
    const d1 = await C.sendDM("here " + rd[0]);
    const dmSent = w.sent[w.sent.length - 1];
    ok(d1 && d1.ok && dmSent && dmSent.roomId === "!dm:hs" && dmSent.text === "here " + rd[1],
      "C: A DM SENDS THE CLEAN LINK TOO", { d1, dmSent });
  }

  console.log(failed ? "[chat-links] " + failed + " failure(s) in " + asserts + " assertions"
    : "[chat-links] PASS — Settings lists every link site, on, under the owner's kinds, none twice; every https URL inside a message, on an allowed link host, is a link wherever a chat body is drawn (room "
    + "chat, the room's DM tab, the lobby's DMs), with today's attributes and its trailing punctuation outside it; a host not allowed "
    + "stays plain; a whole-message image is an image and one inside a sentence only a link; long plain runs still break; and the sender's "
    + "device sends every link without its ID, tracking and referral codes, by a per-host table held to real share links, keep-cases "
    + "and strip-cases, with no network call (" + asserts + " assertions)");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log("[chat-links] FAIL — threw: " + String(e && e.stack || e).split("\n").slice(0, 4).join(" | ")); process.exit(1); });
