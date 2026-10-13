// Engine tests: run with `node --test test/`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const E = require("../engine.js");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures");

function load(name, opts = {}) {
  const { text } = E.decode(readFileSync(path.join(FIX, name)));
  return E.clean(E.parseText(text).rows, opts);
}

test("SequenceMatcher port gives Python's ratios", () => {
  // Values from Python: difflib.SequenceMatcher(None, a, b).ratio()
  assert.equal(E.ratio("abcd", "bcde"), 0.75);
  assert.equal(E.ratio("peter hall", "petra hall"), 0.9);
  assert.equal(E.ratio("", ""), 1);
  assert.equal(E.ratio("kushtrim hoxha", "kushtrim hoxha"), 1);
  assert.ok(Math.abs(E.ratio("acme corp", "acme corp ltd") - 0.8181818181818182) < 1e-12);
});

test("CSV parsing handles quotes, doubled quotes, line breaks and semicolons", () => {
  assert.deepEqual(E.parseCSV('a,"b,c","say ""hi""\nthere"\r\n1,2,3', ","), [["a", "b,c", 'say "hi"\nthere'], ["1", "2", "3"]]);
  assert.equal(E.sniffDelimiter("Name;Amount\nA;1,5\nB;2,5\n"), ";");
  assert.equal(E.sniffDelimiter("Name,Email\nA,a@b.co\n"), ",");
  assert.equal(E.sniffDelimiter("Name\tEmail\nA\ta@b.co\n"), "\t");
});

test("a Central European file is read as Windows-1250, not mangled", () => {
  const { text, encoding } = E.decode(readFileSync(path.join(FIX, "cp1250.csv")));
  assert.equal(encoding, "windows-1250");
  assert.ok(text.includes("Łukasz Wiśniewski") && text.includes("Petrović"));
});

test("the messy list: exact duplicates removed, likely ones flagged, never merged", () => {
  const r = load("messy.csv");
  assert.equal(r.report.rows_in, 13);
  assert.equal(r.report.blank_rows_removed, 1);
  assert.equal(r.report.exact_duplicates_removed, 1); // "arta berisha ... kosova tech" == row 1 once capitals are tidied
  const reasons = r.groups.map((g) => g.reason);
  assert.ok(reasons.some((x) => x.includes("same phone")), reasons.join("|"));
  assert.ok(reasons.some((x) => x.includes("similar name, different email")), reasons.join("|"));
  assert.equal(r.report.invalid_emails, 1); // "blerim@example"
  assert.equal(r.report.values_dropped_from_ragged_rows, 1);
  // Nothing in a review group was dropped.
  assert.equal(r.rows.length, r.report.rows_out);
});

test("phone matching is what links international and local formats", () => {
  assert.equal(E.phoneKey("+383 44 123 456"), E.phoneKey("044 123 456"));
  assert.equal(E.phoneKey("12345"), "");
  const off = load("messy.csv", { phones: false });
  assert.ok(!off.groups.some((g) => g.reason.includes("same phone")));
});

test("merging a group keeps the first row and fills its gaps from the others", () => {
  const table = [["Name", "Email", "Phone"], ["Ana Markovic", "ana@m.rs", ""], ["Ana Marković", "ana@m.rs", "+381 11 222 333"]];
  const r = E.clean(table);
  assert.equal(r.groups.length, 1);
  const kept = E.applyDecisions(r, { 0: "merge" });
  assert.equal(kept.rows.length, 1);
  assert.equal(kept.merged, 1);
  assert.equal(kept.rows[0][2], "+381 11 222 333");
  assert.equal(E.applyDecisions(r, {}).rows.length, 2, "no decision keeps every row");
});

test("CSV output quotes what needs quoting and keeps original headings", () => {
  const r = load("multiline.csv");
  assert.deepEqual(r.labels, ["Name", "Email", "Notes"]);
  const csv = E.toCSV([r.labels, ...r.rows]);
  assert.ok(csv.includes('"met at fair wants a quote, ""urgent"""'));
  assert.equal(r.report.exact_duplicates_removed, 1);
});

test("the summary says what was found in plain words", () => {
  const s = E.summaryText(load("messy.csv"));
  assert.match(s, /Rows checked: 13/);
  assert.match(s, /would not find them/);
});

// Parity: with the extra checks off, the browser must find exactly what
// GENESIS's listclean.py finds.
// The reference is GENESIS's listclean.py, in a checkout next to this one
// (or wherever GENESIS_DIR points); without it this test is skipped.
const GENESIS = process.env.GENESIS_DIR || path.join(HERE, "..", "..", "genesis");
const PY = path.join(GENESIS, ".venv", "Scripts", "python.exe");
const LISTCLEAN = path.join(GENESIS, "genesis", "economy", "products");
test("parity with listclean.py on every fixture", { skip: !existsSync(PY) && "Python reference not available" }, () => {
  const files = readdirSync(FIX).filter((f) => f.endsWith(".csv")).map((f) => path.join(FIX, f));
  const ref = JSON.parse(execFileSync(PY, [path.join(HERE, "py_reference.py"), LISTCLEAN, ...files], { encoding: "utf8", maxBuffer: 64 << 20 }));
  for (const file of files) {
    const js = load(path.basename(file), { phones: false });
    const py = ref[file];
    for (const [k, v] of Object.entries(py.report)) assert.equal(js.report[k], v, `${path.basename(file)}: ${k}`);
    assert.deepEqual(js.report.skipped_common_tokens.slice().sort(), py.skipped, `${path.basename(file)}: skipped tokens`);
    const jsGroups = js.groups.map((g) => ({ lines: g.rows.map((i) => js.lines[i]), reason: g.reason, similarity: g.similarity }));
    assert.deepEqual(jsGroups, py.groups, `${path.basename(file)}: groups`);
    assert.deepEqual(js.rows, py.rows, `${path.basename(file)}: cleaned rows`);
  }
});
