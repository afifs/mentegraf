// glossary.js — choosing node types for map exports, and the glossary / index export.
//
// ExportPick: before a map export (JSON, HTML, Obsidian, SVG, CSV) the author picks which node
// types go in; links are kept only between nodes that go in. The choice lives in
// window.exportTypes while the export runs (null = everything).
//
// Gloss: a list of terms, concepts and ideas (or people, institutions, events…) with their
// definition and the chapters they belong to, from the map's links and/or from where the
// name occurs in the texts. Written as Markdown, Word (through Pandoc) or CSV.
/* global cy, L, curLang, categories, catById, catLabel, closeExport, showMsg, Binder, Writer */
var ExportPick = (function () {
  'use strict'

  var pending = null

  function $(id) { return document.getElementById(id) }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }

  // Types that have at least one node, with their counts.
  function typesInUse() {
    var count = {}
    cy.nodes().forEach(function (n) { var t = n.data('type'); count[t] = (count[t] || 0) + 1 })
    return categories.filter(function (c) { return count[c.id] }).map(function (c) { return { cat: c, n: count[c.id] } })
  }

  function open(kind) {
    pending = kind
    closeExport()
    var visible = window.activeTypes
    $('pickTypes').innerHTML = typesInUse().map(function (t) {
      var on = !visible || visible.has(t.cat.id)
      return '<label class="gtype"><input type="checkbox" value="' + esc(t.cat.id) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="cdot" style="background:' + esc(t.cat.color) + '"></span><span>' + esc(catLabel(t.cat)) + '</span><span class="gcount">' + t.n + '</span></label>'
    }).join('')
    $('pickTitle').textContent = L('pickTitle') + ': ' + ({ json: 'JSON', publish: 'HTML', obsidian: 'Obsidian', svg: 'SVG', csv: 'CSV' }[kind] || '')
    $('pickNote').style.display = kind === 'json' ? '' : 'none'
    $('pickModal').style.display = 'flex'
  }

  function close() { $('pickModal').style.display = 'none'; pending = null }

  function setAll(on) { Array.prototype.forEach.call($('pickTypes').querySelectorAll('input'), function (i) { i.checked = on }) }

  function chosen() {
    var set = new Set()
    Array.prototype.forEach.call($('pickTypes').querySelectorAll('input:checked'), function (i) { set.add(i.value) })
    return set
  }

  function run() {
    var kind = pending, set = chosen()
    if (!set.size) { alert(L('pickNone')); return }
    close()
    var all = typesInUse().every(function (t) { return set.has(t.cat.id) })
    window.exportTypes = all ? null : set
    try {
      if (kind === 'json') window.doExportJSON()
      else if (kind === 'publish') window.doPublish()
      else if (kind === 'obsidian') ObsidianOut.run()
      else if (kind === 'svg') window.doExportSVG()
      else if (kind === 'csv') window.doExportCSV()
    } finally { window.exportTypes = null }
  }

  return { open: open, close: close, run: run, setAll: setAll }
})()

// Obsidian: one note per node in the vault, in a folder named after the book (main process
// writes the files). Without the desktop app, falls back to the single combined Markdown file.
var ObsidianOut = (function () {
  'use strict'
  function api() { return window.mentegraf }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v) } catch (e) { return null } }

  function records() {
    var nodes = cy.nodes().filter(function (n) { return inExport(n.data('type')) })
    var keep = {}, byFragment = {}
    nodes.forEach(function (n) { keep[n.id()] = true })
    cy.nodes().forEach(function (n) { if (n.data('fragment')) byFragment[n.data('fragment')] = n.id() })
    return nodes.map(function (n) {
      var d = n.data(), cat = catById(d.type)
      var links = []
      n.connectedEdges().forEach(function (e) {
        var out = e.source().id() === n.id(), o = out ? e.target() : e.source()
        if (!keep[o.id()]) return
        var ct = e.data('edgeType') ? connById(e.data('edgeType')) : null
        links.push({ to: o.id(), dir: out ? 'out' : 'in', type: ct ? connLabel(ct) : '', marker: ct ? (ct.marker || '') : '', note: e.data('note') || '', w: e.data('weight') || 0 })
      })
      links.sort(function (a, b) { return (a.type || '~').localeCompare(b.type || '~', curLang) || b.w - a.w })
      var cats = (d.cats || []).map(function (id) { return window.Classify ? Classify.path(id) : '' }).filter(Boolean)
      var arg = window.Argue && Argue.isArg(n)
      var passage = d.passage || '', owner = passage ? byFragment[passage.split('#')[0]] : null
      return {
        id: d.id, label: String(d.label || ''), type: d.type, typeLabel: cat ? catLabel(cat) : d.type,
        description: d.description || '', notes: d.notes || '', tags: d.tags || [],
        cats: cats, catTags: cats.map(function (c) { return c.split(' › ').join('/') }),
        status: arg ? L('as_' + Argue.statusOf(n)) : '', passage: passage, passageOwner: owner && keep[owner] ? owner : null,
        fragment: d.fragment || '', links: links
      }
    })
  }

  async function run() {
    if (!api() || !api().obsidianExport) { window.doExportObsidianFile(); return }
    var title = (window.Binder && Binder.get && Binder.get().title) || ''
    var r = await api().obsidianExport({
      vault: store('mentegraf-obsidian-vault') || undefined, folderName: title, projectTitle: title, nodes: records(), labels: labels()
    })
    if (r && r.vault) store('mentegraf-obsidian-vault', r.vault)
  }
  function labels() {
    return { status: L('argStatusLabel'), categories: L('catsTitle'), links: L('connections'), notes: L('notesLabel'), related: L('obsRelated'), index: L('obsIndex') }
  }
  // Write the vault again without asking (after an import), so the notes and the baseline follow the map.
  async function rewrite(vault, adopt) {
    if (!api() || !api().obsidianExport) return null
    var title = (window.Binder && Binder.get && Binder.get().title) || ''
    return api().obsidianExport({ vaultDir: vault, quiet: true, folderName: title, projectTitle: title, nodes: records(), labels: labels(), adopt: adopt || {} })
  }
  return { run: run, records: records, labels: labels, rewrite: rewrite, store: store }
})()

// Bring back from Obsidian what the author changed in the book's folder: corrected descriptions
// and notes, tags, [[links]] between notes, and new notes as new nodes. Shown as a list to tick;
// the map changes only for what is ticked. Afterwards the vault is written again from the map.
var ObsidianIn = (function () {
  'use strict'
  var plan = null
  function api() { return window.mentegraf }
  function $(id) { return document.getElementById(id) }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }
  function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s }
  function node(id) { var n = cy.getElementById(id); return n.length ? n : null }
  function nameOf(key) {
    if (String(key).indexOf('new:') === 0) return String(key).slice(4).split('/').pop()
    var n = node(key); return n ? n.data('label') : key
  }

  function modal() {
    var m = $('obsInModal')
    if (m) return m
    m = document.createElement('div')
    m.className = 'modal-overlay'; m.id = 'obsInModal'
    m.innerHTML = '<div class="modal obs-in"><div class="oi-head"><h2>' + esc(L('oiTitle')) + '</h2><button class="bt bg" onclick="ObsidianIn.close()">✕</button></div>' +
      '<div id="oiBody" class="oi-body"></div>' +
      '<div class="oi-foot"><span id="oiNote" class="oi-note"></span><span style="flex:1"></span>' +
      '<button class="bt bg" onclick="ObsidianIn.close()">' + esc(L('cancel')) + '</button> ' +
      '<button class="bt bp" id="oiApply" onclick="ObsidianIn.apply()">' + esc(L('oiApply')) + '</button></div></div>'
    document.body.appendChild(m)
    return m
  }
  function close() { var m = $('obsInModal'); if (m) m.style.display = 'none' }

  async function open() {
    if (!api() || !api().obsidianScan) { showMsg(L('oiDesktopOnly')); return }
    var title = (window.Binder && Binder.get && Binder.get().title) || ''
    var r = await api().obsidianScan({ vault: ObsidianOut.store('mentegraf-obsidian-vault') || undefined, folderName: title, nodes: ObsidianOut.records(), labels: ObsidianOut.labels() })
    if (!r || r.canceled) return
    if (r.error) { alert(r.error); return }
    plan = r
    var m = modal()
    render()
    m.style.display = 'flex'
  }

  function typeOptions(hint) {
    var h = String(hint || '').toLocaleLowerCase('tr')
    var pick = categories.find(function (c) { return c.id === hint || catLabel(c).toLocaleLowerCase('tr') === h || (c.tr || '').toLocaleLowerCase('tr') === h || (c.en || '').toLowerCase() === h })
    if (!pick) pick = catById('idea') || categories[0]
    return categories.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c === pick ? ' selected' : '') + '>' + esc(catLabel(c)) + '</option>' }).join('')
  }

  function section(title, rows) {
    if (!rows.length) return ''
    return '<div class="oi-sec"><div class="oi-sh">' + esc(title) + ' <span class="oi-n">' + rows.length + '</span></div>' + rows.join('') + '</div>'
  }
  function row(kind, i, on, html) {
    return '<label class="oi-row"><input type="checkbox" data-k="' + kind + '" data-i="' + i + '"' + (on ? ' checked' : '') + '><div class="oi-main">' + html + '</div></label>'
  }

  function render() {
    var p = plan, h = ''
    h += '<div class="oi-where">' + esc(p.folder) + '</div>'
    if (!p.hasBaseline) h += '<div class="oi-warn">' + esc(L('oiNoBase')) + '</div>'
    h += section(L('oiUpdates'), p.updates.map(function (u, i) {
      var tag = u.conflict ? '<span class="oi-badge">' + esc(L('oiConflict')) + '</span>' : (u.noBaseline ? '<span class="oi-badge">' + esc(L('oiUnsure')) + '</span>' : '')
      return row('updates', i, !u.conflict && !u.noBaseline,
        '<div class="oi-t">' + esc(short(nameOf(u.id), 90)) + ' · ' + esc(L(u.field === 'notes' ? 'notesLabel' : 'oiDesc')) + ' ' + tag + '</div>' +
        '<div class="oi-diff"><div><b>' + esc(L('oiInMap')) + '</b> ' + (esc(short(u.from, 400)) || '<i>—</i>') + '</div><div><b>' + esc(L('oiInVault')) + '</b> ' + (esc(short(u.to, 400)) || '<i>—</i>') + '</div></div>')
    }))
    h += section(L('oiTagsAdd'), p.tagsAdd.map(function (t, i) { return row('tagsAdd', i, true, '<div class="oi-t">' + esc(short(nameOf(t.id), 90)) + ' <span class="oi-tag">+ #' + esc(t.tag) + '</span></div>') }))
    h += section(L('oiTagsRemove'), p.tagsRemove.map(function (t, i) { return row('tagsRemove', i, true, '<div class="oi-t">' + esc(short(nameOf(t.id), 90)) + ' <span class="oi-tag oi-del">− #' + esc(t.tag) + '</span></div>') }))
    h += section(L('oiCreated'), p.created.map(function (c, i) {
      return row('created', i, true, '<div class="oi-t">' + esc(c.label) + (c.file !== c.label ? ' <span class="oi-dim">' + esc(c.file) + '</span>' : '') +
        ' <select data-type="' + i + '" onclick="event.preventDefault();event.stopPropagation()" onmousedown="event.stopPropagation()">' + typeOptions(c.typeHint) + '</select></div>')
    }))
    h += section(L('oiLinks'), p.links.map(function (l, i) { return row('links', i, true, '<div class="oi-t">' + esc(short(nameOf(l.from), 70)) + ' — ' + esc(short(nameOf(l.to), 70)) + '</div>') }))
    var info = []
    p.quotes.forEach(function (q) { info.push('<div class="oi-info">' + esc(short(nameOf(q.id), 90)) + ': ' + esc(L('oiQuote')) + '</div>') })
    p.orphans.forEach(function (f) { info.push('<div class="oi-info">' + esc(f) + ': ' + esc(L('oiOrphan')) + '</div>') })
    if (info.length) h += '<div class="oi-sec"><div class="oi-sh">' + esc(L('oiInfo')) + '</div>' + info.join('') + '</div>'
    var any = p.updates.length + p.tagsAdd.length + p.tagsRemove.length + p.created.length + p.links.length
    if (!any) h += '<div class="oi-empty">' + esc(L('oiNothing')) + '</div>'
    $('oiBody').innerHTML = h
    $('oiApply').disabled = !any
    $('oiNote').textContent = any ? L('oiAfter') : ''
  }

  function ticked(kind) {
    var out = []
    document.querySelectorAll('#oiBody input[data-k="' + kind + '"]').forEach(function (cb) { if (cb.checked) out.push(+cb.dataset.i) })
    return out
  }

  async function apply() {
    var p = plan; if (!p) return
    var ids = {}, adopt = {}, n = { updates: 0, tags: 0, created: 0, links: 0 }
    var ext = cy.extent(), cx = (ext.x1 + ext.x2) / 2, cyy = (ext.y1 + ext.y2) / 2
    ticked('created').forEach(function (i) {
      var c = p.created[i], sel = document.querySelector('#oiBody select[data-type="' + i + '"]')
      var type = sel ? sel.value : 'idea', cat = catById(type) || categories[0]
      var id = ProjectFormat.newId('n'), x = cx + (Math.random() - 0.5) * 300, y = cyy + (Math.random() - 0.5) * 300
      cy.add({ data: { id: id, label: c.label, type: cat.id, color: cat.color, description: '', notes: '', tags: (c.tags || []).slice(), x: x, y: y }, position: { x: x, y: y } })
      ids['new:' + c.file] = id; adopt[id] = c.file; n.created++
    })
    ticked('updates').forEach(function (i) { var u = p.updates[i], nd = node(u.id); if (nd) { nd.data(u.field, u.to); n.updates++ } })
    ticked('tagsAdd').forEach(function (i) {
      var t = p.tagsAdd[i], nd = node(t.id); if (!nd) return
      var tags = (nd.data('tags') || []).slice(); if (tags.indexOf(t.tag) < 0) { tags.push(t.tag); nd.data('tags', tags); n.tags++ }
    })
    ticked('tagsRemove').forEach(function (i) {
      var t = p.tagsRemove[i], nd = node(t.id); if (!nd) return
      nd.data('tags', (nd.data('tags') || []).filter(function (x) { return x !== t.tag })); n.tags++
    })
    ticked('links').forEach(function (i) {
      var l = p.links[i], a = ids[l.from] || (node(l.from) ? l.from : null), b = ids[l.to] || (node(l.to) ? l.to : null)
      if (!a || !b || a === b) return
      cy.add({ data: { id: ProjectFormat.newId('e'), source: a, target: b, weight: 3, edgeType: '', note: 'Obsidian' } }); n.links++
    })
    close()
    if (typeof uStats === 'function') uStats()
    snapshot()
    var r = await ObsidianOut.rewrite(p.vault, adopt)
    showMsg(L('oiDone').replace('%u', n.updates).replace('%t', n.tags).replace('%c', n.created).replace('%l', n.links) + (r && r.error ? ' — ' + r.error : ''))
    plan = null
  }

  return { open: open, close: close, apply: apply, _plan: function () { return plan } }
})()

// Is a node of this type part of the export under way?
function inExport(type) { return !window.exportTypes || window.exportTypes.has(type) }

var Gloss = (function () {
  'use strict'

  var PRESETS = {
    terms: ['term', 'concept', 'idea'],
    people: ['person', 'institution', 'event']
  }

  function $(id) { return document.getElementById(id) }
  function api() { return window.mentegraf }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }
  function locale() { return curLang === 'en' ? 'en' : 'tr' }

  function typesInUse() {
    var count = {}
    cy.nodes().forEach(function (n) { var t = n.data('type'); count[t] = (count[t] || 0) + 1 })
    return categories.filter(function (c) { return count[c.id] }).map(function (c) { return { cat: c, n: count[c.id] } })
  }

  function open() {
    closeExport()
    $('glossTypes').innerHTML = typesInUse().map(function (t) {
      return '<label class="gtype"><input type="checkbox" value="' + esc(t.cat.id) + '">' +
        '<span class="cdot" style="background:' + esc(t.cat.color) + '"></span><span>' + esc(catLabel(t.cat)) + '</span><span class="gcount">' + t.n + '</span></label>'
    }).join('')
    preset('terms')
    $('glossModal').style.display = 'flex'
  }

  function close() { $('glossModal').style.display = 'none' }

  function preset(name) {
    var want = PRESETS[name] || []
    Array.prototype.forEach.call($('glossTypes').querySelectorAll('input'), function (i) { i.checked = want.indexOf(i.value) >= 0 })
    $('glossTitle').value = L(name === 'people' ? 'glossPeopleTitle' : 'glossTermsTitle')
    Array.prototype.forEach.call(document.querySelectorAll('#glossModal [data-preset]'), function (b) { b.classList.toggle('on', b.dataset.preset === name) })
  }

  function chosen() {
    var set = new Set()
    Array.prototype.forEach.call($('glossTypes').querySelectorAll('input:checked'), function (i) { set.add(i.value) })
    return set
  }

  // Chapters of the book plan, in order: node id -> { node, order }.
  function planChapters() {
    var out = {}, i = 0
    var walk = function (list) {
      (list || []).forEach(function (it) {
        if (it.kind === 'node' && it.include !== false) { var n = cy.getElementById(it.node); if (n.length) out[it.node] = { node: n, order: i++ } }
        walk(it.children)
      })
    }
    if (window.Binder && Binder.get) walk(Binder.get().items)
    return out
  }

  // Words to look for in the texts: the name, and what is in parentheses on its own
  // ("Satisficing (Ehven)" -> Satisficing, Ehven). People also by surname, unless two share it.
  function searchTerms(nodes) {
    var bySurname = {}
    nodes.forEach(function (n) {
      if (n.data('type') !== 'person') return
      var s = surname(n.data('label')); if (s) (bySurname[s.toLocaleLowerCase('tr')] = bySurname[s.toLocaleLowerCase('tr')] || []).push(n.id())
    })
    var out = {}
    nodes.forEach(function (n) {
      var label = String(n.data('label') || '').trim(), terms = []
      var m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(label)
      if (m) { terms.push(m[1].trim()); m[2].split(/[,;]/).forEach(function (p) { if (!/^\s*[\d\s–-]+\s*$/.test(p)) terms.push(p.trim()) }) } else terms.push(label)
      if (n.data('type') === 'person') {
        var s = surname(label)
        if (s && (bySurname[s.toLocaleLowerCase('tr')] || []).length === 1) terms.push(s)
      }
      out[n.id()] = terms.filter(function (t) { return t && t.length >= 3 })
    })
    return out
  }
  // "Charles Sanders Peirce" -> "Peirce, Charles Sanders" (index order).
  function surnameFirst(label) {
    if (/[(),]/.test(label)) return label
    var words = label.trim().split(/\s+/)
    return words.length < 2 ? label : words[words.length - 1] + ', ' + words.slice(0, -1).join(' ')
  }
  function surname(label) {
    var words = String(label || '').replace(/\(.*?\)/g, '').trim().split(/\s+/)
    if (words.length < 2) return ''
    var last = words[words.length - 1]
    return last.length >= 3 ? last : ''
  }

  async function collect() {
    var types = chosen(), useLinks = $('glossLinks').checked, useText = $('glossText').checked, withEmpty = $('glossEmpty').checked, bySurname = $('glossSurname').checked
    var plan = planChapters(), byPath = {}
    Object.keys(plan).forEach(function (id) { var f = plan[id].node.data('fragment'); if (f) byPath[f] = id })
    var nodes = cy.nodes().filter(function (n) { return types.has(n.data('type')) && !plan[n.id()] })
    var chapters = {}
    nodes.forEach(function (n) { chapters[n.id()] = {} })
    if (useLinks) nodes.forEach(function (n) {
      n.neighborhood().nodes().forEach(function (o) { if (plan[o.id()]) chapters[n.id()][o.id()] = true })
    })
    if (useText && api() && api().textMentions) {
      var terms = searchTerms(nodes), list = []
      Object.keys(terms).forEach(function (id) { terms[id].forEach(function (t) { if (list.indexOf(t) < 0) list.push(t) }) })
      var overrides = {}
      if (window.Writer && Writer.dirtyFragments) Writer.dirtyFragments().forEach(function (f) { overrides[f.path] = f.text })
      var r = await api().textMentions(list, { only: Object.keys(byPath), overrides: overrides })
      var counts = (r && r.counts) || {}
      Object.keys(terms).forEach(function (id) {
        terms[id].forEach(function (t) { Object.keys(counts[t] || {}).forEach(function (p) { if (byPath[p]) chapters[id][byPath[p]] = true }) })
      })
    }
    var entries = []
    nodes.forEach(function (n) {
      var desc = String(n.data('description') || '').trim()
      var chs = Object.keys(chapters[n.id()]).sort(function (a, b) { return plan[a].order - plan[b].order }).map(function (id) { return plan[id].node.data('label') })
      if (!withEmpty && !desc && !chs.length) return
      var cat = catById(n.data('type'))
      var label = String(n.data('label') || '')
      if (bySurname && n.data('type') === 'person') label = surnameFirst(label)
      entries.push({ label: label, type: cat ? catLabel(cat) : n.data('type'), typeId: n.data('type'), description: desc, chapters: chs })
    })
    entries.sort(function (a, b) { return a.label.localeCompare(b.label, locale(), { sensitivity: 'base' }) })
    return entries
  }

  function initial(label) {
    var c = String(label || '').replace(/^[^\p{L}\p{N}]+/u, '').charAt(0)
    return c ? c.toLocaleUpperCase(locale()) : '#'
  }

  function markdown(entries, title, byType) {
    var md = '# ' + title + '\n\n'
    var line = function (e) {
      var s = '**' + e.label + '**' + (byType ? '' : ' · *' + e.type + '*')
      if (e.description) s += '  \n' + e.description.replace(/\s*\n\s*/g, ' ')
      if (e.chapters.length) s += '  \n*' + L('glossChapters') + ':* ' + e.chapters.join('; ')
      return s + '\n\n'
    }
    if (byType) {
      var groups = {}, order = []
      entries.forEach(function (e) { if (!groups[e.type]) { groups[e.type] = []; order.push(e.type) } groups[e.type].push(e) })
      order.sort(function (a, b) { return a.localeCompare(b, locale()) })
      order.forEach(function (t) { md += '## ' + t + '\n\n'; groups[t].forEach(function (e) { md += line(e) }) })
    } else {
      var last = null
      entries.forEach(function (e) { var i = initial(e.label); if (i !== last) { md += '## ' + i + '\n\n'; last = i } md += line(e) })
    }
    return md
  }

  function csv(entries) {
    var q = function (s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"' }
    var rows = [[L('glossColName'), L('glossColType'), L('glossColDef'), L('glossChapters')].map(q).join(',')]
    entries.forEach(function (e) { rows.push([e.label, e.type, e.description.replace(/\s*\n\s*/g, ' '), e.chapters.join('; ')].map(q).join(',')) })
    return '﻿' + rows.join('\r\n') + '\r\n'
  }

  function fileName(title, ext) {
    var base = String(title || 'sozluk').toLocaleLowerCase(locale()).replace(/[çğıöşü]/g, function (c) { return { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u' }[c] })
    base = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sozluk'
    return base + '.' + ext
  }

  function download(text, name, mime) {
    var blob = new Blob([text], { type: mime }), url = URL.createObjectURL(blob), a = document.createElement('a')
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  var busy = false
  async function run(format) {
    if (busy) return
    if (!chosen().size) { alert(L('pickNone')); return }
    busy = true
    var title = $('glossTitle').value.trim() || L('glossTermsTitle'), byType = $('glossByType').checked
    try {
      var entries = await collect()
      if (!entries.length) { alert(L('glossEmptyResult')); return }
      if (format === 'csv') { download(csv(entries), fileName(title, 'csv'), 'text/csv'); close(); showMsg(L('exported')); return }
      var md = markdown(entries, title, byType)
      if (format === 'docx') {
        if (!api() || !api().exportDocx) { download(md, fileName(title, 'md'), 'text/markdown'); close(); return }
        close()
        var settings = Object.assign({ language: locale() }, window.exportSettings || {})
        var r = await api().exportDocx(fileName(title, 'md'), md, settings)
        if (r && r.error === 'untitled') alert(L('saveFirst'))
        return
      }
      download(md, fileName(title, 'md'), 'text/markdown'); close(); showMsg(L('exported'))
    } finally { busy = false }
  }

  return { open: open, close: close, preset: preset, run: run, _collect: collect, _markdown: markdown, _csv: csv, _searchTerms: searchTerms }
})()
