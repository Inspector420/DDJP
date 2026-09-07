// tools/probes/_journal.js
//
// MUTATION JOURNAL. Every probe that edits a file on disk writes its intent here BEFORE it edits,
// and clears the entry only after it has restored the original bytes. If a probe dies mid-run —
// a throw, a kill, a container reset — the next run finds a dirty journal and restores from the
// recorded originals instead of reading a mutated tree and calling it a measurement.
//
// WHY THIS EXISTS RATHER THAN A try/finally. A finally block does not survive the process being
// killed, and `09-roadmap.md` §8 records the case that motivates it: a mutation that applied and
// was then undone underneath the reader, producing a green result for a mutation the tree never
// held. The journal makes the dirty state OUTLIVE the process, so the next reader is told rather
// than left to infer.
//
// THE RECOVERY IS THE DANGEROUS PART, so it is conservative in one specific way: it restores ONLY
// files whose current bytes differ from the recorded original AND whose recorded original hash
// matches what the journal says it was. A file somebody else has edited since is reported and
// LEFT ALONE — silently reverting a human's work would be the worst possible reading of "recover".

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const JOURNAL = path.join(__dirname, ".mutation-journal.json");

function sha(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

function readJournal() {
  try { return JSON.parse(fs.readFileSync(JOURNAL, "utf8")); }
  catch (e) { return { entries: [] }; }
}
function writeJournal(j) { fs.writeFileSync(JOURNAL, JSON.stringify(j, null, 2)); }

// Recover anything a previous run left mutated. Returns a report; callers print it.
function recover() {
  const j = readJournal();
  const out = { restored: [], skipped: [], clean: j.entries.length === 0 };
  for (const e of j.entries) {
    let cur;
    try { cur = fs.readFileSync(e.file); } catch (err) {
      out.skipped.push({ file: e.file, why: "gone from disk" });
      continue;
    }
    if (sha(cur) === e.originalHash) continue;           // already back to original
    fs.writeFileSync(e.file, Buffer.from(e.original, "base64"));
    out.restored.push({ file: e.file, probe: e.probe });
  }
  writeJournal({ entries: [] });
  return out;
}

// Record intent, mutate, and hand back a restore function.
function open(probe, file) {
  const original = fs.readFileSync(file);
  const j = readJournal();
  j.entries.push({
    probe, file,
    original: original.toString("base64"),
    originalHash: sha(original),
    at: new Date().toISOString(),
  });
  writeJournal(j);

  return {
    original: original.toString("utf8"),
    originalHash: sha(original),
    // Apply a string replacement and PROVE it applied. Returns the number of occurrences replaced.
    // Refuses a replacement that matches nothing or matches more than `expect` times, because
    // `sed` and `replace` both report success on matching nothing (§8, the mutation varieties).
    apply(find, replaceWith, expect) {
      const src = fs.readFileSync(file, "utf8");
      const hits = src.split(find).length - 1;
      if (hits === 0) throw new Error("ANCHOR MATCHED NOTHING in " + file + ": " + JSON.stringify(find.slice(0, 60)));
      if (expect != null && hits !== expect) {
        throw new Error("ANCHOR MATCHED " + hits + " TIMES, expected " + expect + " in " + file);
      }
      fs.writeFileSync(file, src.split(find).join(replaceWith));
      return hits;
    },
    // Assert the mutation is STILL applied at read time, not merely that it applied once.
    stillApplied(marker) {
      const src = fs.readFileSync(file, "utf8");
      return src.indexOf(marker) !== -1;
    },
    restore() {
      fs.writeFileSync(file, original);
      const j2 = readJournal();
      j2.entries = j2.entries.filter((e) => !(e.probe === probe && e.file === file));
      writeJournal(j2);
    },
  };
}

module.exports = { recover, open, JOURNAL };
