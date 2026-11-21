// core/countries.js — Countries: every country a person can be in, and what a typed country means
//
// THE OWNER'S PLAN (J153, `main/01-project.md` item 9): people tell the bot their country (`!setcountry`), the bot carries it
// on REP's messages, and later a song blocked somewhere is checked against the countries of the people here. His words for
// what a person may type: "accepted france France FRANCE fr FR or code". This file is the one home of that vocabulary: every
// ISO 3166-1 country with its two-letter code, its number code and its English name, and the one reading of a typed country.
//
// ── THE ROWS ARE WRITTEN IN, NOT COMPUTED ─────────────────────────────────────────────────────────────────────────────────
// One row per country: `[code, number, name, aliases]`, taken at J153 from the ISO 3166-1 list (the Debian `iso-codes`
// package, 4.16), the name its common English short form where ISO inverts it ("Iran", not "Iran, Islamic Republic of"; the
// ISO form stays as an alias). Written in so a guard can hold it and every device reads it the same way: browsers' own
// country names (`Intl.DisplayNames`) differ between browsers and versions, so a parse built on them would make one typed
// word mean two countries on two screens. Names shown in a person's own language may come from `Intl.DisplayNames` over the
// CODES, for display only; parsing never does. Kosovo (`XK`) is not in ISO 3166-1, so it is not here.
//
// ── WHAT A TYPED COUNTRY MEANS (`read`) ───────────────────────────────────────────────────────────────────────────────────
// Two letters, in any case, are a code ("fr", "FR"); one to three digits are a number code ("250", "4", "004"); anything else
// is a name or an alias, compared FOLDED: case, accents, punctuation and spaces do not count, "&" reads "and", "St" reads
// "Saint", and a leading "The" is dropped ("France", "FRANCE", "cote d'ivoire", "St. Lucia", "The Gambia"). A code that is
// no country falls through to the names ("UK" is an alias, not a code). A name two countries share is AMBIGUOUS, refused by
// its own reason rather than guessed (`AMBIGUOUS`, below): "Korea" could be the South or the North. A name that is one
// country's exact short name is that country, whatever else it resembles: "Congo" is the Republic of the Congo, ISO's own
// short name for it; the other is "DR Congo", "DRC" or "Congo-Kinshasa".
//
// ── WHAT ASKS HERE ────────────────────────────────────────────────────────────────────────────────────────────────────────
//   · REP's bot side, through its ports (`features/rep-ports.js`): `!setcountry`'s country (`read`), and the codes a REP
//     message may carry (`codes`), which REP's rules are handed, never keeping a copy.
//   · The two song-metadata boundaries (J153 (c)): where a song is blocked, read through `regionList` (below).
//   · A song row's globe and its pop-up, Region Blocks (`ui/playlists.js`, J153 (c), `ddjp_729`): who here a saved answer
//     leaves out, and which countries (`blockedView`); the map's shapes are named by this table's numbers (`core/worldmap.js`).
// `check-countries` holds the table: codes, numbers, names and aliases each unique, every ambiguous name refused, and the
// answer for each form.
//
// Pure: no dependencies, no I/O, no clock; the same input gives the same output, and nothing here throws.

const Countries = (() => {
  "use strict";

  // ── THE COUNTRIES ──────────────────────────────────────────────────────────────────────────────────────────────────────
  //   [code, number, name, aliases?] — `code` ISO 3166-1 alpha-2, `number` its numeric code, `name` the English name a
  //   reply says, `aliases` other names it is typed as (ISO's own form where the name differs from it).
  const ROWS = [
    ["AD", 20, "Andorra"],
    ["AE", 784, "United Arab Emirates", ["UAE"]],
    ["AF", 4, "Afghanistan"],
    ["AG", 28, "Antigua and Barbuda"],
    ["AI", 660, "Anguilla"],
    ["AL", 8, "Albania"],
    ["AM", 51, "Armenia"],
    ["AO", 24, "Angola"],
    ["AQ", 10, "Antarctica"],
    ["AR", 32, "Argentina"],
    ["AS", 16, "American Samoa"],
    ["AT", 40, "Austria"],
    ["AU", 36, "Australia"],
    ["AW", 533, "Aruba"],
    ["AX", 248, "Åland Islands"],
    ["AZ", 31, "Azerbaijan"],
    ["BA", 70, "Bosnia and Herzegovina"],
    ["BB", 52, "Barbados"],
    ["BD", 50, "Bangladesh"],
    ["BE", 56, "Belgium"],
    ["BF", 854, "Burkina Faso"],
    ["BG", 100, "Bulgaria"],
    ["BH", 48, "Bahrain"],
    ["BI", 108, "Burundi"],
    ["BJ", 204, "Benin"],
    ["BL", 652, "Saint Barthélemy"],
    ["BM", 60, "Bermuda"],
    ["BN", 96, "Brunei", ["Brunei Darussalam"]],
    ["BO", 68, "Bolivia", ["Bolivia, Plurinational State of"]],
    ["BQ", 535, "Bonaire, Sint Eustatius and Saba", ["Caribbean Netherlands"]],
    ["BR", 76, "Brazil"],
    ["BS", 44, "Bahamas"],
    ["BT", 64, "Bhutan"],
    ["BV", 74, "Bouvet Island"],
    ["BW", 72, "Botswana"],
    ["BY", 112, "Belarus"],
    ["BZ", 84, "Belize"],
    ["CA", 124, "Canada"],
    ["CC", 166, "Cocos (Keeling) Islands"],
    ["CD", 180, "Democratic Republic of the Congo", ["Congo, The Democratic Republic of the", "DR Congo", "DRC", "Congo-Kinshasa"]],
    ["CF", 140, "Central African Republic"],
    ["CG", 178, "Congo", ["Republic of the Congo", "Congo-Brazzaville"]],
    ["CH", 756, "Switzerland"],
    ["CI", 384, "Côte d'Ivoire", ["Ivory Coast"]],
    ["CK", 184, "Cook Islands"],
    ["CL", 152, "Chile"],
    ["CM", 120, "Cameroon"],
    ["CN", 156, "China"],
    ["CO", 170, "Colombia"],
    ["CR", 188, "Costa Rica"],
    ["CU", 192, "Cuba"],
    ["CV", 132, "Cabo Verde", ["Cape Verde"]],
    ["CW", 531, "Curaçao"],
    ["CX", 162, "Christmas Island"],
    ["CY", 196, "Cyprus"],
    ["CZ", 203, "Czechia", ["Czech Republic"]],
    ["DE", 276, "Germany"],
    ["DJ", 262, "Djibouti"],
    ["DK", 208, "Denmark"],
    ["DM", 212, "Dominica"],
    ["DO", 214, "Dominican Republic"],
    ["DZ", 12, "Algeria"],
    ["EC", 218, "Ecuador"],
    ["EE", 233, "Estonia"],
    ["EG", 818, "Egypt"],
    ["EH", 732, "Western Sahara"],
    ["ER", 232, "Eritrea"],
    ["ES", 724, "Spain"],
    ["ET", 231, "Ethiopia"],
    ["FI", 246, "Finland"],
    ["FJ", 242, "Fiji"],
    ["FK", 238, "Falkland Islands", ["Falkland Islands (Malvinas)"]],
    ["FM", 583, "Micronesia", ["Micronesia, Federated States of"]],
    ["FO", 234, "Faroe Islands"],
    ["FR", 250, "France"],
    ["GA", 266, "Gabon"],
    ["GB", 826, "United Kingdom", ["UK", "Great Britain", "Britain"]],
    ["GD", 308, "Grenada"],
    ["GE", 268, "Georgia"],
    ["GF", 254, "French Guiana"],
    ["GG", 831, "Guernsey"],
    ["GH", 288, "Ghana"],
    ["GI", 292, "Gibraltar"],
    ["GL", 304, "Greenland"],
    ["GM", 270, "Gambia"],
    ["GN", 324, "Guinea"],
    ["GP", 312, "Guadeloupe"],
    ["GQ", 226, "Equatorial Guinea"],
    ["GR", 300, "Greece"],
    ["GS", 239, "South Georgia and the South Sandwich Islands"],
    ["GT", 320, "Guatemala"],
    ["GU", 316, "Guam"],
    ["GW", 624, "Guinea-Bissau"],
    ["GY", 328, "Guyana"],
    ["HK", 344, "Hong Kong"],
    ["HM", 334, "Heard Island and McDonald Islands"],
    ["HN", 340, "Honduras"],
    ["HR", 191, "Croatia"],
    ["HT", 332, "Haiti"],
    ["HU", 348, "Hungary"],
    ["ID", 360, "Indonesia"],
    ["IE", 372, "Ireland"],
    ["IL", 376, "Israel"],
    ["IM", 833, "Isle of Man"],
    ["IN", 356, "India"],
    ["IO", 86, "British Indian Ocean Territory"],
    ["IQ", 368, "Iraq"],
    ["IR", 364, "Iran", ["Iran, Islamic Republic of"]],
    ["IS", 352, "Iceland"],
    ["IT", 380, "Italy"],
    ["JE", 832, "Jersey"],
    ["JM", 388, "Jamaica"],
    ["JO", 400, "Jordan"],
    ["JP", 392, "Japan"],
    ["KE", 404, "Kenya"],
    ["KG", 417, "Kyrgyzstan"],
    ["KH", 116, "Cambodia"],
    ["KI", 296, "Kiribati"],
    ["KM", 174, "Comoros"],
    ["KN", 659, "Saint Kitts and Nevis"],
    ["KP", 408, "North Korea", ["Korea, Democratic People's Republic of"]],
    ["KR", 410, "South Korea", ["Korea, Republic of"]],
    ["KW", 414, "Kuwait"],
    ["KY", 136, "Cayman Islands"],
    ["KZ", 398, "Kazakhstan"],
    ["LA", 418, "Laos", ["Lao People's Democratic Republic"]],
    ["LB", 422, "Lebanon"],
    ["LC", 662, "Saint Lucia"],
    ["LI", 438, "Liechtenstein"],
    ["LK", 144, "Sri Lanka"],
    ["LR", 430, "Liberia"],
    ["LS", 426, "Lesotho"],
    ["LT", 440, "Lithuania"],
    ["LU", 442, "Luxembourg"],
    ["LV", 428, "Latvia"],
    ["LY", 434, "Libya"],
    ["MA", 504, "Morocco"],
    ["MC", 492, "Monaco"],
    ["MD", 498, "Moldova", ["Moldova, Republic of"]],
    ["ME", 499, "Montenegro"],
    ["MF", 663, "Saint Martin", ["Saint Martin (French part)"]],
    ["MG", 450, "Madagascar"],
    ["MH", 584, "Marshall Islands"],
    ["MK", 807, "North Macedonia", ["Macedonia"]],
    ["ML", 466, "Mali"],
    ["MM", 104, "Myanmar", ["Burma"]],
    ["MN", 496, "Mongolia"],
    ["MO", 446, "Macao", ["Macau"]],
    ["MP", 580, "Northern Mariana Islands"],
    ["MQ", 474, "Martinique"],
    ["MR", 478, "Mauritania"],
    ["MS", 500, "Montserrat"],
    ["MT", 470, "Malta"],
    ["MU", 480, "Mauritius"],
    ["MV", 462, "Maldives"],
    ["MW", 454, "Malawi"],
    ["MX", 484, "Mexico"],
    ["MY", 458, "Malaysia"],
    ["MZ", 508, "Mozambique"],
    ["NA", 516, "Namibia"],
    ["NC", 540, "New Caledonia"],
    ["NE", 562, "Niger"],
    ["NF", 574, "Norfolk Island"],
    ["NG", 566, "Nigeria"],
    ["NI", 558, "Nicaragua"],
    ["NL", 528, "Netherlands"],
    ["NO", 578, "Norway"],
    ["NP", 524, "Nepal"],
    ["NR", 520, "Nauru"],
    ["NU", 570, "Niue"],
    ["NZ", 554, "New Zealand"],
    ["OM", 512, "Oman"],
    ["PA", 591, "Panama"],
    ["PE", 604, "Peru"],
    ["PF", 258, "French Polynesia"],
    ["PG", 598, "Papua New Guinea"],
    ["PH", 608, "Philippines"],
    ["PK", 586, "Pakistan"],
    ["PL", 616, "Poland"],
    ["PM", 666, "Saint Pierre and Miquelon"],
    ["PN", 612, "Pitcairn Islands", ["Pitcairn"]],
    ["PR", 630, "Puerto Rico"],
    ["PS", 275, "Palestine", ["Palestine, State of", "State of Palestine"]],
    ["PT", 620, "Portugal"],
    ["PW", 585, "Palau"],
    ["PY", 600, "Paraguay"],
    ["QA", 634, "Qatar"],
    ["RE", 638, "Réunion"],
    ["RO", 642, "Romania"],
    ["RS", 688, "Serbia"],
    ["RU", 643, "Russia", ["Russian Federation"]],
    ["RW", 646, "Rwanda"],
    ["SA", 682, "Saudi Arabia"],
    ["SB", 90, "Solomon Islands"],
    ["SC", 690, "Seychelles"],
    ["SD", 729, "Sudan"],
    ["SE", 752, "Sweden"],
    ["SG", 702, "Singapore"],
    ["SH", 654, "Saint Helena, Ascension and Tristan da Cunha", ["Saint Helena"]],
    ["SI", 705, "Slovenia"],
    ["SJ", 744, "Svalbard and Jan Mayen"],
    ["SK", 703, "Slovakia"],
    ["SL", 694, "Sierra Leone"],
    ["SM", 674, "San Marino"],
    ["SN", 686, "Senegal"],
    ["SO", 706, "Somalia"],
    ["SR", 740, "Suriname"],
    ["SS", 728, "South Sudan"],
    ["ST", 678, "Sao Tome and Principe"],
    ["SV", 222, "El Salvador"],
    ["SX", 534, "Sint Maarten", ["Sint Maarten (Dutch part)"]],
    ["SY", 760, "Syria", ["Syrian Arab Republic"]],
    ["SZ", 748, "Eswatini", ["Swaziland"]],
    ["TC", 796, "Turks and Caicos Islands"],
    ["TD", 148, "Chad"],
    ["TF", 260, "French Southern Territories"],
    ["TG", 768, "Togo"],
    ["TH", 764, "Thailand"],
    ["TJ", 762, "Tajikistan"],
    ["TK", 772, "Tokelau"],
    ["TL", 626, "Timor-Leste", ["East Timor"]],
    ["TM", 795, "Turkmenistan"],
    ["TN", 788, "Tunisia"],
    ["TO", 776, "Tonga"],
    ["TR", 792, "Türkiye", ["Turkey"]],
    ["TT", 780, "Trinidad and Tobago"],
    ["TV", 798, "Tuvalu"],
    ["TW", 158, "Taiwan", ["Taiwan, Province of China"]],
    ["TZ", 834, "Tanzania", ["Tanzania, United Republic of"]],
    ["UA", 804, "Ukraine"],
    ["UG", 800, "Uganda"],
    ["UM", 581, "United States Minor Outlying Islands"],
    ["US", 840, "United States", ["USA", "United States of America"]],
    ["UY", 858, "Uruguay"],
    ["UZ", 860, "Uzbekistan"],
    ["VA", 336, "Vatican City", ["Holy See (Vatican City State)", "Holy See", "Vatican"]],
    ["VC", 670, "Saint Vincent and the Grenadines"],
    ["VE", 862, "Venezuela", ["Venezuela, Bolivarian Republic of"]],
    ["VG", 92, "British Virgin Islands", ["Virgin Islands, British"]],
    ["VI", 850, "United States Virgin Islands", ["Virgin Islands, U.S.", "US Virgin Islands"]],
    ["VN", 704, "Vietnam", ["Viet Nam"]],
    ["VU", 548, "Vanuatu"],
    ["WF", 876, "Wallis and Futuna"],
    ["WS", 882, "Samoa"],
    ["YE", 887, "Yemen"],
    ["YT", 175, "Mayotte"],
    ["ZA", 710, "South Africa"],
    ["ZM", 894, "Zambia"],
    ["ZW", 716, "Zimbabwe"],
  ];

  // ── NAMES TWO COUNTRIES SHARE (the owner's supervisor, J153 (b)): refused by their own reason, never guessed. Each is no
  // country's name or alias; `check-countries` holds that, and that each names the countries it could mean.
  const AMBIGUOUS = [
    ["Korea", ["KR", "KP"]],
    ["Virgin Islands", ["VG", "VI"]],
  ];

  // A name as compared: lower case, accents off, "&" as "and", each word kept, "st" read "saint", a leading "the" dropped,
  // then everything but letters and digits removed.
  function fold(text) {
    if (typeof text !== "string") return "";
    let s = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/['\u2019]/g, "");
    let words = s.split(/[^a-z0-9]+/).filter(Boolean);
    words = words.map((w) => (w === "st" ? "saint" : w));
    if (words.length > 1 && words[0] === "the") words = words.slice(1);
    return words.join("");
  }

  const _byCode = Object.create(null), _byNum = Object.create(null), _byName = Object.create(null), _ambiguous = Object.create(null);
  const _all = [];
  for (const r of ROWS) {
    const c = Object.freeze({ code: r[0], num: r[1], name: r[2] });
    _all.push(c);
    _byCode[c.code] = c;
    _byNum[c.num] = c;
    for (const n of [r[2]].concat(r[3] || [])) _byName[fold(n)] = c;
  }
  for (const a of AMBIGUOUS) _ambiguous[fold(a[0])] = a[1].slice();

  // The country with this two-letter code, or null.
  function byCode(code) {
    if (typeof code !== "string" || !/^[A-Za-z]{2}$/.test(code)) return null;
    return _byCode[code.toUpperCase()] || null;
  }
  // What a typed country means: { ok: true, country: { code, num, name } }, or { ok: false, why: "ambiguous", could: [codes] }
  // or { ok: false, why: "unknown" }.
  function read(text) {
    const t = (typeof text === "string") ? text.trim() : "";
    if (!t) return { ok: false, why: "unknown" };
    if (/^[A-Za-z]{2}$/.test(t) && _byCode[t.toUpperCase()]) return { ok: true, country: _byCode[t.toUpperCase()] };
    if (/^\d{1,3}$/.test(t)) {
      const c = _byNum[Number(t)];
      return c ? { ok: true, country: c } : { ok: false, why: "unknown" };
    }
    const k = fold(t);
    if (k && _byName[k]) return { ok: true, country: _byName[k] };
    if (k && _ambiguous[k]) return { ok: false, why: "ambiguous", could: _ambiguous[k].slice() };
    return { ok: false, why: "unknown" };
  }
  // The country a typed country means, or null.
  function parse(text) { const r = read(text); return r.ok ? r.country : null; }
  // Every two-letter code, A to Z.
  function codes() { return _all.map((c) => c.code); }

  // ── WHERE A SONG MAY PLAY, AS COUNTRIES (J153 (c)) ────────────────────────────────────────────────────────────────────
  // A source says either the countries a song is BLOCKED in or the only ones it is ALLOWED in (YouTube's own two forms; an
  // EMPTY allowed list means allowed nowhere, which is not the same as no restriction). `regionList` reads one such answer:
  // every code is checked against the table above, so a code that is no country (`EU`, `ZZ`, a typo, lower case) is dropped,
  // and the answer is kept in its SHORTER form — a blocked list longer than the rest of the table is kept as the allowed
  // list, and the other way round; a tie keeps `blocked`. Deterministic over the table, so every device keeps the same
  // answer the same way. Exactly one of the two lists must be given: both, neither, or a list that is no array, reads null.
  // Returns `{ blocked: [codes] }` or `{ allowed: [codes] }`, A to Z. Its two callers are the song-metadata boundaries
  // (`features/metadata.js` `sanitize`, `core/playlistdoc.js` `sanitizeMeta`): one rule, so they cannot drift.
  const REGION_SCAN_MAX = 1000;   // an answer's list is read this far and no further: the table is a quarter of it
  function regionList(r) {
    if (!r || typeof r !== "object") return null;
    const hasA = Array.isArray(r.allowed), hasB = Array.isArray(r.blocked);
    if (hasA === hasB) return null;
    const named = Object.create(null);
    for (const c of (hasA ? r.allowed : r.blocked).slice(0, REGION_SCAN_MAX)) if (typeof c === "string" && _byCode[c]) named[c] = true;
    const blocked = [], allowed = [];
    for (const c of _all) ((named[c.code] === true) === hasB ? blocked : allowed).push(c.code);
    return blocked.length <= allowed.length ? { blocked: blocked } : { allowed: allowed };
  }
  // ── WHO HERE A SONG IS BLOCKED FOR (J153 (c), the owner's icon) ─────────────────────────────────────────────────────────
  // One answer for the globe on a song row and for its pop-up, so the two cannot disagree. `geo` is a saved answer as the
  // metadata boundary keeps it (`{ blocked | allowed, embeddable, … }`, its list already `regionList`'s); `cc` is
  // `{ person: code }`, the countries REP's messages name (never worked out here). Returns:
  //   tone        null (no icon: no answer, or one with no country limit that can play on other sites), "grey" (blocked
  //               somewhere, for none of `cc`), or "red" (blocked for at least one of `cc`, or it cannot play on other sites —
  //               `embeddable` false, the read-through's adopted default);
  //   people      `[{ user, code }]`, those of `cc` whose country the answer leaves out, A to Z by person;
  //   kind, codes the answer's own list ("blocked" or "allowed", A to Z) or null and [];
  //   limited     whether the answer leaves any country out (an empty allowed list leaves out every one);
  //   blocked     every country of the table the answer leaves out, A to Z by code — Region Blocks' map and its two lists
  //               (`ddjp_729`) read this, so what "left out" means is said here and nowhere else;
  //   embeddable  true, false or null, as saved.
  // A country `cc` names that the table does not hold is nobody's here. Pure, like everything in this file.
  function blockedView(geo, cc) {
    const out = { tone: null, people: [], kind: null, codes: [], limited: false, blocked: [], embeddable: null };
    if (!geo || typeof geo !== "object") return out;
    out.embeddable = (geo.embeddable === true || geo.embeddable === false) ? geo.embeddable : null;
    const kind = Array.isArray(geo.allowed) ? "allowed" : (Array.isArray(geo.blocked) ? "blocked" : null);
    const listed = Object.create(null);
    if (kind) {
      for (const c of (kind === "allowed" ? geo.allowed : geo.blocked)) if (typeof c === "string" && _byCode[c]) listed[c] = true;
      out.kind = kind;
      out.codes = _all.map((c) => c.code).filter((c) => listed[c] === true);
      out.limited = kind === "blocked" ? out.codes.length > 0 : out.codes.length < _all.length;
    }
    const leftOut = (code) => kind === "blocked" ? listed[code] === true : (kind === "allowed" ? listed[code] !== true : false);
    out.blocked = _all.map((c) => c.code).filter(leftOut);
    if (cc && typeof cc === "object") {
      for (const u of Object.keys(cc).sort()) {
        const code = cc[u];
        if (typeof code === "string" && _byCode[code] && leftOut(code)) out.people.push({ user: u, code: code });
      }
    }
    out.tone = (out.people.length || out.embeddable === false) ? "red" : (out.limited ? "grey" : null);
    return out;
  }

  // The table as plain data, for the guard.
  function rows() { return ROWS.map((r) => ({ code: r[0], num: r[1], name: r[2], aliases: (r[3] || []).slice() })); }
  function ambiguous() { return AMBIGUOUS.map((a) => ({ name: a[0], could: a[1].slice() })); }

  return { read, parse, byCode, codes, regionList, blockedView, rows, ambiguous, fold };
})();
