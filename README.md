# Mentegraf: Author's Visual Knowledge Graph Tool

Mentegraf is a desktop application for authors, researchers and thinkers who want to map their ideas visually. Create nodes for concepts, people, books, ideas, and chapters, then connect them with typed, weighted edges to reveal the hidden structure of your work.

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
├── package.json
└── README.md
```

## Features

### Graph Editor
- **10 node types** with Material Symbol SVG icons inside nodes
- **7 edge types** with colors, line styles, and mid-edge markers (▶ ✕ « ◉ ∥ ◇)
- **Edge weight 1-5** as line thickness + visual dots
- **Alt+click** to connect nodes (dashed gold line follows mouse)
- **+ button** next to selected node creates connected child
- **Slide-in panel** for editing name, type, description, notes, tags
- **Search** with auto-zoom, **type filtering**, **multi-select** (Ctrl+click)
- **Undo/Redo** up to 40 steps, **auto-save** every 30 seconds

### Themes & Language
- Dark / Light theme toggle
- TR / EN interface (all UI, Electron menus, About page, published HTML)
- New languages: add a JSON file to `lang/`

### Configurable
- Categories: name (TR/EN), color, icon — up to 10
- Connection types: name (TR/EN), color, marker symbol — up to 8
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
- Type filter toggles, search, zoom controls
- Click node → detail panel with connections
- Dark/Light theme, inherits editor language

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Ctrl+D | Add node |
| Alt+Click | Create edge |
| Ctrl+Click | Multi-select |
| Delete | Delete selected |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Ctrl+S | Save |
| Ctrl+N | New project |
| Ctrl+O | Open project |
| Escape | Deselect / close |

## File Format (v2.0)

`.mentegraf` files are JSON:
```json
{
  "version": "2.0",
  "app": "Mentegraf",
  "config": {
    "categories": [{"id":"person","tr":"Kişi","en":"Person","color":"#7b8cc4","svgPath":"..."}],
    "connectionTypes": [{"id":"influences","tr":"Etkiliyor","en":"Influences","color":"#6a9fd8","marker":"▶","style":"solid"}]
  },
  "elements": {
    "nodes": [{"data":{"id":"n1","label":"...","type":"person",...},"position":{"x":100,"y":200}}],
    "edges": [{"data":{"source":"n1","target":"n2","weight":4,"edgeType":"influences","note":"..."}}]
  }
}
```

## Roadmap

- [ ] Zotero integration (local API import)
- [ ] Lasso selection
- [ ] Groups / clusters (compound nodes)
- [ ] Minimap
- [ ] Presentation mode

## License

MIT © 2026 Afif Say — www.afifsay.org

## About Author
Information about the author along with his essays, information on his books are available at [www.afifsay.org](https://www.afifsay.org).
Open to managing and consulting projects related to knowledge and authorship, or senior management consulting.

