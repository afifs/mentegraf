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
  var md = null           // Markdown renderer for the preview (lazy)
  var previewOn = false
  var previewTimer = null
  var msgTimer = null

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
      '.cm-fm': { fontFamily: "'DM Sans', sans-serif", fontSize: '12px', lineHeight: '1.6', color: 'var(--dim)' },
      '.cm-fn': { color: 'var(--accent)', fontFamily: "'DM Sans', sans-serif", fontSize: '0.78em', fontWeight: '600' },
      '.cm-cite, .cm-cite span': { color: '#3f8f86 !important', fontFamily: "'DM Sans', sans-serif", fontSize: '0.85em' },
      '.cm-pid': { color: 'var(--dim)', fontFamily: "'DM Sans', sans-serif", fontSize: '0.72em' },
      '.cm-lensline': { backgroundColor: 'rgba(197,160,94,0.13)', boxShadow: 'inset 3px 0 0 #c5a05e' },
      '.cm-lensword': { borderBottom: '2px solid #c5a05e' }
    })
    extensions = [
      CM.history(),
      CM.drawSelection(),
      CM.EditorView.lineWrapping,
      CM.yamlFrontmatter({ content: CM.markdown({ base: CM.markdownLanguage }) }),
      frontMatterLines(),
      markPlugin(/\[\^[^\]\s]+\]/g, 'cm-fn'),
      markPlugin(/\[[^\][\n]*@[^\][\n]*\]/g, 'cm-cite'),
      markPlugin(/\s\^[a-z0-9]{4,12}$/g, 'cm-pid'),
      lensPlugin(),
      CM.syntaxHighlighting(hl),
      CM.search({ top: true }),
      CM.highlightSelectionMatches(),
      theme,
      // Typing ] right before an existing ] just steps over it (leaving a citation).
      // Images pasted or dropped into the text become figure nodes (figures.js).
      CM.EditorView.domEventHandlers({
        paste: function (e) { return window.Figures ? Figures.onPaste(e) : false },
        drop: function (e, v) { return window.Figures ? Figures.onDrop(e, v) : false }
      }),
      CM.EditorView.inputHandler.of(function (v, from, to, text) {
        if (text !== ']' || from !== to || v.state.sliceDoc(from, from + 1) !== ']') return false
        v.dispatch({ selection: { anchor: from + 1 } })
        return true
      }),
      // Our own bindings first, so menu accelerators and editor keys never both fire.
      CM.keymap.of([
        { key: 'Mod-z', run: keyCmd('undo', CM.undo), preventDefault: true },
        { key: 'Mod-y', run: keyCmd('redo', CM.redo), preventDefault: true },
        { key: 'Mod-Shift-z', run: keyCmd('redo', CM.redo), preventDefault: true },
        { key: 'Delete', run: keyCmd('delete', CM.deleteCharForward) },
        { key: 'Mod-s', run: keyCmd('save', function () { if (typeof doSave === 'function') doSave(); return true }), preventDefault: true },
        { key: 'Mod-b', run: wrap('**'), preventDefault: true },
        { key: 'Mod-i', run: wrap('_'), preventDefault: true },
        { key: 'Mod-k', run: link, preventDefault: true },
        { key: 'Mod-Shift-f', run: footnote, preventDefault: true },
        { key: 'Mod-Shift-c', run: cite, preventDefault: true },
        { key: 'Mod-Shift-p', run: passageId, preventDefault: true },
        { key: 'Mod-e', run: function () { togglePreview(); return true }, preventDefault: true },
        { key: 'Mod-Shift-g', run: function () { run('figure'); return true }, preventDefault: true }
      ]),
      CM.keymap.of([].concat(CM.searchKeymap, CM.historyKeymap, CM.defaultKeymap, [CM.indentWithTab])),
      CM.EditorView.updateListener.of(function (u) {
        if (!u.docChanged) return
        updateStatus()
        schedulePreview()
        if (window.Binder) Binder.textChanged()
        if (!loading && typeof setDirty === 'function') setDirty(true)
      })
    ]
    view = new CM.EditorView({ state: makeState(''), parent: $('wEditor') })
  }

  // Colour footnote markers, citations and passage IDs.
  function markPlugin(re, cls) {
    var deco = new CM.MatchDecorator({ regexp: re, decoration: CM.Decoration.mark({ class: cls }) })
    return CM.ViewPlugin.fromClass(class {
      constructor(v) { this.decorations = deco.createDeco(v) }
      update(u) { this.decorations = deco.updateDeco(u, this.decorations) }
    }, { decorations: function (v) { return v.decorations } })
  }

  // Classification lens: mark lines that mention a node in the chosen category or tag.
  function lensPlugin() {
    var line = CM.Decoration.line({ class: 'cm-lensline' }), word = CM.Decoration.mark({ class: 'cm-lensword' })
    function find(v) {
      var terms = window.Classify && current ? Classify.lensTerms(current.nodeId) : []
      if (!terms.length) return CM.Decoration.none
      var re = new RegExp('(^|[^\\p{L}\\p{N}])(' + terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }).join('|') + ')(?![\\p{L}\\p{N}])', 'giu')
      var ranges = []
      v.visibleRanges.forEach(function (r) {
        for (var pos = r.from; pos <= r.to;) {
          var l = v.state.doc.lineAt(pos), m, hit = false
          re.lastIndex = 0
          while ((m = re.exec(l.text))) { hit = true; var s = l.from + m.index + m[1].length; ranges.push(word.range(s, s + m[2].length)); if (!m[0].length) re.lastIndex++ }
          if (hit) ranges.push(line.range(l.from))
          pos = l.to + 1
        }
      })
      return CM.Decoration.set(ranges, true)
    }
    return CM.ViewPlugin.fromClass(class {
      constructor(v) { this.ver = window.Classify ? Classify.version() : 0; this.decorations = find(v) }
      update(u) {
        var ver = window.Classify ? Classify.version() : 0
        if (u.docChanged || u.viewportChanged || ver !== this.ver) { this.ver = ver; this.decorations = find(u.view) }
      }
    }, { decorations: function (v) { return v.decorations } })
  }

  // ───────── formatting commands (toolbar and shortcuts) ─────────

  // Toggle **bold** / _italic_ around each selection.
  function wrap(mark) {
    return function (v) {
      var st = v.state, n = mark.length
      v.dispatch(st.update(st.changeByRange(function (r) {
        var text = st.sliceDoc(r.from, r.to)
        if (st.sliceDoc(r.from - n, r.from) === mark && st.sliceDoc(r.to, r.to + n) === mark) {
          return { changes: [{ from: r.from - n, to: r.from }, { from: r.to, to: r.to + n }], range: CM.EditorSelection.range(r.from - n, r.to - n) }
        }
        if (text.length > 2 * n && text.slice(0, n) === mark && text.slice(-n) === mark) {
          return { changes: { from: r.from, to: r.to, insert: text.slice(n, -n) }, range: CM.EditorSelection.range(r.from, r.to - 2 * n) }
        }
        return { changes: [{ from: r.from, insert: mark }, { from: r.to, insert: mark }], range: CM.EditorSelection.range(r.from + n, r.to + n) }
      }), { scrollIntoView: true, userEvent: 'input' }))
      return true
    }
  }

  // Heading levels, quotes and lists: toggle a prefix on every selected line.
  function linePrefix(kind) {
    return function (v) {
      var st = v.state, changes = [], seen = {}
      st.selection.ranges.forEach(function (r) {
        var multi = st.doc.lineAt(r.from).number !== st.doc.lineAt(r.to).number
        for (var pos = r.from; pos <= r.to;) {
          var line = st.doc.lineAt(pos)
          if (!seen[line.number] && !(multi && !line.text.trim())) {
            seen[line.number] = true
            var cur = (/^(#{1,6} |> |- |\d+\. )/.exec(line.text) || [''])[0], next
            if (kind === 'heading') next = cur === '# ' ? '## ' : cur === '## ' ? '### ' : cur === '### ' ? '' : '# '
            else if (kind === 'quote') next = cur === '> ' ? '' : '> '
            else if (kind === 'bullet') next = cur === '- ' ? '' : '- '
            else next = /^\d+\. $/.test(cur) ? '' : '1. '
            changes.push({ from: line.from, to: line.from + cur.length, insert: next })
          }
          pos = line.to + 1
        }
      })
      v.dispatch({ changes: changes, userEvent: 'input' })
      return true
    }
  }

  function link(v) {
    var st = v.state, r = st.selection.main
    var text = st.sliceDoc(r.from, r.to) || L('linkText')
    var ins = '[' + text + '](https://)'
    v.dispatch({ changes: { from: r.from, to: r.to, insert: ins },
      selection: { anchor: r.from + text.length + 3, head: r.from + ins.length - 1 }, userEvent: 'input' })
    return true
  }

  // Citation: Zotero's picker (Better BibTeX) when available, else empty [@] brackets.
  var picking = false
  function cite(v) {
    if (!api() || !api().citePick) return manualCite(v)
    if (picking) return true
    picking = true
    flash(L('zoteroPicking'))
    api().citePick().then(function (r) {
      picking = false
      if (!view || !current) return
      if (r && r.text) {
        var s = view.state.selection.main
        view.dispatch({ changes: { from: s.from, to: s.to, insert: r.text }, selection: { anchor: s.from + r.text.length }, scrollIntoView: true, userEvent: 'input' })
        flash('')
      } else if (r && r.error && r.error !== 'busy') {
        manualCite(view)
        flash(L(r.error === 'bbt' ? 'bbtMissing' : 'zoteroUnavailable'))
      } else flash('')
      view.focus()
    }, function () { picking = false; if (view && current) manualCite(view) })
    return true
  }

  function manualCite(v) {
    var st = v.state, r = st.selection.main, sel = st.sliceDoc(r.from, r.to)
    v.dispatch({ changes: { from: r.from, to: r.to, insert: '[@' + sel + ']' },
      selection: { anchor: r.from + 2 + sel.length }, userEvent: 'input' })
    return true
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

  // Footnote labels: first word of the file name + node id tail + number, so
  // labels stay unique when chapters are joined into one book.
  function noteKey() {
    var base = (current.path.split('/').pop() || '').replace(/\.md$/i, '')
    var first = (base.split('-')[0] || 'not').slice(0, 12)
    var tail = String(current.nodeId).replace(/[^A-Za-z0-9]/g, '').slice(-4).toLowerCase()
    return first + '-' + tail
  }

  // Insert a footnote and jump to its definition at the end. Pressed again on a
  // definition line, jump back to where the note is referenced.
  function footnote(v) {
    if (!current) return false
    var st = v.state, doc = st.doc.toString()
    var line = st.doc.lineAt(st.selection.main.head)
    var def = /^\[\^([^\]\s]+)\]:/.exec(line.text)
    if (def) {
      var ref = '[^' + def[1] + ']', i = -1
      while ((i = doc.indexOf(ref, i + 1)) >= 0) {
        if (doc.charAt(i + ref.length) !== ':') { v.dispatch({ selection: { anchor: i + ref.length }, scrollIntoView: true }); return true }
      }
      return true
    }
    var key = noteKey(), max = 0, m, re = new RegExp('\\[\\^' + escapeRe(key) + '-(\\d+)\\]', 'g')
    while ((m = re.exec(doc))) max = Math.max(max, +m[1])
    var label = '[^' + key + '-' + (max + 1) + ']'
    var pos = st.selection.main.to, end = st.doc.length
    var gap = /\n\n$/.test(doc) ? '' : /\n$/.test(doc) ? '\n' : '\n\n'
    var defText = gap + label + ': '
    v.dispatch({ changes: [{ from: pos, insert: label }, { from: end, insert: defText }],
      selection: { anchor: end + label.length + defText.length }, scrollIntoView: true, userEvent: 'input' })
    flash(L('footnoteHint'))
    return true
  }

  function randomId() {
    var s = ''
    for (var i = 0; i < 6; i++) s += '0123456789abcdefghijklmnopqrstuvwxyz'.charAt(Math.floor(Math.random() * 36))
    return s
  }

  // Tag the paragraph under the cursor with ^id (kept if it already has one)
  // and copy its link (path#id) for use elsewhere.
  function passageId(v) {
    if (!current) return false
    var st = v.state, line = st.doc.lineAt(st.selection.main.head)
    if (!line.text.trim() || /^---\s*$/.test(line.text)) { flash(L('passageNeedsText')); return true }
    var n = line.number
    while (n < st.doc.lines && st.doc.line(n + 1).text.trim()) n++
    var last = st.doc.line(n), m = /\s\^([a-z0-9]{4,12})\s*$/.exec(last.text), id
    if (m) id = m[1]
    else {
      var doc = st.doc.toString()
      do { id = randomId() } while (doc.indexOf('^' + id) >= 0)
      v.dispatch({ changes: { from: last.to, insert: ' ^' + id }, userEvent: 'input' })
    }
    try { navigator.clipboard.writeText(current.path + '#' + id) } catch (e) { /* ignore */ }
    flash(L('passageCopied').replace('%s', '^' + id))
    return true
  }

  var COMMANDS = {
    bold: wrap('**'), italic: wrap('_'), heading: linePrefix('heading'), quote: linePrefix('quote'),
    bullet: linePrefix('bullet'), number: linePrefix('number'), link: link,
    footnote: footnote, cite: cite, passage: passageId
  }
  var TIPS = { bold: 'tbBold', italic: 'tbItalic', heading: 'tbHeading', quote: 'tbQuote', bullet: 'tbBullet',
    number: 'tbNumber', link: 'tbLink', footnote: 'tbFootnote', cite: 'tbCite', passage: 'tbPassage', preview: 'tbPreview', docx: 'tbDocx', figure: 'tbFigure' }

  // Export the open text to Word through Pandoc (main process shows the result).
  var exporting = false
  async function exportDocx() {
    if (!view || !current || !api() || !api().exportDocx || exporting) return
    exporting = true
    flash(L('exporting'))
    try {
      var settings = Object.assign({ language: window.curLang === 'en' ? 'en' : 'tr' }, window.exportSettings || {})
      var r = await api().exportDocx(current.path, view.state.doc.toString(), settings)
      if (r && r.error === 'untitled') alert(L('saveFirst'))
    } finally { exporting = false; flash('') }
  }

  function run(name) {
    if (name === 'preview') { togglePreview(); return }
    if (name === 'docx') { exportDocx(); return }
    if (name === 'figure') { if (window.Figures && current && !previewOn) Figures.openPicker(document.querySelector('#wToolbar button[data-cmd="figure"]')); return }
    if (!view || !current || previewOn || !COMMANDS[name]) return
    COMMANDS[name](view)
    view.focus()
  }

  function bindToolbar() {
    var bar = $('wToolbar')
    if (!bar || bar._bound) return
    bar._bound = true
    bar.addEventListener('mousedown', function (e) { if (e.target.closest('button')) e.preventDefault() })   // keep the cursor in the text
    bar.addEventListener('click', function (e) { var b = e.target.closest('button[data-cmd]'); if (b) run(b.dataset.cmd) })
  }

  function setTips() {
    var bar = $('wToolbar')
    if (bar) bar.querySelectorAll('button[data-cmd]').forEach(function (b) { b.title = L(TIPS[b.dataset.cmd]) })
  }

  function flash(text) {
    var el = $('wMsg')
    if (!el) return
    el.textContent = text
    clearTimeout(msgTimer)
    msgTimer = setTimeout(function () { el.textContent = '' }, 4000)
  }

  // ───────── preview (read-only, rendered) ─────────

  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

  function renderPreview() {
    if (!previewOn || !view || !window.MD) return
    if (!md) {
      md = window.MD()
      var defaultValidate = md.validateLink
      md.validateLink = function (u) { return (window.Figures && Figures.isAssetUrl(u)) || defaultValidate(u) }   // project images only
    }
    var text = view.state.doc.toString()
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')        // metadata block
      .replace(/[ \t]\^[a-z0-9]{4,12}[ \t]*$/gm, '')         // passage IDs
    if (window.Figures) text = Figures.previewMarkdown(text)
    var html = md.render(text)
    if (window.Figures) html = Figures.markCaptions(html)
      .replace(/\[([^\[\]<]*@[^\[\]<]*)\]/g, function (all, inner) { return '<span class="pv-cite">[' + inner + ']</span>' })
    $('wPreview').innerHTML = html
  }

  function schedulePreview() {
    if (!previewOn) return
    clearTimeout(previewTimer)
    previewTimer = setTimeout(renderPreview, 150)
  }

  function togglePreview() {
    if (!view || !current) return
    previewOn = !previewOn
    $('writer').classList.toggle('previewing', previewOn)
    var b = document.querySelector('#wToolbar button[data-cmd="preview"]')
    if (b) b.classList.toggle('on', previewOn)
    if (previewOn) renderPreview()
    else view.focus()
  }

  function bindPreview() {
    var pv = $('wPreview')
    if (!pv || pv._bound) return
    pv._bound = true
    // Never let a link replace the app: in-page anchors scroll, web links open in the browser.
    pv.addEventListener('click', function (e) {
      var a = e.target.closest('a')
      if (!a) return
      e.preventDefault()
      var href = a.getAttribute('href') || ''
      if (href.charAt(0) === '#') {
        var target = pv.querySelector('[id="' + href.slice(1).replace(/"/g, '') + '"]')
        if (target) target.scrollIntoView({ block: 'center' })
      } else if (/^https?:\/\//i.test(href) && api() && api().openExternal) {
        api().openExternal(href)
      }
    })
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

  function show(path, node, keepFocus) {
    build()
    syncCurrent()
    current = { nodeId: node.id(), path: path }
    loading = true
    view.setState(buffers[path].state)
    loading = false
    $('wTitle').textContent = node.data('label') || ''
    $('wPath').textContent = path
    openPane()
    setTips()
    updateStatus()
    if (previewOn) renderPreview()
    else if (!keepFocus) view.focus()
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

  // opts.focus === false: open the text but leave the keyboard where it is (e.g. in the book plan).
  async function openForNode(node, opts) {
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
    var keep = !!(opts && opts.focus === false)
    show(path, node, keep)
    if (view && !keep) view.dispatch({ selection: { anchor: view.state.doc.length } })
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
    bindToolbar()
    bindPreview()
    bindCy()
    if (api() && api().onFragmentChanged && !init._watching) {
      init._watching = true
      api().onFragmentChanged(function (path) { onExternalChange(path) })
    }
  }

  // New or opened project: forget all texts.
  function reset() {
    close()
    if (previewOn) {
      previewOn = false
      $('writer').classList.remove('previewing')
      var b = document.querySelector('#wToolbar button[data-cmd="preview"]')
      if (b) b.classList.remove('on')
    }
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
    init: init, reset: reset, openForNode: openForNode, close: close, toggleFull: toggleFull, run: run, togglePreview: togglePreview, exportDocx: exportDocx,
    updatePanel: updatePanel, dirtyFragments: dirtyFragments, willSave: willSave, markSaved: markSaved,
    hasUnsaved: hasUnsaved, loadRecovered: loadRecovered, handleMenu: handleMenu,
    // Text of a loaded buffer (including unsaved edits), or null if not loaded.
    textFor: function (path) { return buffers[path] ? textOf(path) : null },
    // Re-mark lens lines after the lens changed.
    refreshLens: function () { if (view) view.dispatch({}) },
    // The open text: { path, nodeId } or null.
    current: function () { return current ? { path: current.path, nodeId: current.nodeId } : null },
    // Insert at the cursor; block = on its own paragraph (blank lines around it).
    insert: function (text, block) {
      if (!view || !current) return false
      var st = view.state, r = st.selection.main, ins = text
      if (block) {
        var before = st.sliceDoc(Math.max(0, r.from - 2), r.from), after = st.sliceDoc(r.to, r.to + 2)
        var pre = r.from === 0 || /\n\n$/.test(before) ? '' : /\n$/.test(before) ? '\n' : '\n\n'
        var post = /^\n\n/.test(after) ? '' : /^\n/.test(after) ? '\n' : '\n\n'
        ins = pre + text + post
      }
      view.dispatch({ changes: { from: r.from, to: r.to, insert: ins }, selection: { anchor: r.from + ins.length }, scrollIntoView: true, userEvent: 'input' })
      view.focus()
      return true
    }
  }
})()
