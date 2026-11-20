// projectStore.js — folder-based Mentegraf projects (format 3.x). Main process only.
//
//   <Project>/
//   ├── project.mentegraf        manifest: format, settings, node types, connection types
//   ├── graph/nodes/<id>.json    one file per node (content only)
//   ├── graph/edges.json         all edges, sorted by id
//   ├── graph/layout.json        node positions, kept apart so moving nodes
//   │                            does not rewrite node files
//   ├── manuscript/  notes/      reserved for Stage 2
//   └── .mentegraf/              local only: backups/, recovery.json
//
// In memory the renderer keeps using the single-object shape that
// projectFormat.js defines; this module only maps it to and from files.
'use strict'

const fs = require('fs')
const path = require('path')
const ProjectFormat = require('./projectFormat')

const MANIFEST = 'project.mentegraf'
const FORMAT = '3.0'
const MAX_BACKUPS = 20
const KEEP_RECENT = 3                       // the newest copies are always kept
const BACKUP_GAP_MS = 10 * 60 * 1000        // older copies are thinned to one per 10 minutes
const DIRS = ['graph', 'graph/nodes', 'manuscript', 'notes', 'assets', '.mentegraf', '.mentegraf/backups']

// ───────── helpers ─────────

function err(code, message) { const e = new Error(message); e.code = code; return e }
function stable(value) { return JSON.stringify(value, null, 2) + '\n' }
function round1(v) { return Math.round(v * 10) / 10 }
function byId(a, b) { a = String(a.id); b = String(b.id); return a < b ? -1 : a > b ? 1 : 0 }
function majorOf(v) { return parseInt(String(v).split('.')[0], 10) || 0 }

// Copies left behind by sync clients (Seafile, Nextcloud, Dropbox, OneDrive).
function isConflictName(name) {
  return /SFConflict|conflicted copy|\(conflict|-conflict-|\(Case Conflict/i.test(name)
}

// Node id -> safe file name (Windows-safe, reversible enough to be readable).
function safeName(id) {
  let s = String(id).replace(/[^A-Za-z0-9._-]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = '_' + s
  return s
}

function readOrNull(file) {
  try { return fs.readFileSync(file, 'utf8') } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

// Crash-safe write of one file: temp file, flush, rename over the target.
function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try {
    if (Buffer.isBuffer(text)) fs.writeSync(fd, text)          // images and other binary files
    else fs.writeSync(fd, text, null, 'utf8')
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  // Windows: antivirus or a sync client may hold the file briefly.
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return } catch (e) {
      if (i < 4 && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { sleepMs(100 * (i + 1)); continue }
      throw e
    }
  }
}

// ───────── manuscript (book structure) ─────────
//
// { title, items: [ { id, kind: 'part', title, children: [...] },
//                   { id, kind: 'node', node: <node id>, include: true, children: [...] } ] }
// Parts only at the top level; nodes nest at most three levels (part > chapter > section).
function normalizeManuscript(m, nodeIds) {
  const seen = new Set()
  const walk = (list, depth) => (Array.isArray(list) ? list : []).map(it => {
    if (!it || typeof it !== 'object') return null
    if (it.kind === 'part') {
      if (depth > 0) return null
      return { id: String(it.id || ''), kind: 'part', title: String(it.title || ''), children: walk(it.children, depth + 1) }
    }
    if (it.kind !== 'node' || it.node == null) return null
    const id = String(it.node)
    if (seen.has(id) || (nodeIds && !nodeIds[id])) return null
    seen.add(id)
    return { id, kind: 'node', node: id, include: it.include !== false, children: depth >= 2 ? [] : walk(it.children, depth + 1) }
  }).filter(Boolean)
  const src = m && typeof m === 'object' ? m : {}
  return { title: typeof src.title === 'string' ? src.title : '', items: walk(src.items, 0) }
}

// ───────── classification (category tree) ─────────
//
// { categories: [ { id, name, parent } ] }  parent null = top level; order = array order.
// Unknown parents and cycles are repaired by moving the item to the top level.
function normalizeClassification(c) {
  const list = (c && Array.isArray(c.categories) ? c.categories : [])
    .filter(x => x && x.id != null && typeof x.name === 'string')
    .map(x => ({ id: String(x.id), name: x.name, parent: x.parent != null && x.parent !== '' ? String(x.parent) : null }))
  const seenIds = new Set()
  const unique = list.filter(x => !seenIds.has(x.id) && seenIds.add(x.id))
  const byId = new Map(unique.map(x => [x.id, x]))
  unique.forEach(x => {
    if (x.parent && !byId.has(x.parent)) x.parent = null
    const seen = new Set()
    let p = x.parent
    while (p) { if (p === x.id || seen.has(p)) { x.parent = null; break } seen.add(p); p = byId.has(p) ? byId.get(p).parent : null }
  })
  return { categories: unique }
}

// Words in a text, as the editor counts them (metadata block excluded).
function countWords(text) {
  const body = String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  return (body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length
}

// ───────── pure mapping (no file system; unit-tested) ─────────

// In-memory project -> file texts.
function toFiles(project) {
  const p = ProjectFormat.migrate(project).data
  const cfg = p.config || {}
  const manifest = {
    format: FORMAT,
    app: 'Mentegraf',
    lang: p.lang || 'tr',
    settings: { nodeSizing: cfg.nodeSizing !== false },
    export: cfg.export && typeof cfg.export === 'object' ? cfg.export : {},
    nodeTypes: cfg.categories || [],
    connectionTypes: cfg.connectionTypes || []
  }
  const classification = normalizeClassification(p.classification)
  const catIds = new Set(classification.categories.map(c => c.id))
  const layout = {}
  const nodes = {}
  p.elements.nodes.map(n => n).sort((a, b) => byId(a.data, b.data)).forEach(n => {
    const d = Object.assign({}, n.data)
    const pos = n.position || (typeof d.x === 'number' && typeof d.y === 'number' ? { x: d.x, y: d.y } : null)
    if (pos) layout[d.id] = { x: round1(pos.x), y: round1(pos.y) }
    delete d.x; delete d.y
    delete d.color // derived from the node type on load
    if (Array.isArray(d.cats)) { d.cats = d.cats.map(String).filter(c => catIds.has(c)); if (!d.cats.length) delete d.cats } else delete d.cats
    nodes[d.id] = stable(d)
  })
  const edges = p.elements.edges.map(e => e.data).sort(byId)
  const ids = {}; Object.keys(nodes).forEach(id => { ids[id] = true })
  const manuscript = normalizeManuscript(p.manuscript, ids)
  return { manifest: stable(manifest), edges: stable(edges), layout: stable(layout), manuscript: stable(manuscript), categories: stable(classification), nodes }
}

// File texts -> { project, warnings }. nodeFiles: [{ name, text }].
function fromFiles({ manifestText, edgesText, layoutText, manuscriptText, categoriesText, nodeFiles }) {
  let m
  try { m = JSON.parse(manifestText) } catch (e) { throw err('not-a-project', 'The project file is not valid JSON.') }
  if (!m || typeof m !== 'object' || !m.format) throw err('not-a-project', 'This file is not a Mentegraf folder project.')
  if (majorOf(m.format) > ProjectFormat.SUPPORTED_MAJOR) {
    throw err('too-new', 'This project was saved by a newer version of Mentegraf (format ' + m.format + ').')
  }
  const warnings = []
  const types = Array.isArray(m.nodeTypes) ? m.nodeTypes : []
  const colorOf = t => { const c = types.find(x => x.id === t); return c && c.color ? c.color : '#888' }

  let layout = {}
  if (layoutText) {
    try { layout = JSON.parse(layoutText) || {} } catch (e) { warnings.push({ kind: 'unreadable', file: 'graph/layout.json' }) }
  }

  const seen = {}
  const nodes = []
  ;(nodeFiles || []).slice().sort((a, b) => (a.name < b.name ? -1 : 1)).forEach(f => {
    if (isConflictName(f.name)) { warnings.push({ kind: 'conflict', file: 'graph/nodes/' + f.name }); return }
    let d
    try { d = JSON.parse(f.text) } catch (e) { warnings.push({ kind: 'unreadable', file: 'graph/nodes/' + f.name }); return }
    if (!d || typeof d !== 'object' || d.id == null) { warnings.push({ kind: 'unreadable', file: 'graph/nodes/' + f.name }); return }
    if (seen[d.id]) { warnings.push({ kind: 'duplicate', file: 'graph/nodes/' + f.name }); return }
    seen[d.id] = true
    const data = Object.assign({}, d, { color: colorOf(d.type) })
    const pos = layout[d.id]
    const node = { data }
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      data.x = pos.x; data.y = pos.y
      node.position = { x: pos.x, y: pos.y }
    }
    nodes.push(node)
  })

  let edgeData = []
  if (edgesText) {
    try {
      const parsed = JSON.parse(edgesText)
      if (Array.isArray(parsed)) edgeData = parsed
      else warnings.push({ kind: 'unreadable', file: 'graph/edges.json' })
    } catch (e) { warnings.push({ kind: 'unreadable', file: 'graph/edges.json' }) }
  }

  const project = {
    version: ProjectFormat.CURRENT_VERSION,
    app: 'Mentegraf',
    lang: m.lang || 'tr',
    config: {
      categories: types,
      connectionTypes: Array.isArray(m.connectionTypes) ? m.connectionTypes : [],
      nodeSizing: !(m.settings && m.settings.nodeSizing === false),
      export: m.export && typeof m.export === 'object' ? m.export : {}
    },
    elements: { nodes, edges: edgeData.map(d => ({ data: d })) }
  }
  let manuscript = null
  if (manuscriptText) {
    try { manuscript = JSON.parse(manuscriptText) } catch (e) { warnings.push({ kind: 'unreadable', file: 'graph/manuscript.json' }) }
  }
  const ids = {}; nodes.forEach(n => { ids[n.data.id] = true })
  project.manuscript = normalizeManuscript(manuscript, ids)
  let classification = null
  if (categoriesText) {
    try { classification = JSON.parse(categoriesText) } catch (e) { warnings.push({ kind: 'unreadable', file: 'graph/categories.json' }) }
  }
  project.classification = normalizeClassification(classification)
  const migrated = ProjectFormat.migrate(project).data
  const dropped = project.elements.edges.length - migrated.elements.edges.length
  if (dropped > 0) warnings.push({ kind: 'dangling', count: dropped })
  return { project: migrated, warnings }
}

// ───────── file system ─────────

function manifestPath(dir) { return path.join(dir, MANIFEST) }
function isProjectDir(dir) { return fs.existsSync(manifestPath(dir)) }

// What kind of file did the user pick? 'folder' (a manifest) or 'legacy' (single-file project).
function classify(file) {
  let obj
  try { obj = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) {
    throw err('not-a-project', 'This file is not a Mentegraf project.')
  }
  if (obj && typeof obj === 'object' && obj.format && !obj.elements) return 'folder'
  if (obj && typeof obj === 'object' && obj.elements) return 'legacy'
  throw err('not-a-project', 'This file is not a Mentegraf project.')
}

function listJson(dir) {
  try { return fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.json')) } catch (e) {
    if (e.code === 'ENOENT') return []
    throw e
  }
}

function readProject(dir) {
  const manifestText = readOrNull(manifestPath(dir))
  if (manifestText == null) throw err('not-a-project', 'No ' + MANIFEST + ' in this folder.')
  const nodesDir = path.join(dir, 'graph', 'nodes')
  const nodeFiles = listJson(nodesDir).map(name => ({ name, text: fs.readFileSync(path.join(nodesDir, name), 'utf8') }))
  const res = fromFiles({
    manifestText,
    edgesText: readOrNull(path.join(dir, 'graph', 'edges.json')),
    layoutText: readOrNull(path.join(dir, 'graph', 'layout.json')),
    manuscriptText: readOrNull(path.join(dir, 'graph', 'manuscript.json')),
    categoriesText: readOrNull(path.join(dir, 'graph', 'categories.json')),
    nodeFiles
  })
  // Conflict copies of edges/layout/manifest.
  listJson(path.join(dir, 'graph')).filter(isConflictName)
    .forEach(n => res.warnings.push({ kind: 'conflict', file: 'graph/' + n }))
  try {
    fs.readdirSync(dir).filter(n => isConflictName(n) && /mentegraf/i.test(n))
      .forEach(n => res.warnings.push({ kind: 'conflict', file: n }))
  } catch (e) { /* ignore */ }
  return res
}

function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0')
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
}

// Which backup files to delete. names: sorted oldest first, each with a stamp YYYYMMDD-HHMMSS.
// With auto-save every minute, keeping simply the last N would cover only N minutes, so:
// keep the newest few, then at most one copy per gap, up to max in all.
function backupsToDrop(names, max) {
  const when = n => { const m = /(\d{8})-(\d{6})/.exec(n); if (!m) return 0; const d = m[1], t = m[2]
    return new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)).getTime() }
  const newestFirst = names.slice().reverse(), keep = new Set()
  let last = null
  newestFirst.forEach((n, i) => {
    if (keep.size >= max) return
    const t = when(n)
    if (i < KEEP_RECENT || last === null || last - t >= BACKUP_GAP_MS) { keep.add(n); last = t }
  })
  return names.filter(n => !keep.has(n))
}

// Snapshot the project as it is on disk now, as one importable JSON file.
function backup(dir) {
  try {
    const current = readProject(dir).project
    const bdir = path.join(dir, '.mentegraf', 'backups')
    fs.mkdirSync(bdir, { recursive: true })
    let name = 'backup-' + stamp() + '.json', i = 2
    while (fs.existsSync(path.join(bdir, name))) name = 'backup-' + stamp() + '-' + (i++) + '.json'
    atomicWrite(path.join(bdir, name), JSON.stringify(current, null, 2))
    const all = fs.readdirSync(bdir).filter(n => /^backup-.*\.json$/.test(n)).sort()
    backupsToDrop(all, MAX_BACKUPS).forEach(n => fs.unlinkSync(path.join(bdir, n)))
  } catch (e) {
    console.warn('Backup skipped:', e.message)
  }
}

// Write the project, touching only files whose content changed.
// Returns { written, deleted }.
function writeProject(dir, project) {
  DIRS.forEach(d => fs.mkdirSync(path.join(dir, d), { recursive: true }))
  const f = toFiles(project)
  const want = {}
  Object.keys(f.nodes).forEach(id => { want['graph/nodes/' + safeName(id) + '.json'] = f.nodes[id] })
  want['graph/edges.json'] = f.edges
  want['graph/layout.json'] = f.layout
  want['graph/manuscript.json'] = f.manuscript
  want['graph/categories.json'] = f.categories
  want[MANIFEST] = f.manifest

  const changed = Object.keys(want).filter(rel => readOrNull(path.join(dir, rel)) !== want[rel])

  // Node files that no longer belong to the project. Conflict copies and
  // anything that does not look like a node file are left alone.
  const nodesDir = path.join(dir, 'graph', 'nodes')
  const stale = listJson(nodesDir).filter(name => {
    if (want['graph/nodes/' + name] !== undefined || isConflictName(name)) return false
    try { const d = JSON.parse(fs.readFileSync(path.join(nodesDir, name), 'utf8')); return d && d.id != null } catch (e) { return false }
  })

  if (!changed.length && !stale.length) return { written: 0, deleted: 0 }
  if (isProjectDir(dir)) backup(dir)

  // Content first, manifest last: a manifest on disk means the save completed.
  changed.sort((a, b) => (a === MANIFEST) - (b === MANIFEST))
    .forEach(rel => atomicWrite(path.join(dir, rel), want[rel]))
  stale.forEach(name => fs.unlinkSync(path.join(nodesDir, name)))
  return { written: changed.length, deleted: stale.length }
}

// Old single-file project -> new folder next to it. The original is not touched.
function convertLegacy(file) {
  const data = ProjectFormat.migrate(JSON.parse(fs.readFileSync(file, 'utf8'))).data
  const base = path.join(path.dirname(file), path.basename(file).replace(/\.(mentegraf|json)$/i, ''))
  let dir = base, i = 2
  while (fs.existsSync(dir)) dir = base + ' (' + (i++) + ')'
  writeProject(dir, data)
  return dir
}

// Is this folder usable as the target of "Save As"? Returns null or an error code.
function checkNewProjectDir(dir) {
  if (!fs.existsSync(dir)) return null
  if (!fs.statSync(dir).isDirectory()) return 'not-a-folder'
  if (fs.readdirSync(dir).length) return 'not-empty'
  return null
}

// ───────── text fragments (Markdown files attached to nodes) ─────────

const TEXT_DIRS = ['manuscript', 'notes']
const MAX_TEXT_VERSIONS = 10
const TR_MAP = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'İ': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'Ç': 'c', 'Ğ': 'g', 'Ö': 'o', 'Ş': 's', 'Ü': 'u' }

function slugify(label) {
  const s = String(label || '')
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, c => TR_MAP[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40).replace(/-+$/, '')
  return s || 'metin'
}

// Validate a project-relative text path and return its absolute path.
function fragmentAbs(dir, rel) {
  if (typeof rel !== 'string' || !/^(manuscript|notes)\/[^\\:*?"<>|]+\.md$/i.test(rel) || rel.split('/').includes('..')) {
    throw err('bad-path', 'Invalid text path: ' + rel)
  }
  const abs = path.resolve(dir, rel)
  if (!abs.startsWith(path.resolve(dir) + path.sep)) throw err('bad-path', 'Invalid text path: ' + rel)
  return abs
}

// A new, unused path for a node's text: manuscript/ for chapters, notes/ otherwise.
function newFragmentPath(dir, label, type, nodeId, taken) {
  const folder = type === 'chapter' ? 'manuscript' : 'notes'
  const tail = String(nodeId || '').replace(/[^A-Za-z0-9]/g, '').slice(-4).toLowerCase()
  const base = folder + '/' + slugify(label) + (tail ? '-' + tail : '')
  const used = new Set((taken || []).map(p => String(p).toLowerCase()))
  let rel = base + '.md', i = 2
  while (used.has(rel.toLowerCase()) || fs.existsSync(path.join(dir, rel))) rel = base + '-' + (i++) + '.md'
  return rel
}

function readFragment(dir, rel) {
  const text = readOrNull(fragmentAbs(dir, rel))
  return text == null ? { exists: false } : { exists: true, text }
}

// Keep the last few versions of a text before it is overwritten.
function backupText(dir, rel, oldText) {
  try {
    const bdir = path.join(dir, '.mentegraf', 'backups', 'text')
    fs.mkdirSync(bdir, { recursive: true })
    const flat = rel.replace(/\//g, '__').replace(/\.md$/i, '')
    atomicWrite(path.join(bdir, flat + '--' + stamp() + '.md'), oldText)
    const mine = fs.readdirSync(bdir).filter(n => n.startsWith(flat + '--')).sort()
    backupsToDrop(mine, MAX_TEXT_VERSIONS).forEach(n => fs.unlinkSync(path.join(bdir, n)))
  } catch (e) {
    console.warn('Text backup skipped:', e.message)
  }
}

// Write texts [{ path, text }]. Unchanged files are skipped. Returns the paths written.
function writeFragments(dir, list) {
  const written = []
  ;(list || []).forEach(f => {
    const abs = fragmentAbs(dir, f.path)
    const old = readOrNull(abs)
    if (old === f.text) return
    if (old != null) backupText(dir, f.path, old)
    atomicWrite(abs, f.text)
    written.push(f.path)
  })
  return written
}

// Word counts of texts on disk: { path: words } (missing or invalid paths are left out).
function fragmentStats(dir, paths) {
  const out = {}
  ;(paths || []).forEach(rel => {
    try { const r = readFragment(dir, rel); if (r.exists) out[rel] = countWords(r.text) } catch (e) { /* skip */ }
  })
  return out
}

// ───────── search in texts ─────────
//
// Case- and accent-tolerant: "dusunme" finds "Düşünme"; ı/i/I/İ are the same letter.
// Folding works letter by letter, so positions in the folded text are positions in the original.
const FOLD = { 'ı': 'i', 'İ': 'i', 'I': 'i', 'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u', '’': "'", '‘': "'" }
function foldChar(ch) {
  if (FOLD[ch]) return FOLD[ch]
  const l = ch.toLowerCase()
  if (l.length !== 1) return ch
  const n = l.normalize('NFD')
  return n.length > 1 && /[̀-ͯ]/.test(n.slice(1)) ? n[0] : l
}
function foldText(s) { let out = ''; for (let i = 0; i < s.length; i++) out += foldChar(s[i]); return out }

// All .md files under manuscript/ and notes/, as project-relative paths.
function listTexts(dir) {
  const out = []
  const walk = (abs, rel, depth) => {
    let entries = []
    try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch (e) { return }
    entries.forEach(e => {
      if (e.name.startsWith('.')) return
      if (e.isDirectory() && depth < 6) walk(path.join(abs, e.name), rel + '/' + e.name, depth + 1)
      else if (e.isFile() && /\.md$/i.test(e.name) && !isConflictName(e.name)) out.push(rel + '/' + e.name)
    })
  }
  if (dir) TEXT_DIRS.forEach(d => walk(path.join(dir, d), d, 0))
  return out.sort()
}

// query: words to find (as a phrase). opts: { overrides: { path: text } (unsaved editor texts),
// only: [paths] (limit to these), limit: total hits }. Returns { files: [{ path, count, hits }], total, truncated }.
// A hit: { line (1-based), col, len, before, match, after } — a short window of the line around the match.
// How often each term occurs in each text: case- and accent-folded, counted only where the
// term starts a word. terms: [string]; opts.only: paths to look in; opts.overrides: { path: text }.
// Returns { counts: { term: { path: n } } } (paths with no occurrence are left out).
function mentionCounts(dir, terms, opts) {
  opts = opts || {}
  const overrides = opts.overrides && typeof opts.overrides === 'object' ? opts.overrides : {}
  let paths = listTexts(dir)
  Object.keys(overrides).forEach(p => { if (paths.indexOf(p) < 0) paths.push(p) })
  if (Array.isArray(opts.only)) { const set = new Set(opts.only); paths = paths.filter(p => set.has(p)) }
  const wanted = []
  ;(terms || []).forEach(t => {
    const q = foldText(String(t || '').replace(/\s+/g, ' ').trim())
    if (q.length >= 2) wanted.push({ term: String(t), q })
  })
  const counts = {}
  const letter = /[\p{L}\p{N}]/u
  paths.forEach(rel => {
    let text = typeof overrides[rel] === 'string' ? overrides[rel] : null
    if (text == null && dir) { try { const r = readFragment(dir, rel); text = r.exists ? r.text : null } catch (e) { text = null } }
    if (text == null) return
    text = text.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '')
    const f = foldText(text)
    wanted.forEach(w => {
      let at = f.indexOf(w.q), n = 0
      while (at >= 0) {
        if (at === 0 || !letter.test(f[at - 1])) n++
        at = f.indexOf(w.q, at + w.q.length)
      }
      if (n) (counts[w.term] = counts[w.term] || {})[rel] = n
    })
  })
  return { counts }
}

function searchTexts(dir, query, opts) {
  opts = opts || {}
  const q = foldText(String(query || '').replace(/\s+/g, ' ').trim())
  if (q.length < 2) return { files: [], total: 0, truncated: false }
  const overrides = opts.overrides && typeof opts.overrides === 'object' ? opts.overrides : {}
  let paths = listTexts(dir)
  Object.keys(overrides).forEach(p => { if (paths.indexOf(p) < 0) paths.push(p) })
  if (Array.isArray(opts.only)) { const set = new Set(opts.only); paths = paths.filter(p => set.has(p)) }
  const limit = opts.limit || 300
  const files = []
  let total = 0, truncated = false
  paths.forEach(rel => {
    let text = typeof overrides[rel] === 'string' ? overrides[rel] : null
    if (text == null && dir) { try { const r = readFragment(dir, rel); text = r.exists ? r.text : null } catch (e) { text = null } }
    if (text == null) return
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    let start = 0                                            // skip the metadata block
    if (lines[0] === '---') { const end = lines.indexOf('---', 1); if (end > 0) start = end + 1 }
    const hits = []
    let count = 0
    for (let i = start; i < lines.length; i++) {
      const line = lines[i], f = foldText(line)
      let at = f.indexOf(q)
      while (at >= 0) {
        count++
        if (total < limit) {
          total++
          const from = Math.max(0, at - 50), to = Math.min(line.length, at + q.length + 70)
          hits.push({ line: i + 1, col: at, len: q.length, before: (from > 0 ? '…' : '') + line.slice(from, at), match: line.slice(at, at + q.length), after: line.slice(at + q.length, to) + (to < line.length ? '…' : '') })
        } else truncated = true
        at = f.indexOf(q, at + q.length)
      }
    }
    if (count) files.push({ path: rel, count, hits })
  })
  files.sort((a, b) => b.count - a.count || (a.path < b.path ? -1 : 1))
  return { files, total: files.reduce((s, f) => s + f.count, 0), truncated }
}

// ───────── consistency checks over the texts (audit) ─────────

// The texts to check, metadata block removed: [{ rel, lines, start }] (start: first body line, 0-based).
function bodyTexts(dir, opts) {
  opts = opts || {}
  const overrides = opts.overrides && typeof opts.overrides === 'object' ? opts.overrides : {}
  let paths = listTexts(dir)
  Object.keys(overrides).forEach(p => { if (paths.indexOf(p) < 0) paths.push(p) })
  if (Array.isArray(opts.only)) { const set = new Set(opts.only); paths = paths.filter(p => set.has(p)) }
  const out = []
  paths.forEach(rel => {
    let text = typeof overrides[rel] === 'string' ? overrides[rel] : null
    if (text == null && dir) { try { const r = readFragment(dir, rel); text = r.exists ? r.text : null } catch (e) { text = null } }
    if (text == null) return
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    let start = 0
    if (lines[0] === '---') { const end = lines.indexOf('---', 1); if (end > 0) start = end + 1 }
    out.push({ rel, lines, start })
  })
  return out
}

// Markup that is not prose (footnote and citation keys, attributes, link targets, passage IDs,
// URLs), blanked with spaces so columns still match the line.
function blankMarkup(line) {
  const blank = s => ' '.repeat(s.length)
  return line
    .replace(/\[\^[^\]\s]*\]|\[@[^\]]*\]|\{[^}\n]*\}|\]\([^)\s]*\)|<[^>\s]*>|https?:\/\/\S+|\s\^[a-z0-9]{4,12}\s*$/g, blank)
}
// Lines that are not running prose: headings, footnote texts, images, tables, rules.
function proseLine(line) { return !!line.trim() && !/^\s*(#|\[\^[^\]]*\]:|!\[|\||-{3,}|\*{3,})/.test(line) }

// Remember the last answer of a check while its texts are unchanged (the work queue asks often).
const checkCache = new Map()
function cached(name, dir, opts, fn) {
  const o = opts || {}, overrides = o.overrides && typeof o.overrides === 'object' ? o.overrides : {}
  let paths = listTexts(dir)
  Object.keys(overrides).forEach(p => { if (paths.indexOf(p) < 0) paths.push(p) })
  if (Array.isArray(o.only)) { const set = new Set(o.only); paths = paths.filter(p => set.has(p)) }
  const sig = [name, dir || '', o.min == null ? '' : o.min].concat(paths.map(rel => {
    if (typeof overrides[rel] === 'string') { const s = overrides[rel]; let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return rel + '=' + s.length + ':' + h }
    try { const st = fs.statSync(fragmentAbs(dir, rel)); return rel + '@' + st.mtimeMs + ':' + st.size } catch (e) { return rel + '!' }
  })).join('\n')
  const hit = checkCache.get(name)
  if (hit && hit.sig === sig) return hit.value
  const value = fn()
  checkCache.set(name, { sig, value })
  return value
}

// Words written in more than one way across the texts:
//  - spacing and hyphen: "geri bildirim" / "geribildirim" / "geri-bildirim"
//  - circumflex: "hâlâ" / "hala", "resmî" / "resmi"
// Returns { groups: [{ key, kind, forms: [{ form, n }] (most used first), hits: [{ path, line, col, len, form }] }] }.
// hits lists where the less used forms are (up to 100), so they can be visited one by one.
function spellingVariants(dir, opts) { return cached('spelling', dir, opts, () => spellingVariantsNow(dir, opts)) }
function spellingVariantsNow(dir, opts) {
  const texts = bodyTexts(dir, opts)
  const lower = s => s.toLocaleLowerCase('tr')
  const single = new Map(), pairs = new Map(), hyph = new Map()
  const add = (m, k, h) => { let e = m.get(k); if (!e) m.set(k, e = { n: 0, hits: [] }); e.n++; if (e.hits.length < 100) e.hits.push(h) }
  const W = /[\p{L}\p{N}]+(?:[-‐][\p{L}\p{N}]+)*/gu
  texts.forEach(t => {
    for (let i = t.start; i < t.lines.length; i++) {
      if (!proseLine(t.lines[i])) continue
      const line = blankMarkup(t.lines[i])
      let m, prev = null
      W.lastIndex = 0
      while ((m = W.exec(line))) {
        const w = lower(m[0]).replace(/‐/g, '-'), h = { path: t.rel, line: i + 1, col: m.index, len: m[0].length }
        if (w.indexOf('-') >= 0) add(hyph, w, h); else add(single, w, h)
        if (prev && line.slice(prev.end, m.index) === ' ' && w.indexOf('-') < 0 && prev.w.indexOf('-') < 0) add(pairs, prev.w + ' ' + w, { path: t.rel, line: i + 1, col: prev.col, len: m.index + m[0].length - prev.col })
        prev = { w, end: m.index + m[0].length, col: m.index }
      }
    }
  })
  const ok = (a, b) => a.length >= 3 && b.length >= 3 && !/\d/.test(a + b)
  const groups = new Map()
  const put = (key, kind, form, e) => {
    let g = groups.get(key); if (!g) groups.set(key, g = { key, kind, forms: new Map() })
    let f = g.forms.get(form); if (!f) g.forms.set(form, f = { n: 0, hits: [] })
    f.n += e.n; e.hits.forEach(h => { if (f.hits.length < 100) f.hits.push(Object.assign({ form }, h)) })
  }
  // root of a split word: first part + a few letters of the second, so inflected forms group together
  const rootOf = (a, b) => 'sp:' + a + '|' + (a + b).slice(0, a.length + 4)
  const spacedForm = (a, b) => ({ spaced: a + ' ' + b, joined: a + b, hyphen: a + '-' + b })
  const seen = new Set()
  pairs.forEach((e, k) => {
    const [a, b] = k.split(' ')
    if (!ok(a, b) || (!single.has(a + b) && !hyph.has(a + '-' + b))) return
    const key = rootOf(a, b), f = spacedForm(a, b)
    put(key, 'spacing', f.spaced, e); seen.add(key + '\n' + f.spaced)
  })
  groups.forEach(g => {
    const [a, pre] = g.key.slice(3).split('|')
    single.forEach((e, w) => { if (w.startsWith(pre) && w.length > a.length + 2) put(g.key, 'spacing', w, e) })
    hyph.forEach((e, w) => { const parts = w.split('-'); if (parts.length === 2 && parts[0] === a && (parts[0] + parts[1]).startsWith(pre)) put(g.key, 'spacing', w, e) })
  })
  hyph.forEach((e, w) => {
    const parts = w.split('-'); if (parts.length !== 2) return
    const [a, b] = parts; if (!ok(a, b)) return
    const key = rootOf(a, b); if (groups.has(key)) return
    const j = single.get(a + b), s = pairs.get(a + ' ' + b)
    if (!j && !s) return
    put(key, 'spacing', w, e); if (j) put(key, 'spacing', a + b, j); if (s) put(key, 'spacing', a + ' ' + b, s)
  })
  // circumflex: key on the plain spelling up to just after the marked vowel
  single.forEach((e, w) => {
    const at = w.search(/[âîû]/); if (at < 0) return
    const plain = w.replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    const pe = single.get(plain); if (!pe) return
    const key = 'cf:' + plain.slice(0, Math.max(at + 2, 4))
    put(key, 'circumflex', w, e); put(key, 'circumflex', plain, pe)
  })
  const out = []
  groups.forEach(g => {
    // spellings grouped by style (joined / spaced / hyphenated, or with / without circumflex);
    // each style is shown by its most used form
    const styleOf = form => g.kind === 'circumflex' ? (/[âîû]/.test(form) ? 'mark' : 'plain') : form.indexOf(' ') >= 0 ? 'spaced' : form.indexOf('-') >= 0 ? 'hyphen' : 'joined'
    const styles = new Map()
    g.forms.forEach((f, form) => {
      const s = styleOf(form); let st = styles.get(s); if (!st) styles.set(s, st = { style: s, n: 0, form, top: 0, hits: [] })
      st.n += f.n; if (f.n > st.top) { st.top = f.n; st.form = form }
      f.hits.forEach(h => { if (st.hits.length < 100) st.hits.push(h) })
    })
    const forms = Array.from(styles.values()).sort((x, y) => y.n - x.n || (x.form < y.form ? -1 : 1))
    if (forms.length < 2) return
    // the most used style counts as the house style; the places of the others are listed
    const hits = []
    forms.slice(1).forEach(f => f.hits.forEach(h => { if (hits.length < 100) hits.push(h) }))
    hits.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : x.line - y.line || x.col - y.col))
    out.push({ key: g.key, kind: g.kind, forms: forms.map(f => ({ form: f.form, n: f.n, style: f.style })), hits })
  })
  out.sort((x, y) => y.forms.reduce((s, f) => s + f.n, 0) - x.forms.reduce((s, f) => s + f.n, 0))
  return { groups: out }
}

// Paragraphs in different texts that say much the same thing (a concept explained again,
// an example told twice). Each paragraph becomes a weighted bag of word stems (rare words
// weigh more); pairs whose cosine similarity reaches opts.min (default 0.3) are joined into
// clusters. Returns { clusters: [{ key, score, paras: [{ path, line, text }] }] }, strongest first.
const STOP_WORDS = new Set(('ve ile bir bu da de ki icin gibi daha cok olan olarak ama ancak en her ne su ya veya hem kadar sonra once ise yani gore bunu bunun buna bunlar ' +
  'sey diye oldu olur olmasi olmak degil var yok kendi diger ayni boyle sekilde nasil neden cunku ayrica tum butun bazi baska icinde uzerinde arasinda ilgili zaman fakat ' +
  'oysa hatta bile the and of to in is that for it as with are this by on be or from an which').split(' '))
function similarParagraphs(dir, opts) { return cached('repeats', dir, opts, () => similarParagraphsNow(dir, opts)) }
function similarParagraphsNow(dir, opts) {
  opts = opts || {}
  const min = typeof opts.min === 'number' ? opts.min : 0.3
  const P = []
  bodyTexts(dir, opts).forEach(t => {
    for (let i = t.start; i < t.lines.length; i++) {
      const line = t.lines[i]
      if (!proseLine(line) || /^\s*[-*+]\s|^\s*\d+\.\s/.test(line)) continue
      if (/^\s*\p{Lu}[\p{L}'’ -]{1,40},\s+\p{Lu}/u.test(line) && /\*[^*]+\*/.test(line)) continue      // a bibliography entry
      const words = (foldText(blankMarkup(line)).match(/\p{L}{3,}/gu) || []).filter(w => !STOP_WORDS.has(w)).map(w => w.slice(0, 5))
      if (words.length < 12) continue
      P.push({ path: t.rel, line: i + 1, words, text: line.replace(/\s\^[a-z0-9]{4,12}\s*$/, '').trim() })
    }
  })
  const N = P.length, df = new Map()
  P.forEach(p => new Set(p.words).forEach(w => df.set(w, (df.get(w) || 0) + 1)))
  P.forEach(p => {
    const tf = new Map(); p.words.forEach(w => tf.set(w, (tf.get(w) || 0) + 1))
    p.vec = new Map(); let norm = 0
    tf.forEach((c, w) => { const d = df.get(w); if (d > N * 0.05 || d < 2) return; const v = (1 + Math.log(c)) * Math.log(N / d); p.vec.set(w, v); norm += v * v })
    p.norm = Math.sqrt(norm) || 1
  })
  const parent = P.map((p, i) => i)
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i }
  const best = new Map()
  for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
    const A = P[a], B = P[b]
    if (A.path === B.path) continue
    const [s, l] = A.vec.size < B.vec.size ? [A, B] : [B, A]
    let dot = 0; s.vec.forEach((v, w) => { const u = l.vec.get(w); if (u) dot += v * u })
    const c = dot / (A.norm * B.norm)
    if (c < min) continue
    parent[find(a)] = find(b)
    best.set(a, Math.max(best.get(a) || 0, c)); best.set(b, Math.max(best.get(b) || 0, c))
  }
  const byRoot = new Map()
  best.forEach((c, i) => { const r = find(i); let g = byRoot.get(r); if (!g) byRoot.set(r, g = { score: 0, idx: [] }); g.idx.push(i); g.score = Math.max(g.score, c) })
  const clusters = []
  byRoot.forEach(g => {
    const paras = g.idx.map(i => P[i]).sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : x.line - y.line))
    // a key that survives small edits: the start of each paragraph, folded
    const key = 'rp:' + paras.map(p => foldText(p.text).replace(/[^\p{L}]+/gu, '').slice(0, 24)).sort().join('|')
    clusters.push({ key, score: Math.round(g.score * 100) / 100, paras: paras.map(p => ({ path: p.path, line: p.line, text: p.text.slice(0, 200) })) })
  })
  clusters.sort((x, y) => y.score - x.score)
  return { clusters }
}

// ───────── assets (images and CSV tables for figure and table nodes) ─────────

const ASSET_TYPES = { png: 'figure', jpg: 'figure', jpeg: 'figure', gif: 'figure', webp: 'figure', svg: 'figure', csv: 'table' }
const MAX_ASSET_BYTES = 50 * 1024 * 1024

function assetKind(name) { return ASSET_TYPES[String(path.extname(name || '')).slice(1).toLowerCase()] || null }

// Copy a file (or write bytes) into <project>/assets under a new, unused name.
// src: { file } or { data, name }. Returns { rel, kind, name } — name without extension, for the caption.
function importAsset(dir, src) {
  const original = src.file ? path.basename(src.file) : String(src.name || 'gorsel.png')
  const ext = path.extname(original).slice(1).toLowerCase()
  const kind = ASSET_TYPES[ext]
  if (!kind) throw err('bad-type', 'Only images (PNG, JPG, GIF, WebP, SVG) and CSV tables can be added.')
  const data = src.file ? fs.readFileSync(src.file) : Buffer.from(src.data)
  if (!data.length) throw err('empty', 'The file is empty.')
  if (data.length > MAX_ASSET_BYTES) throw err('too-big', 'The file is larger than 50 MB.')
  const name = original.slice(0, original.length - ext.length - 1)
  const base = 'assets/' + slugify(name)
  let rel = base + '.' + ext, i = 2
  while (fs.existsSync(path.join(dir, rel))) rel = base + '-' + (i++) + '.' + ext
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  atomicWrite(path.join(dir, rel), data)
  return { rel, kind, name }
}

// Save As: bring the texts and assets along to the new project folder.
function copyTextFolders(fromDir, toDir) {
  TEXT_DIRS.concat(['assets']).forEach(d => {
    const src = path.join(fromDir, d)
    if (fs.existsSync(src)) fs.cpSync(src, path.join(toDir, d), { recursive: true, force: false, errorOnExist: false })
  })
}

module.exports = {
  MANIFEST, FORMAT,
  toFiles, fromFiles, safeName, isConflictName,
  atomicWrite, classify, isProjectDir, readProject, writeProject, convertLegacy, checkNewProjectDir,
  TEXT_DIRS, slugify, fragmentAbs, newFragmentPath, readFragment, writeFragments, copyTextFolders,
  normalizeManuscript, normalizeClassification, countWords, fragmentStats, foldText, listTexts, searchTexts, mentionCounts, spellingVariants, similarParagraphs, assetKind, importAsset,
  backupsToDrop
}
