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
      else if (kind === 'obsidian') window.doExportObsidian()
      else if (kind === 'svg') window.doExportSVG()
      else if (kind === 'csv') window.doExportCSV()
    } finally { window.exportTypes = null }
  }

  return { open: open, close: close, run: run, setAll: setAll }
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
