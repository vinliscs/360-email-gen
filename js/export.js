// export.js — clipboard, downloads, mailto and mail-merge helpers

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadText(name, content, mime = "text/plain") {
  try {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 200);
    return true;
  } catch {
    return false;
  }
}

export const csvEscape = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// Columns: To, Subject, Body (plain text), BodyHTML (real HTML table) — ready for GMass / YAMM / any mail merge
export function toMailMergeCsv(emails) {
  const rows = [["To", "Subject", "Body", "BodyHTML"], ...emails.map((e) => [e.to, e.subject, e.body, e.bodyHtml])];
  return "\uFEFF" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

export function toAllText(emails) {
  const sep = "=".repeat(70);
  return emails
    .map((e) => `To: ${e.to || "(no email address)"}\nSubject: ${e.subject}\n\n${e.body}`)
    .join(`\n\n${sep}\n\n`);
}

export function mailtoUrl(e) {
  const body = e.body.replace(/\r?\n/g, "\r\n");
  return `mailto:${encodeURIComponent(e.to)}?subject=${encodeURIComponent(e.subject)}&body=${encodeURIComponent(body)}`;
}
