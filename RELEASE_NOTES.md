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

---

MIT License © 2026 Afif Say — [www.afifsay.org](https://www.afifsay.org)
