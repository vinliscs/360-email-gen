// parse.js — spreadsheet ingestion: delimited text (CSV/TSV/paste) and .xlsx

// ---------- delimited text ----------

function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ",";
}

export function parseDelimited(text) {
  const delim = detectDelimiter(text);
  const records = [];
  let field = "";
  let record = [];
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { record.push(field); field = ""; }
    else if (ch === "\n") { record.push(field); records.push(record); record = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || record.length) { record.push(field); records.push(record); }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows = nonEmpty.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
  return { headers, rows };
}

// ---------- .xlsx (zip + XML, no external libraries) ----------

async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid .xlsx file");
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out = {};
  const td = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = td.decode(new Uint8Array(buf, off + 46, nameLen));
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const data = new Uint8Array(buf, dataStart, compSize);
    out[name] = method === 0 ? data : await inflateRaw(data);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function colIndexFromRef(ref) {
  const m = ref.match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function parseXlsx(buf) {
  const files = await unzip(buf);
  const td = new TextDecoder();
  const parser = new DOMParser();

  const shared = [];
  if (files["xl/sharedStrings.xml"]) {
    const doc = parser.parseFromString(td.decode(files["xl/sharedStrings.xml"]), "application/xml");
    for (const si of doc.getElementsByTagName("si")) {
      let s = "";
      for (const t of si.getElementsByTagName("t")) s += t.textContent ?? "";
      shared.push(s);
    }
  }

  const sheetName = Object.keys(files).find((n) => /^xl\/worksheets\/sheet\d*\.xml$/.test(n));
  if (!sheetName) throw new Error("No worksheet found inside .xlsx");
  const doc = parser.parseFromString(td.decode(files[sheetName]), "application/xml");

  const matrix = []; // matrix[colIndex][rowIndex]
  for (const rowEl of doc.getElementsByTagName("row")) {
    for (const c of rowEl.getElementsByTagName("c")) {
      const ci = colIndexFromRef(c.getAttribute("r") || "");
      const t = c.getAttribute("t") || "";
      let val = "";
      if (t === "inlineStr") {
        for (const tt of c.getElementsByTagName("t")) val += tt.textContent ?? "";
      } else {
        const v = c.getElementsByTagName("v")[0];
        if (t === "s" && v) val = shared[Number(v.textContent)] ?? "";
        else if (v) val = v.textContent || "";
      }
      while (matrix.length <= ci) matrix.push([]);
      matrix[ci].push(val.trim());
    }
  }

  const width = Math.max(...matrix.map((c) => c.length), 0);
  const grid = [];
  for (let r = 0; r < width; r++) grid.push(matrix.map((col) => col[r] ?? ""));
  const nonEmpty = grid.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows = nonEmpty.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
  return { headers, rows };
}

// ---------- file dispatch ----------

export async function parseFile(file) {
  if (/\.xlsx$/i.test(file.name)) {
    const p = await parseXlsx(await file.arrayBuffer());
    if (!p.headers.length) throw new Error("The workbook appears to be empty.");
    return p;
  }
  const p = parseDelimited(await file.text());
  if (!p.headers.length) throw new Error("No data rows found in the file.");
  return p;
}
