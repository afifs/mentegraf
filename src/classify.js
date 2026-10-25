// classify.js — the author's own classification: a category tree and tags.
//
// Categories form a tree of any depth (Sibernetik › Geri besleme › Homeostaz).
// A node lists its categories in data.cats (ids); its text belongs to the same
// categories. Tags are the node's flat data.tags list.
//
// Choosing a category or a tag turns on a "lens": the map fades everything
// else, the book plan dims other items, the pane lists the matching nodes,
// and the open text highlights lines that mention them.
//
// Stored in the project as "classification" (graph/categories.json):
//   { categories: [ { id, name, parent } ] }   (parent null = top level; order = array order)
/* global cy, L, snapshot, selNode, curLang, Writer, Binder, ProjectFormat, focusNeighborhood, catById */
var Classify = (function () {
  'use strict'

  var data = { categories: [] }
  var lens = null                  // { kind: 'cat', id } | { kind: 'tag', name } | null
  var hits = null                  // node id -> true, while a lens is on
  var version = 0                  // bumped whenever the lens result changes (the editor checks it)
  var expanded = {}                // category id -> true/false (default: top level open, deeper closed)
  var focusId = null, dragId = null, bound = false, lensTimer = null

  function $(id) { return document.getElementById(id) }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }
  function lower(s) { return String(s || '').toLocaleLowerCase(curLang === 'en' ? 'en' : 'tr') }
  function newId() { return window.ProjectFormat ? ProjectFormat.newId('cat') : 'cat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }

  // ───────── tree ─────────

  function byId(id) { for (var i = 0; i < data.categories.length; i++) if (data.categories[i].id === id) return data.categories[i]; return null }
  function children(id) { return data.categories.filter(function (c) { return (c.parent || null) === (id || null) }) }
  function isOpen(c, depth) { return expanded[c.id] != null ? expanded[c.id] : depth === 0 }

  // The category and everything below it.
  function subtree(id) {
    var out = {}, stack = [id]
    while (stack.length) { var x = stack.pop(); if (out[x]) continue; out[x] = true; children(x).forEach(function (c) { stack.push(c.id) }) }
    return out
  }

  function path(id) {
    var names = [], c = byId(id), guard = 0
    while (c && guard++ < 50) { names.unshift(c.name); c = c.parent ? byId(c.parent) : null }
    return names.join(' › ')
  }

  // Tree with broken parents or cycles repaired (such items go to the top level).
  function normalize(src) {
    var list = (src && Array.isArray(src.categories) ? src.categories : []).filter(function (c) { return c && c.id && typeof c.name === 'string' })
      .map(function (c) { return { id: String(c.id), name: c.name, parent: c.parent ? String(c.parent) : null } })
    var ids = {}; list.forEach(function (c) { ids[c.id] = c })
    list.forEach(function (c) {
      if (c.parent && !ids[c.parent]) c.parent = null
      var seen = {}, p = c.parent
      while (p) { if (p === c.id || seen[p]) { c.parent = null; break } seen[p] = true; p = ids[p] ? ids[p].parent : null }
    })
    return { categories: list }
  }

  function get() { return JSON.parse(JSON.stringify(data)) }

  function load(c) {
    data = normalize(c)
    if (lens && lens.kind === 'cat' && !byId(lens.id)) lens = null
    if (focusId && !byId(focusId)) focusId = null
    refresh()
  }

  function changed() { if (typeof snapshot === 'function') snapshot(); refresh() }

  // Nodes in a category (or below it).
  function nodesIn(id) {
    var set = subtree(id)
    return cy.nodes().filter(function (n) { return (n.data('cats') || []).some(function (c) { return set[c] }) })
  }

  function allTags() {
    var counts = {}
    if (!window.cy) return []
    cy.nodes().forEach(function (n) { (n.data('tags') || []).forEach(function (t) { t = String(t).trim(); if (t) counts[t] = (counts[t] || 0) + 1 }) })
    return Object.keys(counts).sort(function (a, b) { return a.localeCompare(b, 'tr') }).map(function (t) { return { name: t, count: counts[t] } })
  }

  // ───────── editing ─────────

  function add(parent, name) {
    var c = { id: newId(), name: name || L('newCatName'), parent: parent || null }
    data.categories.push(c)
    if (parent) expanded[parent] = true
    focusId = c.id
    changed()
    return c
  }

  function rename(id, name) {
    var c = byId(id); name = String(name || '').trim()
    if (!c || !name || c.name === name) return
    c.name = name
    changed()
  }

  // Remove a category: its children move up one level, nodes forget it.
  function remove(id) {
    var c = byId(id)
    if (!c) return false
    var used = nodesIn(id).filter(function (n) { return (n.data('cats') || []).indexOf(id) >= 0 }).length
    if (used && !window.confirm(L('catDeleteConfirm').replace('%s', c.name).replace('%n', used))) return false
    data.categories.forEach(function (x) { if (x.parent === id) x.parent = c.parent })
    data.categories = data.categories.filter(function (x) { return x.id !== id })
    cy.nodes().forEach(function (n) {
      var cs = n.data('cats')
      if (cs && cs.indexOf(id) >= 0) { cs = cs.filter(function (x) { return x !== id }); if (cs.length) n.data('cats', cs); else n.removeData('cats') }
    })
    if (lens && lens.kind === 'cat' && lens.id === id) lens = null
    if (focusId === id) focusId = null
    changed()
    return true
  }

  // Move id before/after/inside target (target null = end of the top level).
  function move(id, targetId, where) {
    var c = byId(id)
    if (!c || id === targetId) return false
    var t = targetId ? byId(targetId) : null
    if (t && subtree(id)[t.id]) return false                     // not into itself
    var list = data.categories.filter(function (x) { return x.id !== id })
    if (!t) { c.parent = null; list.push(c) } else if (where === 'inside') {
      c.parent = t.id; expanded[t.id] = true
      var last = -1; list.forEach(function (x, i) { if (x.parent === t.id) last = i })
      list.splice(last >= 0 ? last + 1 : list.indexOf(t) + 1, 0, c)
    } else {
      c.parent = t.parent || null
      list.splice(list.indexOf(t) + (where === 'after' ? 1 : 0), 0, c)
    }
    data.categories = list
    return true
  }

  function assign(n, id, on) {
    if (!n || !n.length || !byId(id)) return
    var cs = (n.data('cats') || []).filter(function (x) { return x !== id && byId(x) })
    if (on) cs.push(id)
    if (cs.length) n.data('cats', cs); else n.removeData('cats')
    changed()
    updatePanel(n)
  }

  // ───────── lens ─────────

  function setLens(l) {
    var same = l && lens && l.kind === lens.kind && (l.kind === 'cat' ? l.id === lens.id : l.name === lens.name)
    lens = same ? null : l
    applyLens()
    render()
  }

  function computeHits() {
    if (!lens || !window.cy) return null
    var out = {}
    if (lens.kind === 'cat') nodesIn(lens.id).forEach(function (n) { out[n.id()] = true })
    else cy.nodes().forEach(function (n) { if ((n.data('tags') || []).some(function (t) { return String(t).trim() === lens.name })) out[n.id()] = true })
    return out
  }

  function applyLens() {
    if (!window.cy) return
    var before = JSON.stringify(hits)
    hits = computeHits()
    cy.batch(function () {
      cy.elements().removeClass('lens-out lens-hit')
      if (!hits) return
      cy.nodes().forEach(function (n) { n.addClass(hits[n.id()] ? 'lens-hit' : 'lens-out') })
      cy.edges().forEach(function (e) { if (!hits[e.source().id()] || !hits[e.target().id()]) e.addClass('lens-out') })
    })
    $('main').classList.toggle('lensing', !!hits)
    if (JSON.stringify(hits) !== before) {
      version++
      if (window.Binder) Binder.render()
      if (window.Writer && Writer.refreshLens) Writer.refreshLens()
      if (window.TextSearch) TextSearch.lensChanged()
      if (window.Work) Work.schedule()
    }
  }

  function scheduleLens() { clearTimeout(lensTimer); lensTimer = setTimeout(function () { applyLens(); render() }, 60) }

  function active() { return lens ? JSON.parse(JSON.stringify(lens)) : null }
  // Passages (^ids) in a text whose claims/questions are in the lens: { id: true }.
  function lensPassages(path) {
    var out = {}
    if (!hits || !window.cy || !path) return out
    Object.keys(hits).forEach(function (id) {
      var m = /^(.+\.md)#([a-z0-9]{4,12})$/i.exec(String(cy.getElementById(id).data('passage') || ''))
      if (m && m[1] === path) out[m[2]] = true
    })
    return out
  }
  function matches(nodeId) { return !hits || !!hits[nodeId] }

  // Words to highlight in the open text: names of matching nodes (not the text's own node).
  function lensTerms(ownNodeId) {
    if (!hits || !window.cy) return []
    var out = []
    Object.keys(hits).forEach(function (id) {
      if (id === ownNodeId) return
      var n = cy.getElementById(id), label = n.length ? String(n.data('label') || '').trim() : ''
      if (label.length >= 3) out.push(label)
    })
    return out.sort(function (a, b) { return b.length - a.length })
  }

  // ───────── pane ─────────

  function paneOpen() { var m = $('main'); return m.classList.contains('binding') && m.classList.contains('classing') }

  function toggle() {
    var m = $('main')
    if (paneOpen()) { m.classList.remove('binding', 'classing'); remember(false) } else { if (window.Work) Work.leave(); m.classList.add('binding', 'classing'); remember(true); render() }
    syncButtons()
    setTimeout(function () { if (window.cy) cy.resize() }, 30)
  }

  // Leave the pane for the book plan (the plan's button).
  function leave() { $('main').classList.remove('classing'); remember(false); syncButtons() }

  function remember(on) {
    try { localStorage.setItem('mentegraf-classes', on ? '1' : '0'); if (on) localStorage.setItem('mentegraf-binder', '0') } catch (e) { /* ignore */ }
  }

  function syncButtons() {
    var m = $('main'), cls = $('b_classes'), bnd = $('b_binder')
    if (cls) cls.classList.toggle('on', paneOpen())
    if (bnd) bnd.classList.toggle('on', m.classList.contains('binding') && !m.classList.contains('classing'))
    if (window.Work) Work.syncButtons()
  }

  function typeColor(n) { var t = typeof catById === 'function' ? catById(n.data('type')) : null; return t ? t.color : '#999' }

  function render() {
    var tree = $('cTree')
    if (!tree || !window.cy) return
    var html = []
    function row(c, depth) {
      var kids = children(c.id), open = isOpen(c, depth), count = nodesIn(c.id).length
      html.push('<div class="crow" draggable="true" data-id="' + esc(c.id) + '" style="padding-left:' + (8 + depth * 16) + 'px">' +
        '<span class="ctog" data-act="toggle">' + (kids.length ? (open ? '▾' : '▸') : '') + '</span>' +
        '<span class="cname">' + esc(c.name) + '</span><span class="ccount">' + (count || '') + '</span>' +
        '<button class="cadd" data-act="addchild" title="' + esc(L('addSubcat')) + '">+</button>' +
        '<button class="crm" data-act="remove" title="' + esc(L('deleteLabel')) + '">✕</button></div>')
      if (open) kids.forEach(function (k) { row(k, depth + 1) })
    }
    children(null).forEach(function (c) { row(c, 0) })
    var markup = html.join('')
    // Rows are replaced only when the tree itself changed (replacing them under the
    // pointer would swallow clicks and double-clicks); highlights are set in place.
    if (tree._markup !== markup) { tree.innerHTML = markup; tree._markup = markup }
    Array.prototype.forEach.call(tree.querySelectorAll('.crow'), function (r) {
      r.classList.toggle('con', !!(lens && lens.kind === 'cat' && lens.id === r.dataset.id))
      r.classList.toggle('cfocus', r.dataset.id === focusId)
    })
    $('cEmpty').style.display = data.categories.length ? 'none' : 'block'

    var tags = allTags()
    $('cTags').innerHTML = tags.length ? tags.map(function (t) {
      var on = lens && lens.kind === 'tag' && lens.name === t.name
      return '<button class="ctag' + (on ? ' con' : '') + '" data-tag="' + esc(t.name) + '">' + esc(t.name) + ' <span>' + t.count + '</span></button>'
    }).join('') : '<div class="cnone">' + esc(L('noTags')) + '</div>'

    var res = $('cResults')
    if (!hits) { res.style.display = 'none'; res.innerHTML = ''; return }
    var list = cy.nodes().filter(function (n) { return hits[n.id()] }).sort(function (a, b) { return String(a.data('label')).localeCompare(String(b.data('label')), 'tr') })
    var texts = list.filter(function (n) { return n.data('fragment') }).length
    var title = lens.kind === 'cat' ? path(lens.id) : '#' + lens.name
    res.style.display = ''
    res.innerHTML = '<div class="crh"><span class="crt">' + esc(title) + '</span><button class="bt cclear" data-act="clear">' + esc(L('lensClear')) + '</button></div>' +
      '<div class="crs">' + esc(L('lensCount').replace('%n', list.length).replace('%t', texts)) + '</div>' +
      (list.length ? list.map(function (n) {
        return '<div class="cres" data-node="' + esc(n.id()) + '"><span class="cdot" style="background:' + esc(typeColor(n)) + '"></span><span class="cname">' + esc(n.data('label')) + '</span>' +
          (n.data('fragment') ? '<span class="ctext" title="' + esc(n.data('fragment')) + '">✎</span>' : '') + '</div>'
      }).join('') : '<div class="cnone">' + esc(L('lensNone')) + '</div>')
  }

  function editName(id) {
    var rowEl = document.querySelector('#cTree .crow[data-id="' + id + '"] .cname')
    var c = byId(id)
    if (!rowEl || !c) return
    var input = document.createElement('input')
    input.className = 'cedit'; input.value = c.name
    rowEl.replaceWith(input)
    input.focus(); input.select()
    var done = false
    function finish(save) { if (done) return; done = true; if (save) rename(id, input.value); $('cTree')._markup = null; render() }
    input.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false) })
    input.addEventListener('blur', function () { finish(true) })
  }

  function zoneOf(e, rowEl) {
    var r = rowEl.getBoundingClientRect(), y = (e.clientY - r.top) / r.height
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside'
  }
  function clearMarks() { document.querySelectorAll('#cTree .drop-before,#cTree .drop-after,#cTree .drop-inside').forEach(function (el) { el.classList.remove('drop-before', 'drop-after', 'drop-inside') }) }

  function openNode(id) {
    var n = cy.getElementById(id)
    if (!n.length) return
    selNode(n)
    Promise.resolve(n.data('fragment') ? Writer.openForNode(n, { focus: false }) : null).then(function () {
      setTimeout(function () { if (typeof focusNeighborhood === 'function') focusNeighborhood(n) }, 60)
    })
  }

  function bindPane() {
    var tree = $('cTree')
    tree.addEventListener('click', function (e) {
      var rowEl = e.target.closest('.crow'); if (!rowEl) return
      var id = rowEl.dataset.id, act = e.target.closest('[data-act]') ? e.target.closest('[data-act]').dataset.act : null
      focusId = id
      if (act === 'toggle') { var c = byId(id); expanded[id] = !isOpen(c, depthOf(id)); render(); return }
      if (act === 'addchild') { var k = add(id); render(); editName(k.id); return }
      if (act === 'remove') { remove(id); return }
      setLens({ kind: 'cat', id: id })
    })
    tree.addEventListener('dblclick', function (e) { var rowEl = e.target.closest('.crow'); if (rowEl && !e.target.closest('[data-act]')) editName(rowEl.dataset.id) })
    tree.addEventListener('dragstart', function (e) {
      var rowEl = e.target.closest('.crow'); if (!rowEl) return
      dragId = rowEl.dataset.id; e.dataTransfer.effectAllowed = 'move'
      try { e.dataTransfer.setData('text/plain', dragId) } catch (x) { /* ignore */ }
    })
    tree.addEventListener('dragend', function () { dragId = null; clearMarks() })
    tree.addEventListener('dragover', function (e) {
      if (!dragId) return
      e.preventDefault(); clearMarks()
      var rowEl = e.target.closest('.crow')
      if (rowEl && rowEl.dataset.id !== dragId) rowEl.classList.add('drop-' + zoneOf(e, rowEl))
    })
    tree.addEventListener('drop', function (e) {
      if (!dragId) return
      e.preventDefault()
      var rowEl = e.target.closest('.crow')
      var ok = rowEl ? move(dragId, rowEl.dataset.id, zoneOf(e, rowEl)) : move(dragId, null, 'after')
      clearMarks(); dragId = null
      if (ok) changed()
    })
    $('cTags').addEventListener('click', function (e) { var b = e.target.closest('[data-tag]'); if (b) setLens({ kind: 'tag', name: b.dataset.tag }) })
    $('cResults').addEventListener('click', function (e) {
      if (e.target.closest('[data-act="clear"]')) { setLens(null); return }
      var r = e.target.closest('.cres'); if (r) openNode(r.dataset.node)
    })
  }

  function depthOf(id) { var d = 0, c = byId(id); while (c && c.parent && d < 50) { d++; c = byId(c.parent) } return d }

  function addRoot() { var c = add(null); render(); editName(c.id) }
  function addChild() { var p = focusId && byId(focusId) ? focusId : null; var c = add(p); render(); editName(c.id) }

  // ───────── node panel: category chips with a search box ─────────

  function updatePanel(n) {
    var box = $('nCats')
    if (!box) return
    if (!n || !n.length || !n.isNode()) { box.innerHTML = ''; return }
    var cs = (n.data('cats') || []).filter(byId)
    $('nCatChips').innerHTML = cs.map(function (id) {
      return '<span class="cchip" title="' + esc(path(id)) + '">' + esc(byId(id).name) + '<button data-rm="' + esc(id) + '" title="' + esc(L('catRemove')) + '">✕</button></span>'
    }).join('')
  }

  function suggestions(q) {
    var cur = (selEle && selEle.isNode && selEle.isNode() ? selEle.data('cats') : null) || []
    q = lower(q).trim()
    var list = data.categories.filter(function (c) { return cur.indexOf(c.id) < 0 && (!q || lower(c.name).indexOf(q) >= 0) })
      .sort(function (a, b) { return path(a.id).localeCompare(path(b.id), 'tr') }).slice(0, 8)
    var html = list.map(function (c, i) { return '<div class="csug' + (i === 0 ? ' csel' : '') + '" data-id="' + esc(c.id) + '">' + esc(path(c.id)) + '</div>' })
    if (q && !data.categories.some(function (c) { return lower(c.name) === q })) html.push('<div class="csug cnew' + (list.length ? '' : ' csel') + '" data-new="1">' + esc(L('catCreate').replace('%s', $('nCatInput').value.trim())) + '</div>')
    return html.join('')
  }

  function closeSug() { var s = $('nCatSug'); if (s) { s.style.display = 'none'; s.innerHTML = '' } }

  function pick(el) {
    if (!el || !window.selEle || !selEle.isNode || !selEle.isNode()) return
    var input = $('nCatInput'), id = el.dataset.id
    if (el.dataset.new) {
      var c = { id: newId(), name: input.value.trim(), parent: null }
      if (!c.name) return
      data.categories.push(c); id = c.id
    }
    input.value = ''
    closeSug()
    assign(selEle, id, true)
  }

  function bindPanel() {
    var input = $('nCatInput'), sug = $('nCatSug')
    if (!input) return
    function show() { sug.innerHTML = suggestions(input.value); sug.style.display = sug.innerHTML ? '' : 'none' }
    input.addEventListener('input', show)
    input.addEventListener('focus', show)
    input.addEventListener('keydown', function (e) {
      e.stopPropagation()
      var items = Array.prototype.slice.call(sug.querySelectorAll('.csug')), i = items.findIndex(function (x) { return x.classList.contains('csel') })
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!items.length) return
        if (i >= 0) items[i].classList.remove('csel')
        i = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)
        items[i].classList.add('csel')
      } else if (e.key === 'Enter') { e.preventDefault(); pick(items[i]) } else if (e.key === 'Escape') { closeSug(); input.blur() }
    })
    input.addEventListener('blur', function () { setTimeout(closeSug, 150) })
    sug.addEventListener('mousedown', function (e) { var el = e.target.closest('.csug'); if (el) { e.preventDefault(); pick(el) } })
    $('nCatChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-rm]')
      if (b && window.selEle && selEle.isNode()) assign(selEle, b.dataset.rm, false)
    })
  }

  // Anything that may change counts or the lens result.
  function refresh() { scheduleLens(); if (window.selEle && selEle.isNode && selEle.isNode()) updatePanel(selEle) }

  function init() {
    if (bound || !window.cy) return
    bound = true
    cy.style().selector('.lens-out').style({ opacity: 0.12 }).selector('node.lens-hit').style({ 'border-width': 3, 'border-color': '#c5a05e' }).update()
    bindPane()
    bindPanel()
    cy.on('data', 'node', scheduleLens)
    cy.on('add remove', scheduleLens)
    var open = null
    try { open = localStorage.getItem('mentegraf-classes') } catch (e) { /* ignore */ }
    if (open === '1') toggle()
    syncButtons()
  }

  return {
    init: init, load: load, get: get, render: render, toggle: toggle, leave: leave, syncButtons: syncButtons,
    addRoot: addRoot, addChild: addChild, updatePanel: updatePanel,
    active: active, matches: matches, lensTerms: lensTerms, lensPassages: lensPassages, version: function () { return version },
    setLens: setLens, assign: assign, path: path,
    _move: move, _add: add, _remove: remove, _normalize: normalize
  }
})()
