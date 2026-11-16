// app.js — state, rendering and event wiring

import { REL_ORDER, linkKey, relSort, autoDetectMapping, computeAssignments } from "./model.js";
import { defaultSettings, buildEmails, SAMPLE_CSV } from "./email.js";
import { parseFile, parseDelimited } from "./parse.js";
import { copyText, downloadText, toMailMergeCsv, toAllText, mailtoUrl } from "./export.js";

/* ================================================================
   State
================================================================ */

const state = {
  step: 1,
  parsed: null, // { headers, rows, source }
  mapping: { officerName: "", officerEmail: "", officerGrade: "", widePairs: [], selfFromOfficer: false },
  links: {}, // "grade||rel" -> form URL
  settings: { ...defaultSettings },
  selectedAssessor: null,
  bodyView: "html", // "html" | "text"
  search: "",
  pasteText: "",
  bulkText: "",
  error: "",
};

let view = null; // derived data computed on each render

const STEPS = ["Import roster", "Map columns", "Form links", "Generate emails"];

const PLACEHOLDERS = [
  ["{assessor_name}", "assessor's name (falls back to “Colleague”)"],
  ["{org}", "organisation name"],
  ["{deadline}", "due date (falls back to “the announced deadline”)"],
  ["{officer_count}", "number of officers to assess"],
  ["{plural}", "“s” when more than one officer"],
  ["{assignments}", "table of officers + form links (only relevant assessment types; proper HTML table in the HTML version)"],
  ["{signature}", "sign-off name"],
];

/* ================================================================
   Helpers
================================================================ */

const $ = (sel) => document.querySelector(sel);

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function derived() {
  const { assignments, duplicates } = computeAssignments(state.parsed, state.mapping);
  const emails = buildEmails(assignments, state.links, state.settings);
  const missingCount = assignments.filter((a) => !(state.links[linkKey(a.grade, a.relationship)] || "").trim()).length;
  const officers = new Set(assignments.map((a) => `${a.officerName}||${a.grade}`));
  const assessors = new Set(assignments.map((a) => a.assessorEmail.toLowerCase()));
  return { assignments, duplicates, emails, missingCount, officers: officers.size, assessors: assessors.size };
}

let flashTimer = null;
function flash(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.textContent = ""; }, 2500);
}

const chip = (label, value, tone = "") => `<span class="chip ${tone}"><b>${value}</b> ${label}</span>`;

const currentEmail = () => view.emails.find((e) => e.key === state.selectedAssessor) || view.emails[0];

function selectHtml(headers, role, value, extra = "") {
  return `<select class="in" data-role="${role}" ${extra}>
    <option value="">— none —</option>
    ${headers.map((h) => `<option value="${esc(h)}" ${h === value ? "selected" : ""}>${esc(h)}</option>`).join("")}
  </select>`;
}

/* ================================================================
   Import actions
================================================================ */

function adoptParsed(p, source) {
  state.parsed = { ...p, source };
  state.mapping = autoDetectMapping(p.headers);
  state.error = "";
  state.selectedAssessor = null;
  state.step = 2;
  render();
}

function loadSample() {
  const seed = {};
  for (const g of ["Grade A", "Grade B", "Grade C"]) {
    for (const r of REL_ORDER) {
      seed[linkKey(g, r)] = `https://forms.gle/sample-${g.toLowerCase().replace(/\s+/g, "-")}-${r.toLowerCase()}`;
    }
  }
  state.links = seed;
  adoptParsed(parseDelimited(SAMPLE_CSV), "sample data");
}

function usePaste() {
  if (!state.pasteText.trim()) return;
  const p = parseDelimited(state.pasteText);
  if (!p.headers.length) {
    state.error = "Could not detect any rows in the pasted text.";
    render();
    return;
  }
  adoptParsed(p, "pasted data");
}

async function handleFiles(files) {
  if (!files || !files.length) return;
  try {
    adoptParsed(await parseFile(files[0]), files[0].name);
  } catch (err) {
    state.error = err && err.message ? err.message : "Could not read that file.";
    render();
  }
}

function applyBulk() {
  let applied = 0;
  for (const line of (state.bulkText || "").split(/\r?\n/)) {
    const m = line.match(/^([^,]+),([^,]+),(.+)$/);
    if (!m) continue;
    const grade = m[1].trim();
    const rel = m[2].trim();
    const url = m[3].trim();
    if (grade && rel && url) {
      state.links[linkKey(grade, rel)] = url;
      applied++;
    }
  }
  state.bulkText = "";
  render();
  flash("bulk-flash", applied ? `${applied} link(s) applied ✓` : "");
}

async function copyEmail(key) {
  const e = view.emails.find((x) => x.key === key);
  if (!e) return;
  const ok = await copyText(`Subject: ${e.subject}\n\n${e.body}`);
  flash("preview-flash", ok ? "Email copied to clipboard ✓" : "Copy failed — select the text manually.");
}

async function copyHtml(key) {
  const e = view.emails.find((x) => x.key === key);
  if (!e) return;
  const ok = await copyText(e.bodyHtml);
  flash("preview-flash", ok ? "HTML copied to clipboard ✓" : "Copy failed.");
}

/* ================================================================
   Render: shell
================================================================ */

function render() {
  view = derived();
  $("#stats").innerHTML = statsHtml();
  $("#stepper").innerHTML = stepperHtml();
  $("#error-box").innerHTML = state.error
    ? `<div class="alert error">${esc(state.error)} <button class="link" data-action="dismiss-error">dismiss</button></div>`
    : "";
  $("#step").innerHTML = state.step === 1 ? step1Html() : state.step === 2 ? step2Html() : state.step === 3 ? step3Html() : step4Html();
  $("#step-nav").innerHTML = stepNavHtml();
}

function statsHtml() {
  return chip("officers", view.officers) + chip("assessors", view.assessors) + chip("assignments", view.assignments.length, "indigo");
}

function stepperHtml() {
  const enabled = (n) => n === 1 || (!!state.parsed && view.assignments.length > 0);
  return STEPS.map((title, i) => {
    const n = i + 1;
    const cls = state.step === n ? "active" : state.step > n ? "done" : "";
    return `<button class="step-pill ${cls}" data-action="goto-step" data-step="${n}" ${enabled(n) ? "" : "disabled"}>
      <span class="step-num">${state.step > n ? "✓" : n}</span>${title}
    </button>`;
  }).join("");
}

function stepNavHtml() {
  const nextDisabled = state.step === 4 || !state.parsed || view.assignments.length === 0;
  const hint =
    state.step === 2 && view.assignments.length === 0
      ? `<span class="hint error">Map at least one column pair to continue.</span>`
      : state.step === 3 && view.missingCount > 0
      ? `<span class="hint warn">${view.missingCount} form link(s) still missing — you can continue anyway.</span>`
      : "";
  return `
    <button class="btn outline" data-action="back" ${state.step === 1 ? "disabled" : ""}>← Back</button>
    <div class="step-nav-right">${hint}<button class="btn" data-action="next" ${nextDisabled ? "disabled" : ""}>Next →</button></div>`;
}

/* ================================================================
   Render: step 1 — import
================================================================ */

function importedCardHtml(p) {
  return `
  <section class="card">
    <div class="preview-head">
      <h2 class="card-title">Imported: <span class="primary-text">${esc(p.source)}</span></h2>
      <span class="badge">${p.rows.length} rows × ${p.headers.length} columns</span>
    </div>
    <div class="table-wrap small">
      <table class="tbl">
        <thead><tr>${p.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>
          ${p.rows.slice(0, 10).map((row) => `<tr>${p.headers.map((h) => `<td>${row[h] ? esc(row[h]) : '<span class="muted">—</span>'}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${p.rows.length > 10 ? `<p class="fine">Showing first 10 of ${p.rows.length} rows.</p>` : ""}
  </section>`;
}

function step1Html() {
  const p = state.parsed;
  return `
  <div class="grid-2">
    <section class="card">
      <h2 class="card-title">1. Upload your spreadsheet</h2>
      <p class="card-sub">.xlsx, .csv or tab-separated file. Nothing leaves your browser — all processing happens locally.</p>
      <div class="dropzone" data-dropzone data-action="trigger-file">
        <p class="dz-main">Drag &amp; drop a file here, or click to browse</p>
        <p class="dz-sub">.xlsx · .csv · .tsv · .txt</p>
        <input type="file" id="file-input" accept=".xlsx,.csv,.tsv,.txt" hidden />
      </div>
      <hr class="rule" />
      <label class="lbl">…or paste rows directly</label>
      <textarea class="ta" rows="4" data-role="paste" placeholder="Paste cells straight from Excel / Google Sheets (tab-separated), or CSV text. The first row must be your column headers.">${esc(state.pasteText)}</textarea>
      <div class="btn-row">
        <button class="btn" data-action="use-paste" ${state.pasteText.trim() ? "" : "disabled"}>Use pasted data</button>
        <button class="btn outline" data-action="load-sample">Load sample data</button>
      </div>
    </section>
    <section class="card">
      <h2 class="card-title">Expected format</h2>
      <p class="card-sub">One row per targeted officer — you confirm the column mapping in the next step.</p>
      <pre class="code">Officer Name, Grade,  Peer,        Peer Email,     Subordinate, Subordinate Email, Supervisor, Supervisor Email
Sarah Tan,    Grade A, Marcus Lee,  marcus.lee@..., Tan Wei Ling, weiling.tan@...,   Alex Chong, alex.chong@...</pre>
      <p class="fine">Paired name + email columns per relationship. An email cell may also hold several contacts (separated by <code>;</code>, commas or new lines), and "Name &lt;email&gt;" is understood. Self-assessment can be added with one click.</p>
      <p class="fine">Assessors do not need to be targeted employees — support staff and C-suite raters are perfectly fine, as are targeted employees who assess each other.</p>
    </section>
  </div>
  ${p ? importedCardHtml(p) : ""}`;
}

/* ================================================================
   Render: step 2 — mapping
================================================================ */

function step2Html() {
  const headers = state.parsed.headers;
  const m = state.mapping;
  const a = view.assignments;

  const rels = [...new Set(a.map((x) => x.relationship))].sort(relSort);
  const grades = [...new Set(a.map((x) => x.grade))];
  const relCounts = new Map();
  const gradeCounts = new Map();
  a.forEach((x) => {
    relCounts.set(x.relationship, (relCounts.get(x.relationship) || 0) + 1);
    gradeCounts.set(x.grade, (gradeCounts.get(x.grade) || 0) + 1);
  });
  const officerSet = new Set(a.map((x) => `${x.officerName}||${x.grade}`));
  const noEmail = a.filter((x) => !x.assessorEmail).length;

  const coverage = [...officerSet].map((k) => {
    const [name, grade] = k.split("||");
    const counts = {};
    rels.forEach((r) => (counts[r] = 0));
    a.forEach((x) => { if (x.officerName === name && x.grade === grade) counts[x.relationship]++; });
    return { name, grade, counts };
  });

  return `
  <section class="card">
    <h2 class="card-title">Column mapping</h2>
    <div class="map-grid">
      <div class="field-sm"><label class="lbl">Officer name</label>${selectHtml(headers, "officer", m.officerName, 'data-field="officerName"')}</div>
      <div class="field-sm"><label class="lbl">Officer email <span class="opt">(optional)</span></label>${selectHtml(headers, "officer", m.officerEmail, 'data-field="officerEmail"')}</div>
      <div class="field-sm"><label class="lbl">Officer grade / level</label>${selectHtml(headers, "officer", m.officerGrade, 'data-field="officerGrade"')}</div>
    </div>

    <label class="lbl">Relationship columns</label>
    <div class="pairs">
      <div class="pair-head"><span>Relationship</span><span>Assessor name column</span><span>Assessor email column</span><span></span></div>
      ${m.widePairs.map((pair, i) => `
      <div class="pair-row">
        <input class="in" data-role="pair-rel" data-index="${i}" value="${esc(pair.relationship)}" placeholder="e.g. Peer" />
        ${selectHtml(headers, "pair-name", pair.nameColumn, `data-index="${i}"`)}
        ${selectHtml(headers, "pair-email", pair.emailColumn, `data-index="${i}"`)}
        <button class="icon-btn" data-action="remove-pair" data-index="${i}" title="Remove">✕</button>
      </div>`).join("")}
      <div class="btn-row"><button class="btn outline" data-action="add-pair">+ Add relationship mapping</button></div>
    </div>

    <label class="check">
      <input type="checkbox" data-role="self-toggle" ${m.selfFromOfficer ? "checked" : ""} />
      <span>Include self-assessment — each officer also assesses themselves (uses the officer email column)</span>
    </label>
  </section>

  <div class="chips">
    ${chip("assignments", a.length, "indigo")}
    ${chip("officers", officerSet.size)}
    ${chip("relationships", rels.length)}
    ${view.duplicates.length ? chip("duplicates skipped", view.duplicates.length, "red") : ""}
    ${noEmail ? chip("assessments without assessor email", noEmail, "red") : ""}
  </div>

  ${a.length ? `
  <div class="grid-2">
    <section class="card">
      <h2 class="card-title">Grades &amp; relationships found</h2>
      <div class="badges">${grades.map((g) => `<span class="badge">${esc(g)} <em>(${gradeCounts.get(g)})</em></span>`).join("")}</div>
      <div class="badges">${rels.map((r) => `<span class="badge primary">${esc(r)} <em>(${relCounts.get(r)})</em></span>`).join("")}</div>
      <p class="fine">The app needs one Google Form link for every grade × relationship combination you want to send.</p>
    </section>
    <section class="card">
      <h2 class="card-title">Coverage per officer</h2>
      <div class="table-wrap small">
        <table class="tbl">
          <thead><tr><th>Officer</th>${rels.map((r) => `<th class="center">${esc(r)}</th>`).join("")}</tr></thead>
          <tbody>
            ${coverage.map((row) => `<tr>
              <td>${esc(row.name)}${row.grade !== "(no grade)" ? ` <span class="muted">· ${esc(row.grade)}</span>` : ""}</td>
              ${rels.map((r) => `<td class="center ${row.counts[r] ? "" : "zero"}">${row.counts[r] || 0}</td>`).join("")}
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>
  </div>` : ""}`;
}

/* ================================================================
   Render: step 3 — form links
================================================================ */

function formsChipsHtml(used) {
  const missing = [...used.entries()].filter(([k]) => !(state.links[k] || "").trim()).length;
  return chip("grade × relationship combinations in use", used.size, "indigo") +
    (missing ? chip("still missing a form link", missing, "red") : chip("missing links", "0", "green"));
}

function step3Html() {
  const used = new Map();
  view.assignments.forEach((x) => used.set(linkKey(x.grade, x.relationship), (used.get(linkKey(x.grade, x.relationship)) || 0) + 1));
  const grades = [...new Set(view.assignments.map((x) => x.grade))];
  const rels = [...new Set(view.assignments.map((x) => x.relationship))].sort(relSort);

  return `
  <div id="forms-chips" class="chips">${formsChipsHtml(used)}</div>

  <section class="card">
    <h2 class="card-title">Google Form link per grade &amp; relationship</h2>
    <p class="card-sub">Paste the share URL of each form — one per grade × relationship combination.</p>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>Grade</th>${rels.map((r) => `<th>${esc(r)}</th>`).join("")}</tr></thead>
        <tbody>
          ${grades.map((g) => `<tr>
            <td class="grade-cell">${esc(g)}</td>
            ${rels.map((r) => {
              const k = linkKey(g, r);
              const n = used.get(k) || 0;
              const filled = (state.links[k] || "").trim();
              return `<td><input class="in link ${n === 0 ? "unused" : filled ? "filled" : ""}" data-role="link"
                data-grade="${esc(g)}" data-rel="${esc(r)}" value="${esc(state.links[k] || "")}"
                placeholder="${n ? `https://forms.gle/… (${n} form${n > 1 ? "s" : ""})` : "not used"}" /></td>`;
            }).join("")}
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </section>

  <section class="card">
    <h2 class="card-title">Bulk paste (optional)</h2>
    <p class="card-sub">One row per link, e.g. <code>Grade A, Peer, https://forms.gle/abc123</code></p>
    <textarea class="ta mono" rows="4" data-role="bulk" placeholder="Grade A, Self, https://forms.gle/…">${esc(state.bulkText)}</textarea>
    <div class="btn-row"><button class="btn" data-action="apply-bulk" ${state.bulkText.trim() ? "" : "disabled"}>Apply links</button><span id="bulk-flash" class="flash"></span></div>
  </section>`;
}

/* ================================================================
   Render: step 4 — generate & export
================================================================ */

function listItemsHtml() {
  const q = state.search.trim().toLowerCase();
  const list = q
    ? view.emails.filter((e) => e.to.toLowerCase().includes(q) || (e.assessorName || "").toLowerCase().includes(q))
    : view.emails;
  const current = currentEmail();
  if (!list.length) return `<p class="fine">No assessor matches that search.</p>`;
  return list.map((e) => `
    <button class="assessor ${current && e.key === current.key ? "selected" : ""}" data-action="select-assessor" data-key="${esc(e.key)}">
      <span class="a-top">
        <span class="a-name">${esc(e.assessorName || "(unknown)")} <span class="a-count">(${e.assignments.length})</span></span>
        ${e.missing ? `<span class="badge warn">⚠ ${e.missing}</span>` : ""}
      </span>
      <span class="a-mail">${esc(e.to || "⚠ no email address")}</span>
    </button>`).join("");
}

function previewHtml() {
  const e = currentEmail();
  if (!e) return "";
  const body =
    state.bodyView === "html"
      ? `<iframe class="preview-iframe" srcdoc="<!DOCTYPE html><html><head><meta charset=&quot;utf-8&quot;></head><body style=&quot;margin:12px;&quot;>${e.bodyHtml.replace(/"/g, "&quot;")}"></iframe>`
      : `<pre class="body-pre">${esc(e.body)}</pre>`;
  return `
  <section class="card">
    <div class="preview-head">
      <h2 class="card-title">${esc(e.assessorName || e.to || "(unknown)")}</h2>
      <div class="btn-row" style="margin-top:0">
        <span id="preview-flash" class="flash"></span>
        <button class="btn" data-action="copy-email" data-key="${esc(e.key)}">Copy text</button>
        <button class="btn" data-action="copy-html" data-key="${esc(e.key)}">Copy HTML</button>
        ${e.to ? `<a class="btn outline" href="${esc(mailtoUrl(e))}">Open in mail app</a>` : ""}
      </div>
    </div>
    <div class="field"><p class="field-label">To</p><p>${esc(e.to || "⚠ no email address on record")}</p></div>
    <div class="field"><p class="field-label">Subject</p><p class="strong">${esc(e.subject)}</p></div>
    <div class="field">
      <p class="field-label">Body <span class="muted">— ${state.bodyView === "html" ? "HTML preview (as recipients will see it)" : "plain text"}</span></p>
      <div class="btn-row" style="margin-top:0;margin-bottom:8px">
        <button class="btn outline small ${state.bodyView === "html" ? "active" : ""}" data-action="toggle-body-view" data-view="html">HTML</button>
        <button class="btn outline small ${state.bodyView === "text" ? "active" : ""}" data-action="toggle-body-view" data-view="text">Plain text</button>
      </div>
      ${body}
    </div>
  </section>`;
}

function step4Html() {
  const s = state.settings;
  return `
  ${view.missingCount ? `<div class="alert warn">⚠️ ${view.missingCount} assignment(s) still reference <strong>[FORM LINK MISSING — grade / relationship]</strong>. Emails can be generated, but fill the grid in Step 3 first for clean output.</div>` : ""}
  <div class="grid-2 wide-left">
    <div class="stack">
      <section class="card">
        <h2 class="card-title">Email settings &amp; template</h2>
        <div class="map-grid">
          <div class="field-sm"><label class="lbl">Organisation name</label><input class="in" data-role="setting" data-key="org" value="${esc(s.org)}" /></div>
          <div class="field-sm"><label class="lbl">Deadline</label><input class="in" data-role="setting" data-key="deadline" value="${esc(s.deadline)}" placeholder="e.g. Friday, 30 October 2026" /></div>
          <div class="field-sm"><label class="lbl">Signature</label><input class="in" data-role="setting" data-key="signature" value="${esc(s.signature)}" /></div>
        </div>
        <div class="field-sm"><label class="lbl">Subject line</label><input class="in" data-role="setting" data-key="subject" value="${esc(s.subject)}" /></div>
        <div class="field-sm"><label class="lbl">Body template</label><textarea class="ta mono" rows="10" data-role="setting" data-key="body">${esc(s.body)}</textarea></div>
        <div class="ph-help">
          <p class="lbl">Available placeholders</p>
          ${PLACEHOLDERS.map(([p, d]) => `<p><code>${esc(p)}</code> — ${esc(d)}</p>`).join("")}
        </div>
      </section>
      <section class="card">
        <div class="preview-head">
          <h2 class="card-title">Export for sending</h2>
          <span id="export-flash" class="flash"></span>
        </div>
        <div class="btn-row" style="margin-top:0">
          <button class="btn outline" data-action="download-csv">⬇ Mail-merge CSV (all emails)</button>
          <button class="btn outline" data-action="download-txt">⬇ All emails (.txt)</button>
        </div>
        <p class="fine">Use the CSV with a mail-merge add-on (GMass, YAMM…) to send personalised emails from Gmail in bulk. Map <code>To</code>, <code>Subject</code> and either <code>Body</code> (plain text) or <code>BodyHTML</code> (real HTML table) depending on your add-on. The “Open in mail app” button carries the plain-text version — mailto cannot include HTML.</p>
      </section>
    </div>
    <div class="stack">
      <section class="card">
        <h2 class="card-title">Preview emails <span class="muted">(${view.emails.length})</span></h2>
        <input class="in" data-role="search" placeholder="Search assessor…" value="${esc(state.search)}" />
        <div id="assessor-list" class="assessor-list">${listItemsHtml()}</div>
      </section>
      <div id="preview-pane">${previewHtml()}</div>
    </div>
  </div>`;
}

/* ================================================================
   Targeted re-renders (keep focus in text inputs)
================================================================ */

function renderList() {
  const el = $("#assessor-list");
  if (el) el.innerHTML = listItemsHtml();
}

function renderPreview() {
  const el = $("#preview-pane");
  if (el) el.innerHTML = previewHtml();
}

/* ================================================================
   Events
================================================================ */

document.addEventListener("click", (e) => {
  if (e.target.id === "file-input") return; // don't re-trigger the file dialog
  const el = e.target.closest("[data-action]");
  if (!el) return;
  switch (el.dataset.action) {
    case "dismiss-error": state.error = ""; render(); break;
    case "trigger-file": $("#file-input").click(); break;
    case "use-paste": usePaste(); break;
    case "load-sample": loadSample(); break;
    case "goto-step": state.step = Number(el.dataset.step); render(); break;
    case "next": state.step = Math.min(4, state.step + 1); render(); break;
    case "back": state.step = Math.max(1, state.step - 1); render(); break;
    case "add-pair": state.mapping.widePairs.push({ nameColumn: "", emailColumn: "", relationship: "" }); render(); break;
    case "remove-pair": state.mapping.widePairs.splice(Number(el.dataset.index), 1); render(); break;
    case "apply-bulk": applyBulk(); break;
    case "select-assessor": state.selectedAssessor = el.dataset.key; renderList(); renderPreview(); break;
    case "copy-email": copyEmail(el.dataset.key); break;
    case "copy-html": copyHtml(el.dataset.key); break;
    case "toggle-body-view": state.bodyView = el.dataset.view === "text" ? "text" : "html"; renderPreview(); break;
    case "download-csv": {
      const ok = downloadText("360-assessment-mail-merge.csv", toMailMergeCsv(view.emails), "text/csv");
      flash("export-flash", ok ? "Mail-merge CSV downloaded ✓" : "Download blocked — use Copy instead.");
      break;
    }
    case "download-txt": {
      const ok = downloadText("360-assessment-emails.txt", toAllText(view.emails));
      flash("export-flash", ok ? "Text file downloaded ✓" : "Download blocked — use Copy instead.");
      break;
    }
  }
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "file-input") { handleFiles(el.files); return; }
  const role = el.dataset.role;
  if (!role) return;
  const i = Number(el.dataset.index);
  if (role === "officer") state.mapping[el.dataset.field] = el.value;
  else if (role === "pair-name") state.mapping.widePairs[i].nameColumn = el.value;
  else if (role === "pair-email") state.mapping.widePairs[i].emailColumn = el.value;
  else if (role === "self-toggle") state.mapping.selfFromOfficer = el.checked;
  else return;
  render();
});

document.addEventListener("input", (e) => {
  const el = e.target;
  const role = el.dataset.role;
  if (!role) return;
  if (role === "paste") state.pasteText = el.value;
  else if (role === "bulk") state.bulkText = el.value;
  else if (role === "pair-rel") state.mapping.widePairs[Number(el.dataset.index)].relationship = el.value;
  else if (role === "link") {
    state.links[linkKey(el.dataset.grade, el.dataset.rel)] = el.value;
    view = derived();
    const chips = $("#forms-chips");
    const used = new Map();
    view.assignments.forEach((x) => used.set(linkKey(x.grade, x.relationship), (used.get(linkKey(x.grade, x.relationship)) || 0) + 1));
    if (chips) chips.innerHTML = formsChipsHtml(used);
  } else if (role === "setting") {
    state.settings[el.dataset.key] = el.value;
    view = derived();
    renderPreview();
  } else if (role === "search") {
    state.search = el.value;
    view = derived();
    renderList();
    renderPreview();
  }
});

// Drag & drop (delegated, so it survives re-renders)
document.addEventListener("dragover", (e) => {
  const dz = e.target.closest("[data-dropzone]");
  if (dz) { e.preventDefault(); dz.classList.add("dragover"); }
});
document.addEventListener("dragleave", (e) => {
  const dz = e.target.closest("[data-dropzone]");
  if (dz) dz.classList.remove("dragover");
});
document.addEventListener("drop", (e) => {
  const dz = e.target.closest("[data-dropzone]");
  if (!dz) return;
  e.preventDefault();
  dz.classList.remove("dragover");
  handleFiles(e.dataTransfer.files);
});

render();
