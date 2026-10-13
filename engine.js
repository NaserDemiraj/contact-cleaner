/* Contact Cleaner engine: tidy a contact list and flag likely duplicates.
 *
 * A port of GENESIS's listclean.py, with the same deliberate caution:
 *   - exact duplicates (identical once spacing and capitals are tidied) are removed;
 *   - likely duplicates (same email, same phone, similar names) are NEVER merged
 *     on their own. They are listed for a person to decide, because merging two
 *     different people is a worse mistake than leaving one duplicate in place.
 *
 * Pure functions, no network. Runs in the browser (window.CCEngine) and in Node
 * (require) for the tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CCEngine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const BLANKS = new Set(["n/a", "na", "null", "none", "-", "--", "#n/a"]);
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const FUZZY_THRESHOLD = 0.88;
  // A word shared by more rows than this is too common to compare on ("john");
  // comparing every pair would be quadratic, so it is reported and skipped.
  const MAX_BLOCK = 300;
  const NAME_HINTS = ["name", "company", "organisation", "organization", "business", "org"];
  const PHONE_HINTS = ["phone", "mobile", "tel", "cell", "whatsapp", "telefon"];
  // Legal-form spellings folded together, so "ACME Corp." matches "Acme Corporation".
  const SUFFIXES = { corporation: "corp", incorporated: "inc", limited: "ltd", company: "co", and: "&" };
  const STOPWORDS = new Set(["the", "corp", "inc", "ltd", "llc", "co", "&", "of", "gmbh", "sa", "srl"]);

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  // What a Central European (Windows-1250) file looks like when misread as
  // Western (Windows-1252): symbols inside words (ł -> ³, ą -> ¹, ż -> ¿) and
  // South Slavic surname endings (-ić -> -iæ, -ič -> -iè).
  const CP1250_TELLS = /(?<=\p{L})[³¹¿º¾¼ª¥£ŒŸ](?=\p{L})|(?<=i)[æè](?!\p{L})|(?<=\p{L})ð(?=\p{L})/u;

  /** Bytes to text. UTF-8 first; otherwise choose between Western and Central
   *  European from tell-tale misreadings, and say which was used. */
  function decode(bytes, encoding) {
    if (encoding) return { text: new TextDecoder(encoding).decode(bytes), encoding };
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
    } catch (_) { /* not UTF-8 */ }
    const western = new TextDecoder("windows-1252").decode(bytes);
    if (CP1250_TELLS.test(western)) {
      return { text: new TextDecoder("windows-1250").decode(bytes), encoding: "windows-1250" };
    }
    return { text: western, encoding: "windows-1252" };
  }

  /** RFC 4180 CSV: quoted fields may hold the delimiter, quotes ("") and line breaks. */
  function parseCSV(text, delim) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    let start = true; // at the start of a field
    for (let i = 0, n = text.length; i < n; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += c;
        continue;
      }
      if (c === '"' && start) { quoted = true; start = false; continue; }
      if (c === delim) { row.push(field); field = ""; start = true; continue; }
      if (c === "\r" || c === "\n") {
        row.push(field); rows.push(row);
        row = []; field = ""; start = true;
        if (c === "\r" && text[i + 1] === "\n") i++;
        continue;
      }
      field += c;
      start = false;
    }
    if (field !== "" || row.length || !start) { row.push(field); rows.push(row); }
    return rows;
  }

  /** Comma, semicolon (European Excel) or tab: the one that splits the first
   *  lines most consistently into more than one column. */
  function sniffDelimiter(text) {
    const sample = text.slice(0, 4096);
    const truncated = text.length > sample.length;
    let best = ",";
    let bestScore = 0;
    for (const d of [",", ";", "\t"]) {
      let rows = parseCSV(sample, d);
      if (truncated && rows.length > 1) rows = rows.slice(0, -1);
      rows = rows.filter((r) => r.length > 1 || r[0] !== "");
      if (!rows.length) continue;
      const freq = new Map();
      for (const r of rows) freq.set(r.length, (freq.get(r.length) || 0) + 1);
      let mode = 0;
      let count = 0;
      for (const [len, f] of freq) if (f > count || (f === count && len > mode)) { mode = len; count = f; }
      if (mode < 2) continue;
      const score = (count / rows.length) * 1000 + Math.min(mode, 999);
      if (score > bestScore) { best = d; bestScore = score; }
    }
    return best;
  }

  function parseText(text) {
    const delimiter = sniffDelimiter(text);
    return { rows: parseCSV(text, delimiter), delimiter };
  }

  // -------------------------------------------------------------------------
  // Normalising
  // -------------------------------------------------------------------------

  function normaliseHeader(name, index) {
    const cleaned = String(name ?? "").trim().replace(/[^0-9a-zA-Z]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
    return cleaned || "column_" + (index + 1);
  }

  function uniqueHeaders(raw) {
    const seen = new Map();
    return raw.map((h, i) => {
      let name = normaliseHeader(h, i);
      if (seen.has(name)) {
        seen.set(name, seen.get(name) + 1);
        name = name + "_" + seen.get(name);
      } else seen.set(name, 1);
      return name;
    });
  }

  function coerce(value) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return BLANKS.has(text.toLowerCase()) ? "" : text;
  }

  function canon(text) {
    const s = String(text || "").normalize("NFKD").replace(/\p{M}/gu, "")
      .replace(/[^0-9a-zA-Z& ]+/g, " ").toLowerCase();
    return s.split(/\s+/).filter(Boolean).map((t) => SUFFIXES[t] || t).join(" ");
  }

  /** "+383 44 123 456" and "044 123 456" are the same phone: the country code
   *  and the leading 0 differ, the last eight digits do not. Fewer than seven
   *  digits is not a phone number. */
  function phoneKey(value) {
    const digits = String(value || "").replace(/\D+/g, "");
    if (digits.length < 7) return "";
    return digits.length >= 8 ? digits.slice(-8) : digits;
  }

  function findColumns(keys, rows, phones) {
    let email = keys.flatMap((h, i) => (h.includes("email") || h === "e_mail" || h === "mail" ? [i] : []));
    if (!email.length) {
      for (let i = 0; i < keys.length; i++) {
        const values = rows.map((r) => r[i]).filter(Boolean);
        if (values.length && values.filter((v) => EMAIL_RE.test(v)).length >= 0.6 * values.length) email.push(i);
      }
    }
    let name = keys.flatMap((h, i) => (!email.includes(i) && NAME_HINTS.some((k) => h.includes(k)) ? [i] : []));
    if (!name.length) name = keys.map((_, i) => i).filter((i) => !email.includes(i)).slice(0, 1);
    const phone = phones
      ? keys.flatMap((h, i) => (!email.includes(i) && !name.includes(i) && PHONE_HINTS.some((k) => h.includes(k)) ? [i] : []))
      : [];
    return { email, name, phone };
  }

  // -------------------------------------------------------------------------
  // Similarity: Python's difflib.SequenceMatcher(None, a, b), ported exactly so
  // the browser flags the same pairs as listclean.py.
  // -------------------------------------------------------------------------

  function realQuickRatio(a, b) {
    const t = a.length + b.length;
    return t ? (2 * Math.min(a.length, b.length)) / t : 1;
  }

  function quickRatio(a, b) {
    const avail = new Map();
    for (const ch of b) avail.set(ch, (avail.get(ch) || 0) + 1);
    let matches = 0;
    for (const ch of a) {
      const n = avail.get(ch) || 0;
      if (n > 0) { matches++; avail.set(ch, n - 1); }
    }
    const t = a.length + b.length;
    return t ? (2 * matches) / t : 1;
  }

  function longestMatch(a, b, b2j, alo, ahi, blo, bhi) {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const next = new Map();
      const js = b2j.get(a[i]);
      if (js) {
        for (const j of js) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          next.set(j, k);
          if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
        }
      }
      j2len = next;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize];
  }

  function ratio(a, b) {
    const t = a.length + b.length;
    if (!t) return 1;
    const b2j = new Map();
    for (let j = 0; j < b.length; j++) {
      let list = b2j.get(b[j]);
      if (!list) b2j.set(b[j], (list = []));
      list.push(j);
    }
    if (b.length >= 200) { // difflib's "autojunk": ignore very popular characters
      const ntest = Math.floor(b.length / 100) + 1;
      for (const [ch, list] of b2j) if (list.length > ntest) b2j.delete(ch);
    }
    let matches = 0;
    const stack = [[0, a.length, 0, b.length]];
    while (stack.length) {
      const [alo, ahi, blo, bhi] = stack.pop();
      const [i, j, k] = longestMatch(a, b, b2j, alo, ahi, blo, bhi);
      if (k) {
        matches += k;
        if (alo < i && blo < j) stack.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) stack.push([i + k, ahi, j + k, bhi]);
      }
    }
    return (2 * matches) / t;
  }

  // -------------------------------------------------------------------------
  // Grouping
  // -------------------------------------------------------------------------

  /** Union-find over row indices, remembering why rows were linked. */
  class Groups {
    constructor() { this.parent = new Map(); this.reasons = new Map(); this.best = new Map(); }
    find(i) {
      if (!this.parent.has(i)) this.parent.set(i, i);
      while (this.parent.get(i) !== i) {
        this.parent.set(i, this.parent.get(this.parent.get(i)));
        i = this.parent.get(i);
      }
      return i;
    }
    link(a, b, reason, score) {
      const ra = this.find(a), rb = this.find(b);
      if (ra !== rb) {
        this.parent.set(rb, ra);
        const merged = this.reasons.get(ra) || new Set();
        for (const r of this.reasons.get(rb) || []) merged.add(r);
        this.reasons.set(ra, merged);
        this.reasons.delete(rb);
        this.best.set(ra, Math.min(this.best.get(ra) ?? 1, this.best.get(rb) ?? 1));
        this.best.delete(rb);
      }
      if (!this.reasons.has(ra)) this.reasons.set(ra, new Set());
      this.reasons.get(ra).add(reason);
      this.best.set(ra, Math.min(this.best.get(ra) ?? 1, score));
    }
    groups() {
      const members = new Map();
      for (const i of this.parent.keys()) {
        const root = this.find(i);
        if (!members.has(root)) members.set(root, []);
        members.get(root).push(i);
      }
      const out = [];
      for (const [root, idxs] of members) {
        if (idxs.length > 1) {
          out.push({
            rows: idxs.sort((x, y) => x - y),
            reason: [...(this.reasons.get(root) || ["similar"])].sort().join(" + "),
            similarity: Math.round((this.best.get(root) ?? 1) * 1000) / 1000,
          });
        }
      }
      return out.sort((x, y) => x.rows[0] - y.rows[0]);
    }
  }

  // -------------------------------------------------------------------------
  // Cleaning
  // -------------------------------------------------------------------------

  /**
   * rows: the table as arrays of strings, header first.
   * Returns { labels, keys, rows, lines, groups, invalidEmails, report }.
   * opts.maxRows keeps only the first N records; opts.phones and
   * opts.invalidEmails switch on the checks listclean.py does not have.
   */
  function clean(table, opts = {}) {
    const maxRows = opts.maxRows ?? null;
    const phones = opts.phones !== false;
    const report = {
      rows_in: 0, rows_out: 0, blank_rows_removed: 0,
      exact_duplicates_removed: 0, values_dropped_from_ragged_rows: 0,
      duplicate_groups_for_review: 0, rows_in_review_groups: 0,
      invalid_emails: 0,
      email_columns: [], match_columns: [], phone_columns: [], skipped_common_tokens: [],
      notes: [],
    };
    let rows = table;
    const limited = maxRows !== null && rows.length - 1 > maxRows;
    if (limited) rows = rows.slice(0, maxRows + 1);
    if (!rows.length) return { labels: [], keys: [], rows: [], lines: [], groups: [], invalidEmails: [], report };

    const raw0 = rows[0].map((h) => String(h ?? ""));
    const keys = uniqueHeaders(raw0);
    const labels = raw0.map((h, i) => h.trim() || "Column " + (i + 1));
    const width = keys.length;
    report.rows_in = Math.max(rows.length - 1, 0);
    if (limited) report.sample_limited_to_rows = maxRows;

    const kept = [];
    const keptLines = [];
    for (let r = 1; r < rows.length; r++) {
      const raw = rows[r] || [];
      report.values_dropped_from_ragged_rows += raw.slice(width).filter((v) => String(v ?? "").trim()).length;
      const row = raw.slice(0, width).map(coerce);
      while (row.length < width) row.push("");
      if (!row.some(Boolean)) { report.blank_rows_removed++; continue; }
      kept.push(row);
      keptLines.push(r + 1); // spreadsheet row number, header is row 1
    }

    const cols = findColumns(keys, kept, phones);
    report.email_columns = cols.email.map((i) => labels[i]);
    report.match_columns = cols.name.map((i) => labels[i]);
    report.phone_columns = cols.phone.map((i) => labels[i]);

    const out = [];
    const lines = [];
    const seen = new Set();
    for (let k = 0; k < kept.length; k++) {
      const row = kept[k];
      for (const c of cols.email) row[c] = row[c].toLowerCase();
      const key = row.map((v) => v.toLowerCase()).join("\u0000");
      if (seen.has(key)) { report.exact_duplicates_removed++; continue; }
      seen.add(key);
      out.push(row);
      lines.push(keptLines[k]);
    }

    const invalidEmails = [];
    for (let idx = 0; idx < out.length; idx++) {
      for (const c of cols.email) {
        const v = out[idx][c];
        if (v && !EMAIL_RE.test(v)) invalidEmails.push({ row: idx, column: labels[c], value: v });
      }
    }
    report.invalid_emails = invalidEmails.length;

    const groups = new Groups();
    const byEmail = new Map();
    out.forEach((row, idx) => {
      for (const c of cols.email) {
        if (EMAIL_RE.test(row[c])) {
          if (!byEmail.has(row[c])) byEmail.set(row[c], []);
          byEmail.get(row[c]).push(idx);
        }
      }
    });
    for (const idxs of byEmail.values()) for (const other of idxs.slice(1)) groups.link(idxs[0], other, "same email", 1);

    if (cols.phone.length) {
      const byPhone = new Map();
      out.forEach((row, idx) => {
        for (const c of cols.phone) {
          const p = phoneKey(row[c]);
          if (p) {
            if (!byPhone.has(p)) byPhone.set(p, []);
            const list = byPhone.get(p);
            if (list[list.length - 1] !== idx) list.push(idx);
          }
        }
      });
      for (const idxs of byPhone.values()) for (const other of idxs.slice(1)) groups.link(idxs[0], other, "same phone", 1);
    }

    const emails = out.map((row) => new Set(cols.email.map((c) => row[c]).filter((v) => EMAIL_RE.test(v))));
    const names = out.map((row) => canon(cols.name.map((c) => row[c]).join(" ")));
    const postings = new Map();
    names.forEach((key, idx) => {
      for (const token of new Set(key.split(" "))) {
        if (token.length >= 3 && !STOPWORDS.has(token)) {
          if (!postings.has(token)) postings.set(token, []);
          postings.get(token).push(idx);
        }
      }
    });
    const n = out.length;
    const compared = new Set();
    for (const [token, idxs] of postings) {
      if (idxs.length > MAX_BLOCK) { report.skipped_common_tokens.push(token); continue; }
      for (let i = 0; i < idxs.length; i++) {
        for (let j = i + 1; j < idxs.length; j++) {
          const a = idxs[i], b = idxs[j];
          const pair = a * n + b;
          if (compared.has(pair)) continue;
          compared.add(pair);
          const x = names[a], y = names[b];
          if (realQuickRatio(x, y) < FUZZY_THRESHOLD || quickRatio(x, y) < FUZZY_THRESHOLD) continue;
          const score = ratio(x, y);
          if (score >= FUZZY_THRESHOLD) {
            // Say when the emails differ: "Peter Hall" and "Petra Hall" at one
            // company may well be two people, and the person deciding needs to
            // see that at a glance.
            const ea = emails[a], eb = emails[b];
            const shared = [...ea].some((e) => eb.has(e));
            groups.link(a, b, ea.size && eb.size && !shared ? "similar name, different email" : "similar name", score);
          }
        }
      }
    }

    const found = groups.groups();
    report.rows_out = out.length;
    report.duplicate_groups_for_review = found.length;
    report.rows_in_review_groups = found.reduce((s, g) => s + g.rows.length, 0);
    if (report.values_dropped_from_ragged_rows) {
      report.notes.push("some rows had more values than there are column headings; the extra values were left out");
    }
    if (report.skipped_common_tokens.length) {
      report.notes.push("very common words were not used for name matching, so some near-duplicates sharing only those words may not be flagged");
    }
    return { labels, keys, rows: out, lines, groups: found, invalidEmails, report, columns: cols };
  }

  // -------------------------------------------------------------------------
  // Decisions and output
  // -------------------------------------------------------------------------

  /** Apply the person's decisions: decisions[g] === "merge" keeps the group's
   *  first row, fills its empty cells from the others in order, and drops the
   *  others. Any other value keeps every row. */
  function applyDecisions(result, decisions) {
    const drop = new Set();
    const rows = result.rows.map((r) => r.slice());
    result.groups.forEach((g, gi) => {
      if (decisions[gi] !== "merge") return;
      const [first, ...rest] = g.rows;
      for (const other of rest) {
        rows[first].forEach((v, c) => { if (!v && rows[other][c]) rows[first][c] = rows[other][c]; });
        drop.add(other);
      }
    });
    return { rows: rows.filter((_, i) => !drop.has(i)), merged: drop.size };
  }

  function csvField(v) {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(table) {
    return table.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
  }

  function duplicatesTable(result) {
    const out = [["Group", "Why", "Similarity", "Original row", ...result.labels]];
    result.groups.forEach((g, gi) => {
      for (const idx of g.rows) out.push([gi + 1, g.reason, g.similarity, result.lines[idx], ...result.rows[idx]]);
    });
    return out;
  }

  function displayName(result, idx) {
    const row = result.rows[idx];
    return result.columns.name.map((c) => row[c]).filter(Boolean).join(" ") || "(no name)";
  }

  /** What was found, for a person: counts first, then a few examples. */
  function summaryText(result, examples = 3) {
    const r = result.report;
    const lines = [
      "What Contact Cleaner found in your list",
      "",
      "Rows checked: " + r.rows_in + (r.sample_limited_to_rows ? " (only the first " + r.sample_limited_to_rows + ")" : ""),
      "- " + r.blank_rows_removed + " blank row(s) removed",
      "- " + r.exact_duplicates_removed + " exact duplicate(s) removed (identical once spacing and capitals are tidied)",
      "- " + r.duplicate_groups_for_review + " group(s) of likely duplicates, covering " + r.rows_in_review_groups + " rows, for you to review",
    ];
    for (const g of result.groups.slice(0, examples)) {
      lines.push('    e.g. ' + g.rows.slice(0, 3).map((i) => '"' + displayName(result, i) + '"').join(" / ") + " -- " + g.reason);
    }
    lines.push("- " + r.invalid_emails + " email address(es) that do not look valid");
    for (const e of result.invalidEmails.slice(0, examples)) lines.push('    e.g. "' + e.value + '" in row ' + result.lines[e.row]);
    lines.push("");
    if (r.duplicate_groups_for_review) {
      lines.push('A spreadsheet\'s built-in "Remove duplicates" removes only rows that are exactly identical. ' +
        "None of the " + r.duplicate_groups_for_review + " group(s) above are identical rows, so it would not find them.");
    } else {
      lines.push("No likely duplicates were found.");
    }
    for (const note of r.notes) lines.push("Note: " + note);
    return lines.join("\n") + "\n";
  }

  return {
    decode, parseCSV, parseText, sniffDelimiter, clean, applyDecisions, toCSV, duplicatesTable,
    summaryText, displayName, canon, phoneKey, ratio, quickRatio, realQuickRatio, coerce,
    EMAIL_RE, FUZZY_THRESHOLD,
  };
});
