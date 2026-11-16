// forms_sheet.js — import Google Form links from a sheet with headers:
// grade, self_form, peer_form, subordinate_form, supervisor_form
// One row per grade; each *_form cell holds that grade's form URL for that relationship.

import { linkKey } from "./model.js";

const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const GRADE_HEADERS = new Set(["grade", "gred", "level", "rank", "band", "class"]);

const REL_ALIASES = {
  self: "Self",
  peer: "Peer",
  subordinate: "Subordinate",
  sub: "Subordinate",
  supervisor: "Supervisor",
  supervis: "Supervisor",
  superior: "Supervisor",
};

const URL_RE = /^https?:\/\/\S+$/i;

// parsed: { headers, rows } as returned by parseFile() / parseDelimited() from parse.js
// returns: { links, applied, skipped, errors, gradesSeen }
export function parseFormsSheet(parsed) {
  const links = {};
  const skipped = [];
  const errors = [];
  const gradesSeen = new Set();
  let applied = 0;

  if (!parsed || !parsed.headers.length) {
    errors.push("the sheet appears to be empty");
    return { links, applied, skipped, errors, gradesSeen: [] };
  }

  const gradeCol = parsed.headers.find((h) => GRADE_HEADERS.has(norm(h)));
  if (!gradeCol) {
    errors.push(`no "grade" column found (headers: ${parsed.headers.join(", ")})`);
    return { links, applied, skipped, errors, gradesSeen: [] };
  }

  // form column per relationship: "peer_form" → Peer, "Peer Form" → Peer, "peer" → Peer, …
  const formCols = [];
  for (const h of parsed.headers) {
    if (h === gradeCol) continue;
    let key = norm(h);
    if (key.endsWith("_form")) key = key.slice(0, -"_form".length);
    const rel = REL_ALIASES[key];
    if (rel) formCols.push({ column: h, rel });
  }
  if (!formCols.length) {
    errors.push(
      `no form columns found — expected self_form, peer_form, subordinate_form, supervisor_form (headers: ${parsed.headers.join(", ")})`
    );
    return { links, applied, skipped, errors, gradesSeen: [] };
  }

  parsed.rows.forEach((row, idx) => {
    const grade = (row[gradeCol] ?? "").trim();
    if (!grade) {
      skipped.push({ row: idx + 2, rel: "(row)", value: "", reason: "empty grade" });
      return;
    }
    gradesSeen.add(grade);
    for (const { column, rel } of formCols) {
      const value = (row[column] ?? "").trim();
      if (!value) continue; // not every grade needs every relationship
      if (!URL_RE.test(value)) {
        skipped.push({ row: idx + 2, rel, value, reason: "not a http(s) URL" });
        continue;
      }
      links[linkKey(grade, rel)] = value; // "grade||rel" — same key the Step 3 grid uses
      applied++;
    }
  });

  return { links, applied, skipped, errors, gradesSeen: [...gradesSeen] };
}
