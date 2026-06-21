# Mentegraf: Author's Visual Knowledge Graph Tool

<p align="center">
  <a href="https://afifsay.org/" target="_blank">
    <img src="assets/icon.png" alt="https://www.afifsay.org/" width="100"><br/>
  </a>
    A desktop application for authors, researchers and thinkers who want to map their ideas visually. Create nodes for concepts, people, books, ideas, and chapters, then connect them with typed, weighted edges to reveal the hidden structure of your work.
</p>

Built with Electron + Cytoscape.js. Publishes interactive D3.js web pages.

![Screenshot Mentegraf3.webp](assets/Screenshot%20Mentegraf3.webp)
## Quick Start

```bash
npm install
npm start
```

## Build Distributable

```bash
# Windows installer + portable
npm run build:win

# macOS dmg
npm run build:mac

# Linux AppImage + deb
npm run build:linux
```

Output goes to `dist/` folder.

## Project Structure

```
mentegraf/
├── src/
│   ├── index.html           ← HTML layout
│   ├── style.css            ← CSS (dark/light themes)
│   ├── app.js               ← Application logic
│   ├── publish.js           ← D3.js publish template
│   ├── zotero.js            ← Zotero integration
│   ├── about.html           ← Help & about (12 tips, 8 shortcuts)
│   ├── lib/
│   │   └── cytoscape.min.js ← Bundled (offline capable)
│   ├── lang/
│   │   ├── tr.json          ← Türkçe
│   │   └── en.json          ← English
│   ├── config/
│   │   ├── categories.json  ← 10 node types + SVG paths
│   │   └── connections.json ← 7 edge types + colors/markers
│   ├── main.js              ← Electron main process
│   └── preload.js           ← Electron context bridge
├── assets/                  ← App icons (ico/icns/png)
├── .github/workflows/
│   └── build.yml            ← CI/CD: auto-build on tag push
├── package.json
├── LICENSE
└── README.md

```

## Features

### Graph Editor
- **10 node types** with Material Symbol SVG icons inside nodes: Person, Concept, Book, Idea, Term, Document, Chapter, Event, Location, Institution
- **7 edge types** with distinct colors, line styles, and mid-edge markers: General, Influences (▶), Contradicts (✕), Builds On («), Contains (◉), Parallel (∥), Discusses (◇)
- **Edge weight 1-5** reflected as line thickness and visual dots
- **Add nodes**: toolbar button (free) or + button next to selected node (connected)
- **Connect nodes**: Alt+click source, then target. Dashed gold line follows mouse.
- **Slide-in panel**: click node/edge → edit name, type, description, notes, tags
- **Live name update**: type in name field, label updates instantly on graph
- **Search**: top bar, highlights matches, auto-zooms to single result
- **Type filtering**: toggle category buttons to show/hide node types
- **Multi-select**: Ctrl+click multiple nodes, bulk delete from bottom bar
- **Undo/Redo**: Ctrl+Z / Ctrl+Shift+Z, up to 40 steps
- **Auto-save**: every 30 seconds to localStorage

### Zotero Integration
- Import books, articles, and references directly from your Zotero library
- Browse collections or search within Zotero
- Zotero items become graph nodes (books → Book, articles → Document)
- Authors automatically become Person nodes with connections
- Metadata preserved: abstract, publication, date, DOI, URL, tags
- Click "Open in Zotero" on any imported node to jump back to the source
- **Requires**: Zotero running + Preferences → Advanced → "Allow other applications on this computer to communicate with Zotero"

### Themes & Language
- Dark / Light theme toggle
- TR / EN interface (all UI, Electron menus, About page, published HTML)
- New languages: add a JSON file to `lang/`

### Configurable
- **Categories**: Settings (⚙) → edit name (TR/EN), color — up to 10
- **Connection types**: Settings → edit name (TR/EN), color, marker symbol — up to 8
- Config saved per-project in `.mentegraf` files

### Export (5 formats)

| Format | Description |
|---|---|
| **JSON** | Full project, re-importable |
| **HTML Publish** | Standalone D3.js force-directed interactive page |
| **Obsidian** | Markdown with `[[wikilinks]]` + YAML frontmatter |
| **SVG** | Vector graphic for print |
| **CSV** | Node + edge tables |

### Published HTML
- D3-force physics (drag, repel, attract)
- Node icons, edge colors + markers
- Type filter toggles, search, zoom controls (+/−/fit)
- Click node → detail panel with description and connection list
- Dark/Light theme toggle
- Language inherits from editor at publish time

### Electron Desktop
- Native file open/save dialogs (`.mentegraf` file association)
- i18n menus (Dosya/File, Düzenle/Edit, Görünüm/View)
- About window with 12 usage tips + 8 keyboard shortcuts
- Offline capable (Cytoscape.js bundled locally)
- GitHub Actions CI/CD: tag push → auto-build → auto-release

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Ctrl+D` | Add node |
| `Alt+Click` | Create edge between nodes |
| `Ctrl+Click` | Multi-select nodes |
| `Delete` | Delete selected |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+S` | Save |
| `Ctrl+N` | New project |
| `Ctrl+O` | Open project |
| `Escape` | Deselect / close panel |

## File Format (v2.0)

`.mentegraf` files are JSON:
```json
{
  "version": "2.0",
  "app": "Mentegraf",
  "config": {
    "categories": [
      {"id": "person", "tr": "Kişi", "en": "Person", "color": "#7b8cc4", "svgPath": "M12 2..."}
    ],
    "connectionTypes": [
      {"id": "influences", "tr": "Etkiliyor", "en": "Influences", "color": "#6a9fd8", "marker": "▶", "style": "solid"}
    ]
  },
  "elements": {
    "nodes": [{"data": {"id": "n1", "label": "...", "type": "person", "zoteroKey": "ABC123"}, "position": {"x": 100, "y": 200}}],
    "edges": [{"data": {"source": "n1", "target": "n2", "weight": 4, "edgeType": "influences", "note": "..."}}]
  }
}
```

## Adding a New Language

1. Copy `src/lang/en.json` → `src/lang/XX.json`
2. Translate all values (including `about.*` section)
3. In `app.js` → `loadLangs()`: add `fetch('lang/XX.json')`
4. In `app.js` → `toggleLang()`: add the new language to the cycle
5. In `main.js` → `MENU_LABELS`: add the new language block

## Roadmap

- [x] Zotero integration
- [ ] Lasso selection
- [x] Category Reports
- [ ] Groups / clusters (compound nodes)
- [ ] Minimap
- [ ] Presentation mode
- [ ] Node image attachments

## License

MIT © 2026 Afif Say — www.afifsay.org

## About Author
Information about the author along with his essays, information on his books are available at [www.afifsay.org](https://www.afifsay.org).
Open to managing and consulting projects related to knowledge and authorship, or senior management consulting.

