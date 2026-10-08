// model.js — column auto-detection and assignment computation

export const REL_ORDER = ["Self", "Peer", "Subordinate", "Supervisor"];

export const linkKey = (grade, rel) => `${grade}||${rel}`;

const relRank = (rel) => {
  const i = REL_ORDER.indexOf(rel);
  return i >= 0 ? i : 90 + rel.charCodeAt(0);
};

export const relSort = (a, b) => relRank(a) - relRank(b) || a.localeCompare(b);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// "Name <a@b.com>" / "a@b.com (Name)" / plain email / plain name
export function splitContact(raw) {
  const s = (raw || "").trim().replace(/^mailto:/i, "");
  const angle = s.match(/^(.*)<\s*([^\s<>]+@[^\s<>]+)\s*>$/);
  if (angle) return { email: angle[2].trim(), name: angle[1].replace(/[(),]/g, "").trim() };
  const em = s.match(EMAIL_RE);
  if (em) return { email: em[0], name: s.replace(em[0], "").replace(/[(<>,;]/g, " ").trim() };
  return { email: "", name: s };
}

// A cell may hold several contacts: "a@x.com; b@x.com", or newline / | separated
export function splitCell(cell) {
  return (cell || "")
    .split(/[\n;|]+/)
    .flatMap((part) => (((part.match(/@/g) || []).length > 1) ? part.split(",") : [part]))
    .map((s) => s.trim())
    .filter(Boolean);
}

const findHeader = (headers, re) => headers.find((h) => re.test(h.toLowerCase())) ?? "";

export function autoDetectMapping(headers) {
  const emailHeaders = headers.filter((h) => /e-?mail/i.test(h));
  const nameHeaders = headers.filter((h) => /name/i.test(h));
  const officerName = findHeader(nameHeaders, /officer|target|employee|staff/) || nameHeaders[0] || "";
  const officerEmail = findHeader(emailHeaders, /officer|target|employee|staff/) || emailHeaders[0] || "";
  const officerGrade = findHeader(headers, /grade|gred|level|rank|band|class/) || "";

  const relWord = (h) => {
    const v = h.toLowerCase();
    if (v.includes("self")) return "Self";
    if (v.includes("peer")) return "Peer";
    if (v.includes("sub")) return "Subordinate";
    if (v.includes("supervis") || v.includes("superior")) return "Supervisor";
    return null;
  };
  const widePairs = [];
  for (const rel of ["Peer", "Subordinate", "Supervisor"]) {
    const cols = headers.filter((h) => relWord(h) === rel && !/officer|target|employee/i.test(h));
    const emailCol = cols.find((h) => /e-?mail/i.test(h)) || "";
    const nameCol = cols.find((h) => !/e-?mail/i.test(h)) || "";
    if (emailCol || nameCol) widePairs.push({ nameColumn: nameCol, emailColumn: emailCol, relationship: rel });
  }
  return { officerName, officerEmail, officerGrade, widePairs, selfFromOfficer: !!officerEmail };
}

export function computeAssignments(parsed, mapping) {
  const assignments = [];
  const duplicates = [];
  const seen = new Set();
  const push = (a) => {
    const k = `${a.assessorEmail.toLowerCase()}|${a.officerName.toLowerCase()}|${a.relationship.toLowerCase()}`;
    if (seen.has(k)) { duplicates.push(a); return; }
    seen.add(k);
    assignments.push(a);
  };
  if (!parsed) return { assignments, duplicates };

  for (const row of parsed.rows) {
    const officerName = (row[mapping.officerName] ?? "").trim();
    if (!officerName) continue;
    const officerEmail = (row[mapping.officerEmail] ?? "").trim();
    const grade = (row[mapping.officerGrade] ?? "").trim() || "(no grade)";

    if (mapping.selfFromOfficer && officerEmail) {
      push({
        officerName,
        officerEmail,
        grade,
        relationship: "Self",
        assessorName: officerName,
        assessorEmail: splitContact(officerEmail).email,
      });
    }
    for (const pair of mapping.widePairs) {
      const emailCell = (row[pair.emailColumn] ?? "").trim();
      const nameFromCol = (row[pair.nameColumn] ?? "").trim();
      const frags = emailCell ? splitCell(emailCell) : [""];
      for (const frag of frags) {
        const contact = frag ? splitContact(frag) : { email: "", name: "" };
        const assessorName = contact.name || nameFromCol;
        if (!contact.email && !assessorName) continue;
        push({
          officerName,
          officerEmail,
          grade,
          relationship: pair.relationship || "(unspecified)",
          assessorName,
          assessorEmail: contact.email,
        });
      }
    }
  }
  return { assignments, duplicates };
}
