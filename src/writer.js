// writer.js — Markdown texts attached to nodes, edited in a pane beside the graph.
//
// Each node may own one text file (node data "fragment": "notes/x.md" or
// "manuscript/x.md"). Texts are kept as editor buffers in memory and written
// together with the graph on save (Ctrl+S). Uses CodeMirror 6 from
// lib/codemirror.bundle.js (window.CM).
/* global CM, cy, L, snapshot, setDirty, doSave */
var Writer = (function () {
  'use strict'

  var buffers = {}        // path -> { state, saved }  saved: text on disk (null = never written)
  var lastWritten = {}    // path -> text we sent to disk most recently
  var current = null      // { nodeId, path }
  var view = null
  var extensions = null
  var loading = false     // true while we replace text ourselves
  var lastKey = {}        // command -> time, to avoid running a command twice (keymap + menu)
  var boundCy = null

  function api() { return window.mentegraf }
  function $(id) { return document.getElementById(id) }
  function now() { return Date.now() }

  // ───────── editor setup ─────────

  function keyCmd(name, fn) {
    return function (v) { lastKey[name] = now(); return fn(v) }
  }

  function build() {
    if (view || !window.CM) return
    var hl = CM.HighlightStyle.define([
      { tag: CM.tags.heading1, fontSize: '1.45em', fontWeight: '700' },
      { tag: CM.tags.heading2, fontSize: '1.25em', fontWeight: '700' },
      { tag: CM.tags.heading3, fontSize: '1.1em', fontWeight: '700' },
      { tag: [CM.tags.heading4, CM.tags.heading5, CM.tags.heading6], fontWeight: '700' },
      { tag: CM.tags.emphasis, fontStyle: 'italic' },
      { tag: CM.tags.strong, fontWeight: '700' },
      { tag: CM.tags.strikethrough, textDecoration: 'line-through' },
      { tag: CM.tags.link, color: 'var(--accent)' },
      { tag: CM.tags.url, color: 'var(--dim)' },
      { tag: CM.tags.quote, color: 'var(--dim)', fontStyle: 'italic' },
      { tag: CM.tags.monospace, fontFamily: 'Consolas, monospace', fontSize: '0.92em' },
      { tag: [CM.tags.processingInstruction, CM.tags.meta, CM.tags.contentSeparator, CM.tags.labelName], color: 'var(--dim)' }
    ])
    var theme = CM.EditorView.theme({
      '&': { height: '100%', backgroundColor: 'var(--bg2)', color: 'var(--text)' },
      '.cm-scroller': { fontFamily: "Georgia, 'Times New Roman', serif", fontSize: '17px', lineHeight: '1.7' },
      '.cm-content': { maxWidth: '72ch', margin: '0 auto', padding: '28px 32px 40vh', caretColor: 'var(--accent)' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(197,160,94,0.30)' },
      '.cm-panels': { backgroundColor: 'var(--bg3)', color: 'var(--text)', fontFamily: "'DM Sans', sans-serif", fontSize: '13px' },
      '.cm-panels input, .cm-panels button': { color: 'var(--text)' },
      '.cm-searchMatch': { backgroundColor: 'rgba(197,160,94,0.35)' },
      '.cm-selectionMatch': { backgroundColor: 'rgba(197,160,94,0.18)' },
      '.cm-fm': { fontFamily: "'DM Sans', sans-serif", fontSize: '12px', lineHeight: '1.6', color: 'var(--dim)' }
    })
    extensions = [
      CM.history(),
      CM.drawSelection(),
      CM.EditorView.lineWrapping,
      CM.yamlFrontmatter({ content: CM.markdown({ base: CM.markdownLanguage }) }),
      frontMatterLines(),
      CM.syntaxHighlighting(hl),
      CM.search({ top: true }),
      CM.highlightSelectionMatches(),
      theme,
      // Our own bindings first, so menu accelerators and editor keys never both fire.
      CM.keymap.of([
        { key: 'Mod-z', run: keyCmd('undo', CM.undo), preventDefault: true },
        { key: 'Mod-y', run: keyCmd('redo', CM.redo), preventDefault: true },
        { key: 'Mod-Shift-z', run: keyCmd('redo', CM.redo), preventDefault: true },
        { key: 'Delete', run: keyCmd('delete', CM.deleteCharForward) },
        { key: 'Mod-s', run: keyCmd('save', function () { if (typeof doSave === 'function') doSave(); return true }), preventDefault: true }
      ]),
      CM.keymap.of([].concat(CM.searchKeymap, CM.historyKeymap, CM.defaultKeymap, [CM.indentWithTab])),
      CM.EditorView.updateListener.of(function (u) {
        if (!u.docChanged) return
        updateStatus()
        if (!loading && typeof setDirty === 'function') setDirty(true)
      })
    ]
    view = new CM.EditorView({ state: makeState(''), parent: $('wEditor') })
  }

  // Dim the metadata block (--- … ---) at the top of a text.
  function frontMatterLines() {
    var deco = CM.Decoration.line({ class: 'cm-fm' })
    function find(view) {
      var doc = view.state.doc, ranges = []
      if (doc.lines > 1 && doc.line(1).text.trim() === '---') {
        for (var i = 2; i <= Math.min(doc.lines, 60); i++) {
          if (doc.line(i).text.trim() === '---') { for (var j = 1; j <= i; j++) ranges.push(deco.range(doc.line(j).from)); break }
        }
      }
      return CM.Decoration.set(ranges)
    }
    return CM.ViewPlugin.fromClass(class {
      constructor(v) { this.decorations = find(v) }
      update(u) { if (u.docChanged) this.decorations = find(u.view) }
    }, { decorations: function (v) { return v.decorations } })
  }

  function makeState(text) {
    if (!extensions) build()          // every text gets history, keys and highlighting
    return CM.EditorState.create({ doc: text, extensions: extensions })
  }

  function textOf(path) {
    if (current && current.path === path && view) return view.state.doc.toString()
    var b = buffers[path]
    return b ? b.state.doc.toString() : null
  }

  function syncCurrent() {
    if (current && view && buffers[current.path]) buffers[current.path].state = view.state
  }

  // ───────── pane ─────────

  function storedWidth() { try { return localStorage.getItem('mentegraf-writer-w') } catch (e) { return null } }

  function openPane() {
    var main = $('main')
    var w = storedWidth()
    if (w) main.style.setProperty('--writer-w', w)
    main.classList.add('writing')
    resizeGraph()
  }

  function resizeGraph() { setTimeout(function () { if (window.cy) cy.resize() }, 30) }

  function bindResizer() {
    var handle = $('writerResize')
    if (!handle || handle._bound) return
    handle._bound = true
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault()
      var main = $('main'), rect = main.getBoundingClientRect()
      function move(ev) {
        var w = Math.max(320, Math.min(rect.right - ev.clientX, rect.width - 200))
        main.style.setProperty('--writer-w', w + 'px')
      }
      function up() {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
        try { localStorage.setItem('mentegraf-writer-w', main.style.getPropertyValue('--writer-w')) } catch (e) { /* ignore */ }
        resizeGraph()
      }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    })
  }

  function updateStatus() {
    if (!current || !view) return
    var text = view.state.doc.toString().replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    var words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length
    $('wWords').textContent = words.toLocaleString(window.curLang === 'en' ? 'en-GB' : 'tr-TR') + ' ' + L('words')
    var b = buffers[current.path]
    $('wState').textContent = b && view.state.doc.toString() !== b.saved ? L('unsavedText') : ''
  }

  function show(path, node) {
    build()
    syncCurrent()
    current = { nodeId: node.id(), path: path }
    loading = true
    view.setState(buffers[path].state)
    loading = false
    $('wTitle').textContent = node.data('label') || ''
    $('wPath').textContent = path
    openPane()
    updateStatus()
    view.focus()
  }

  function close() {
    syncCurrent()
    current = null
    var main = $('main')
    main.classList.remove('writing', 'writer-full')
    resizeGraph()
  }

  function toggleFull() {
    $('main').classList.toggle('writer-full')
    resizeGraph()
    if (view) view.focus()
  }

  // ───────── opening and creating texts ─────────

  function takenPaths() {
    var taken = Object.keys(buffers)
    if (window.cy) cy.nodes().forEach(function (n) { if (n.data('fragment')) taken.push(n.data('fragment')) })
    return taken
  }

  function starterText(node) {
    return '---\nmentegraf-node: ' + node.id() + '\n---\n\n# ' + (node.data('label') || '') + '\n\n'
  }

  async function openForNode(node) {
    if (!node || !node.isNode || !node.isNode() || !api()) return
    var path = node.data('fragment')
    if (!path) {
      var res = await api().fragmentNewPath(node.data('label'), node.data('type'), node.id(), takenPaths())
      if (res.error) { alert(L(res.error === 'untitled' ? 'saveFirst' : 'textError') + (res.message ? '\n\n' + res.message : '')); return }
      path = res.path
      buffers[path] = { state: makeState(starterText(node)), saved: null }
      node.data('fragment', path)
      if (typeof snapshot === 'function') snapshot()
      updatePanel(node)
    } else if (!buffers[path]) {
      var r = await api().fragmentRead(path)
      if (r.error) { alert(L('textError') + '\n\n' + r.message); return }
      if (!r.exists) {
        if (!confirm(L('textMissing') + '\n\n' + path)) return
        buffers[path] = { state: makeState(starterText(node)), saved: null }
      } else {
        buffers[path] = { state: makeState(r.text), saved: r.text }
      }
    }
    show(path, node)
    if (view) view.dispatch({ selection: { anchor: view.state.doc.length } })
  }

  function updatePanel(node) {
    var btn = $('nTextBtn'), p = $('nTextPath')
    if (!btn || !node) return
    var path = node.data('fragment')
    btn.textContent = path ? L('textOpen') : L('textCreate')
    p.textContent = path || ''
    p.title = path || ''
  }

  // ───────── saving and recovery ─────────

  // Texts that differ from disk and still belong to a node in the graph.
  function dirtyFragments() {
    syncCurrent()
    var used = {}
    if (window.cy) cy.nodes().forEach(function (n) { if (n.data('fragment')) used[n.data('fragment')] = true })
    return Object.keys(buffers).filter(function (p) {
      return used[p] && textOf(p) !== buffers[p].saved
    }).map(function (p) { return { path: p, text: textOf(p) } })
  }

  function willSave(list) { (list || []).forEach(function (f) { lastWritten[f.path] = f.text }) }

  function markSaved(list) {
    (list || []).forEach(function (f) { if (buffers[f.path]) buffers[f.path].saved = f.text })
    updateStatus()
  }

  function hasUnsaved() { return dirtyFragments().length > 0 }

  function loadRecovered(list) {
    (list || []).forEach(function (f) {
      if (f && typeof f.path === 'string' && typeof f.text === 'string') buffers[f.path] = { state: makeState(f.text), saved: null }
    })
  }

  // ───────── outside changes (Typora, Obsidian, sync) ─────────

  function replaceText(path, text) {
    var b = buffers[path]
    loading = true
    if (current && current.path === path && view) {
      var head = view.state.selection.main.head   // keep the cursor where it was
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: Math.min(head, text.length) } })
      b.state = view.state
    } else {
      b.state = b.state.update({ changes: { from: 0, to: b.state.doc.length, insert: text } }).state
    }
    loading = false
    b.saved = text
    updateStatus()
  }

  async function onExternalChange(path) {
    var b = buffers[path]
    if (!b || !api()) return
    var r = await api().fragmentRead(path)
    if (!r || !r.exists) return
    var disk = r.text
    if (disk === b.saved || disk === lastWritten[path]) return   // our own save
    var mine = textOf(path)
    if (mine === disk) { b.saved = disk; updateStatus(); return }
    if (mine === b.saved) { replaceText(path, disk); return }    // no local edits: just reload
    if (confirm(L('textChangedOutside') + '\n\n' + path)) replaceText(path, disk)
    else { b.saved = disk; updateStatus() }                      // keep mine; saving will overwrite
  }

  // ───────── lifecycle ─────────

  function bindCy() {
    if (!window.cy || boundCy === cy) return
    boundCy = cy
    cy.on('remove', 'node', function () {
      setTimeout(function () { if (current && cy.getElementById(current.nodeId).empty()) close() }, 0)
    })
    cy.on('data', 'node', function (e) {
      if (current && e.target.id() === current.nodeId) $('wTitle').textContent = e.target.data('label') || ''
    })
  }

  function init() {
    bindResizer()
    bindCy()
    if (api() && api().onFragmentChanged && !init._watching) {
      init._watching = true
      api().onFragmentChanged(function (path) { onExternalChange(path) })
    }
  }

  // New or opened project: forget all texts.
  function reset() {
    close()
    buffers = {}
    lastWritten = {}
    if (view) { loading = true; view.setState(makeState('')); loading = false }
    bindCy()
  }

  // Menu accelerators (undo, redo, delete, save, add node…) while typing:
  // act on the text, never on the graph. Returns true when handled.
  function handleMenu(action) {
    var active = document.activeElement
    if (!view || !current || !active || !view.dom.contains(active)) return false
    var inText = view.contentDOM.contains(active)          // not the search box
    var map = { undo: CM.undo, redo: CM.redo, 'delete': CM.deleteCharForward }
    if (action === 'save') { return now() - (lastKey.save || 0) < 300 }
    if (map[action]) {
      if (inText && now() - (lastKey[action] || 0) >= 300) map[action](view)
      return true
    }
    return action === 'add-node' || action === 'link-mode'
  }

  return {
    init: init, reset: reset, openForNode: openForNode, close: close, toggleFull: toggleFull,
    updatePanel: updatePanel, dirtyFragments: dirtyFragments, willSave: willSave, markSaved: markSaved,
    hasUnsaved: hasUnsaved, loadRecovered: loadRecovered, handleMenu: handleMenu
  }
})()
