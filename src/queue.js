// queue.js — the work queue (left pane) and the chapter brief (a page per text).
//
// Queue: open questions, open tasks, claims still to settle (Taslak / Tartışmalı) and
// claims or questions whose passage has disappeared from the text. Grouped by chapter in
// book-plan order; with a category or tag filter on, only matching items are listed.
// Brief: everything the map knows about one text — claims by status with what supports or
// contradicts them, questions, tasks, connected concepts and people, figures, categories.
/* global cy, L, snapshot, selNode, catById, curLang, Writer, Binder, Classify, Argue, focusNeighborhood */
var Work = (function () {
  'use strict'

  var bound = false, timer = null, kinds = { question: true, task: true, claim: true }, showDone = false
  var texts = {}                    // path -> text (for the "passage missing" check), refreshed on render

  function $(id) { return document.getElementById(id) }
  function api() { return window.mentegraf }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }
  function node(id) { var n = window.cy ? cy.getElementById(id) : null; return n && n.length ? n : null }
  function split(p) { return Argue._split(p) }
  function ownerOf(path) { var o = null; if (path) cy.nodes().forEach(function (n) { if (!o && n.data('fragment') === path) o = n }); return o }
  function typeColor(n) { var t = n && typeof catById === 'function' ? catById(n.data('type')) : null; return t ? t.color : '#999' }
  function lensOk(n) { return !window.Classify || !Classify.active() || Classify.matches(n.id()) }

  // ───────── pane ─────────

  function paneOpen() { var m = $('main'); return m.classList.contains('binding') && m.classList.contains('queueing') }

  function toggle() {
    var m = $('main')
    if (paneOpen()) { m.classList.remove('binding', 'queueing'); remember(false) } else { m.classList.remove('classing'); m.classList.add('binding', 'queueing'); remember(true); refresh() }
    syncButtons()
    setTimeout(function () { if (window.cy) cy.resize() }, 30)
  }
  function leave() { $('main').classList.remove('queueing'); remember(false) }
  function remember(on) {
    try { localStorage.setItem('mentegraf-queue', on ? '1' : '0'); if (on) { localStorage.setItem('mentegraf-binder', '0'); localStorage.setItem('mentegraf-classes', '0') } } catch (e) { /* ignore */ }
  }
  function syncButtons() {
    var m = $('main'), b = $('b_queue'), pane = m.classList.contains('binding')
    if (b) b.classList.toggle('on', paneOpen())
    if ($('b_binder')) $('b_binder').classList.toggle('on', pane && !m.classList.contains('classing') && !m.classList.contains('queueing'))
    if ($('b_classes')) $('b_classes').classList.toggle('on', pane && m.classList.contains('classing'))
  }

  // Book-plan order of nodes (chapters first, in the order of the plan).
  function planOrder() {
    var order = {}, i = 0
    var walk = function (list) { (list || []).forEach(function (it) { if (it.kind === 'node') order[it.node] = i++; walk(it.children) }) }
    if (window.Binder) walk(Binder.get().items)
    return order
  }

  // Load the texts that passages point to (open editor texts win).
  async function loadTexts(paths) {
    var out = {}
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i], t = Writer.textFor ? Writer.textFor(p) : null
      if (t == null && api() && api().fragmentRead) { try { var r = await api().fragmentRead(p); t = r && r.exists ? r.text : null } catch (e) { t = null } }
      out[p] = t
    }
    return out
  }
  function passageAlive(passage) {
    var p = split(passage)
    if (!p) return true
    var t = texts[p.path]
    return t != null && new RegExp('\\s\\^' + p.id + '\\s*$', 'm').test(t)
  }

  // Everything to do, as items: { kind, group (node), node, task?, text, status, missing, passage }
  function collect() {
    var items = []
    cy.nodes().forEach(function (n) {
      if (Argue.isArg(n)) {
        var st = Argue.statusOf(n), p = split(n.data('passage'))
        var group = (p && ownerOf(p.path)) || n.connectedEdges().connectedNodes().filter(function (x) { return x.data('fragment') && x.id() !== n.id() })[0] || null
        var missing = !!(p && !passageAlive(n.data('passage')))
        var open = n.data('type') === 'question' ? st === 'open' : (st === 'draft' || st === 'contested')
        if (open || missing || showDone) items.push({ kind: n.data('type'), node: n, group: group, text: n.data('label'), status: st, missing: missing, passage: n.data('passage'), done: !open && !missing })
      }
      Argue.tasksOf(n).forEach(function (t) {
        if (t.done && !showDone) return
        var p = split(t.passage)
        items.push({ kind: 'task', node: n, task: t, group: (p && ownerOf(p.path)) || (n.data('fragment') ? n : null), text: t.text, passage: t.passage, done: t.done, missing: false })
      })
    })
    return items.filter(function (it) { return kinds[it.kind] && (lensOk(it.node) || (it.group && lensOk(it.group))) })
  }

  async function refresh() {
    if (!paneOpen() || !window.cy) return
    var paths = {}
    cy.nodes().forEach(function (n) { if (Argue.isArg(n)) { var p = split(n.data('passage')); if (p) paths[p.path] = true } })
    texts = await loadTexts(Object.keys(paths))
    render()
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(refresh, 250) }

  function render() {
    var box = $('qList')
    if (!box || !window.cy) return
    var items = collect(), order = planOrder(), groups = {}, keys = []
    items.forEach(function (it) { var k = it.group ? it.group.id() : ''; if (!groups[k]) { groups[k] = []; keys.push(k) } groups[k].push(it) })
    keys.sort(function (a, b) {
      if (!a) return 1; if (!b) return -1
      var oa = order[a] != null ? order[a] : 1e6, ob = order[b] != null ? order[b] : 1e6
      return oa - ob || String(node(a).data('label')).localeCompare(String(node(b).data('label')), 'tr')
    })
    var counts = { question: 0, task: 0, claim: 0, missing: 0 }
    items.forEach(function (it) { if (!it.done) counts[it.kind]++; if (it.missing) counts.missing++ })
    $('qSum').textContent = L('queueSum').replace('%q', counts.question).replace('%t', counts.task).replace('%c', counts.claim) +
      (counts.missing ? ' · ' + L('queueMissing').replace('%n', counts.missing) : '') +
      (window.Classify && Classify.active() ? ' · ' + L('queueFiltered') : '')
    if (!items.length) { box.innerHTML = '<div class="cnone">' + esc(L('queueEmpty')) + '</div>'; return }
    var RANK = { contested: 0, open: 1, draft: 2, supported: 3, thesis: 3, answered: 4, beyond: 4, dropped: 5 }
    box.innerHTML = keys.map(function (k) {
      var g = k ? node(k) : null
      var list = groups[k].sort(function (a, b) {
        return (b.missing - a.missing) || (a.done - b.done) || ({ question: 0, task: 1, claim: 2 }[a.kind] - { question: 0, task: 1, claim: 2 }[b.kind]) || ((RANK[a.status] || 0) - (RANK[b.status] || 0))
      })
      return '<div class="qgroup"><div class="qgh"' + (g ? ' data-node="' + esc(g.id()) + '"' : '') + '><span class="cdot" style="background:' + esc(g ? typeColor(g) : '#bbb') + '"></span>' +
        '<span class="qgname">' + esc(g ? g.data('label') : L('queueOther')) + '</span>' +
        (g && g.data('fragment') ? '<button class="qbrief" data-act="brief" title="' + esc(L('briefTitle')) + '">' + esc(L('briefBtn')) + '</button>' : '') + '</div>' +
        list.map(function (it) {
          var icon = it.kind === 'task' ? '<input type="checkbox"' + (it.done ? ' checked' : '') + '>' : '<span class="qicon q-' + it.kind + '">' + (it.kind === 'claim' ? '◆' : '?') + '</span>'
          var badge = it.missing ? '<span class="qbad">' + esc(L('queueGone')) + '</span>'
            : it.kind === 'claim' ? '<span class="qst" style="color:' + Argue.STATUS_COLOR[it.status] + '">' + esc(L('as_' + it.status)) + '</span>'
              : it.kind === 'question' && it.done ? '<span class="qst">' + esc(L('as_' + it.status)) + '</span>' : ''
          var where = it.kind === 'task' && it.node !== it.group ? '<span class="qwhere">' + esc(it.node.data('label')) + '</span>' : ''
          return '<div class="qitem' + (it.done ? ' done' : '') + '" data-kind="' + it.kind + '" data-node="' + esc(it.node.id()) + '"' + (it.task ? ' data-task="' + esc(it.task.id) + '"' : '') + (it.passage ? ' data-passage="' + esc(it.passage) + '"' : '') + '>' +
            icon + '<span class="qtext">' + esc(it.text) + where + '</span>' + badge + '</div>'
        }).join('') + '</div>'
    }).join('')
  }

  async function openItem(el) {
    var n = node(el.dataset.node)
    if (!n) return
    if (el.dataset.kind !== 'task') selNode(n)
    if (el.dataset.passage && await Argue.goToPassage(el.dataset.passage)) return
    if (el.dataset.kind === 'task') { selNode(n); if (n.data('fragment')) Writer.openForNode(n, { focus: false }) }
    if (typeof focusNeighborhood === 'function') focusNeighborhood(n)
  }

  function bindPane() {
    $('qList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act="brief"]')
      if (b) { openBrief(node(b.closest('.qgh').dataset.node)); return }
      var head = e.target.closest('.qgh[data-node]')
      if (head) { var g = node(head.dataset.node); selNode(g); if (typeof focusNeighborhood === 'function') focusNeighborhood(g); return }
      var it = e.target.closest('.qitem'); if (!it) return
      if (e.target.matches('input[type=checkbox]')) { Argue.changeTask(node(it.dataset.node), it.dataset.task, { done: e.target.checked }); schedule(); return }
      openItem(it)
    })
    $('qKinds').addEventListener('click', function (e) {
      var b = e.target.closest('[data-kind]'); if (!b) return
      kinds[b.dataset.kind] = !kinds[b.dataset.kind]
      if (!kinds.question && !kinds.task && !kinds.claim) kinds[b.dataset.kind] = true    // never all off
      syncKinds(); render()
    })
    $('qDone').addEventListener('change', function () { showDone = this.checked; render() })
  }
  function syncKinds() { Array.prototype.forEach.call(document.querySelectorAll('#qKinds [data-kind]'), function (b) { b.classList.toggle('on', !!kinds[b.dataset.kind]) }) }

  // ───────── chapter brief ─────────

  function briefNodes(n) {
    var path = n.data('fragment'), args = [], seen = {}
    cy.nodes().forEach(function (x) { if (Argue.isArg(x)) { var p = split(x.data('passage')); if (p && p.path === path) { args.push(x); seen[x.id()] = true } } })
    n.neighborhood().nodes().forEach(function (x) { if (Argue.isArg(x) && !seen[x.id()]) { args.push(x); seen[x.id()] = true } })
    return args
  }

  function relations(c) {
    var out = { supports: [], contradicts: [], source: [], answers: [] }
    c.connectedEdges().forEach(function (e) {
      var t = e.data('edgeType')
      if (out[t]) out[t].push(e.source().id() === c.id() ? e.target() : e.source())
    })
    return out
  }

  // The brief as Markdown (shown in the dialog and copied with one click).
  function briefMarkdown(n) {
    var lines = ['# ' + n.data('label'), '']
    var meta = []
    if (n.data('status')) meta.push(L('statusLabel') + ': ' + L('st_' + n.data('status')))
    if (n.data('wordTarget')) meta.push(L('targetLabel') + ': ' + n.data('wordTarget'))
    var cats = (n.data('cats') || []).map(function (id) { return window.Classify ? Classify.path(id) : id }).filter(Boolean)
    if (cats.length) meta.push(L('catsTitle') + ': ' + cats.join(', '))
    if (meta.length) lines.push('_' + meta.join(' · ') + '_', '')
    if (n.data('description')) lines.push(n.data('description'), '')
    var args = briefNodes(n), claims = args.filter(function (x) { return x.data('type') === 'claim' }), qs = args.filter(function (x) { return x.data('type') === 'question' })
    lines.push('## ' + L('briefClaims') + ' (' + claims.length + ')', '')
    if (!claims.length) lines.push(L('briefNone'), '')
    Argue.STATUS.claim.forEach(function (st) {
      var list = claims.filter(function (c) { return Argue.statusOf(c) === st })
      if (!list.length) return
      lines.push('**' + L('as_' + st) + '**', '')
      list.forEach(function (c) {
        lines.push('- ' + c.data('label') + (c.data('passage') && texts[split(c.data('passage')).path] !== undefined && !passageAlive(c.data('passage')) ? ' _(' + L('queueGone') + ')_' : ''))
        var r = relations(c)
        if (r.supports.length) lines.push('  - ✓ ' + r.supports.map(function (x) { return x.data('label') }).join('; '))
        if (r.contradicts.length) lines.push('  - ✕ ' + r.contradicts.map(function (x) { return x.data('label') }).join('; '))
        if (r.source.length) lines.push('  - ❝ ' + r.source.map(function (x) { return x.data('label') }).join('; '))
      })
      lines.push('')
    })
    lines.push('## ' + L('briefQuestions') + ' (' + qs.length + ')', '')
    if (!qs.length) lines.push(L('briefNone'), '')
    qs.forEach(function (q) {
      var st = Argue.statusOf(q)
      lines.push('- ' + q.data('label') + (st === 'open' ? '' : ' _(' + L('as_' + st) + ')_'))
      relations(q).answers.forEach(function (a) { lines.push('  - ↳ ' + a.data('label')) })
    })
    if (qs.length) lines.push('')
    var tasks = Argue.tasksOf(n).map(function (t) { return t }).concat([].concat.apply([], args.map(function (a) { return Argue.tasksOf(a) })))
    lines.push('## ' + L('tasksLabel') + ' (' + tasks.filter(function (t) { return !t.done }).length + ')', '')
    if (!tasks.length) lines.push(L('briefNone'), '')
    tasks.forEach(function (t) { lines.push('- [' + (t.done ? 'x' : ' ') + '] ' + t.text) })
    if (tasks.length) lines.push('')
    var near = n.neighborhood().nodes().filter(function (x) { return !Argue.isArg(x) })
    var byType = {}
    near.forEach(function (x) { var t = x.data('type') || ''; (byType[t] = byType[t] || []).push(x.data('label')) })
    var types = Object.keys(byType)
    if (types.length) {
      lines.push('## ' + L('briefLinked'), '')
      types.forEach(function (t) {
        var c = typeof catById === 'function' ? catById(t) : null
        var name = c ? (curLang === 'en' ? c.en : c.tr) : t
        lines.push('- **' + name + ':** ' + byType[t].sort(function (a, b) { return a.localeCompare(b, 'tr') }).join(', '))
      })
      lines.push('')
    }
    return lines.join('\n')
  }

  function openBrief(n) {
    if (!n) return
    var md = briefMarkdown(n)
    var ov = $('briefModal')
    $('briefBody').innerHTML = window.MD ? window.MD().render(md) : '<pre>' + esc(md) + '</pre>'
    ov._md = md
    ov.style.display = 'flex'
  }
  function closeBrief() { $('briefModal').style.display = 'none' }
  function copyBrief() {
    var md = $('briefModal')._md || ''
    try { navigator.clipboard.writeText(md) } catch (e) { /* ignore */ }
    var b = $('briefCopy'); b.textContent = L('briefCopied'); setTimeout(function () { b.textContent = L('briefCopy') }, 1500)
  }

  function updatePanel(n) {
    var b = $('nBriefBtn')
    if (b) b.style.display = n && n.isNode && n.isNode() && n.data('fragment') ? '' : 'none'
  }

  function init() {
    if (bound || !window.cy) return
    bound = true
    bindPane()
    syncKinds()
    $('briefModal').addEventListener('click', function (e) { if (e.target === this) closeBrief() })
    cy.on('data add remove', 'node', function () { if (paneOpen()) schedule() })
    var open = null
    try { open = localStorage.getItem('mentegraf-queue') } catch (e) { /* ignore */ }
    if (open === '1') toggle()
    syncButtons()
  }

  return {
    init: init, toggle: toggle, leave: leave, refresh: refresh, render: render, syncButtons: syncButtons, schedule: schedule,
    openBrief: openBrief, closeBrief: closeBrief, copyBrief: copyBrief, briefMarkdown: briefMarkdown, updatePanel: updatePanel,
    _collect: collect
  }
})()
