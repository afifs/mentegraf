// binder.js — the book plan: an ordered tree of parts, chapters and sections.
//
// Parts are plain headings; chapters and sections are graph nodes, so they keep
// their links to concepts and people. Stored in the project as "manuscript"
// (graph/manuscript.json). Status and target words live on each node.
/* global cy, L, snapshot, selNode, mkNode, curLang, Writer */
var Binder = (function () {
  'use strict'

  var STATUSES = ['idea', 'draft', 'revision', 'done']
  var STATUS_FILL = { idea: 0, draft: 0.25, revision: 0.75, done: 1 }
  var STATUS_COLOR = { idea: '#8f8a7e', draft: '#c08a3e', revision: '#4f7fa8', done: '#4f8f5e' }

  // A circle that fills up as the chapter progresses: ○ ◔ ◕ ●
  function statusIcon(st) {
    var f = STATUS_FILL[st] || 0, c = STATUS_COLOR[st] || STATUS_COLOR.idea, fill = ''
    if (f >= 1) fill = '<circle cx="8" cy="8" r="6" fill="' + c + '"/>'
    else if (f > 0) {
      var a = 2 * Math.PI * f - Math.PI / 2, x = 8 + 6 * Math.cos(a), y = 8 + 6 * Math.sin(a)
      fill = '<path d="M8 8V2A6 6 0 ' + (f > 0.5 ? 1 : 0) + ' 1 ' + x.toFixed(2) + ' ' + y.toFixed(2) + 'Z" fill="' + c + '"/>'
    }
    return '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6" fill="none" stroke="' + c + '" stroke-width="1.6"/>' + fill + '</svg>'
  }
  var MAX_NODE_DEPTH = 3                 // part > chapter > section, or chapter > section > subsection
  var data = { title: '', items: [] }
  var counts = {}                        // text path -> words on disk
  var collapsed = {}                     // item id -> true
  var dragId = null
  var focusId = null                     // highlighted row
  var renderTimer = null, countTimer = null
  var bound = false

  function $(id) { return document.getElementById(id) }
  function api() { return window.mentegraf }
  function node(id) { var n = window.cy ? cy.getElementById(id) : null; return n && n.length ? n : null }
  function isOpen() { return $('main').classList.contains('binding') }
  function fmt(n) { return Number(n || 0).toLocaleString(curLang === 'en' ? 'en-GB' : 'tr-TR') }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }
  function newId() { return (window.ProjectFormat ? ProjectFormat.newId('part') : 'part-' + Date.now().toString(36)) }

  // ───────── data ─────────

  function walk(list, fn, parent, depth) {
    for (var i = 0; i < list.length; i++) {
      if (fn(list[i], list, i, parent || null, depth || 0) === false) return false
      if (walk(list[i].children || [], fn, list[i], (depth || 0) + 1) === false) return false
    }
  }

  function find(id) {
    var hit = null
    walk(data.items, function (it, list, i, parent, depth) { if (it.id === id) { hit = { item: it, list: list, index: i, parent: parent, depth: depth }; return false } })
    return hit
  }

  function contains(item, id) {
    var yes = false
    walk(item.children || [], function (it) { if (it.id === id) { yes = true; return false } })
    return yes
  }

  // Remove items whose node no longer exists (deleted in the graph).
  function prune(list) {
    return list.filter(function (it) { return it.kind === 'part' || node(it.node) }).map(function (it) {
      it.children = prune(it.children || []); return it
    })
  }

  function get() {
    if (window.cy) data.items = prune(data.items)
    return JSON.parse(JSON.stringify(data))
  }

  function load(m) {
    var src = m && typeof m === 'object' ? m : {}
    data = { title: typeof src.title === 'string' ? src.title : '', items: Array.isArray(src.items) ? JSON.parse(JSON.stringify(src.items)) : [] }
    counts = {}
    scheduleRender()
    refreshCounts()
  }

  function changed() { if (typeof snapshot === 'function') snapshot(); render(); refreshCounts(true) }

  // Depth of the deepest node chain below an item (an item alone = 1).
  function nodeHeight(it) {
    var h = 0
    ;(it.children || []).forEach(function (c) { h = Math.max(h, nodeHeight(c)) })
    return (it.kind === 'node' ? 1 : 0) + h
  }
  // How many node levels sit above a position (parts do not count).
  function nodeLevelsAbove(parent) {
    var levels = 0, p = parent
    while (p) { if (p.kind === 'node') levels++; var f = find(p.id); p = f ? f.parent : null }
    return levels
  }

  // Move item `id` before/after/inside `targetId`. Returns false if not allowed.
  function move(id, targetId, where) {
    if (id === targetId) return false
    var from = find(id), to = targetId ? find(targetId) : null
    if (!from) return false
    var item = from.item
    if (to && contains(item, targetId)) return false
    if (to && item.kind === 'part' && to.depth > 0) {           // parts stay at the top level
      var top = to; while (top.parent) top = find(top.parent.id)
      to = top; if (where === 'inside') where = 'after'
    }
    if (to && where === 'inside') {
      if (item.kind === 'part') where = 'after'
      else if (nodeLevelsAbove(to.item) + (to.item.kind === 'node' ? 1 : 0) + nodeHeight(item) > MAX_NODE_DEPTH) return false
    }
    if (to && where !== 'inside' && item.kind === 'node' && to.parent &&
        nodeLevelsAbove(to.parent) + (to.parent.kind === 'node' ? 1 : 0) + nodeHeight(item) > MAX_NODE_DEPTH) return false
    from.list.splice(from.index, 1)
    if (!to) { data.items.push(item); return true }
    to = find(targetId) || to                                    // indexes may have shifted
    if (where === 'inside') { to.item.children = to.item.children || []; to.item.children.push(item); collapsed[to.item.id] = false }
    else to.list.splice(to.index + (where === 'after' ? 1 : 0), 0, item)
    return true
  }

  // ───────── word counts ─────────

  function textWords(path) {
    if (!path) return 0
    var live = Writer.textFor ? Writer.textFor(path) : null
    if (live != null) return countWords(live)
    return counts[path] || 0
  }
  function countWords(text) {
    var body = String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    return (body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length
  }

  // missingOnly: fetch only texts not counted yet (after adding items to the plan).
  async function refreshCounts(missingOnly) {
    if (!api() || !api().fragmentStats || !window.cy) return
    var paths = []
    walk(data.items, function (it) {
      var n = it.kind === 'node' && node(it.node), p = n && n.data('fragment')
      if (p && !(missingOnly && counts[p] !== undefined)) paths.push(p)
    })
    if (!paths.length) return
    var r = await api().fragmentStats(paths)
    if (r && r.counts) { counts = Object.assign({}, counts, r.counts); scheduleRender() }
  }

  function textChanged() { clearTimeout(countTimer); countTimer = setTimeout(scheduleRender, 600) }

  // ───────── rendering ─────────

  function roman(n) {
    var r = '', map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
    map.forEach(function (m) { while (n >= m[0]) { r += m[1]; n -= m[0] } })
    return r
  }

  function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 30) }

  function bookTitle() {
    if (data.title) return data.title
    var b = window.cy ? cy.nodes().filter(function (n) { return n.data('type') === 'book' }) : null
    return b && b.length ? b[0].data('label') : ''
  }

  // Totals for an item: { words, target } of included nodes below (and including) it.
  function totals(it, inherited) {
    var on = inherited !== false && (it.kind === 'part' || it.include !== false)
    var t = { words: 0, target: 0 }
    if (it.kind === 'node' && on) {
      var n = node(it.node)
      if (n) { t.words += textWords(n.data('fragment')); t.target += Number(n.data('wordTarget')) || 0 }
    }
    ;(it.children || []).forEach(function (c) { var s = totals(c, on); t.words += s.words; t.target += s.target })
    return t
  }

  function render() {
    var tree = $('bTree')
    if (!tree || !window.cy) return
    data.items = prune(data.items)
    var titleInput = $('bTitle')
    if (document.activeElement !== titleInput) titleInput.value = data.title
    titleInput.placeholder = bookTitle() || L('bookTitlePh')
    var html = [], chapterNo = 0, partNo = 0, selected = window.selEle && selEle.isNode && selEle.isNode() ? selEle.id() : null
    var paths = {}                         // item id -> chapter/section number, e.g. [3, 2]
    function rowWithPath(it, depth, p, included) {
      var on = included && (it.kind === 'part' || it.include !== false)
      if (it.kind === 'node') {
        if (on && p.length === 0) { paths[it.id] = [++chapterNo] } else if (on) { paths[it.id] = p } else { paths[it.id] = [] }
      }
      var kids = it.children || [], hasKids = kids.length > 0, open = !collapsed[it.id]
      var t = totals(it, included)
      var cls = ['brow', it.kind === 'part' ? 'bpart' : 'bnode', on ? '' : 'boff', it.kind === 'node' && it.node === selected ? 'bsel' : '', it.id === focusId ? 'bfocus' : '', it.kind === 'node' && window.Classify && !Classify.matches(it.node) ? 'blens' : ''].join(' ')
      var num = '', label, extra = ''
      if (it.kind === 'part') {
        if (on) num = roman(++partNo) + '.'
        label = esc(it.title || L('untitledPart'))
      } else {
        var n = node(it.node)
        label = esc(n ? n.data('label') : '?')
        if (on && paths[it.id].length) num = paths[it.id].join('.') + (paths[it.id].length === 1 ? '.' : '')
        var st = (n && n.data('status')) || 'idea'
        extra = '<button class="bst" data-act="status" title="' + esc(L('statusTitle').replace('%s', L('st_' + st))) + '">' + statusIcon(st) + '</button>'
      }
      var inc = it.kind === 'part' ? '<span class="binc bnone"></span>'
        : '<button class="binc' + (it.include === false ? ' off' : '') + '" data-act="include" title="' + esc(L(it.include === false ? 'includeOff' : 'includeOn')) + '"></button>'
      var words = t.target ? fmt(t.words) + ' / ' + fmt(t.target) : t.words ? fmt(t.words) : ''
      var over = t.target && t.words >= t.target ? ' bdone' : ''
      var syn = it.kind === 'node' && node(it.node) ? node(it.node).data('description') : ''
      html.push('<div class="' + cls + '" draggable="true" data-id="' + esc(it.id) + '" style="padding-left:' + (8 + depth * 16) + 'px"' + (syn ? ' title="' + esc(syn) + '"' : '') + '>' +
        '<span class="btog" data-act="toggle">' + (hasKids ? (open ? '▾' : '▸') : '') + '</span>' +
        inc + '<span class="bnum">' + num + '</span><span class="blabel">' + label + '</span>' +
        '<span class="bwords' + over + '">' + words + '</span>' + extra +
        '<button class="brm" data-act="remove" title="' + esc(L('removeFromBook')) + '">✕</button></div>')
      if (hasKids) {
        // Children are numbered even when collapsed, so numbers never jump.
        var sub = 0, start = html.length
        kids.forEach(function (c) {
          var cOn = on && (c.kind === 'part' || c.include !== false)
          var cp = []
          if (it.kind === 'node' && c.kind === 'node' && cOn && paths[it.id].length) cp = paths[it.id].concat([++sub])
          rowWithPath(c, depth + 1, it.kind === 'part' ? [] : cp, on)
        })
        if (!open) html.length = start
      }
    }
    data.items.forEach(function (it) { rowWithPath(it, 0, [], true) })
    // Only touch the page when something changed: replacing rows under the
    // pointer between mouse-down and mouse-up would swallow the click.
    var markup = html.join('')
    if (tree._markup !== markup) { tree.innerHTML = markup; tree._markup = markup }
    $('bEmpty').style.display = data.items.length ? 'none' : 'block'
    var all = { words: 0, target: 0 }
    data.items.forEach(function (it) { var s = totals(it, true); all.words += s.words; all.target += s.target })
    $('bSum').textContent = L('bookTotal') + ': ' + fmt(all.words) + (all.target ? ' / ' + fmt(all.target) : '') + ' ' + L('words')
  }

  // ───────── actions ─────────

  function toggle() {
    var main = $('main')
    if (main.classList.contains('classing')) {          // the classification pane is showing: switch to the plan
      if (window.Classify) Classify.leave()
      main.classList.add('binding')
    } else main.classList.toggle('binding')
    try { localStorage.setItem('mentegraf-binder', isOpen() ? '1' : '0') } catch (e) { /* ignore */ }
    var b = $('b_binder'); if (b) b.classList.toggle('on', isOpen())
    if (window.Classify) Classify.syncButtons()
    if (isOpen()) { render(); refreshCounts() }
    setTimeout(function () { if (window.cy) cy.resize() }, 30)
  }

  function addPart() {
    var it = { id: newId(), kind: 'part', title: L('newPart'), children: [] }
    data.items.push(it)
    changed()
    editPartTitle(it.id)
  }

  // Where new chapters go: into the selected part, else the last part, else the top level.
  function chapterTarget() {
    var f = focusId ? find(focusId) : null
    if (f && f.item.kind === 'part') return f.item.children
    for (var i = data.items.length - 1; i >= 0; i--) if (data.items[i].kind === 'part') return data.items[i].children
    return data.items
  }

  function addChapter() {
    if (typeof mkNode !== 'function') return
    var ext = cy.extent()
    var n = mkNode((ext.x1 + ext.x2) / 2 + (Math.random() - 0.5) * 120, (ext.y1 + ext.y2) / 2 + (Math.random() - 0.5) * 120)
    var cat = (window.catById && catById('chapter')) || null
    n.data('label', L('newChapter'))
    if (cat) { n.data('type', 'chapter'); n.data('color', cat.color) }
    n.data('status', 'idea')
    chapterTarget().push({ id: n.id(), kind: 'node', node: n.id(), include: true, children: [] })
    changed()
    selNode(n)
    var name = $('nName'); if (name) { name.focus(); name.select() }
  }

  function addSelected() {
    var n = window.selEle && selEle.isNode && selEle.isNode() ? selEle : null
    if (!n) { flash(L('selectNodeFirst')); return }
    if (find(n.id())) { flash(L('alreadyInBook')); return }
    chapterTarget().push({ id: n.id(), kind: 'node', node: n.id(), include: true, children: [] })
    changed()
  }

  function flash(text) {
    var el = $('bSum')
    el.textContent = text
    el.classList.add('bflash')
    setTimeout(function () { el.classList.remove('bflash'); render() }, 2200)
  }

  function editPartTitle(id) {
    render()
    var row = document.querySelector('#bTree .brow[data-id="' + CSS.escape(id) + '"] .blabel')
    var f = find(id)
    if (!row || !f) return
    $('bTree')._markup = null              // the input is not part of the cached markup
    var input = document.createElement('input')
    input.className = 'bedit'
    input.value = f.item.title
    row.replaceWith(input)
    input.focus(); input.select()
    var done = false
    function finish(save) {
      if (done) return
      done = true
      if (save && input.value.trim() && input.value.trim() !== f.item.title) { f.item.title = input.value.trim(); changed() } else render()
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation() })
    input.addEventListener('blur', function () { finish(true) })
  }

  function onClick(e) {
    var rowEl = e.target.closest('.brow')
    if (!rowEl) return
    var f = find(rowEl.dataset.id)
    if (!f) return
    var act = e.target.closest('[data-act]') ? e.target.closest('[data-act]').dataset.act : null
    if (act === 'status') { openStatusMenu(e.target.closest('[data-act]'), f); return }
    if (act === 'toggle') { collapsed[f.item.id] = !collapsed[f.item.id]; render(); return }
    if (act === 'include') { f.item.include = f.item.include === false; changed(); return }
    if (act === 'remove') { f.list.splice(f.index, 1); changed(); return }
    focusId = f.item.id
    $('bTree').focus({ preventScroll: true })
    render()
    openItem(f, false)
  }

  // Select the node, show it with its direct connections, open its text
  // (moving the cursor into the text only when asked, e.g. with Enter).
  function openItem(f, focusText) {
    if (!f || f.item.kind !== 'node') return
    var n = node(f.item.node)
    if (!n) return
    selNode(n)
    if (!focusText) $('bTree').focus({ preventScroll: true })
    // Zoom after the text pane has opened: it narrows the graph.
    Promise.resolve(Writer.openForNode(n, { focus: !!focusText })).then(function () {
      setTimeout(function () { if (typeof focusNeighborhood === 'function' && selEle && selEle.id && selEle.id() === n.id()) focusNeighborhood(n) }, 60)
    })
  }

  // ───────── status menu ─────────

  function closeStatusMenu() { var m = $('bStatusMenu'); if (m) m.remove() }

  function openStatusMenu(btn, f) {
    closeStatusMenu()
    var n = node(f.item.node)
    if (!n || !btn) return
    var menu = document.createElement('div')
    menu.id = 'bStatusMenu'
    menu.className = 'bmenu'
    menu.innerHTML = STATUSES.map(function (s) {
      return '<button data-status="' + s + '"' + ((n.data('status') || 'idea') === s ? ' class="cur"' : '') + '>' + statusIcon(s) + '<span>' + esc(L('st_' + s)) + '</span></button>'
    }).join('')
    $('binder').appendChild(menu)
    var r = btn.getBoundingClientRect(), b = $('binder').getBoundingClientRect()
    menu.style.top = Math.min(r.bottom - b.top + 2, b.height - menu.offsetHeight - 8) + 'px'
    menu.style.left = Math.max(8, r.right - b.left - menu.offsetWidth) + 'px'
    menu.addEventListener('click', function (e) {
      var o = e.target.closest('[data-status]')
      if (!o) return
      n.data('status', o.dataset.status)
      closeStatusMenu()
      changed()
      if (window.selEle && selEle.id && selEle.id() === n.id()) updatePanel(n)
    })
    // Registered right away: the mouse-down that opened the menu has already happened.
    document.addEventListener('mousedown', function away(e) { if (!e.target.closest('#bStatusMenu')) { closeStatusMenu(); document.removeEventListener('mousedown', away, true) } }, true)
  }

  // ───────── keyboard: ↑ ↓ move, Tab / Shift+Tab change level, Enter open, Delete remove ─────────

  function visibleIds() { return Array.prototype.map.call(document.querySelectorAll('#bTree .brow'), function (r) { return r.dataset.id }) }

  function indent(id) {
    var f = find(id)
    if (!f || f.item.kind === 'part' || f.index === 0) return false
    return move(id, f.list[f.index - 1].id, 'inside')
  }
  function outdent(id) {
    var f = find(id)
    if (!f || !f.parent) return false
    return move(id, f.parent.id, 'after')
  }

  function onKey(e) {
    if (e.target !== $('bTree')) return                          // not while renaming a part
    var ids = visibleIds(), i = ids.indexOf(focusId), handled = true
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      var j = i < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
      if (ids.length) { focusId = ids[j]; render(); scrollToFocus() }
    } else if (e.key === 'Tab') {
      if (focusId && ((e.shiftKey ? outdent : indent)(focusId))) { changed(); scrollToFocus() }
      else if (focusId) flash(L(e.shiftKey ? 'cannotOutdent' : 'cannotIndent'))
    } else if (e.key === 'Enter') {
      var f = find(focusId)
      if (f && f.item.kind === 'part') editPartTitle(f.item.id); else openItem(f, true)
    } else if (e.key === 'Delete') {
      var g = find(focusId)
      if (g) { focusId = ids[i + 1] || ids[i - 1] || null; g.list.splice(g.index, 1); changed() }
    } else if (e.key === 'F2') {
      var h = find(focusId); if (h && h.item.kind === 'part') editPartTitle(h.item.id)
    } else handled = false
    if (handled) { e.preventDefault(); e.stopPropagation() }    // keep keys away from the graph
  }

  function scrollToFocus() {
    var el = focusId && document.querySelector('#bTree .brow[data-id="' + CSS.escape(focusId) + '"]')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }

  function onDblClick(e) {
    var rowEl = e.target.closest('.brow.bpart')
    if (rowEl && !e.target.closest('[data-act]')) editPartTitle(rowEl.dataset.id)
  }

  function zoneOf(e, rowEl) {
    var r = rowEl.getBoundingClientRect(), y = (e.clientY - r.top) / r.height
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside'
  }
  function clearMarks() { document.querySelectorAll('#bTree .drop-before,#bTree .drop-after,#bTree .drop-inside').forEach(function (el) { el.classList.remove('drop-before', 'drop-after', 'drop-inside') }) }

  function bindTree() {
    var tree = $('bTree')
    tree.addEventListener('click', onClick)
    tree.addEventListener('dblclick', onDblClick)
    tree.addEventListener('keydown', onKey)
    tree.addEventListener('scroll', closeStatusMenu)
    tree.addEventListener('dragstart', function (e) {
      var rowEl = e.target.closest('.brow'); if (!rowEl) return
      dragId = rowEl.dataset.id
      e.dataTransfer.effectAllowed = 'move'
      try { e.dataTransfer.setData('text/plain', dragId) } catch (x) { /* ignore */ }
      rowEl.classList.add('bdrag')
    })
    tree.addEventListener('dragend', function () { dragId = null; clearMarks(); document.querySelectorAll('#bTree .bdrag').forEach(function (r) { r.classList.remove('bdrag') }) })
    tree.addEventListener('dragover', function (e) {
      if (!dragId) return
      e.preventDefault()
      clearMarks()
      var rowEl = e.target.closest('.brow')
      if (rowEl && rowEl.dataset.id !== dragId) rowEl.classList.add('drop-' + zoneOf(e, rowEl))
    })
    tree.addEventListener('drop', function (e) {
      if (!dragId) return
      e.preventDefault()
      var rowEl = e.target.closest('.brow')
      var ok = rowEl ? move(dragId, rowEl.dataset.id, zoneOf(e, rowEl)) : move(dragId, null, 'after')
      clearMarks(); dragId = null
      if (ok) changed()
    })
    $('bTitle').addEventListener('change', function () { data.title = this.value.trim(); changed() })
    $('bTitle').addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); e.stopPropagation() })
  }

  // ───────── compile the book ─────────

  // The plan as the compiler needs it: included items in order, with heading levels.
  // Excluded items are skipped together with everything below them; empty parts are dropped.
  function compileItems() {
    var out = []
    function visit(list, depth) {
      list.forEach(function (it) {
        if (it.kind === 'part') {
          var start = out.length
          out.push({ kind: 'part', title: it.title || L('untitledPart'), level: depth + 1 })
          visit(it.children || [], depth + 1)
          if (!out.slice(start + 1).some(function (x) { return x.kind === 'node' })) out.length = start
          return
        }
        if (it.include === false) return
        var n = node(it.node)
        if (!n) return
        var p = n.data('fragment') || null
        out.push({ kind: 'node', title: n.data('label') || '', level: depth + 1, path: p, text: p && Writer.textFor ? Writer.textFor(p) : null })
        visit(it.children || [], depth + 1)
      })
    }
    visit(data.items, 0)
    return out
  }

  var FORMATS = [['docx', 'compileDocx'], ['epub', 'compileEpub'], ['md', 'compileMd']]
  var compiling = false

  function compileMenu(btn) {
    closeStatusMenu()
    var old = $('bCompileMenu'); if (old) { old.remove(); return }
    var menu = document.createElement('div')
    menu.id = 'bCompileMenu'
    menu.className = 'bmenu'
    menu.innerHTML = FORMATS.map(function (f) { return '<button data-format="' + f[0] + '"><span>' + esc(L(f[1])) + '</span></button>' }).join('')
    $('binder').appendChild(menu)
    var r = btn.getBoundingClientRect(), b = $('binder').getBoundingClientRect()
    menu.style.top = (r.bottom - b.top + 2) + 'px'
    menu.style.left = Math.max(8, Math.min(r.left - b.left, b.width - menu.offsetWidth - 8)) + 'px'
    menu.addEventListener('click', function (e) {
      var o = e.target.closest('[data-format]')
      if (!o) return
      menu.remove()
      compile(o.dataset.format)
    })
    document.addEventListener('mousedown', function away(e) { if (!e.target.closest('#bCompileMenu') && !e.target.closest('.bcomp')) { menu.remove(); document.removeEventListener('mousedown', away, true) } }, true)
  }

  async function compile(format) {
    if (compiling || !api() || !api().compileBook) return
    var items = compileItems()
    if (!items.some(function (x) { return x.kind === 'node' })) { flash(L('compileEmpty')); return }
    compiling = true
    var el = $('bSum'); el.textContent = L('compiling'); el.classList.add('bflash')
    try {
      var settings = Object.assign({ language: curLang === 'en' ? 'en' : 'tr' }, window.exportSettings || {})
      var r = await api().compileBook({ title: data.title || bookTitle(), items: items, format: format, settings: settings })
      if (r && r.error === 'untitled') alert(L('saveFirst'))
      else if (r && r.error === 'empty') flash(L('compileEmpty'))
    } finally {
      compiling = false
      el.classList.remove('bflash')
      render()
    }
  }

  // ───────── node panel: status and target ─────────

  function updatePanel(n) {
    var st = $('nStatus'), tg = $('nTarget')
    if (!st || !n) return
    if (!st.options.length) STATUSES.forEach(function (s) { var o = document.createElement('option'); o.value = s; st.appendChild(o) })
    Array.prototype.forEach.call(st.options, function (o) { o.textContent = L('st_' + o.value) })
    st.value = n.data('status') || 'idea'
    tg.value = n.data('wordTarget') || ''
  }

  function bindPanel() {
    var st = $('nStatus'), tg = $('nTarget')
    if (!st) return
    st.addEventListener('change', function () {
      if (!window.selEle || !selEle.isNode || !selEle.isNode()) return
      selEle.data('status', st.value); changed()
    })
    tg.addEventListener('change', function () {
      if (!window.selEle || !selEle.isNode || !selEle.isNode()) return
      var v = parseInt(tg.value, 10)
      if (v > 0) selEle.data('wordTarget', v); else selEle.removeData('wordTarget')
      changed()
    })
  }

  function init() {
    if (bound || !window.cy) return
    bound = true
    bindTree()
    bindPanel()
    cy.on('data', 'node', scheduleRender)
    cy.on('remove', 'node', scheduleRender)
    cy.on('select unselect', 'node', scheduleRender)
    var open = null
    try { open = localStorage.getItem('mentegraf-binder') } catch (e) { /* ignore */ }
    if (open === '1') toggle()
  }

  return {
    indent: indent, outdent: outdent, compileMenu: compileMenu, compile: compile, compileItems: compileItems,
    init: init, load: load, get: get, render: render, toggle: toggle, refreshCounts: refreshCounts, textChanged: textChanged,
    addPart: addPart, addChapter: addChapter, addSelected: addSelected, updatePanel: updatePanel,
    _move: move, _find: find
  }
})()
