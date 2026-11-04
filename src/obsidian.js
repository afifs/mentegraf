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

// Notes already in the folder that came from Mentegraf: id -> file name (without .md).
function scanFolder(dir) {
  const byId = {}, names = new Set()
  let entries = []
  try { entries = fs.readdirSync(dir) } catch (e) { return { byId, names } }
  entries.filter(n => /\.md$/i.test(n)).forEach(n => {
    const base = n.replace(/\.md$/i, '')
    names.add(base.toLocaleLowerCase('tr'))
    try {
      const id = readKey(splitNote(fs.readFileSync(path.join(dir, n), 'utf8')).lines, 'mentegraf-id')
      if (id) byId[id] = base
    } catch (e) { /* unreadable: leave it */ }
  })
  return { byId, names }
}

// File names for the nodes: an existing note keeps its name; new ones get a free, unique name.
function assignNames(nodes, found, reserved) {
  const out = {}, taken = new Set((reserved || []).map(n => n.toLocaleLowerCase('tr')))
  nodes.forEach(n => { if (found.byId[n.id]) { out[n.id] = found.byId[n.id]; taken.add(out[n.id].toLocaleLowerCase('tr')) } })
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
  const n = names[id]
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
  const indexName = safeName((L.index || 'Dizin') + ' - ' + (folderName || projectTitle || 'Mentegraf'))
  found.names.delete(indexName.toLocaleLowerCase('tr'))
  const names = assignNames(nodes, found, [indexName])
  const labels = {}
  nodes.forEach(n => { labels[n.id] = n.label })
  const counts = { created: 0, updated: 0, unchanged: 0, orphaned: 0 }
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
  return Object.assign({ folder: dir, notes: nodes.length }, counts)
}

module.exports = { exportVault, mergeNote, safeName, safeTag, passageText, assignNames, splitNote, readList, START, END }
