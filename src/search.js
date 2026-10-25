// search.js — search in all texts (manuscript/ and notes/), shown in the classification pane.
//
// The main process reads the files; texts open in the editor are sent along so that
// unsaved changes are searched too. With a category or tag filter on, the search can be
// limited to the texts of the matching nodes. A result opens its text at the line.
/* global cy, L, snapshot, selNode, curLang, Writer, Classify, ProjectFormat, catById */
var TextSearch = (function () {
  'use strict'

  var timer = null, seq = 0, last = null, bound = false

  function $(id) { return document.getElementById(id) }
  function api() { return window.mentegraf }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }

  function query() { var i = $('sQuery'); return i ? i.value.replace(/\s+/g, ' ').trim() : '' }
  function active() { return query().length >= 2 }

  // path -> node, for the texts that belong to a node
  function nodeByPath() {
    var m = {}
    if (window.cy) cy.nodes().forEach(function (n) { if (n.data('fragment')) m[n.data('fragment')] = n })
    return m
  }

  function lensOn() { return !!(window.Classify && Classify.active()) }
  function onlyInLens() { var c = $('sInLens'); return lensOn() && c && c.checked }

  async function run() {
    var q = query(), pane = $('classes')
    pane.classList.toggle('searching', q.length >= 2)
    $('sLensRow').style.display = lensOn() && q.length >= 2 ? '' : 'none'
    if (q.length < 2) { $('sResults').innerHTML = q ? '<div class="cnone">' + esc(L('searchShort')) + '</div>' : ''; last = null; return }
    if (!api() || !api().textSearch) return
    var overrides = {}
    if (window.Writer && Writer.dirtyFragments) Writer.dirtyFragments().forEach(function (f) { overrides[f.path] = f.text })
    var opts = { overrides: overrides }
    if (onlyInLens()) {
      var only = []
      cy.nodes().forEach(function (n) { if (n.data('fragment') && Classify.matches(n.id())) only.push(n.data('fragment')) })
      opts.only = only
    }
    var my = ++seq
    var r = await api().textSearch(q, opts)
    if (my !== seq) return                       // a newer search has started
    last = r && r.files ? r : { files: [], total: 0 }
    render()
  }

  function schedule(ms) { clearTimeout(timer); timer = setTimeout(run, ms == null ? 250 : ms) }

  function typeColor(n) { var t = n && typeof catById === 'function' ? catById(n.data('type')) : null; return t ? t.color : '#999' }

  function selectedNode() { return window.selEle && selEle.isNode && selEle.isNode() ? selEle : null }

  function render() {
    var box = $('sResults')
    if (!box || !last) return
    var nodes = nodeByPath(), sel = selectedNode()
    var count = last.files.length
    var head = '<div class="crs">' + esc(L('searchCount').replace('%n', last.total).replace('%t', count)) +
      (last.truncated ? ' · ' + esc(L('searchMore')) : '') + '</div>'
    if (!count) { box.innerHTML = head + '<div class="cnone">' + esc(L('searchNone')) + '</div>'; return }
    // texts that belong to a node first (they can be opened); order by matches within each group
    var files = last.files.filter(function (f) { return nodes[f.path] }).concat(last.files.filter(function (f) { return !nodes[f.path] }))
    box.innerHTML = head + files.map(function (f) {
      var n = nodes[f.path], label = n ? n.data('label') : f.path
      var link = ''
      if (n && sel && sel.id() !== n.id()) {
        link = sel.edgesWith(n).length
          ? '<span class="slinked" title="' + esc(L('searchLinkedTip').replace('%s', sel.data('label'))) + '">' + esc(L('searchLinked')) + '</span>'
          : '<button class="slink" data-act="link" title="' + esc(L('searchLinkTip').replace('%s', sel.data('label'))) + '">' + esc(L('searchLink')) + '</button>'
      }
      return '<div class="sfile' + (n ? '' : ' snonode') + '" data-path="' + esc(f.path) + '"' + (n ? '' : ' title="' + esc(L('searchNoNode')) + '"') + '>' +
        '<div class="sfh"><span class="cdot" style="background:' + esc(typeColor(n)) + '"></span><span class="sname">' + esc(label) + '</span>' +
        '<span class="ccount">' + f.count + '</span>' + link + '</div>' +
        f.hits.map(function (h) {
          return '<div class="shit" data-line="' + h.line + '" data-col="' + h.col + '" data-len="' + h.len + '"><span class="sline">' + h.line + '</span>' +
            '<span class="stext">' + esc(h.before) + '<mark>' + esc(h.match) + '</mark>' + esc(h.after) + '</span></div>'
        }).join('') + '</div>'
    }).join('')
  }

  async function openHit(el) {
    var file = el.closest('.sfile'), n = nodeByPath()[file.dataset.path]
    if (!n) return
    selNode(n)
    await Writer.openForNode(n, { focus: true })
    Writer.reveal(+el.dataset.line, +el.dataset.col, +el.dataset.len)
  }

  function link(file) {
    var n = nodeByPath()[file.dataset.path], sel = selectedNode()
    if (!n || !sel || sel.id() === n.id() || sel.edgesWith(n).length) return
    cy.add({ data: { id: ProjectFormat.newId('e'), source: sel.id(), target: n.id(), weight: 3, edgeType: '', note: '' } })
    snapshot()
    render()
  }

  // Ctrl+Shift+H: open the pane and put the cursor in the box (with the editor's selection, if any).
  function open() {
    var m = $('main')
    if (!(m.classList.contains('binding') && m.classList.contains('classing')) && window.Classify) Classify.toggle()
    var input = $('sQuery'), picked = window.Writer && Writer.selectionText ? Writer.selectionText() : ''
    if (picked && picked.length < 80 && picked.indexOf('\n') < 0) input.value = picked
    input.focus(); input.select()
    schedule(0)
  }

  // The editor changed: refresh results (slowly) if a search is on.
  function textChanged() { if (active()) schedule(900) }

  function init() {
    if (bound || !$('sQuery')) return
    bound = true
    var input = $('sQuery')
    input.addEventListener('input', function () { schedule() })
    input.addEventListener('keydown', function (e) {
      e.stopPropagation()
      if (e.key === 'Escape') { input.value = ''; schedule(0) }
      if (e.key === 'Enter') { var first = document.querySelector('#sResults .sfile:not(.snonode) .shit'); if (first) openHit(first) }
    })
    $('sInLens').addEventListener('change', function () { schedule(0) })
    $('sResults').addEventListener('click', function (e) {
      if (e.target.closest('[data-act="link"]')) { link(e.target.closest('.sfile')); return }
      var h = e.target.closest('.shit'); if (h) openHit(h)
    })
    if (window.cy) {
      cy.on('select unselect', 'node', function () { if (last) render() })
    }
  }

  // The filter changed: limit or widen the results.
  function lensChanged() { if (active()) schedule(0) }

  return { init: init, open: open, run: run, textChanged: textChanged, lensChanged: lensChanged, active: active }
})()
