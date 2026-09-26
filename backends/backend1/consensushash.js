// backends/backend1/consensushash.js
// Pure functions. No side effects, no dependencies (browser, IDB, clock, network,
// crypto.subtle) — a self-contained SHA-256 so the primitive is deterministic and
// GUARDABLE HEADLESSLY (the reference-hash mechanism it will underpin is consensus-
// critical, so its foundation must be testable without a live browser).
//
// This is the load-bearing content-addressing primitive for the hash-ref / voucher
// design (see docs/consensus/consensus-models.md §2, docs/consensus/consensus-models.md). It defines:
//   • DCF — the DDJP Canonical Form: a deterministic byte string for an event body,
//     so two clients hash the SAME bytes from the same event.
//   • contentHash(body) — base64url(unpadded) of SHA-256(DCF(body)).
//   • verify(body, expected) — the accept/reject gate a voucher passes through.
//
// THIS IS LIVE AND LOAD-BEARING. Every chained event (play/skip) carries a pHash committing its
// parent's body, stamped unconditionally — there is no per-room gate and no unhashed path. The
// vouch layer verifies against those commitments, so a record that does not reproduce the original
// loses to the maths. hv:1 names THIS scheme; a future scheme bumps hv and both can coexist
// (agility, §2.2).
//
// The header used to say the opposite — "NOTHING here is wired into the protocol yet" — and kept
// saying it long after the hash chain went live. That is worse than no comment: a note claiming a
// path is dormant reads as handled, so nobody looks there again. It is the same failure this
// codebase records elsewhere as "a message that names an action it does not take".
//
// LAYER NOTE: this file lives in backends/backend1/, not core/ — it is part of the swappable
// consensus engine, not shared infrastructure. It is pure and dependency-free, so it stays safe
// under the purity and layer guards, and it is used at runtime on every chained send.

const ConsensusHash = (() => {

  const HV = 1;                         // hash version: DCF + SHA-256 + base64url(unpadded)
  const MAX_SAFE = Number.MAX_SAFE_INTEGER;
  const ASCII_KEY = /^[\x20-\x7e]*$/;   // DCF keys must be printable ASCII (removes UTF-16 sort ambiguity)

  // ---- PURE: UTF-8 encode a JS string to bytes (handles full Unicode incl. astral
  // pairs). Manual so the module needs no TextEncoder (keeps it dependency-free). ----
  function _utf8(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) { out.push(c); }
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else if (c >= 0xd800 && c <= 0xdbff) {                 // high surrogate -> combine
        const c2 = str.charCodeAt(++i);
        const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return new Uint8Array(out);
  }

  // ---- PURE: SHA-256 over a byte array -> 32-byte Uint8Array. Standard FIPS 180-4;
  // uses only Uint32Array/DataView/Math (available in any JS context, incl. the guard
  // sandbox). Verified against Node's crypto in check-consensus-hash. ----
  const _K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);
  function _sha256(bytes) {
    let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
    const l = bytes.length;
    const bitHi = Math.floor((l / 0x20000000));   // (l*8) >> 32, computed without overflow
    const bitLo = (l * 8) >>> 0;
    const withOne = l + 1;
    const pad = (56 - (withOne % 64) + 64) % 64;
    const total = withOne + pad + 8;
    const msg = new Uint8Array(total);
    msg.set(bytes);
    msg[l] = 0x80;
    const dv = new DataView(msg.buffer);
    dv.setUint32(total - 8, bitHi >>> 0);
    dv.setUint32(total - 4, bitLo);
    const w = new Uint32Array(64);
    const R = (n, x) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let t = 0; t < 16; t++) w[t] = dv.getUint32(off + t * 4);
      for (let t = 16; t < 64; t++) {
        const s0 = R(7, w[t-15]) ^ R(18, w[t-15]) ^ (w[t-15] >>> 3);
        const s1 = R(17, w[t-2]) ^ R(19, w[t-2]) ^ (w[t-2] >>> 10);
        w[t] = (w[t-16] + s0 + w[t-7] + s1) >>> 0;
      }
      let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
      for (let t = 0; t < 64; t++) {
        const S1 = R(6, e) ^ R(11, e) ^ R(25, e);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + _K[t] + w[t]) >>> 0;
        const S0 = R(2, a) ^ R(13, a) ^ R(22, a);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h=g; g=f; f=e; e=(d + t1) >>> 0; d=c; c=b; b=a; a=(t1 + t2) >>> 0;
      }
      h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0; h4=(h4+e)>>>0; h5=(h5+f)>>>0; h6=(h6+g)>>>0; h7=(h7+h)>>>0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    const H = [h0,h1,h2,h3,h4,h5,h6,h7];
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i] >>> 0);
    return out;
  }

  // ---- PURE: base64url (unpadded) of a byte array. ----
  const _B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function _b64url(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i], has1 = i + 1 < bytes.length, has2 = i + 2 < bytes.length;
      const b1 = has1 ? bytes[i+1] : 0, b2 = has2 ? bytes[i+2] : 0;
      s += _B64[b0 >> 2];
      s += _B64[((b0 & 3) << 4) | (b1 >> 4)];
      if (has1) s += _B64[((b1 & 15) << 2) | (b2 >> 6)];
      if (has2) s += _B64[b2 & 63];
    }
    return s;
  }

  // ---- PURE: DCF string-escape (minimal JSON escapes; UTF-8 applied later). ----
  function _encStr(s) {
    let out = '"';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 0x22) out += '\\"';
      else if (c === 0x5c) out += "\\\\";
      else if (c === 0x08) out += "\\b";
      else if (c === 0x0c) out += "\\f";
      else if (c === 0x0a) out += "\\n";
      else if (c === 0x0d) out += "\\r";
      else if (c === 0x09) out += "\\t";
      else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
      else out += s[i];
    }
    return out + '"';
  }

  // ---- PURE: DCF — the DDJP Canonical Form (docs/consensus/consensus-models.md §2.1). Deterministic
  // serialization of a JSON value; THROWS on anything that can't be canonicalized
  // unambiguously (non-integer/NaN/Infinity/-0/out-of-range number, non-ASCII key,
  // unsupported type). Objects: ASCII keys sorted by code point; arrays: order kept. ----
  function _enc(v) {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "boolean") return v ? "true" : "false";
    if (t === "number") {
      if (!isFinite(v) || Math.floor(v) !== v || Object.is(v, -0) || Math.abs(v) > MAX_SAFE) {
        throw new Error("DCF: only finite integers within MAX_SAFE_INTEGER are allowed");
      }
      return String(v);
    }
    if (t === "string") return _encStr(v);
    if (Array.isArray(v)) return "[" + v.map(_enc).join(",") + "]";
    if (t === "object") {
      const keys = Object.keys(v);
      for (const k of keys) if (!ASCII_KEY.test(k)) throw new Error("DCF: object keys must be printable ASCII");
      keys.sort();   // ASCII => code-point order
      return "{" + keys.map((k) => _encStr(k) + ":" + _enc(v[k])).join(",") + "}";
    }
    throw new Error("DCF: unsupported value type " + t);
  }
  function canonicalize(value) { return _enc(value); }

  // ---- PURE: base64url(unpadded) SHA-256 of a UTF-8 string. Also the guard's oracle target. ----
  function hashString(str) { return _b64url(_sha256(_utf8(String(str)))); }

  // ---- PURE: the DDJP content hash of an event body: base64url(SHA-256(DCF(body))). ----
  function contentHash(body) { return hashString(canonicalize(body)); }

  // ---- PURE: verify a supplied body against an expected content hash. Never throws;
  // a body that can't be canonicalized (forbidden types) simply fails to verify. ----
  function _eq(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  }
  function verify(body, expectedHash) {
    let h;
    try { h = contentHash(body); } catch (e) { return false; }
    return _eq(h, expectedHash);
  }

  return { HV, canonicalize, hashString, contentHash, verify };
})();
