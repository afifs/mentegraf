// styles.js — citation styles (.csl) and Word templates (.docx) for export. Main process only.
//
// Sources, in list order:
//   project  — files in the project folder or its styles/ subfolder (travel with the project)
//   library  — files imported once into Mentegraf (userData/styles, userData/templates)
//   zotero   — citation styles already installed in Zotero (<Zotero data>/styles)
// A style or template chosen from the library or Zotero is copied into <project>/styles,
// so the project exports the same way on every computer.
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

function err(code, message) { const e = new Error(message); e.code = code; return e }
const slash = p => p.split(path.sep).join('/')

function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&')
}

function head(file, n) {
  const fd = fs.openSync(file, 'r')
  try { const b = Buffer.alloc(n || 16384); const len = fs.readSync(fd, b, 0, b.length, 0); return b.slice(0, len).toString('utf8') } finally { fs.closeSync(fd) }
}

function cslTitle(file) {
  try {
    const m = /<info>[\s\S]*?<title(?:\s[^>]*)?>([^<]+)<\/title>/.exec(head(file))
    if (m) return decode(m[1].trim())
  } catch (e) { /* fall through */ }
  return path.basename(file).replace(/\.csl$/i, '')
}

function isCsl(file) {
  // Every CSL style declares the CSL namespace on its <style> element.
  try { const h = head(file); return /<style[\s>]/.test(h) && /purl\.org\/net\/xbiblio\/csl/.test(h) } catch (e) { return false }
}

// Dependent styles only point to a parent style; Pandoc cannot use them alone.
function isDependent(file) {
  try { return /rel="independent-parent"/.test(head(file, 32768)) } catch (e) { return true }
}

function isDocx(file) {
  try { return head(file, 4).slice(0, 2) === 'PK' } catch (e) { return false }
}

function listDir(dir, ext) {
  try { return fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith(ext) && !n.startsWith('~$')).map(n => path.join(dir, n)) } catch (e) { return [] }
}

// Zotero's data folder: a custom one from Zotero's preferences, else ~/Zotero.
function zoteroDataDirs() {
  const dirs = []
  const profilesRoot = process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'Zotero', 'Zotero', 'Profiles')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Zotero', 'Profiles')
      : path.join(os.homedir(), '.zotero', 'zotero')
  try {
    for (const p of fs.readdirSync(profilesRoot)) {
      try {
        const t = fs.readFileSync(path.join(profilesRoot, p, 'prefs.js'), 'utf8')
        const m = /user_pref\("extensions\.zotero\.dataDir",\s*"((?:[^"\\]|\\.)*)"\)/.exec(t)
        if (m && /user_pref\("extensions\.zotero\.useDataDir",\s*true\)/.test(t)) dirs.push(JSON.parse('"' + m[1] + '"'))
      } catch (e) { /* no prefs in this profile */ }
    }
  } catch (e) { /* no profiles */ }
  dirs.push(path.join(os.homedir(), 'Zotero'))
  return Array.from(new Set(dirs))
}

function zoteroStylesDir() {
  for (const d of zoteroDataDirs()) {
    const s = path.join(d, 'styles')
    if (fs.existsSync(s)) return s
  }
  return null
}

const byTitle = (a, b) => a.title.localeCompare(b.title, 'tr')

// Options for the settings dropdowns. value: 'project:<relative path>' or 'file:<absolute path>'.
function listOptions(projectDir, userDataDir, zoteroDir) {
  const styles = [], templates = [], seen = new Set()
  const add = (list, item, key) => { if (!seen.has(key)) { seen.add(key); list.push(item) } }
  const groups = { project: [], library: [], zotero: [] }

  if (projectDir) {
    listDir(projectDir, '.csl').concat(listDir(path.join(projectDir, 'styles'), '.csl')).forEach(f => {
      if (!isDependent(f)) add(groups.project, { value: 'project:' + slash(path.relative(projectDir, f)), title: cslTitle(f), source: 'project' }, 'csl:' + path.basename(f).toLowerCase())
    })
  }
  listDir(path.join(userDataDir, 'styles'), '.csl').forEach(f => {
    add(groups.library, { value: 'file:' + f, title: cslTitle(f), source: 'library' }, 'csl:' + path.basename(f).toLowerCase())
  })
  const z = zoteroDir === undefined ? zoteroStylesDir() : zoteroDir
  if (z) listDir(z, '.csl').forEach(f => {
    if (!isDependent(f)) add(groups.zotero, { value: 'file:' + f, title: cslTitle(f), source: 'zotero' }, 'csl:' + path.basename(f).toLowerCase())
  })
  ;['project', 'library', 'zotero'].forEach(g => styles.push(...groups[g].sort(byTitle)))

  const tProject = [], tLibrary = []
  if (projectDir) {
    const rootRef = path.join(projectDir, 'reference.docx')
    ;(fs.existsSync(rootRef) ? [rootRef] : []).concat(listDir(path.join(projectDir, 'styles'), '.docx')).forEach(f => {
      add(tProject, { value: 'project:' + slash(path.relative(projectDir, f)), title: path.basename(f).replace(/\.docx$/i, ''), source: 'project' }, 'docx:' + path.basename(f).toLowerCase())
    })
  }
  listDir(path.join(userDataDir, 'templates'), '.docx').forEach(f => {
    add(tLibrary, { value: 'file:' + f, title: path.basename(f).replace(/\.docx$/i, ''), source: 'library' }, 'docx:' + path.basename(f).toLowerCase())
  })
  templates.push(...tProject.sort(byTitle), ...tLibrary.sort(byTitle))
  return { styles, templates, zoteroDir: z }
}

// Copy into dir under the file's own name; reuse an identical copy, else add -2, -3…
function copyInto(dir, file) {
  fs.mkdirSync(dir, { recursive: true })
  const ext = path.extname(file), base = path.basename(file, ext)
  const data = fs.readFileSync(file)
  let name = base + ext, i = 2
  for (;;) {
    const dest = path.join(dir, name)
    if (!fs.existsSync(dest)) { fs.writeFileSync(dest, data); return dest }
    if (Buffer.compare(fs.readFileSync(dest), data) === 0) return dest
    name = base + '-' + (i++) + ext
  }
}

// Import a file the user picked into Mentegraf's library.
function importToLibrary(file, kind, userDataDir) {
  if (kind === 'csl') {
    if (!isCsl(file)) throw err('not-csl', 'Not a citation style (.csl) file.')
    if (isDependent(file)) throw err('dependent', 'This is a dependent style; choose its parent style.')
    const dest = copyInto(path.join(userDataDir, 'styles'), file)
    return { value: 'file:' + dest, title: cslTitle(dest), source: 'library' }
  }
  if (!isDocx(file)) throw err('not-docx', 'Not a Word (.docx) file.')
  const dest = copyInto(path.join(userDataDir, 'templates'), file)
  return { value: 'file:' + dest, title: path.basename(dest).replace(/\.docx$/i, ''), source: 'library' }
}

// Make a chosen option part of the project. Returns the project-relative path to store.
function useInProject(projectDir, value) {
  if (typeof value !== 'string') throw err('bad-value', 'Invalid choice.')
  if (value.startsWith('project:')) {
    const rel = value.slice(8)
    resolve(projectDir, rel)
    return rel
  }
  if (!value.startsWith('file:')) throw err('bad-value', 'Invalid choice.')
  const file = value.slice(5)
  if (!/\.(csl|docx)$/i.test(file) || !fs.existsSync(file)) throw err('missing', 'File not found: ' + file)
  return slash(path.relative(projectDir, copyInto(path.join(projectDir, 'styles'), file)))
}

// Project-relative path -> absolute path inside the project, or throws.
function resolve(projectDir, rel) {
  if (typeof rel !== 'string' || !/\.(csl|docx)$/i.test(rel) || rel.split(/[\\/]/).includes('..')) throw err('bad-path', 'Invalid style path: ' + rel)
  const abs = path.resolve(projectDir, rel)
  if (!abs.startsWith(path.resolve(projectDir) + path.sep)) throw err('bad-path', 'Invalid style path: ' + rel)
  if (!fs.existsSync(abs)) throw err('missing', 'Style file missing from the project: ' + rel)
  return abs
}

module.exports = { cslTitle, isDependent, zoteroStylesDir, listOptions, importToLibrary, useInProject, resolve }
