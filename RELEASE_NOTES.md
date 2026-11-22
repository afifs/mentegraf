
# Mentegraf v2.5.0 — Release Notes

## Suspicious words

- Words the spell checker cannot catch because every form is a real word — "kar" / "kâr", "hala" / "hâlâ" — are listed in the work queue's **Whole book** group, marked **suspicious**: how often each form occurs and a short note ("kar 3 times · kâr 5 times — kâr: kazanç; kar: yağış"). Each click opens the next place; ✓ takes the item off the list. A group is listed even when only one of its forms occurs.
- The list lives in the project folder, `.mentegraf/suspicious.txt`, and travels and syncs with the book. It is created at the first check with kar/kâr, hala/hâlâ, adet/âdet, hakim/hâkim, ama/âmâ, alem/âlem, kağıt/kâğıt. One group per line: `kar | kâr* — note`; a `*` also finds the word with endings (kârı, kârlı). Case does not count, the circumflex does.
- Running text, headings, footnotes and captions are read; code blocks, link targets, citation and footnote keys are not. A circumflex pair on the list is no longer shown a second time as a circumflex variant.

## Other

- The misspelling underline is a little darker.
- Saving on Windows waits longer (about 3 s) for a file held by a sync client or an antivirus scan. When it still cannot save, it says why: the file is read-only (often locked in Seafile or OneDrive) or held open by another program.
- A read-only project file stops the save before a backup is made, so failing auto-saves no longer fill a synced folder with backups. A failed auto-save is shown in the status line.

# Mentegraf v2.4.0 — Release Notes

## Search in texts

- **Match letters exactly** (new box): case, circumflex and Turkish letters count — "kâr" finds only "kâr", "kar" only "kar", "ılık" not "ILIK". Off by default; the flexible search stays as it was.
- **Whole word** (new box, off by default): "kar" no longer finds "karmaşık". Word edges follow Unicode, so Turkish letters (and circumflexes typed as separate marks) are word letters; an apostrophe or hyphen ends a word ("Ankara" finds "Ankara'da"). Works in both flexible and exact search.
- The query is no longer trimmed: spaces at the start or end are part of it.
- Hits in footnotes and figure captions are labelled **footnote** / **caption**. A figure's file name and `#fig:` id are no longer searched.
- The boxes open with the project's defaults (`project.mentegraf` → `settings.search`) and change only the search at hand; **Make default** writes the current choice to the project.
- The editor's own search panel (Ctrl+F), with "match case" off, now lower-cases by the book's language: in a Turkish book "ılık" finds "ILIK" and "ilik" finds "İLİK".

## Spell checking

- The editor checks every visible word itself — text already in a file too, not only what you type — and marks misspellings with a wavy red underline. Footnotes and captions are checked; node names, file names, the metadata block, code, web addresses, footnote and citation keys, passage IDs, `{…}` blocks, numbers and all-caps abbreviations are not.
- Words with a circumflex the dictionary lacks count as right when the same word without it is right; whether the circumflex belongs there is for the suspicious-words check (next version). The suffix after an apostrophe (Goethe’nin, Ankara'da) is not checked on its own.
- The language is the book's language (Settings → document language), not the menu language. A Turkish book is checked in Turkish and US English together.
- **View → Spell checking** switches it on or off; the choice is kept in the project (`settings.spellcheck`, on by default).
- Right-click menu: suggestions, **Add to dictionary**, **Ignore in this project**, Cut / Copy / Paste — in Turkish and English. Also in texts opened in a window of their own.
- The project's word lists live in the project folder — `.mentegraf/dictionary.txt` and `.mentegraf/ignore.txt`, one word per line — so they travel and sync with the book. They are loaded when the project opens and removed when it closes, so one book's words never leak into another.
- `await mentegraf.spellcheckStatus()` in the developer tools (F12) shows the checker's state.
- The Turkish and US English Hunspell dictionaries ship with Mentegraf (npm packages `dictionary-tr`, MIT, and `dictionary-en`, MIT AND BSD; read with `nspell`) and are loaded in a process of their own. Spelling works the same on Windows, macOS and Linux, needs no internet and no Windows language pack. Chromium's built-in checker is not used: it only looks at words as they are typed, and on Windows it cannot be asked about a word.

## Other

- Project settings other than node sizing are now kept when the project is saved.

# Mentegraf v2.1.0 — Release Notes

## New Features

### Zotero Integration
- Import books, articles, and references directly from your Zotero library
- Browse collections or search within Zotero
- Authors automatically become Person nodes with connections
- Metadata preserved: abstract, publication, date, DOI, URL, tags
- "Open in Zotero" button on imported nodes for quick back-reference
- Requires: Zotero running with "Allow other applications" enabled

### Category Report Export
- New export option: generate reports for selected node categories
- Three output formats: Markdown, HTML, and CSV/TSV
- Category picker with checkboxes — export only what you need
- Optional connection list per node
- HTML output is print-ready (Georgia serif, @media print)
- CSV/TSV output is database-ready (nodes + edges, tab-separated)

## Improvements

- All hardcoded language strings replaced with i18n system — full TR/EN coverage
- About page updated with Zotero usage tip (13 tips total)
- GitHub Actions workflow updated for Node.js 24

## Bug Fixes

- Fixed crash on mouse move before canvas initialization (clearDL guard)
- Fixed preload.js crash: `shell` module removed from preload context, routed through IPC
- Fixed Zotero API connection: explicit hostname/port/path + req.end()
- Fixed Zotero check endpoint: /api/ → /api/users/0/items?limit=1

## System Requirements

- Windows 10/11 (64-bit)
- ~150 MB disk space
- Zotero 7+ (optional, for import feature)

---

MIT License © 2026 Afif Say — [www.afifsay.org](https://www.afifsay.org)

# Mentegraf v2.0.1 — Release Notes

**Author's Visual Knowledge Graph Tool**

Mentegraf helps authors, researchers, and thinkers map their ideas visually. Create nodes for concepts, people, books, and chapters, connect them with typed edges, and publish interactive web pages.

---

## Highlights

### Visual Knowledge Graph
- 10 configurable node types with Material Symbol icons (Person, Concept, Book, Idea, Term, Document, Chapter, Event, Location, Institution)
- 7 edge types with distinct colors and mid-edge markers (Influences ▶, Contradicts ✕, Builds On «, Contains ◉, Parallel ∥, Discusses ◇)
- Edge weight 1–5 with visual thickness and dot indicators

### Zotero Integration
- Import books, articles, and references from your Zotero library
- Browse collections, search, select and import
- Authors automatically become Person nodes with connections
- "Open in Zotero" button on imported nodes for quick back-reference
- Metadata preserved: abstract, publication info, DOI, tags

### D3.js Publish
- Export your graph as a standalone interactive HTML page
- Force-directed physics layout (drag, zoom, pan)
- Type filtering, search, detail panel with connections
- Dark/Light theme toggle
- Share via web, email, or embed — no server needed

### Export Formats
- JSON (re-importable project file)
- HTML Publish (interactive D3.js page)
- Obsidian Vault (Markdown with [[wikilinks]])
- SVG (vector graphic, print quality)
- CSV (spreadsheet compatible)

### Configurable
- Customize categories: name (TR/EN), color, icon — up to 10
- Customize connection types: name (TR/EN), color, marker — up to 8
- Settings saved per-project in `.mentegraf` files

### Desktop Application
- Photoshop-style left toolbar with tooltips
- Slide-in edit panel (nodes and edges)
- Dark / Light theme
- Turkish / English interface (menus, UI, About page, published output)
- Undo/Redo (40 steps), auto-save (30 seconds)
- Search with auto-zoom, type filtering
- Multi-select (Ctrl+click) with bulk operations
- Offline capable (Cytoscape.js bundled)
- `.mentegraf` file association

---

## System Requirements

- Windows 10/11 (64-bit)
- ~150 MB disk space
- Zotero 7+ (optional, for import feature)

## Installation

Download `Mentegraf-Setup-2.0.0.exe` and run the installer.

For Zotero integration: Zotero → Preferences → Advanced → enable "Allow other applications on this computer to communicate with Zotero"

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Ctrl+D | Add node |
| Alt+Click | Create edge |
| Ctrl+Click | Multi-select |
| Delete | Delete selected |
| Ctrl+Z / Ctrl+Shift+Z | Undo / Redo |
| Ctrl+S | Save |
| Ctrl+N / Ctrl+O | New / Open |
| Escape | Deselect |
g't 
---

MIT License © 2026 Afif Say — [www.afifsay.org](https://www.afifsay.org)
