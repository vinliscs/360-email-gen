// email.js — templates and per-assessor email generation

import { relSort } from "./model.js";

export const defaultSettings = {
  org: "our organisation",
  deadline: "",
  signature: "The HR Team",
  subject: "360° Assessment – Action Required ({officer_count} form{plural})",
  body: `Dear {assessor_name},

As part of our 360-degree assessment exercise at {org}, you have been identified as a feedback provider for the following officer{plural}:

{assignments}

Kindly complete the form{plural} by {deadline}. Your responses are confidential and will be used for development purposes only.

Thank you for your time and participation.

{signature}`,
};

export const SAMPLE_CSV = `Officer Name,Officer Email,Officer Grade,Peer,Peer Email,Subordinate,Subordinate Email,Supervisor,Supervisor Email
Sarah Tan,sarah.tan@org.com,Grade A,Marcus Lee,marcus.lee@org.com,Tan Wei Ling,weiling.tan@org.com,Alex Chong (CEO),alex.chong@org.com
Marcus Lee,marcus.lee@org.com,Grade A,Sarah Tan,sarah.tan@org.com,Raj Kumar,raj.kumar@org.com,Alex Chong (CEO),alex.chong@org.com
Priya Nair,priya.nair@org.com,Grade B,David Wong,david.wong@org.com,Nurul Huda,nurul.huda@org.com,Michelle Ong (COO),michelle.ong@org.com
David Wong,david.wong@org.com,Grade B,Priya Nair,priya.nair@org.com,Faridah Osman,faridah.osman@org.com,Michelle Ong (COO),michelle.ong@org.com
James Lim,james.lim@org.com,Grade C,Aisha Rahman,aisha.rahman@org.com,Lim Chee Keong,cheekeong.lim@org.com,Alex Chong (CEO),alex.chong@org.com
Aisha Rahman,aisha.rahman@org.com,Grade C,James Lim,james.lim@org.com,Grace Lee,grace.lee@org.com,Michelle Ong (COO),michelle.ong@org.com`;

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

const htmlEscape = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Inline styles so the table survives Gmail / Outlook sanitising
const TH_STYLE = 'style="padding:8px 14px;border:1px solid #d1d5db;background:#f3f4f6;text-align:left;font-family:Arial,sans-serif;font-size:14px;color:#1f2937;"';
const TD_STYLE = 'style="padding:8px 14px;border:1px solid #d1d5db;font-family:Arial,sans-serif;font-size:14px;color:#1f2937;"';

const linkOrMissing = (a, links) => {
  const url = (links[`${a.grade}||${a.relationship}`] ?? "").trim();
  return url || `[FORM LINK MISSING — ${a.grade} / ${a.relationship}]`;
};

const displayName = (a) =>
  `${a.officerName}${a.grade && a.grade !== "(no grade)" ? ` (${a.grade})` : ""}`;

// Plain-text table, one row per assignment — only assessment types that apply
export function formatAssignments(list, links) {
  const rows = list.map((a) => ({
    type: `${a.relationship} assessment`,
    name: displayName(a),
    link: linkOrMissing(a, links),
  }));
  const pad = (s, w) => s + " ".repeat(Math.max(0, w - s.length));
  const wType = Math.max("Assessment type".length, ...rows.map((r) => r.type.length));
  const wName = Math.max("Targeted Name".length, ...rows.map((r) => r.name.length));
  const line = (r) => `| ${pad(r.type, wType)} | ${pad(r.name, wName)} | ${r.link}`;
  return [
    `| ${pad("Assessment type", wType)} | ${pad("Targeted Name", wName)} | Link`,
    `| ${"-".repeat(wType)} | ${"-".repeat(wName)} | ${"-".repeat(4)}`,
    ...rows.map(line),
  ].join("\n");
}

// Real HTML <table> version for the BodyHTML column
export function formatAssignmentsHtml(list, links) {
  const head = `<tr><th ${TH_STYLE}>Assessment type</th><th ${TH_STYLE}>Targeted Name</th><th ${TH_STYLE}>Link</th></tr>`;
  const body = list
    .map((a) => {
      const url = (links[`${a.grade}||${a.relationship}`] ?? "").trim();
      const linkCell = url
        ? `<a href="${htmlEscape(url)}" style="color:#4f46e5;">Open form</a>`
        : `<span style="color:#b91c1c;font-weight:bold;">FORM LINK MISSING — ${htmlEscape(a.grade)} / ${htmlEscape(a.relationship)}</span>`;
      return `<tr><td ${TD_STYLE}>${htmlEscape(`${a.relationship} assessment`)}</td><td ${TD_STYLE}>${htmlEscape(displayName(a))}</td><td ${TD_STYLE}>${linkCell}</td></tr>`;
    })
    .join("");
  return `<table style="border-collapse:collapse;margin:8px 0;">${head}${body}</table>`;
}

const TABLE_MARKER = "\u0000TABLE\u0000";

// Turns the plain-text template into an HTML email body:
// blank-line-separated paragraphs become <p>, the assignments marker becomes the table
export function htmlBody(text, assignments, links) {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paras
    .map((p) => (p === TABLE_MARKER ? formatAssignmentsHtml(assignments, links) : `<p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:14px;color:#1f2937;">${htmlEscape(p).replace(/\n/g, "<br />")}</p>`))
    .join("\n");
}

export function buildEmails(assignments, links, settings) {
  const byAssessor = new Map();
  for (const a of assignments) {
    const key = a.assessorEmail.toLowerCase();
    let e = byAssessor.get(key);
    if (!e) {
      e = { key, to: a.assessorEmail, assessorName: a.assessorName, assignments: [], subject: "", body: "", missing: 0 };
      byAssessor.set(key, e);
    }
    if (!e.assessorName && a.assessorName) e.assessorName = a.assessorName;
    e.assignments.push(a);
  }

  const emails = [...byAssessor.values()];
  for (const e of emails) {
    e.assignments.sort((a, b) => relSort(a.relationship, b.relationship) || a.officerName.localeCompare(b.officerName));
    e.missing = e.assignments.filter((a) => !(links[`${a.grade}||${a.relationship}`] ?? "").trim()).length;
    const n = e.assignments.length;
    const vars = {
      assessor_name: e.assessorName || "Colleague",
      org: settings.org.trim() || "our organisation",
      deadline: settings.deadline.trim() || "the announced deadline",
      officer_count: String(n),
      plural: n === 1 ? "" : "s",
      assignments: formatAssignments(e.assignments, links),
      signature: settings.signature.trim() || "The HR Team",
    };
    e.subject = fill(settings.subject, vars);
    e.body = fill(settings.body, vars);
    e.bodyHtml = htmlBody(fill(settings.body, { ...vars, assignments: TABLE_MARKER }), e.assignments, links);
  }
  return emails.sort((a, b) => (a.assessorName || a.to).localeCompare(b.assessorName || b.to));
}
