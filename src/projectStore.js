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
const MAX_BACKUPS = 10
const DIRS = ['graph', 'graph/nodes', 'manuscript', 'notes', '.mentegraf', '.mentegraf/backups']

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
  try { fs.writeSync(fd, text, null, 'utf8'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  // Windows: antivirus or a sync client may hold the file briefly.
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return } catch (e) {
      if (i < 4 && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { sleepMs(100 * (i + 1)); continue }
      throw e
    }
  }
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
    nodeTypes: cfg.categories || [],
    connectionTypes: cfg.connectionTypes || []
  }
  const layout = {}
  const nodes = {}
  p.elements.nodes.map(n => n).sort((a, b) => byId(a.data, b.data)).forEach(n => {
    const d = Object.assign({}, n.data)
    const pos = n.position || (typeof d.x === 'number' && typeof d.y === 'number' ? { x: d.x, y: d.y } : null)
    if (pos) layout[d.id] = { x: round1(pos.x), y: round1(pos.y) }
    delete d.x; delete d.y
    delete d.color // derived from the node type on load
    nodes[d.id] = stable(d)
  })
  const edges = p.elements.edges.map(e => e.data).sort(byId)
  return { manifest: stable(manifest), edges: stable(edges), layout: stable(layout), nodes }
}

// File texts -> { project, warnings }. nodeFiles: [{ name, text }].
function fromFiles({ manifestText, edgesText, layoutText, nodeFiles }) {
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
      nodeSizing: !(m.settings && m.settings.nodeSizing === false)
    },
    elements: { nodes, edges: edgeData.map(d => ({ data: d })) }
  }
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
    all.slice(0, Math.max(0, all.length - MAX_BACKUPS)).forEach(n => fs.unlinkSync(path.join(bdir, n)))
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
const MAX_TEXT_VERSIONS = 5
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
    mine.slice(0, Math.max(0, mine.length - MAX_TEXT_VERSIONS)).forEach(n => fs.unlinkSync(path.join(bdir, n)))
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

// Save As: bring the texts along to the new project folder.
function copyTextFolders(fromDir, toDir) {
  TEXT_DIRS.forEach(d => {
    const src = path.join(fromDir, d)
    if (fs.existsSync(src)) fs.cpSync(src, path.join(toDir, d), { recursive: true, force: false, errorOnExist: false })
  })
}

module.exports = {
  MANIFEST, FORMAT,
  toFiles, fromFiles, safeName, isConflictName,
  atomicWrite, classify, isProjectDir, readProject, writeProject, convertLegacy, checkNewProjectDir,
  TEXT_DIRS, slugify, fragmentAbs, newFragmentPath, readFragment, writeFragments, copyTextFolders
}
