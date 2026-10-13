/* Contact Cleaner page: read the file, show what was found, let the person
 * decide, and build the downloads. Everything stays inside this page. */
(function () {
  "use strict";
  const E = window.CCEngine;
  const CFG = Object.assign({ edition: "free", freeRows: 500, buyUrl: "", price: "$9" }, window.CC_CONFIG || {});
  const PRO = CFG.edition === "pro";
  const PAGE = 25;
  const SHEET_EXT = /\.(xlsx|xlsm|xls|ods)$/i;
  const ENCODINGS = { "windows-1252": "Windows-1252 (Western European)", "windows-1250": "Windows-1250 (Central European)" };
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("en");

  // ---- edition and settings -------------------------------------------------
  document.documentElement.dataset.edition = PRO ? "pro" : "free";
  if (PRO) document.querySelector(".brand").textContent = "Contact Cleaner Pro";
  document.querySelectorAll(".free-rows").forEach((el) => { el.textContent = fmt(CFG.freeRows); });
  document.querySelectorAll(".pro-price").forEach((el) => { el.textContent = CFG.price; });
  document.querySelectorAll(".buy-link, #buy").forEach((a) => {
    a.href = CFG.buyUrl || "#pricing";
    if (CFG.buyUrl) { a.target = "_blank"; a.rel = "noopener"; }
  });

  const state = { base: "contacts", result: null, decisions: {}, page: 0, workbook: null, encoding: null };

  const SAMPLE = [
    ["Full Name", "Email", "Phone", "Company", "City"],
    ["Arta Berisha", "arta@kosovatech.com", "+383 44 123 456", "Kosova Tech", "Prishtina"],
    ["  ARTA   berisha ", "Arta@KosovaTech.com", "044 123 456", "Kosova Tech", "Prishtina"],
    ["arta berisha", "arta@kosovatech.com", "+383 44 123 456", "kosova tech", "prishtina"],
    ["", "", "", "", ""],
    ["Peter Hall", "peter@hallsupplies.co.uk", "", "ACME Corp.", "Leeds"],
    ["Petra Hall", "petra@hallsupplies.co.uk", "", "Acme Corporation", "Leeds"],
    ["Blerim Krasniqi", "N/A", "049 555 777", "-", "Prizren"],
    ["Blerim Krasniqi", "blerim@example", "", "", "Prizren"],
    ["Jane O'Neil", "jane@oneil.ie", "", "O'Neil & Sons", "Dublin"],
    ["Jane ONeil", "jane.oneil@gmail.com", "+353 1 234 5678", "ONeil and Sons", "Dublin"],
    ["Ana Marković", "ana@markovic.rs", "", "", "Belgrade"],
    ["Ana Markovic", "ana@markovic.rs", "+381 11 222 333", "", "Belgrade"],
    ["Liridona Gashi", "liridona@gashi.al", "+355 69 876 5432", "Gashi Design", "Tirana"],
    ["Driton Shala", "driton.shala@mail.com", "", "null", "Gjakova"],
    ["Mark Smith", "mark@smithandco.com", "+1 212 555 0101", "Smith & Co", "New York"],
    ["Mark Smith", "mark.smith@othermail.com", "(212) 555-0101", "Smith and Company", "New York"],
  ];

  function setStatus(text, error) {
    const s = $("status");
    s.textContent = text;
    s.classList.toggle("error", !!error);
  }

  // ---- reading ----------------------------------------------------------------
  async function openFile(file) {
    state.base = file.name.replace(/\.[^.]+$/, "") || "contacts";
    setStatus("Reading " + file.name + "…");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (SHEET_EXT.test(file.name)) {
        if (!window.XLSX) throw new Error("the Excel reader did not load; save the file as CSV and try again");
        const wb = XLSX.read(bytes, { type: "array", cellDates: true });
        state.workbook = wb;
        state.encoding = null;
        showSheets(wb);
        check(sheetRows(wb, wb.SheetNames[0]));
      } else {
        state.workbook = null;
        $("sheet-pick").hidden = true;
        const { text, encoding } = E.decode(bytes);
        state.encoding = encoding;
        check(E.parseText(text).rows);
      }
    } catch (err) {
      setStatus("Couldn't read " + file.name + ": " + ((err && err.message) || err), true);
    }
  }

  function sheetRows(wb, name) {
    // rawNumbers keeps long numbers (phones, IDs) whole instead of "3.83E+11".
    return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, rawNumbers: true, defval: "", blankrows: true })
      .map((r) => Array.from(r, (v) => (v == null ? "" : String(v))));
  }

  function showSheets(wb) {
    const pick = $("sheet-pick");
    pick.hidden = wb.SheetNames.length < 2;
    const sel = $("sheet");
    sel.replaceChildren(...wb.SheetNames.map((n) => new Option(n, n)));
  }

  function check(rows) {
    if (rows.length < 2) {
      $("results").hidden = true;
      setStatus("That file has no rows under its headings.", true);
      return;
    }
    setStatus("Checking " + fmt(rows.length - 1) + " rows…");
    setTimeout(() => {
      const t0 = performance.now();
      const result = E.clean(rows);
      if (state.encoding && state.encoding !== "utf-8") {
        result.report.notes.unshift("The file was read as " + (ENCODINGS[state.encoding] || state.encoding) +
          ". Check that accented names look right below.");
      }
      state.result = result;
      state.decisions = {};
      state.page = 0;
      render();
      $("results").hidden = false;
      setStatus("Checked " + fmt(result.report.rows_in) + " rows in " + ((performance.now() - t0) / 1000).toFixed(1) + " s.");
      $("results").scrollIntoView({ behavior: "smooth", block: "start" });
    }, 20);
  }

  // ---- showing ----------------------------------------------------------------
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") node.className = v;
      else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  function render() {
    const r = state.result.report;
    const tile = (n, label, hot) => el("div", { class: "tile" + (hot ? " hot" : "") }, el("div", { class: "n" }, fmt(n)), el("div", { class: "l" }, label));
    $("tiles").replaceChildren(
      tile(r.rows_in, "rows checked"),
      tile(r.exact_duplicates_removed, "exact duplicates removed", r.exact_duplicates_removed > 0),
      tile(r.duplicate_groups_for_review, "groups of likely duplicates", r.duplicate_groups_for_review > 0),
      tile(r.invalid_emails, "emails that don't look valid", r.invalid_emails > 0),
      tile(r.blank_rows_removed, "blank rows removed"),
    );
    const parts = [];
    if (r.match_columns.length) parts.push("Names compared in: " + r.match_columns.join(", "));
    if (r.email_columns.length) parts.push("emails in: " + r.email_columns.join(", "));
    if (r.phone_columns.length) parts.push("phones in: " + r.phone_columns.join(", "));
    $("columns").textContent = parts.join(" · ");
    $("notes").replaceChildren(...r.notes.map((n) => el("li", null, n)));
    $("review").hidden = !state.result.groups.length;
    renderGroups();
    renderInvalid();
    renderExport();
  }

  function renderGroups() {
    const res = state.result;
    const total = res.groups.length;
    const start = state.page * PAGE;
    const cards = res.groups.slice(start, start + PAGE).map((g, k) => groupCard(g, start + k));
    $("groups").replaceChildren(...cards);
    const pages = Math.ceil(total / PAGE);
    const pager = $("pager");
    pager.replaceChildren();
    if (pages > 1) {
      const prev = el("button", { type: "button", class: "ghost", "data-page": state.page - 1, disabled: state.page === 0 }, "Previous");
      const next = el("button", { type: "button", class: "ghost", "data-page": state.page + 1, disabled: state.page >= pages - 1 }, "Next");
      pager.append(prev, el("span", { class: "muted small" }, `Groups ${fmt(start + 1)}–${fmt(Math.min(start + PAGE, total))} of ${fmt(total)}`), next);
    }
  }

  function groupCard(g, gi) {
    const res = state.result;
    const decision = state.decisions[gi] === "merge" ? "merge" : "keep";
    const caution = g.reason.includes("different email");
    const head = el("div", { class: "group-head" },
      el("div", null,
        el("strong", null, "Group " + (gi + 1) + " "),
        el("span", { class: "badge" + (caution ? " caution" : "") }, g.reason),
        g.similarity < 1 ? el("span", { class: "muted small" }, " " + Math.round(g.similarity * 100) + "% similar") : null),
      el("div", { class: "choice", role: "radiogroup", "aria-label": "Group " + (gi + 1) },
        ...[["keep", "Keep all rows"], ["merge", "Merge into one"]].map(([v, label]) =>
          el("label", null, el("input", { type: "radio", name: "g" + gi, value: v, "data-group": gi, checked: decision === v }), el("span", null, label)))));
    const cols = res.labels.map((_, c) => c);
    const differs = cols.map((c) => new Set(g.rows.map((i) => res.rows[i][c].toLowerCase())).size > 1);
    const table = el("table", null,
      el("thead", null, el("tr", null, el("th", null, "Row"), ...res.labels.map((l) => el("th", null, l)))),
      el("tbody", null, ...g.rows.map((i) => el("tr", null,
        el("td", { class: "rownum" }, String(res.lines[i])),
        ...cols.map((c) => el("td", { class: differs[c] ? "diff" : null }, res.rows[i][c]))))));
    return el("div", { class: "group" + (decision === "merge" ? " merge" : "") }, head, el("div", { class: "table-scroll" }, table));
  }

  function renderInvalid() {
    const res = state.result;
    const box = $("invalid");
    box.hidden = !res.invalidEmails.length;
    if (!res.invalidEmails.length) return;
    $("invalid-title").textContent = fmt(res.invalidEmails.length) + " email address(es) that don't look valid";
    $("invalid-table").replaceChildren(
      el("thead", null, el("tr", null, el("th", null, "Row"), el("th", null, "Column"), el("th", null, "Value"))),
      el("tbody", null, ...res.invalidEmails.slice(0, 200).map((e) =>
        el("tr", null, el("td", { class: "rownum" }, String(res.lines[e.row])), el("td", null, e.column), el("td", null, e.value)))));
  }

  function limited() {
    return !PRO && state.result.report.rows_in > CFG.freeRows;
  }

  function renderExport() {
    const res = state.result;
    const after = E.applyDecisions(res, state.decisions);
    const r = res.report;
    const removed = [];
    if (r.exact_duplicates_removed) removed.push(fmt(r.exact_duplicates_removed) + " exact duplicate(s) removed");
    if (r.blank_rows_removed) removed.push(fmt(r.blank_rows_removed) + " blank row(s) removed");
    if (after.merged) removed.push(fmt(after.merged) + " row(s) merged into others");
    $("export-count").textContent = "Your cleaned list will have " + fmt(after.rows.length) + " rows" +
      (removed.length ? " (" + removed.join(", ") + ")." : ".");
    const lock = limited();
    for (const id of ["dl-xlsx", "dl-csv", "dl-dupes"]) $(id).disabled = lock;
    $("dl-dupes").hidden = !res.groups.length;
    $("upsell").hidden = !lock;
    if (lock) {
      $("upsell-text").textContent = "Your list has " + fmt(r.rows_in) + " rows. The free version downloads cleaned lists up to " +
        fmt(CFG.freeRows) + " rows. Contact Cleaner Pro (" + CFG.price + ", once) downloads lists of any size and works offline. The summary is free.";
    }
  }

  // ---- downloads ----------------------------------------------------------------
  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function cleanedTable() {
    return [state.result.labels, ...E.applyDecisions(state.result, state.decisions).rows];
  }

  function sheet(table) {
    const ws = XLSX.utils.aoa_to_sheet(table);
    ws["!cols"] = (table[0] || []).map((_, c) => ({
      wch: Math.min(48, Math.max(8, ...table.slice(0, 200).map((r) => String(r[c] ?? "").length + 2))),
    }));
    return ws;
  }

  const CSV_TYPE = "text/csv;charset=utf-8";
  const actions = {
    "dl-csv": () => download(state.base + "-cleaned.csv", "﻿" + E.toCSV(cleanedTable()), CSV_TYPE),
    "dl-dupes": () => download(state.base + "-duplicates.csv", "﻿" + E.toCSV(E.duplicatesTable(state.result)), CSV_TYPE),
    "dl-summary": () => download(state.base + "-summary.txt", E.summaryText(state.result), "text/plain;charset=utf-8"),
    "dl-xlsx": () => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet(cleanedTable()), "Cleaned");
      if (state.result.groups.length) XLSX.utils.book_append_sheet(wb, sheet(E.duplicatesTable(state.result)), "Possible duplicates");
      XLSX.utils.book_append_sheet(wb, sheet(E.summaryText(state.result).trimEnd().split("\n").map((l) => [l])), "Summary");
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      download(state.base + "-cleaned.xlsx", new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    },
  };

  // ---- wiring -------------------------------------------------------------------
  const drop = $("drop");
  const input = $("file");
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { if (input.files[0]) openFile(input.files[0]); input.value = ""; });
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
  // A file dropped beside the box should not navigate away from the page.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  $("sample").addEventListener("click", () => {
    state.base = "sample-contacts";
    state.workbook = null;
    state.encoding = null;
    $("sheet-pick").hidden = true;
    check(SAMPLE.map((r) => r.slice()));
  });
  $("sheet").addEventListener("change", (e) => { if (state.workbook) check(sheetRows(state.workbook, e.target.value)); });

  $("groups").addEventListener("change", (e) => {
    const t = e.target;
    if (t.name && t.dataset.group != null) {
      const gi = Number(t.dataset.group);
      if (t.value === "merge") state.decisions[gi] = "merge";
      else delete state.decisions[gi];
      t.closest(".group").classList.toggle("merge", t.value === "merge");
      renderExport();
    }
  });
  $("pager").addEventListener("click", (e) => {
    const p = e.target.dataset && e.target.dataset.page;
    if (p != null) { state.page = Number(p); renderGroups(); $("review").scrollIntoView({ block: "start" }); }
  });
  $("merge-sure").addEventListener("click", () => {
    state.result.groups.forEach((g, gi) => {
      if (/same (email|phone)/.test(g.reason) && !g.reason.includes("different email")) state.decisions[gi] = "merge";
    });
    renderGroups();
    renderExport();
  });
  $("keep-all").addEventListener("click", () => { state.decisions = {}; renderGroups(); renderExport(); });
  for (const [id, fn] of Object.entries(actions)) {
    $(id).addEventListener("click", () => {
      if ($(id).disabled) return;
      try { fn(); } catch (err) { setStatus("Couldn't build the download: " + ((err && err.message) || err), true); }
    });
  }

  // For tests: the page's state, read-only use.
  window.__cc = { state, check };
})();
