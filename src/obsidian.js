// obsidian.js — write a book's map into an Obsidian vault, one note per node.
//
// The book gets its own folder in the vault. Each note carries the node's id in its front
// matter (mentegraf-id), so a later export finds the same note again even if the author renamed
// it in Obsidian. Mentegraf writes only between two markers and its own front-matter keys;
// whatever the author adds outside the markers stays as it is.
'use strict'
const fs = require('fs')
const path = require('path')

const START = '<!-- mentegraf:start -->'
const END = '<!-- mentegraf:end -->'
const OWN_KEYS = ['mentegraf-id', 'mentegraf-project', 'mentegraf-type', 'tür', 'durum', 'kaynak-metin']

// A file name Obsidian and every OS accept; Turkish letters stay.
function safeName(label) {
  let s = String(label || '').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim()
  s = s.replace(/^[.\s-]+/, '').replace(/[.\s]+$/, '')
  if (s.length > 120) s = s.slice(0, 120).trim()
  return s || 'Adsız'
}

// Claims and questions are sentences: their file name is cut at a word, the full text goes
// into aliases so it can still be found and linked.
function shortName(node) {
  const full = safeName(node.label)
  if (!/^(claim|question)$/.test(node.type) || full.length <= 80) return full
  const cut = full.slice(0, 80).replace(/[\s,;.-]+\S*$/, '')
  return safeName((cut.length > 30 ? cut : full.slice(0, 80)) + '…')
}

// A tag Obsidian accepts: no spaces, nesting with '/'.
function safeTag(s) {
  return String(s || '').trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_\-/]/gu, '').replace(/^\/+|\/+$/g, '')
}

function yamlValue(v) {
  const s = String(v == null ? '' : v)
  return /^[\p{L}\p{N}][\p{L}\p{N} ._()-]*$/u.test(s) && !/^(true|false|null|yes|no|\d+)$/i.test(s) ? s : JSON.stringify(s)
}

// Front matter: { lines: [...raw lines], body } — only what we need, no YAML library.
function splitNote(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n')
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(t)
  if (!m) return { lines: [], body: t }
  return { lines: m[1].split('\n'), body: t.slice(m[0].length) }
}

// Value of a simple key, and the list under "tags:" / "aliases:" (flow or block style).
function readKey(lines, key) {
  for (const l of lines) { const m = new RegExp('^' + key + ':\\s*(.*)$').exec(l); if (m) return m[1].replace(/^["']|["']$/g, '').trim() }
  return null
}
function readList(lines, key) {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = new RegExp('^' + key + ':\\s*(.*)$').exec(lines[i])
    if (!m) continue
    const v = m[1].trim()
    if (v.startsWith('[')) v.replace(/^\[|\]$/g, '').split(',').forEach(x => { x = x.trim().replace(/^["']|["']$/g, ''); if (x) out.push(x) })
    else if (v) out.push(v.replace(/^["']|["']$/g, ''))
    else for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]); j++) out.push(lines[j].replace(/^\s*-\s+/, '').replace(/^["']|["']$/g, '').trim())
  }
  return out
}
// Drop a key and the block list under it.
function dropKey(lines, key) {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp('^' + key + ':').test(lines[i])) { while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) i++; continue }
    out.push(lines[i])
  }
  return out
}

// The new note text: our keys replaced, tags and aliases merged, our block replaced.
function mergeNote(existing, own, block) {
  const old = splitNote(existing || '')
  let lines = old.lines.slice()
  const tags = Array.from(new Set(readList(lines, 'tags').concat(own.tags || [])))
  const aliases = Array.from(new Set(readList(lines, 'aliases').concat(own.aliases || [])))
  OWN_KEYS.concat(['tags', 'aliases']).forEach(k => { lines = dropKey(lines, k) })
  const ours = []
  Object.keys(own.keys).forEach(k => { if (own.keys[k] != null && own.keys[k] !== '') ours.push(k + ': ' + yamlValue(own.keys[k])) })
  if (tags.length) ours.push('tags:', ...tags.map(t => '  - ' + t))
  if (aliases.length) ours.push('aliases:', ...aliases.map(a => '  - ' + yamlValue(a)))
  const fm = '---\n' + ours.concat(lines.filter(l => l.trim() !== '')).join('\n') + '\n---\n'
  const managed = START + '\n' + block.trim() + '\n' + END
  let body = old.body
  const a = body.indexOf(START), b = body.indexOf(END)
  if (a >= 0 && b > a) body = body.slice(0, a) + managed + body.slice(b + END.length)
  else body = managed + '\n\n' + body.replace(/^\n+/, '')
  return fm + body.replace(/\n*$/, '\n')
}

// The paragraph a passage marker (^id) ends, without the marker.
function passageText(projectDir, passage) {
  if (!projectDir || !passage) return ''
  const m = /^(.*\.md)#([A-Za-z0-9-]+)$/.exec(passage)
  if (!m) return ''
  let text
  try { text = fs.readFileSync(path.join(projectDir, m[1]), 'utf8') } catch (e) { return '' }
  const paras = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)
  const re = new RegExp('\\s\\^' + m[2] + '\\s*$')
  const p = paras.find(x => re.test(x))
  return p ? p.replace(re, '').replace(/\s*\n\s*/g, ' ').trim() : ''
}

// Markdown files under a folder, subfolders included (not hidden ones): paths relative to it,
// '/'-separated, without .md.
function listNotes(dir) {
  const out = []
  const walk = (rel, depth) => {
    let entries = []
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }) } catch (e) { return }
    entries.forEach(e => {
      if (e.name.startsWith('.')) return
      const r = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) { if (depth < 8) walk(r, depth + 1) } else if (/\.md$/i.test(e.name)) out.push(r.replace(/\.md$/i, ''))
    })
  }
  walk('', 0)
  return out.sort()
}
const baseName = rel => rel.split('/').pop()

// Notes already in the folder that came from Mentegraf: id -> file (relative, without .md).
// A note the author moved into a subfolder is still found.
function scanFolder(dir) {
  const byId = {}, names = new Set()
  listNotes(dir).forEach(rel => {
    names.add(baseName(rel).toLocaleLowerCase('tr'))
    try {
      const id = readKey(splitNote(fs.readFileSync(path.join(dir, rel + '.md'), 'utf8')).lines, 'mentegraf-id')
      if (id) byId[id] = rel
    } catch (e) { /* unreadable: leave it */ }
  })
  return { byId, names }
}

// File names for the nodes: an existing note keeps its name; new ones get a free, unique name.
function assignNames(nodes, found, reserved) {
  const out = {}, taken = new Set((reserved || []).map(n => n.toLocaleLowerCase('tr')))
  nodes.forEach(n => { if (found.byId[n.id]) { out[n.id] = found.byId[n.id]; taken.add(baseName(out[n.id]).toLocaleLowerCase('tr')) } })
  found.names.forEach(n => taken.add(n))
  const count = {}
  nodes.forEach(n => { const k = shortName(n).toLocaleLowerCase('tr'); count[k] = (count[k] || 0) + 1 })
  nodes.forEach(n => {
    if (out[n.id]) return
    let name = shortName(n)
    if (count[name.toLocaleLowerCase('tr')] > 1 || taken.has(name.toLocaleLowerCase('tr'))) name = safeName(name.replace(/…$/, '') + ' (' + n.typeLabel + ')')
    let k = name, i = 2
    while (taken.has(k.toLocaleLowerCase('tr'))) k = name + ' ' + (i++)
    out[n.id] = k; taken.add(k.toLocaleLowerCase('tr'))
  })
  return out
}

function link(names, id, label) {
  const n = names[id] && baseName(names[id])
  return !n ? label : (n === label ? '[[' + n + ']]' : '[[' + n + '|' + label + ']]')
}

// The part of the note Mentegraf owns.
function noteBlock(node, names, labels, projectDir, L) {
  const parts = []
  if (node.description) parts.push(node.description.trim())
  const quote = passageText(projectDir, node.passage)
  if (quote) {
    const owner = node.passageOwner
    parts.push('> ' + quote + (owner ? '\n>\n> — ' + link(names, owner, labels[owner] || owner) : ''))
  }
  const meta = []
  if (node.status) meta.push('**' + L.status + ':** ' + node.status)
  if (node.cats && node.cats.length) meta.push('**' + L.categories + ':** ' + node.cats.join('; '))
  if (meta.length) parts.push(meta.join('  \n'))
  if (node.links && node.links.length) {
    const lines = node.links.map(l => {
      const kind = l.type ? l.type + (l.marker ? ' ' + l.marker : '') : L.related
      const arrow = l.type ? (l.dir === 'in' ? '← ' : '→ ') : ''
      return '- ' + arrow + kind + ' ' + link(names, l.to, labels[l.to] || l.to) + (l.note ? ' — ' + l.note : '')
    })
    parts.push('## ' + L.links + '\n\n' + lines.join('\n'))
  }
  if (node.notes) parts.push('## ' + L.notes + '\n\n' + node.notes.trim())
  return parts.join('\n\n')
}

// Write the book into <vault>/<folder>/. Returns counts and the folder.
function exportVault(opts) {
  const { vaultDir, folderName, projectDir, projectTitle, nodes } = opts
  const L = Object.assign({ status: 'Durum', categories: 'Kategoriler', links: 'Bağlantılar', notes: 'Notlar', related: 'İlişkili', index: 'Dizin' }, opts.labels || {})
  const dir = path.join(vaultDir, safeName(folderName || projectTitle || 'Mentegraf'))
  fs.mkdirSync(dir, { recursive: true })
  const found = scanFolder(dir)
  // notes written in Obsidian that just became nodes keep their file
  Object.keys(opts.adopt || {}).forEach(id => { if (!found.byId[id]) found.byId[id] = opts.adopt[id] })
  const indexName = indexNameOf(L, folderName || projectTitle)
  found.names.delete(indexName.toLocaleLowerCase('tr'))
  const names = assignNames(nodes, found, [indexName])
  const labels = {}
  nodes.forEach(n => { labels[n.id] = n.label })
  const counts = { created: 0, updated: 0, unchanged: 0, orphaned: 0 }
  // what each note said when written, so a later import can tell who changed what
  const baseline = { folder: dir, written: new Date().toISOString(), nodes: {} }
  const write = (file, text) => {
    const p = path.join(dir, file + '.md')
    let old = null
    try { old = fs.readFileSync(p, 'utf8') } catch (e) { old = null }
    if (old === text) { counts.unchanged++; return }
    fs.writeFileSync(p, text, 'utf8')
    counts[old == null ? 'created' : 'updated']++
  }
  nodes.forEach(n => {
    const p = path.join(dir, names[n.id] + '.md')
    let old = ''
    try { old = fs.readFileSync(p, 'utf8') } catch (e) { old = '' }
    const own = {
      keys: { 'mentegraf-id': n.id, 'mentegraf-project': projectTitle || '', 'mentegraf-type': n.type, 'tür': n.typeLabel, 'durum': n.status || '', 'kaynak-metin': n.fragment || '' },
      tags: (n.tags || []).concat(n.catTags || []).map(safeTag).filter(Boolean),
      aliases: names[n.id] !== safeName(n.label) ? [n.label] : []
    }
    write(names[n.id], mergeNote(old, own, noteBlock(n, names, labels, projectDir, L)))
    baseline.nodes[n.id] = { file: names[n.id], description: norm(n.description), notes: norm(n.notes), tags: (n.tags || []).map(safeTag).filter(Boolean) }
  })
  // The book's own note: every node by type.
  const byType = {}, order = []
  nodes.forEach(n => { if (!byType[n.typeLabel]) { byType[n.typeLabel] = []; order.push(n.typeLabel) } byType[n.typeLabel].push(n) })
  order.sort((a, b) => a.localeCompare(b, 'tr'))
  const index = order.map(t => '## ' + t + '\n\n' + byType[t].slice().sort((a, b) => a.label.localeCompare(b.label, 'tr')).map(n => '- ' + link(names, n.id, n.label)).join('\n')).join('\n\n')
  let oldIndex = ''
  try { oldIndex = fs.readFileSync(path.join(dir, indexName + '.md'), 'utf8') } catch (e) { oldIndex = '' }
  write(indexName, mergeNote(oldIndex, { keys: { 'mentegraf-project': projectTitle || '', 'tür': L.index }, tags: [] }, index))
  // Notes of nodes that are no longer in the map are left alone, only counted.
  Object.keys(found.byId).forEach(id => { if (!labels[id]) counts.orphaned++ })
  return Object.assign({ folder: dir, notes: nodes.length, baseline }, counts)
}

function indexNameOf(L, title) { return safeName((L.index || 'Dizin') + ' - ' + (title || 'Mentegraf')) }
function norm(s) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n\s*\n/g, '\n\n').trim() }

// ── Import: read back what the author changed in Obsidian ──────────────────────────────────

// Our block, taken apart: description, quoted passage, notes.
function parseBlock(block, L) {
  const t = norm(block)
  const notesHead = new RegExp('(^|\\n)## ' + escRe(L.notes) + '\\n')
  const linksHead = new RegExp('(^|\\n)## ' + escRe(L.links) + '\\n')
  let head = t, notes = ''
  const mn = notesHead.exec(t)
  if (mn) { head = t.slice(0, mn.index); notes = t.slice(mn.index + mn[0].length) }
  const ml = linksHead.exec(head)
  if (ml) head = head.slice(0, ml.index)
  const meta = new RegExp('^\\*\\*(' + escRe(L.status) + '|' + escRe(L.categories) + '):\\*\\*')
  const paras = head.split(/\n\s*\n/)
  const desc = [], quote = []
  let i = 0
  for (; i < paras.length && !/^>/.test(paras[i]) && !meta.test(paras[i]); i++) desc.push(paras[i])
  for (; i < paras.length; i++) if (/^>/.test(paras[i])) quote.push(paras[i])
  const q = quote.join('\n').split('\n').map(l => l.replace(/^>\s?/, '')).join('\n').split(/\n\s*\n— /)[0]
  return { description: norm(desc.join('\n\n')), notes: norm(notes), quote: norm(q).replace(/\s*\n\s*/g, ' ') }
}
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// [[Target]], [[Target|shown]], [[Target#heading]] — not embeds (![[…]]), not inside quotes.
function wikiLinks(body) {
  const out = []
  norm(body).split('\n').forEach(line => {
    if (/^\s*>/.test(line)) return
    const re = /(!?)\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g
    let m
    while ((m = re.exec(line))) if (!m[1]) out.push(m[2].trim())
  })
  return out
}

// Read the book folder and work out what changed there since the last export.
//   nodes     the map as the export sends it (records)
//   baseline  what the last export wrote ({ nodes: { id: { file, description, notes, tags } } }), or null
// Returns lists the author confirms one by one; nothing is applied here.
function scanImport(opts) {
  const { folder, nodes } = opts
  const L = Object.assign({ status: 'Durum', categories: 'Kategoriler', links: 'Bağlantılar', notes: 'Notlar', index: 'Dizin' }, opts.labels || {})
  const base = (opts.baseline && opts.baseline.nodes) || null
  const byId = {}
  nodes.forEach(n => { byId[n.id] = n })
  const indexName = indexNameOf(L, opts.folderName || opts.projectTitle).toLocaleLowerCase('tr')
  const plan = { folder, hasBaseline: !!base, updates: [], tagsAdd: [], tagsRemove: [], links: [], created: [], orphans: [], quotes: [] }
  const notes = []
  listNotes(folder).forEach(rel => {
    let text
    try { text = fs.readFileSync(path.join(folder, rel + '.md'), 'utf8') } catch (e) { return }
    const sp = splitNote(text)
    const id = readKey(sp.lines, 'mentegraf-id')
    if (!id && (baseName(rel).toLocaleLowerCase('tr') === indexName || readKey(sp.lines, 'mentegraf-project') != null)) return
    notes.push({ rel, id, sp })
  })
  // name -> note key (an existing node's id, or 'new:<file>')
  const keyOf = {}
  const keyFor = n => n.id && byId[n.id] ? n.id : (n.id ? null : 'new:' + n.rel)
  notes.forEach(n => {
    const k = keyFor(n); if (!k) return
    const names = [baseName(n.rel), n.rel].concat(readList(n.sp.lines, 'aliases'))
    names.forEach(x => { const l = x.toLocaleLowerCase('tr'); if (!(l in keyOf)) keyOf[l] = k })
  })
  const neighbours = {}
  nodes.forEach(n => { neighbours[n.id] = new Set((n.links || []).map(l => l.to)) })
  const seenPair = new Set()
  const addLink = (from, to, file) => {
    if (!to || from === to) return
    if (byId[from] && byId[to] && (neighbours[from].has(to) || neighbours[to].has(from))) return
    const pair = [from, to].sort().join('|')
    if (seenPair.has(pair)) return
    seenPair.add(pair); plan.links.push({ from, to, file })
  }

  notes.forEach(n => {
    if (n.id && !byId[n.id]) { plan.orphans.push(n.rel); return }
    const fmTags = readList(n.sp.lines, 'tags').map(safeTag).filter(Boolean)
    const body = n.sp.body
    if (!n.id) {
      plan.created.push({ file: n.rel, label: baseName(n.rel), typeHint: readKey(n.sp.lines, 'mentegraf-type') || readKey(n.sp.lines, 'tür') || '', tags: fmTags })
      wikiLinks(body).forEach(t => addLink('new:' + n.rel, keyOf[t.toLocaleLowerCase('tr')], n.rel))
      return
    }
    const node = byId[n.id], b = base && base[n.id]
    const a = body.indexOf(START), z = body.indexOf(END)
    if (a >= 0 && z > a) {
      const got = parseBlock(body.slice(a + START.length, z), L)
      ;['description', 'notes'].forEach(f => {
        const inVault = got[f], inMap = norm(node[f])
        if (inVault === inMap) return
        if (b && inVault === b[f]) return // only the map changed: the next export writes it
        plan.updates.push({ id: n.id, file: n.rel, field: f, from: inMap, to: inVault, conflict: !!b && inMap !== b[f], noBaseline: !b })
      })
      if (got.quote && opts.quoteOf) {
        const q = norm(opts.quoteOf(node)).replace(/\s*\n\s*/g, ' ')
        if (q && q !== got.quote) plan.quotes.push({ id: n.id, file: n.rel })
      }
    }
    // tags: the node's own ones; category tags are written from the classification
    const cat = new Set((node.catTags || []).map(safeTag))
    const mine = (node.tags || []).map(t => ({ t, s: safeTag(t) }))
    const mineSafe = new Set(mine.map(x => x.s))
    const baseTags = new Set(b ? b.tags : mine.map(x => x.s))
    fmTags.forEach(t => { if (!cat.has(t) && !mineSafe.has(t) && !baseTags.has(t)) plan.tagsAdd.push({ id: n.id, file: n.rel, tag: t }) })
    if (b) mine.forEach(x => { if (baseTags.has(x.s) && fmTags.indexOf(x.s) < 0) plan.tagsRemove.push({ id: n.id, file: n.rel, tag: x.t }) })
    wikiLinks(body).forEach(t => addLink(n.id, keyOf[t.toLocaleLowerCase('tr')], n.rel))
  })
  return plan
}

module.exports = { exportVault, scanImport, parseBlock, wikiLinks, listNotes, mergeNote, safeName, safeTag, passageText, assignNames, splitNote, readList, START, END }
