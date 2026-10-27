// argue.js — the argument layer: claims, questions and tasks tied to passages.
//
// Claims (İddia) and questions (Soru) are graph nodes. Each remembers the passage it was
// captured from as data.passage = 'manuscript/x.md#abc123' (the ^abc123 marker at the end
// of that paragraph). Tasks are not nodes: they live on the node whose text they belong to,
// data.tasks = [{ id, text, done, passage, created }], and are listed in the work queue.
//
// Capture: select words in the editor (or just put the cursor in a paragraph) and press
// Ctrl+Shift+K (claim), Ctrl+Shift+U (question) or Ctrl+Shift+T (task).
/* global cy, L, snapshot, selNode, mkNode, catById, categories, connTypes, curLang, Writer, ProjectFormat, focusNeighborhood */
var Argue = (function () {
  'use strict'

  var TYPES = [
    { id: 'claim', tr: 'İddia', en: 'Claim', color: '#c0683f', svgPath: 'M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm7 3v6h2V6h-2zm0 8v2h2v-2h-2z' },
    { id: 'question', tr: 'Soru', en: 'Question', color: '#7a68b3', svgPath: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 15v2h2v-2h-2zm1-11a4 4 0 0 0-4 4h2a2 2 0 1 1 3 1.7c-1.2.7-2 1.6-2 3.3h2c0-1 .4-1.4 1.3-2A4 4 0 0 0 12 6z' }
  ]
  var CONN = [
    { id: 'supports', tr: 'Destekliyor', en: 'Supports', color: '#5b9a68', marker: '✓', style: 'solid' },
    { id: 'contradicts', tr: 'Çelişiyor', en: 'Contradicts', color: '#d46a6a', marker: '✕', style: 'dashed' },
    { id: 'source', tr: 'Kaynak', en: 'Source', color: '#8a8f98', marker: '❝', style: 'dotted' },
    { id: 'answers', tr: 'Yanıtlıyor', en: 'Answers', color: '#7a68b3', marker: '↳', style: 'solid' }
  ]
  // Tez: the author's own proposal (argued, not sourced) — not a to-do.
  // Kitabın ötesinde: a question deliberately left open (out of this book's scope) — not a to-do.
  var STATUS = { claim: ['draft', 'supported', 'thesis', 'contested', 'dropped'], question: ['open', 'answered', 'beyond'] }
  var DEFAULT = { claim: 'draft', question: 'open' }
  var STATUS_COLOR = { draft: '#9a9488', supported: '#4f8f5e', contested: '#c08a3e', dropped: '#b0aaa0', open: '#7a68b3', answered: '#4f8f5e', thesis: '#3f7fa8', beyond: '#9a8fb8' }

  var version = 0, bound = false, versionTimer = null

  function $(id) { return document.getElementById(id) }
  function api() { return window.mentegraf }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }
  function newId(p) { return window.ProjectFormat ? ProjectFormat.newId(p) : p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

  // ───────── types ─────────

  // Projects made before Stage 5 get İddia/Soru and the argument link types.
  function ensureTypes() {
    if (window.categories && typeof catById === 'function') TYPES.forEach(function (t) { if (!catById(t.id)) categories.push(JSON.parse(JSON.stringify(t))) })
    if (Array.isArray(window.connTypes)) CONN.forEach(function (c) { if (!connTypes.some(function (x) { return x.id === c.id })) connTypes.push(JSON.parse(JSON.stringify(c))) })
  }

  function isArg(n) { return !!(n && n.length && n.isNode && n.isNode() && STATUS[n.data('type')]) }
  function statusOf(n) { var s = n.data('argStatus'); return STATUS[n.data('type')] && STATUS[n.data('type')].indexOf(s) >= 0 ? s : DEFAULT[n.data('type')] }

  function splitPassage(p) { var m = /^(.+\.md)#([a-z0-9]{4,12})$/i.exec(String(p || '')); return m ? { path: m[1], id: m[2] } : null }
  function ownerOf(path) { var o = null; cy.nodes().forEach(function (n) { if (!o && n.data('fragment') === path) o = n }); return o }

  function bump() { clearTimeout(versionTimer); versionTimer = setTimeout(function () { version++; if (window.Writer && Writer.refreshArgs) Writer.refreshArgs() }, 30) }

  // ───────── capture from the editor ─────────

  function closePop() { var p = $('argPop'); if (p) p.remove() }

  // kind: 'claim' | 'question' | 'task'
  function capture(kind) {
    var cur = Writer.current && Writer.current()
    if (!cur) return false
    var host = cy.getElementById(cur.nodeId)
    if (!host.length) return false
    var text = Writer.selectionText() || Writer.paragraphText()
    closePop()
    var box = document.createElement('div')
    box.id = 'argPop'
    box.className = 'argpop'
    box.innerHTML = '<div class="aptitle">' + esc(L(kind === 'claim' ? 'newClaim' : kind === 'question' ? 'newQuestion' : 'newTask')) + '</div>' +
      '<textarea class="aptext" rows="3"></textarea>' +
      '<div class="apbar"><span class="aphint">' + esc(L('argPopHint')) + '</span><button class="bt" data-act="cancel">' + esc(L('cancelLabel')) + '</button><button class="bt bp" data-act="save">' + esc(L('saveLabel')) + '</button></div>'
    $('writer').appendChild(box)
    var at = Writer.cursorCoords ? Writer.cursorCoords() : null, w = $('writer').getBoundingClientRect()
    box.style.top = Math.max(90, Math.min((at ? at.bottom - w.top + 8 : 120), w.height - box.offsetHeight - 40)) + 'px'
    var ta = box.querySelector('textarea')
    ta.value = text
    ta.focus(); ta.select()
    function save() {
      var t = ta.value.replace(/\s+/g, ' ').trim()
      if (!t) { ta.focus(); return }
      closePop()
      var pid = Writer.ensurePassage()
      var passage = pid ? cur.path + '#' + pid : null
      if (kind === 'task') { addTask(host, t, passage); Writer.focus() }
      else createArg(kind, t, host, passage)
    }
    ta.addEventListener('keydown', function (e) {
      e.stopPropagation()
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() }
      if (e.key === 'Escape') { closePop(); Writer.focus() }
    })
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return
      if (b.dataset.act === 'save') save(); else { closePop(); Writer.focus() }
    })
    return true
  }

  function createArg(kind, text, host, passage) {
    var p = host.position(), ang = Math.random() * Math.PI * 2
    var n = mkNode(p.x + Math.cos(ang) * 130, p.y + Math.sin(ang) * 130)
    var t = catById(kind)
    n.data({ label: text, type: kind, color: t ? t.color : '#888', argStatus: DEFAULT[kind] })
    if (passage) n.data('passage', passage)
    cy.add({ data: { id: newId('e'), source: host.id(), target: n.id(), weight: 3, edgeType: 'contains', note: '' } })
    snapshot()
    bump()
    Writer.flash(L(kind === 'claim' ? 'claimAdded' : 'questionAdded'))
    Writer.focus()
    return n
  }

  // ───────── tasks ─────────

  function tasksOf(n) { var t = n.data('tasks'); return Array.isArray(t) ? t : [] }

  function addTask(n, text, passage) {
    var list = tasksOf(n).concat([{ id: newId('t'), text: text, done: false, passage: passage || null, created: today() }])
    n.data('tasks', list)
    snapshot()
    bump()
    if (window.Writer && Writer.flash) Writer.flash(L('taskAdded'))
    if (window.selEle && selEle.id && selEle.id() === n.id()) updatePanel(n)
  }

  function changeTask(n, id, patch) {
    var list = tasksOf(n).map(function (t) { return t.id === id ? Object.assign({}, t, patch) : t })
    if (patch === null) list = tasksOf(n).filter(function (t) { return t.id !== id })
    if (list.length) n.data('tasks', list); else n.removeData('tasks')
    snapshot()
    bump()
    updatePanel(n)
  }

  // ───────── passages ─────────

  // For the open text: { passageId: { claims: [labels], questions: [labels], tasks: [texts] } }
  function passageInfo(path) {
    var out = {}
    if (!window.cy || !path) return out
    function slot(id) { return out[id] || (out[id] = { claims: [], questions: [], tasks: [] }) }
    cy.nodes().forEach(function (n) {
      var p = splitPassage(n.data('passage'))
      if (p && p.path === path && isArg(n)) slot(p.id)[n.data('type') === 'claim' ? 'claims' : 'questions'].push(n.data('label'))
      tasksOf(n).forEach(function (t) { var q = splitPassage(t.passage); if (q && q.path === path && !t.done) slot(q.id).tasks.push(t.text) })
    })
    return out
  }

  // Open the text and select the paragraph.
  async function goToPassage(passage) {
    var p = splitPassage(passage)
    if (!p) return false
    var owner = ownerOf(p.path)
    if (!owner) { alert(L('passageNoText')); return false }
    await Writer.openForNode(owner, { focus: true })
    if (!Writer.revealPassage(p.id)) { Writer.flash(L('passageMissing')); return false }
    return true
  }

  // A click on the marker in the text: select the first claim/question of that passage.
  function onBadge(path, id) {
    var hit = null
    cy.nodes().forEach(function (n) { if (!hit && isArg(n) && n.data('passage') === path + '#' + id) hit = n })
    if (!hit) { var o = ownerOf(path); if (o) hit = o }
    if (!hit) return
    selNode(hit)
    if (typeof focusNeighborhood === 'function') focusNeighborhood(hit)
  }

  // Does the passage still exist? (it may have been deleted or rewritten)
  async function passageExists(passage) {
    var p = splitPassage(passage)
    if (!p) return false
    var text = Writer.textFor ? Writer.textFor(p.path) : null
    if (text == null && api() && api().fragmentRead) { var r = await api().fragmentRead(p.path); text = r && r.exists ? r.text : null }
    return text != null && new RegExp('\\s\\^' + p.id + '\\s*$', 'm').test(text)
  }

  // ───────── node panel ─────────

  // The node that owns a text (its chapter or section), for the brief.
  function ownerOfPath(path) { var o = null; if (path && window.cy) cy.nodes().forEach(function (x) { if (!o && x.data('fragment') === path) o = x }); return o }

  function updatePanel(n) {
    var fld = $('nArgFld'), tfld = $('nTasksFld')
    if (!fld || !tfld) return
    var node = n && n.length && n.isNode && n.isNode() ? n : null
    var arg = isArg(node)
    fld.style.display = arg ? '' : 'none'
    var stRow = $('nStatus') ? $('nStatus').closest('.fld') : null
    if (stRow) stRow.style.display = arg ? 'none' : ''           // chapter status/target: not for claims
    tfld.style.display = node ? '' : 'none'
    if (!node) return
    if (arg) {
      var sel = $('nArgStatus'), kind = node.data('type')
      sel.innerHTML = STATUS[kind].map(function (s) { return '<option value="' + s + '">' + esc(L('as_' + s)) + '</option>' }).join('')
      sel.value = statusOf(node)
      sel.style.borderLeft = '4px solid ' + STATUS_COLOR[statusOf(node)]
      var p = splitPassage(node.data('passage')), box = $('nArgPassage')
      if (!p) box.innerHTML = '<span class="apnone">' + esc(L('passageNone')) + '</span>'
      else {
        box.innerHTML = '<button class="bt" data-act="goto">' + esc(L('passageGo')) + '</button><span class="appath" title="' + esc(node.data('passage')) + '">' + esc(p.path.split('/').pop()) + ' ^' + esc(p.id) + '</span><span class="apwarn" style="display:none">' + esc(L('passageMissing')) + '</span>' +
          (ownerOfPath(p.path) ? '<button class="bt" data-act="brief" title="' + esc(L('briefTitle')) + '">' + esc(L('briefBtn')) + '</button>' : '')
        var want = node.id()
        passageExists(node.data('passage')).then(function (ok) {
          if (window.selEle && selEle.id && selEle.id() === want) { var w = box.querySelector('.apwarn'); if (w) w.style.display = ok ? 'none' : '' }
        })
      }
    }
    var tasks = tasksOf(node)
    $('nTasks').innerHTML = tasks.map(function (t) {
      return '<div class="ntask' + (t.done ? ' done' : '') + '" data-id="' + esc(t.id) + '"><input type="checkbox"' + (t.done ? ' checked' : '') + '>' +
        '<span class="nttext"' + (t.passage ? ' data-passage="' + esc(t.passage) + '" title="' + esc(L('passageGo')) + '"' : '') + '>' + esc(t.text) + '</span>' +
        '<button class="ntrm" title="' + esc(L('deleteLabel')) + '">✕</button></div>'
    }).join('')
  }

  function bindPanel() {
    var sel = $('nArgStatus')
    if (!sel) return
    sel.addEventListener('change', function () {
      if (!isArg(window.selEle)) return
      selEle.data('argStatus', sel.value); snapshot(); updatePanel(selEle)
    })
    $('nArgPassage').addEventListener('click', function (e) {
      if (e.target.closest('[data-act="goto"]') && isArg(window.selEle)) goToPassage(selEle.data('passage'))
      if (e.target.closest('[data-act="brief"]') && isArg(window.selEle) && window.Work) { var bp = splitPassage(selEle.data('passage')), o = bp && ownerOfPath(bp.path); if (o) Work.openBrief(o) }
    })
    $('nTasks').addEventListener('click', function (e) {
      var row = e.target.closest('.ntask'); if (!row || !window.selEle) return
      if (e.target.matches('input[type=checkbox]')) changeTask(selEle, row.dataset.id, { done: e.target.checked })
      else if (e.target.closest('.ntrm')) changeTask(selEle, row.dataset.id, null)
      else if (e.target.closest('[data-passage]')) goToPassage(e.target.closest('[data-passage]').dataset.passage)
    })
    var input = $('nTaskInput')
    input.addEventListener('keydown', function (e) {
      e.stopPropagation()
      if (e.key !== 'Enter' || !window.selEle || !selEle.isNode || !selEle.isNode()) return
      e.preventDefault()
      var t = input.value.replace(/\s+/g, ' ').trim()
      if (!t) return
      input.value = ''
      addTask(selEle, t, null)
    })
  }

  // ───────── toolbar menu ─────────

  function closeMenu() { var m = $('argMenu'); if (m) m.remove() }
  function menu(btn) {
    if ($('argMenu')) { closeMenu(); return }
    var m = document.createElement('div')
    m.id = 'argMenu'
    m.className = 'bmenu argmenu'
    m.innerHTML = [['claim', 'Ctrl+Shift+K'], ['question', 'Ctrl+Shift+U'], ['task', 'Ctrl+Shift+T']].map(function (x) {
      return '<button data-kind="' + x[0] + '"><span>' + esc(L(x[0] === 'claim' ? 'newClaim' : x[0] === 'question' ? 'newQuestion' : 'newTask')) + '</span><kbd>' + x[1] + '</kbd></button>'
    }).join('')
    $('writer').appendChild(m)
    var r = btn.getBoundingClientRect(), w = $('writer').getBoundingClientRect()
    m.style.top = (r.bottom - w.top + 4) + 'px'
    m.style.left = Math.max(8, Math.min(r.left - w.left, w.width - m.offsetWidth - 8)) + 'px'
    m.addEventListener('mousedown', function (e) { e.preventDefault() })      // keep the editor selection
    m.addEventListener('click', function (e) { var b = e.target.closest('[data-kind]'); if (b) { closeMenu(); capture(b.dataset.kind) } })
    document.addEventListener('mousedown', function away(e) {
      if (!e.target.closest('#argMenu') && !e.target.closest('button[data-cmd="argue"]')) { closeMenu(); document.removeEventListener('mousedown', away, true) }
    }, true)
  }

  function init() {
    if (bound) return
    bound = true
    ensureTypes()
    bindPanel()
    if (window.cy) {
      cy.on('data', 'node', bump)
      cy.on('add remove', 'node', bump)
    }
  }

  return {
    init: init, ensureTypes: ensureTypes, capture: capture, menu: menu, closePop: closePop,
    passageInfo: passageInfo, version: function () { return version }, onBadge: onBadge, goToPassage: goToPassage,
    updatePanel: updatePanel, addTask: addTask, changeTask: changeTask, tasksOf: tasksOf, isArg: isArg, statusOf: statusOf,
    STATUS: STATUS, STATUS_COLOR: STATUS_COLOR, _passageExists: passageExists, _split: splitPassage
  }
})()
