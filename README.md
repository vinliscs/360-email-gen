# 360° Assessment Email Generator

A static, dependency-free web app for 360-degree assessment exercises. Upload a roster where
**each row is one targeted officer** with paired name + email columns per relationship
(Peer / Peer Email, Subordinate / Subordinate Email, Supervisor / Supervisor Email), assign one
Google Form link per grade × relationship, and generate one ready-to-send email per assessor.

No build tools, no backend, no third-party packages — plain HTML, CSS and JavaScript ES modules.

## Deploy on GitHub Pages

1. Create a repository (e.g. `360-assessment-app`).
2. Upload all files from this folder, keeping the structure:
   ```
   index.html
   styles.css
   js/
     app.js
     model.js
     email.js
     parse.js
     export.js
   README.md
   ```
3. In the repo, go to **Settings → Pages**.
4. Under **Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, Folder = `/ (root)`.
5. Your app is live at `https://<username>.github.io/360-assessment-app/` within a minute or two.

## Run locally

ES modules require an HTTP server — opening `index.html` by double-click will be blocked by
browser CORS rules. From this folder run any static server, for example:

```
python3 -m http.server 8000
```

then open <http://localhost:8000>.

## How it works

1. **Import roster** — upload `.xlsx` / `.csv` / `.tsv`, or paste rows directly. Or click
   *Load sample data* to try it out.
2. **Map columns** — auto-detected from your headers, with a coverage matrix (officer ×
   relationship) and duplicate / missing-email checks. Self-assessment is a checkbox (uses the
   officer's own email column).
3. **Form links** — one URL per grade × relationship (e.g. 4 grades × 4 relationships = 16
   forms). Bulk paste: `Grade A, Peer, https://forms.gle/…`.
4. **Generate emails** — per-assessor emails with a plain-text table of officers and links.
   Edit the subject/body templates, then copy a single email, open it in your mail app, or export:
   - **Mail-merge CSV** (To / Subject / Body) for GMass, YAMM, etc.
   - **All emails (.txt)**

An email cell may hold several contacts (`a@x.com; b@x.com`) and `Name <email>` is understood.
Assessors do not need to be targeted employees — support staff and C-suite raters are fine.

## Privacy

Everything runs locally in the browser. No roster data, form links or email content are uploaded
anywhere.

## Module map

| File | Purpose |
| --- | --- |
| `index.html` | Page shell (header, stepper, step containers) |
| `styles.css` | All styling |
| `js/app.js` | State, rendering, event wiring |
| `js/parse.js` | CSV/TSV + .xlsx reading (built-in zip inflate + XML, no libraries) |
| `js/model.js` | Column auto-detection, assignment computation, duplicates |
| `js/email.js` | Templates, table formatter, per-assessor email builder |
| `js/export.js` | Clipboard, downloads, mailto, mail-merge CSV |
