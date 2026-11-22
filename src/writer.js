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
  var current = null      // { nodeId, path } — of the active pane
  var view = null         // editor of the active pane
  // Panes: the main one in the writer, a second one beside it (side) and any number in windows
  // of their own. Each shows a different text. `view` and `current` always belong to the
  // pane last clicked or typed in, so every command works on the text the author is in.
  var primary = null      // { view, current, kind: 'main' }
  var panes = []
  var extensions = null
  var loading = false     // true while we replace text ourselves
  var lastKey = {}        // command -> time, to avoid running a command twice (keymap + menu)
  var boundCy = null
  var md = null           // Markdown renderer for the preview (lazy)
  var previewOn = false
  var previewTimer = null
  var msgTimer = null
  // Spell checking. The editor checks the words itself (spellPlugin): every visible word is
  // asked about in the book's language (main.js, with the Hunspell dictionaries that ship with
  // Mentegraf), the project's word lists are honoured, and misspelled words get a wavy
  // underline. Chromium's checker is not used: it only looks at words as they are typed, and on
  // Windows it cannot be asked about a word at all. Right-clicking a marked word opens the
  // spelling menu (main.js); anywhere else the usual Cut/Copy/Paste menu.
  var spell = { on: true, lang: 'tr' }
  var spellCache = new Map()   // word -> misspelled?
  var spellGen = 0             // bumped whenever spellCache is emptied
  var spellVer = 0             // bumped when the language, the word lists or the dictionaries change
  var spellComp = null     // its extension is always extensions[0]

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
      '.cm-misspelled': { textDecorationLine: 'underline', textDecorationStyle: 'wavy', textDecorationColor: 'rgba(196, 40, 32, 0.8)', textDecorationThickness: '1px', textDecorationSkipInk: 'none', textUnderlineOffset: '3px' },
      '.cm-fn': { color: 'var(--accent)', fontFamily: "'DM Sans', sans-serif", fontSize: '0.78em', fontWeight: '600' },
      '.cm-cite, .cm-cite span': { color: '#3f8f86 !important', fontFamily: "'DM Sans', sans-serif", fontSize: '0.85em' },
      '.cm-pid': { color: 'var(--dim)', fontFamily: "'DM Sans', sans-serif", fontSize: '0.72em' },
      '.cm-lensline': { backgroundColor: 'rgba(197,160,94,0.13)', boxShadow: 'inset 3px 0 0 #c5a05e' },
      '.cm-lensword': { borderBottom: '2px solid #c5a05e' },
      '.cm-hl': { backgroundColor: 'rgba(255,214,0,0.38)', borderRadius: '2px' },
      '.cm-hl-open': { color: 'var(--dim)', fontSize: '0.8em' },
      '.cm-hl-end': { fontSize: '0', cursor: 'pointer' },
      '.cm-hl-end::after': { content: "'✓'", fontSize: '11px', fontFamily: "'DM Sans', sans-serif", fontWeight: '700', color: '#8a6d00', background: 'rgba(255,214,0,0.55)', borderRadius: '8px', padding: '0 5px', marginLeft: '2px', verticalAlign: '2px' },
      '.cm-hl-end:hover::after': { background: '#e0b800', color: '#fff' },
      '.cm-pid-arg': { cursor: 'pointer', color: '#c0683f !important' },
      '.cm-pid-arg::after': { content: 'attr(data-arg)', marginLeft: '4px', padding: '0 5px', borderRadius: '8px', background: 'rgba(192,104,63,0.14)', color: '#a0532f', fontFamily: "'DM Sans', sans-serif", fontSize: '11px' }
    })
    spellComp = new CM.Compartment()
    extensions = [
      spellComp.of(spellAttrs()),
      CM.history(),
      CM.drawSelection(),
      CM.EditorView.lineWrapping,
      CM.yamlFrontmatter({ content: CM.markdown({ base: CM.markdownLanguage }) }),
      frontMatterLines(),
      markPlugin(/\[\^[^\]\s]+\]/g, 'cm-fn'),
      markPlugin(/\[[^\][\n]*@[^\][\n]*\]/g, 'cm-cite'),
      markPlugin(/\s\^[a-z0-9]{4,12}$/g, 'cm-pid'),
      lensPlugin(),
      argPlugin(),
      hlPlugin(),
      spellPlugin(),
      CM.syntaxHighlighting(hl),
      CM.search({ top: true }),
      CM.highlightSelectionMatches(),
      theme,
      // Typing ] right before an existing ] just steps over it (leaving a citation).
      // Images pasted or dropped into the text become figure nodes (figures.js).
      CM.EditorView.domEventHandlers({
        contextmenu: function (e, v) { return spellMenu(e, v) },
        paste: function (e) { return window.Figures ? Figures.onPaste(e) : false },
        drop: function (e, v) { return window.Figures ? Figures.onDrop(e, v) : false },
        mousedown: function (e, v) {
          var h = e.target.closest && e.target.closest('.cm-hl-end')
          if (h && curOf(v)) {
            var at = v.posAtDOM(h)
            var mk = marksIn(v.state).filter(function (m) { return at >= m.from && at <= m.to })[0]
            if (mk) { acceptRange(v, mk); e.preventDefault(); return true }
          }
          var b = e.target.closest && e.target.closest('.cm-pid-arg')
          if (!b || !window.Argue || !curOf(v)) return false
          Argue.onBadge(curOf(v).path, b.getAttribute('data-pid'))
          return true
        }
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
        { key: 'Mod-Shift-a', run: acceptMark, preventDefault: true },
        { key: 'Mod-Shift-y', run: addMark, preventDefault: true },
        { key: 'Mod-Shift-m', run: nextMark, preventDefault: true },
        { key: 'Mod-e', run: function () { togglePreview(); return true }, preventDefault: true },
        { key: 'Mod-Shift-g', run: function () { run('figure'); return true }, preventDefault: true },
        { key: 'Mod-Shift-k', run: function () { run('claim'); return true }, preventDefault: true },
        { key: 'Mod-Shift-u', run: function () { run('question'); return true }, preventDefault: true },
        { key: 'Mod-Shift-t', run: function () { run('task'); return true }, preventDefault: true }
      ]),
      CM.keymap.of([].concat(CM.searchKeymap, CM.historyKeymap, CM.defaultKeymap, [CM.indentWithTab])),
      CM.EditorView.updateListener.of(function (u) {
        if (!u.docChanged) return
        updateStatus()
        schedulePreview()
        if (window.Binder) Binder.textChanged()
        if (window.TextSearch) TextSearch.textChanged()
        if (!loading && typeof setDirty === 'function') setDirty(true)
      })
    ]
    view = new CM.EditorView({ state: makeState(''), parent: $('wEditor') })
    primary = { view: view, current: null, kind: 'main', doc: document, el: $('wEditor') }
    panes = [primary]
    view.dom.addEventListener('focusin', function () { activate(primary) })
    view.dom.addEventListener('mousedown', function () { activate(primary) })
  }

  // Colour footnote markers, citations and passage IDs. These are markup, not words, so the
  // spell checker leaves them alone.
  function markPlugin(re, cls) {
    var deco = new CM.MatchDecorator({ regexp: re, decoration: CM.Decoration.mark({ class: cls, attributes: { spellcheck: 'false' } }) })
    return CM.ViewPlugin.fromClass(class {
      constructor(v) { this.decorations = deco.createDeco(v) }
      update(u) { this.decorations = deco.updateDeco(u, this.decorations) }
    }, { decorations: function (v) { return v.decorations } })
  }

  // Classification lens: mark lines that mention a node in the chosen category or tag.
  function lensPlugin() {
    var line = CM.Decoration.line({ class: 'cm-lensline' }), word = CM.Decoration.mark({ class: 'cm-lensword' })
    function find(v) {
      var cur = curOf(v)
      var terms = window.Classify && cur ? Classify.lensTerms(cur.nodeId) : []
      var pass = window.Classify && cur && Classify.lensPassages ? Classify.lensPassages(cur.path) : {}
      if (!terms.length && !Object.keys(pass).length) return CM.Decoration.none
      // whole paragraphs whose claim is in the filter
      var marked = {}, doc = v.state.doc
      if (Object.keys(pass).length) for (var i = 1; i <= doc.lines; i++) {
        var pm = /\s\^([a-z0-9]{4,12})\s*$/.exec(doc.line(i).text)
        if (pm && pass[pm[1]]) { var a = i; while (a > 1 && doc.line(a - 1).text.trim()) a--; for (var k = a; k <= i; k++) marked[k] = true }
      }
      if (!terms.length) terms = ['\u0000\u0000']
      var re = new RegExp('(^|[^\\p{L}\\p{N}])(' + terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }).join('|') + ')(?![\\p{L}\\p{N}])', 'giu')
      var ranges = []
      v.visibleRanges.forEach(function (r) {
        for (var pos = r.from; pos <= r.to;) {
          var l = v.state.doc.lineAt(pos), m, hit = false
          re.lastIndex = 0
          while ((m = re.exec(l.text))) { hit = true; var s = l.from + m.index + m[1].length; ranges.push(word.range(s, s + m[2].length)); if (!m[0].length) re.lastIndex++ }
          if (hit || marked[l.number]) ranges.push(line.range(l.from))
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

  // Passages with claims, questions or open tasks: a small marker after their ^id.
  function argPlugin() {
    function find(v) {
      var cur = curOf(v)
      var info = window.Argue && cur ? Argue.passageInfo(cur.path) : {}
      if (!Object.keys(info).length) return CM.Decoration.none
      var ranges = []
      v.visibleRanges.forEach(function (r) {
        for (var pos = r.from; pos <= r.to;) {
          var l = v.state.doc.lineAt(pos), m = /\s\^([a-z0-9]{4,12})\s*$/.exec(l.text)
          if (m && info[m[1]]) {
            var i = info[m[1]], badge = [], tip = []
            if (i.claims.length) { badge.push('◆' + i.claims.length); tip = tip.concat(i.claims.map(function (s) { return '◆ ' + s })) }
            if (i.questions.length) { badge.push('?' + i.questions.length); tip = tip.concat(i.questions.map(function (s) { return '? ' + s })) }
            if (i.tasks.length) { badge.push('☐' + i.tasks.length); tip = tip.concat(i.tasks.map(function (s) { return '☐ ' + s })) }
            var from = l.from + m.index + 1
            ranges.push(CM.Decoration.mark({ class: 'cm-pid-arg', attributes: { 'data-arg': badge.join(' '), 'data-pid': m[1], title: tip.join('\n') } }).range(from, from + m[1].length + 1))
          }
          pos = l.to + 1
        }
      })
      return CM.Decoration.set(ranges, true)
    }
    return CM.ViewPlugin.fromClass(class {
      constructor(v) { this.ver = window.Argue ? Argue.version() : 0; this.decorations = find(v) }
      update(u) {
        var ver = window.Argue ? Argue.version() : 0
        if (u.docChanged || u.viewportChanged || ver !== this.ver) { this.ver = ver; this.decorations = find(u.view) }
      }
    }, { decorations: function (v) { return v.decorations } })
  }

  // ───────── highlighted changes: [text]{.mark} ─────────
  // Text wrapped as [..]{.mark} (a highlight in Word) is a change waiting to be read.
  // Accepting it removes the wrapper and keeps the words.

  var MARK_RE = /\[((?:[^\[\]\n]|\[[^\[\]\n]*\])*)\]\{\.mark\}/g

  function marksInText(text, offset) {
    var out = [], m
    MARK_RE.lastIndex = 0
    while ((m = MARK_RE.exec(text))) out.push({ from: offset + m.index, to: offset + m.index + m[0].length, inner: m[1] })
    return out
  }
  function marksIn(st) { return marksInText(st.doc.toString(), 0) }

  function hlPlugin() {
    var body = CM.Decoration.mark({ class: 'cm-hl' }), open = CM.Decoration.mark({ class: 'cm-hl-open' })
    function find(v) {
      var ranges = []
      v.visibleRanges.forEach(function (r) {
        for (var pos = r.from; pos <= r.to;) {
          var l = v.state.doc.lineAt(pos)
          if (l.text.indexOf('{.mark}') >= 0) marksInText(l.text, l.from).forEach(function (m) {
            var endAt = m.to - 8
            ranges.push(open.range(m.from, m.from + 1))
            if (endAt > m.from + 1) ranges.push(body.range(m.from + 1, endAt))
            ranges.push(CM.Decoration.mark({ class: 'cm-hl-end', attributes: { title: L('markAcceptTip') } }).range(endAt, m.to))
          })
          pos = l.to + 1
        }
      })
      return CM.Decoration.set(ranges, true)
    }
    return CM.ViewPlugin.fromClass(class {
      constructor(v) { this.decorations = find(v) }
      update(u) { if (u.docChanged || u.viewportChanged) this.decorations = find(u.view) }
    }, { decorations: function (v) { return v.decorations } })
  }

  function acceptRange(v, m) {
    v.dispatch({ changes: [{ from: m.from, to: m.from + 1, insert: '' }, { from: m.to - 8, to: m.to, insert: '' }], userEvent: 'input' })
    var left = marksIn(v.state).length
    flash(left ? L('markAcceptedLeft').replace('%n', left) : L('markAllDone'))
  }

  // Go to the next highlight after the cursor (from the top again at the end) and select its words.
  function nextMark(v) {
    if (!current || (previewOn && v === primary.view)) return false
    var all = marksIn(v.state)
    if (!all.length) { flash(L('markNone')); return true }
    var sel = v.state.selection.main, head = sel.head
    var m = all.filter(function (x) { return x.from > head || (x.from === head && sel.empty) })[0] || all[0]
    v.dispatch({ selection: { anchor: m.from + 1, head: m.to - 8 }, effects: CM.EditorView.scrollIntoView(m.from, { y: 'center' }) })
    flash(L('markWhere').replace('%i', all.indexOf(m) + 1).replace('%n', all.length))
    v.focus()
    return true
  }

  // Accept the highlight the cursor is in; when it is in none, go to the next one.
  function acceptMark(v) {
    if (!current || (previewOn && v === primary.view)) return false
    var sel = v.state.selection.main
    var m = marksIn(v.state).filter(function (x) { return sel.from >= x.from && sel.to <= x.to && sel.head >= x.from && sel.head <= x.to })[0]
    if (!m) return nextMark(v)
    acceptRange(v, m)
    return true
  }

  // Highlight the selected words as a change to read later: [words]{.mark}.
  function addMark(v) {
    if (!current || (previewOn && v === primary.view)) return false
    var st = v.state, r = st.selection.main
    if (r.empty) { flash(L('markSelectFirst')); return true }
    if (/\n\s*\n/.test(st.sliceDoc(r.from, r.to))) { flash(L('markOneParagraph')); return true }
    var inside = marksIn(st).filter(function (m) { return r.from < m.to && r.to > m.from })[0]
    if (inside) { flash(L('markAlready')); return true }
    v.dispatch({ changes: [{ from: r.from, insert: '[' }, { from: r.to, insert: ']{.mark}' }],
      selection: { anchor: r.to + 9 }, userEvent: 'input' })
    return true
  }

  function acceptAllMarks(v) {
    if (!current || previewOn) return false
    var all = marksIn(v.state)
    if (!all.length) { flash(L('markNone')); return true }
    if (!confirm(L('markAllConfirm').replace('%n', all.length))) return true
    var ch = []
    all.forEach(function (m) { ch.push({ from: m.from, to: m.from + 1, insert: '' }, { from: m.to - 8, to: m.to, insert: '' }) })
    v.dispatch({ changes: ch, userEvent: 'input' })
    flash(L('markAllAccepted').replace('%n', all.length))
    return true
  }

  function closeMarkMenu() { var m = $('markMenu'); if (m) m.remove() }
  function markMenu() {
    if ($('markMenu')) { closeMarkMenu(); return }
    var btn = document.querySelector('#wToolbar button[data-cmd="marks"]'), n = marksIn(view.state).length
    var m = document.createElement('div')
    m.id = 'markMenu'
    m.className = 'bmenu argmenu'
    m.innerHTML = '<div class="mm-count">' + escapeHtml(n ? L('markCount').replace('%n', n) : L('markNone')) + '</div>' +
      [['add', 'markAdd', 'Ctrl+Shift+Y'], ['accept', 'markAcceptHere', 'Ctrl+Shift+A'], ['next', 'markNext', 'Ctrl+Shift+M'], ['all', 'markAcceptAll', '']].map(function (x) {
        return '<button data-mk="' + x[0] + '"' + (n || x[0] === 'add' ? '' : ' disabled') + '><span>' + escapeHtml(L(x[1])) + '</span>' + (x[2] ? '<kbd>' + x[2] + '</kbd>' : '') + '</button>'
      }).join('')
    $('writer').appendChild(m)
    var r = btn.getBoundingClientRect(), w = $('writer').getBoundingClientRect()
    m.style.top = (r.bottom - w.top + 4) + 'px'
    m.style.left = Math.max(8, Math.min(r.left - w.left, w.width - m.offsetWidth - 8)) + 'px'
    m.addEventListener('mousedown', function (e) { e.preventDefault() })
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mk]')
      if (!b || b.disabled) return
      closeMarkMenu()
      if (b.dataset.mk === 'add') addMark(view)
      else if (b.dataset.mk === 'accept') acceptMark(view)
      else if (b.dataset.mk === 'next') nextMark(view)
      else acceptAllMarks(view)
      view.focus()
    })
    document.addEventListener('mousedown', function away(e) {
      if (!e.target.closest('#markMenu') && !e.target.closest('button[data-cmd="marks"]')) { closeMarkMenu(); document.removeEventListener('mousedown', away, true) }
    }, true)
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
  // The ^id of the paragraph at the cursor, added if missing; null when there is no text there.
  function passageFor(v) {
    var st = v.state, line = st.doc.lineAt(st.selection.main.from)
    if (!line.text.trim() || /^---\s*$/.test(line.text)) return null
    var n = line.number
    while (n < st.doc.lines && st.doc.line(n + 1).text.trim()) n++
    var last = st.doc.line(n), m = /\s\^([a-z0-9]{4,12})\s*$/.exec(last.text), id
    if (m) return m[1]
    var doc = st.doc.toString()
    do { id = randomId() } while (doc.indexOf('^' + id) >= 0)
    v.dispatch({ changes: { from: last.to, insert: ' ^' + id }, userEvent: 'input' })
    return id
  }

  function passageId(v) {
    if (!current) return false
    var id = passageFor(v)
    if (!id) { flash(L('passageNeedsText')); return true }
    try { navigator.clipboard.writeText(current.path + '#' + id) } catch (e) { /* ignore */ }
    flash(L('passageCopied').replace('%s', '^' + id))
    return true
  }

  // The paragraph at the cursor as plain words (for a claim's first wording): its first sentence.
  function paragraphText() {
    if (!view || !current) return ''
    var st = view.state, line = st.doc.lineAt(st.selection.main.head)
    if (!line.text.trim()) return ''
    var a = line.number, b = line.number
    while (a > 1 && st.doc.line(a - 1).text.trim()) a--
    while (b < st.doc.lines && st.doc.line(b + 1).text.trim()) b++
    var text = st.sliceDoc(st.doc.line(a).from, st.doc.line(b).to).replace(MARK_RE, '$1')
      .replace(/\s\^[a-z0-9]{4,12}\s*$/, '').replace(/\[\^[^\]]+\]/g, '').replace(/\[@[^\]]*\]/g, '')
      .replace(/^#+\s*|^>\s*|^[-*]\s+|^\d+\.\s+/gm, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
    var m = /^(.{20,}?[.!?…])(\s|$)/.exec(text)
    return (m ? m[1] : text).slice(0, 240)
  }

  var COMMANDS = {
    bold: wrap('**'), italic: wrap('_'), heading: linePrefix('heading'), quote: linePrefix('quote'),
    bullet: linePrefix('bullet'), number: linePrefix('number'), link: link,
    footnote: footnote, cite: cite, passage: passageId, accept: acceptMark, nextmark: nextMark, acceptall: acceptAllMarks, markadd: addMark
  }
  var ARG = { claim: 1, question: 1, task: 1 }
  var TIPS = { bold: 'tbBold', italic: 'tbItalic', heading: 'tbHeading', quote: 'tbQuote', bullet: 'tbBullet',
    number: 'tbNumber', link: 'tbLink', footnote: 'tbFootnote', cite: 'tbCite', passage: 'tbPassage', marks: 'tbMarks', preview: 'tbPreview', docx: 'tbDocx', figure: 'tbFigure', argue: 'tbArgue' }

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
    if (name === 'marks') { if (view && current && !previewOn) markMenu(); return }
    if (name === 'figure') { if (window.Figures && current && !previewOn) Figures.openPicker(document.querySelector('#wToolbar button[data-cmd="figure"]')); return }
    if (name === 'argue') { if (window.Argue && current && !previewOn) Argue.menu(document.querySelector('#wToolbar button[data-cmd="argue"]')); return }
    if (ARG[name]) { if (window.Argue && current && !previewOn) Argue.capture(name); return }
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
    Array.prototype.forEach.call(document.querySelectorAll('#writer .wh [data-lt]'), function (b) { b.title = L(b.dataset.lt) })
    var bar = $('wToolbar')
    if (bar) bar.querySelectorAll('button[data-cmd]').forEach(function (b) { b.title = L(TIPS[b.dataset.cmd]) })
  }

  function flash(text) {
    var pane = paneOfView(view), el = pane && pane.msgEl ? pane.msgEl : $('wMsg')
    if (!el) return
    el.textContent = text
    clearTimeout(msgTimer)
    msgTimer = setTimeout(function () { el.textContent = '' }, 4000)
  }

  // ───────── preview (read-only, rendered) ─────────

  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

  function renderPreview() {
    if (!previewOn || !primary || !primary.current || !window.MD) return
    if (!md) {
      md = window.MD()
      var defaultValidate = md.validateLink
      md.validateLink = function (u) { return (window.Figures && Figures.isAssetUrl(u)) || defaultValidate(u) }   // project images only
    }
    var text = primary.view.state.doc.toString()
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')        // metadata block
      .replace(/[ \t]\^[a-z0-9]{4,12}[ \t]*$/gm, '')         // passage IDs
    text = text.replace(MARK_RE, '\uE000$1\uE001')                // highlighted changes
    if (window.Figures) text = Figures.previewMarkdown(text)
    var html = md.render(text).replace(/\uE000/g, '<mark>').replace(/\uE001/g, '</mark>')
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
    if (!primary || !primary.current) return
    activate(primary)
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
    var deco = CM.Decoration.line({ class: 'cm-fm', attributes: { spellcheck: 'false' } })
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

  function spellAttrs() {
    // Chromium's own marking stays off: spellPlugin does the checking (see above)
    return CM.EditorView.contentAttributes.of({ spellcheck: 'false', lang: spell.lang })
  }

  // ───────── spell checking in the editor ─────────

  function spellApi() { var a = api(); return a && a.spellCheck ? a : null }
  function spellActive() { return spell.on && !!spellApi() }

  // Markup that is not prose, blanked with spaces (columns stay): footnote and citation keys,
  // passage IDs, web addresses, link and image targets, {attributes}, <autolinks>, @fig:…
  // references and `code`.
  var NO_SPELL = /\[\^[^\]\s]+\]|\[[^\][\n]*@[^\][\n]*\]|\s\^[a-z0-9]{4,12}\s*$|https?:\/\/\S+|\]\([^)\s]*\)|\{[^}\n]*\}|<[^>\s]+>|@[A-Za-z0-9_:.-]+|`[^`\n]*`/g
  var WORD = /[\p{L}\p{M}\p{N}]+/gu
  function proseWords(text) {
    var line = text.replace(NO_SPELL, function (m) { return ' '.repeat(m.length) }), out = [], m
    WORD.lastIndex = 0
    while ((m = WORD.exec(line))) {
      var w = m[0]
      if (w.length < 2 || /\p{N}/u.test(w)) continue                       // numbers, 3D, 1950'de
      if (/['’]/.test(line[m.index - 1] || '') && /[\p{L}\p{M}]/u.test(line[m.index - 2] || '')) continue   // the suffix in Goethe'nin, Faust’ta
      if (w === w.toLocaleUpperCase(spell.lang) && w !== w.toLocaleLowerCase(spell.lang)) continue   // AB, NATO
      out.push({ from: m.index, to: m.index + w.length, word: w })
    }
    return out
  }
  // A word's answer, if known (true: misspelled). Words not asked about yet are queued and
  // asked together (main.js checks them with the dictionaries that ship with Mentegraf);
  // the answer marks them a moment later.
  var spellQueue = new Set(), spellTimer = null
  function misspelled(word) {
    if (window.Spell && Spell.known(word)) return false
    if (spellCache.has(word)) return spellCache.get(word)
    spellQueue.add(word)
    if (!spellTimer) spellTimer = setTimeout(askSpelling, 30)
    return false
  }
  function askSpelling() {
    spellTimer = null
    var words = Array.from(spellQueue).slice(0, 2000), gen = spellGen
    words.forEach(function (w) { spellQueue.delete(w) })
    if (!words.length || !spellApi()) return
    Promise.resolve(spellApi().spellCheck(words)).then(function (bad) {
      if (!Array.isArray(bad) || gen !== spellGen) return   // the language changed meanwhile
      var any = false
      words.forEach(function (w, i) { spellCache.set(w, !!bad[i]); if (bad[i]) any = true })
      if (any) spellRefresh(false)
      if (spellQueue.size && !spellTimer) spellTimer = setTimeout(askSpelling, 30)
    }, function () { /* no answer: leave the words unmarked */ })
  }
  // Lines that are not checked: the metadata block and fenced code.
  function skippedLines(doc, upTo) {
    var skip = {}, i = 1
    if (doc.lines > 1 && doc.line(1).text.trim() === '---') {
      for (var j = 2; j <= Math.min(doc.lines, 60); j++) if (doc.line(j).text.trim() === '---') { for (var k = 1; k <= j; k++) skip[k] = true; i = j + 1; break }
    }
    var fence = false
    for (; i <= Math.min(doc.lines, upTo); i++) {
      var t = doc.line(i).text
      if (/^\s*(```|~~~)/.test(t)) { skip[i] = true; fence = !fence; continue }
      if (fence) skip[i] = true
    }
    return skip
  }
  function spellPlugin() {
    var mark = CM.Decoration.mark({ class: 'cm-misspelled' })
    function find(v) {
      if (!spellActive()) return CM.Decoration.none
      var doc = v.state.doc, ranges = []
      var last = v.visibleRanges.length ? doc.lineAt(v.visibleRanges[v.visibleRanges.length - 1].to).number : 0
      var skip = skippedLines(doc, last)
      v.visibleRanges.forEach(function (r) {
        for (var pos = r.from; pos <= r.to;) {
          var l = doc.lineAt(pos)
          if (!skip[l.number]) proseWords(l.text).forEach(function (w) { if (misspelled(w.word)) ranges.push(mark.range(l.from + w.from, l.from + w.to)) })
          pos = l.to + 1
        }
      })
      return CM.Decoration.set(ranges, true)
    }
    return CM.ViewPlugin.fromClass(class {
      constructor(v) { this.ver = spellVer; this.decorations = find(v) }
      update(u) {
        if (u.docChanged || u.viewportChanged || this.ver !== spellVer) { this.ver = spellVer; this.decorations = find(u.view) }
      }
    }, { decorations: function (v) { return v.decorations } })
  }
  // Something the check depends on changed: check the visible words again.
  function spellRefresh(clearCache) {
    if (clearCache) { spellCache.clear(); spellGen++ }
    spellVer++
    panes.forEach(function (p) { try { p.view.dispatch({}) } catch (e) { /* closed */ } })
  }

  // Right-click on a marked word: suggestions and the project's word lists (main.js shows
  // the menu). Anywhere else the event goes on to the usual menu.
  function spellMenu(e, v) {
    if (!spellActive() || !spellApi().spellMenu) return false
    var pos = v.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos == null) return false
    var l = v.state.doc.lineAt(pos)
    if (skippedLines(v.state.doc, l.number)[l.number]) return false
    var at = pos - l.from
    var w = proseWords(l.text).filter(function (x) { return at >= x.from && at <= x.to })[0]
    if (!w || !misspelled(w.word)) return false
    e.preventDefault()
    var from = l.from + w.from, to = l.from + w.to, word = w.word
    var hasSelection = !v.state.selection.main.empty
    Promise.resolve(spellApi().spellSuggest(word)).catch(function () { return [] }).then(function (sugg) {
      return spellApi().spellMenu({ word: word, suggestions: (sugg || []).slice(0, 6), hasSelection: hasSelection })
    }).then(function (r) {
      if (!r) return
      if (r.replace != null && v.state.sliceDoc(from, to) === word) {
        v.dispatch({ changes: { from: from, to: to, insert: r.replace }, selection: { anchor: from + r.replace.length } })
        v.focus()
      }
      if (r.known && window.Spell) { Spell.addKnown(r.known); spellRefresh(false) }
    })
    return true
  }

  // The book's language or the on/off switch changed (spell.js): every pane, every text kept in
  // memory and every text opened later follow it. The search panel (Ctrl+F) lower-cases with
  // the same language, so that in Turkish I/ı and İ/i pair up.
  function setSpellcheck(on, lang) {
    var langChanged = spell.lang !== (lang === 'en' ? 'en' : 'tr')
    spell = { on: !!on, lang: lang === 'en' ? 'en' : 'tr' }
    window.MENTEGRAF_SEARCH_LOCALE = spell.lang
    if (langChanged) { spellCache.clear(); spellGen++ }
    spellVer++
    if (!extensions) return
    extensions[0] = spellComp.of(spellAttrs())           // for texts opened from now on
    var effect = spellComp.reconfigure(spellAttrs())
    syncCurrent()
    Object.keys(buffers).forEach(function (p) { var b = buffers[p]; if (b && b.state) b.state = b.state.update({ effects: effect }).state })
    panes.forEach(function (p) { try { p.view.dispatch({ effects: effect }) } catch (e) { /* closed */ } })
    syncCurrent()
  }

  function makeState(text) {
    if (!extensions) build()          // every text gets history, keys and highlighting
    return CM.EditorState.create({ doc: text, extensions: extensions })
  }

  function textOf(path) {
    var p = paneShowing(path)
    if (p) return p.view.state.doc.toString()
    var b = buffers[path]
    return b ? b.state.doc.toString() : null
  }

  function syncCurrent() {
    panes.forEach(function (p) { if (p.current && buffers[p.current.path]) buffers[p.current.path].state = p.view.state })
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
    var p = paneOfView(view), wEl = p && p.wordsEl ? p.wordsEl : $('wWords'), sEl = p && p.stateEl ? p.stateEl : $('wState')
    wEl.textContent = words.toLocaleString(window.curLang === 'en' ? 'en-GB' : 'tr-TR') + ' ' + L('words')
    var b = buffers[current.path]
    sEl.textContent = b && view.state.doc.toString() !== b.saved ? L('unsavedText') : ''
  }

  function show(path, node, keepFocus) {
    build()
    syncCurrent()
    var other = paneShowing(path)
    if (other && other !== primary) {                 // already open beside or in a window
      activate(other)
      if (other.win) { try { other.win.focus() } catch (e) { /* closed */ } }
      if (!keepFocus) other.view.focus()
      return
    }
    activate(primary)
    current = primary.current = { nodeId: node.id(), path: path }
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
    if (primary) primary.current = null
    panes.filter(function (p) { return p.kind === 'side' }).forEach(closePane)
    activate(panes.filter(function (p) { return p.current })[0] || primary)
    if (primary && view === primary.view) current = null
    var main = $('main')
    main.classList.remove('writing', 'writer-full')
    resizeGraph()
  }

  function toggleFull() {
    $('main').classList.toggle('writer-full')
    resizeGraph()
    if (view) view.focus()
  }

  // ───────── panes: beside the main text, or in a window of its own ─────────

  function paneOfView(v) { for (var i = 0; i < panes.length; i++) if (panes[i].view === v) return panes[i]; return null }
  function curOf(v) { var p = paneOfView(v); return p ? p.current : current }
  function paneShowing(path) { for (var i = 0; i < panes.length; i++) if (panes[i].current && panes[i].current.path === path) return panes[i]; return null }

  // Make a pane the one that commands, the toolbar and the status line work on.
  function activate(p) {
    if (!p || !p.view) return
    view = p.view
    current = p.current
    panes.forEach(function (x) { if (x.el) x.el.classList.toggle('active', x === p) })
    updateStatus()
  }

  function setPaneTitle(p, label) {
    if (p.titleEl) p.titleEl.textContent = label || ''
    if (p.win) { try { p.win.document.title = (label || '') + ' — Mentegraf' } catch (e) { /* closed */ } }
  }

  var PANE_TOOLS = [['bold', 'B', 'tb-b'], ['italic', 'I', 'tb-i'], ['footnote', '¹', 'tb-fn'], ['passage', '¶', ''], ['sep'], ['markadd', '▌', 'tb-hl'], ['accept', '✓', 'tb-acc'], ['nextmark', '↓', '']]
  var PANE_TIPS = { markadd: 'markAdd', accept: 'markAcceptHere', nextmark: 'markNext' }

  // The pane's own header, small toolbar, editor and status line, built in `doc` (the main
  // window's document or a window of its own).
  function paneDom(p, doc) {
    var el = doc.createElement('div')
    el.className = 'wpane wpane-' + p.kind
    var head = doc.createElement('div')
    head.className = 'wpane-h'
    head.innerHTML = '<div class="wt"><span class="wpane-title"></span><span class="wpane-path"></span></div><div class="wbtns"></div>'
    var btns = head.querySelector('.wbtns')
    var addBtn = function (txt, tip, fn) {
      var b = doc.createElement('button'); b.textContent = txt; b.title = L(tip); b.setAttribute('aria-label', L(tip))
      b.addEventListener('click', fn); btns.appendChild(b)
    }
    if (p.kind === 'side') {
      addBtn('⇱', 'paneToWindow', function () { var c = p.current; if (!c) return; closePane(p); openInWindow(c.nodeId) })
      addBtn('✕', 'paneClose', function () { closePane(p) })
    } else {
      addBtn('⇲', 'paneToMain', function () { var c = p.current; closePane(p); if (c && window.cy) { var n = cy.getElementById(c.nodeId); if (n.length) openForNode(n) } })
    }
    var bar = doc.createElement('div')
    bar.className = 'wtb wpane-tb'
    bar.innerHTML = PANE_TOOLS.map(function (x) {
      return x[0] === 'sep' ? '<span class="wsep"></span>' : '<button data-pcmd="' + x[0] + '" class="' + x[2] + '" title="' + escapeHtml(L(PANE_TIPS[x[0]] || TIPS[x[0]])) + '">' + x[1] + '</button>'
    }).join('')
    bar.addEventListener('mousedown', function (e) { if (e.target.closest('button')) e.preventDefault() })
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-pcmd]'); if (!b || !p.current) return
      activate(p)
      COMMANDS[b.dataset.pcmd](p.view)
      p.view.focus()
    })
    var ed = doc.createElement('div')
    ed.className = 'wpane-ed'
    var st = doc.createElement('div')
    st.className = 'wst'
    st.innerHTML = '<span class="wpane-words"></span><span class="wpane-msg"></span><span class="wpane-state"></span>'
    el.appendChild(head); el.appendChild(bar); el.appendChild(ed); el.appendChild(st)
    p.el = el
    p.titleEl = head.querySelector('.wpane-title')
    p.pathEl = head.querySelector('.wpane-path')
    p.wordsEl = st.querySelector('.wpane-words')
    p.msgEl = st.querySelector('.wpane-msg')
    p.stateEl = st.querySelector('.wpane-state')
    return ed
  }

  // Load a node's text into the buffers (as openForNode does) without showing it.
  async function loadBuffer(node) {
    var path = node.data('fragment')
    if (!path || !api()) return null
    if (!buffers[path]) {
      var r = await api().fragmentRead(path)
      if (r.error || !r.exists) { alert(L('textError') + '\n\n' + (r.message || path)); return null }
      buffers[path] = { state: makeState(r.text), saved: r.text }
    }
    return path
  }

  function mountPane(p, parent, doc, node, path) {
    syncCurrent()
    p.current = { nodeId: node.id(), path: path }
    p.view = new CM.EditorView({ state: buffers[path].state, parent: parent, root: doc })
    p.view.dom.addEventListener('focusin', function () { activate(p) })
    p.view.dom.addEventListener('mousedown', function () { activate(p) })
    panes.push(p)
    setPaneTitle(p, node.data('label'))
    if (p.pathEl) p.pathEl.textContent = path
    activate(p)
    p.view.focus()
  }

  // Open a node's text in a second pane beside the main one (two chapters side by side).
  async function openBeside(nodeOrId) {
    build()
    var node = typeof nodeOrId === 'string' ? cy.getElementById(nodeOrId) : nodeOrId
    if (!node || !node.length) return false
    var path = await loadBuffer(node)
    if (!path) return false
    var there = paneShowing(path)
    if (there) { activate(there); there.view.focus(); flash(L('paneAlreadyOpen')); return false }
    var old = panes.filter(function (x) { return x.kind === 'side' })[0]
    if (old) closePane(old)
    var p = { kind: 'side', doc: document }
    var ed = paneDom(p, document)
    $('wBody').appendChild(p.el)
    var main = $('main')
    if (!main.classList.contains('writing')) openPane()
    if (!main.classList.contains('writer-full')) { main.classList.add('writer-full'); p.madeFull = true; resizeGraph() }
    main.classList.add('writer-split')
    mountPane(p, ed, document, node, path)
    return true
  }

  // Open a node's text in a window of its own (for a second screen).
  async function openInWindow(nodeOrId) {
    build()
    var node = typeof nodeOrId === 'string' ? cy.getElementById(nodeOrId) : nodeOrId
    if (!node || !node.length) return false
    var path = await loadBuffer(node)
    if (!path) return false
    var there = paneShowing(path)
    if (there && there.win) { try { there.win.focus() } catch (e) { /* closed */ } return false }
    if (there) closePane(there === primary ? null : there)
    if (there === primary) detachPrimaryOnly()
    var win = window.open('', 'mentegraf-text-' + node.id(), 'width=900,height=1000')
    if (!win) return false
    var doc = win.document
    doc.open()
    // the layout is set inline so the window is right before the stylesheet arrives
    doc.write('<!doctype html><html><head><meta charset="utf-8"><title></title><style>html,body{margin:0;height:100%;overflow:hidden}' +
      '.wpane{display:flex;flex-direction:column;height:100vh}.wpane-ed{flex:1;min-height:0;overflow:hidden}.wpane-ed .cm-editor{height:100%}</style></head><body class="wwin" spellcheck="false"></body></html>')
    doc.close()
    var loads = []
    Array.prototype.forEach.call(document.querySelectorAll('link[rel="stylesheet"]'), function (l) {
      var c = doc.createElement('link'); c.rel = 'stylesheet'; c.href = l.href
      loads.push(new Promise(function (res) { c.onload = c.onerror = res; setTimeout(res, 1500) }))
      doc.head.appendChild(c)
    })
    doc.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') || 'light')
    doc.documentElement.setAttribute('lang', document.documentElement.getAttribute('lang') || 'tr')
    var p = { kind: 'window', doc: doc, win: win }
    var ed = paneDom(p, doc)
    doc.body.appendChild(p.el)
    await Promise.all(loads)
    if (win.closed) return false
    mountPane(p, ed, doc, node, path)
    // closing the window keeps the edits in memory; they are saved with the project
    win.addEventListener('pagehide', function () { if (panes.indexOf(p) >= 0) closePane(p, true) })
    return true
  }

  // Leave the main pane empty after its text moved to a window.
  function detachPrimaryOnly() {
    if (!primary) return
    syncCurrent()
    primary.current = null
    if (view === primary.view) current = null
    loading = true
    primary.view.setState(CM.EditorState.create({ doc: '', extensions: [extensions, CM.EditorView.editable.of(false)] }))
    loading = false
    $('wTitle').textContent = ''; $('wPath').textContent = ''
    var side = panes.filter(function (x) { return x.kind === 'side' })[0]
    if (!side) { $('main').classList.remove('writing', 'writer-full', 'writer-split'); resizeGraph() }
  }
  function detachMain() { if (primary && primary.current) openInWindow(primary.current.nodeId) }

  function closePane(p, windowGone) {
    if (!p || p === primary || panes.indexOf(p) < 0) return
    syncCurrent()
    panes.splice(panes.indexOf(p), 1)
    try { p.view.destroy() } catch (e) { /* already gone */ }
    if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el)
    if (p.win && !windowGone) { try { p.win.close() } catch (e) { /* closed */ } }
    if (p.kind === 'side') {
      var main = $('main')
      main.classList.remove('writer-split')
      if (p.madeFull) { main.classList.remove('writer-full'); resizeGraph() }
      if (!primary.current) { main.classList.remove('writing', 'writer-full'); resizeGraph() }
    }
    if (view === p.view) activate(primary.current ? primary : (panes.filter(function (x) { return x.current })[0] || primary))
    if (view === primary.view && !primary.current) current = null
  }

  // "Beside" button: the texts of the book plan (and other texts), to open next to this one.
  function sideMenu(btn) {
    var old = $('sideMenu')
    if (old) { old.remove(); return }
    if (!window.cy) return
    var seen = {}, rows = []
    var add = function (n, depth) {
      if (!n || !n.length || seen[n.id()] || !n.data('fragment')) return
      seen[n.id()] = true
      rows.push({ id: n.id(), label: n.data('label') || n.data('fragment'), depth: depth, open: !!paneShowing(n.data('fragment')) })
    }
    var walk = function (list, depth) { (list || []).forEach(function (it) { if (it.kind === 'node') add(cy.getElementById(it.node), depth); walk(it.children, depth + 1) }) }
    if (window.Binder && Binder.get) walk(Binder.get().items, 0)
    var rest = []
    cy.nodes().forEach(function (n) { if (n.data('fragment') && !seen[n.id()]) rest.push(n) })
    rest.sort(function (a, b) { return String(a.data('label')).localeCompare(String(b.data('label')), 'tr') }).forEach(function (n) { add(n, 0) })
    var m = document.createElement('div')
    m.id = 'sideMenu'
    m.className = 'bmenu argmenu sidemenu'
    m.innerHTML = '<div class="mm-count">' + escapeHtml(L('paneBesideHint')) + '</div>' + rows.map(function (r) {
      return '<button data-id="' + escapeHtml(r.id) + '"' + (r.open ? ' disabled' : '') + ' style="padding-left:' + (10 + r.depth * 14) + 'px"><span>' + escapeHtml(r.label) + '</span><kbd data-win="1" title="' + escapeHtml(L('paneWindowTip')) + '">⇱</kbd></button>'
    }).join('')
    $('writer').appendChild(m)
    var r = btn.getBoundingClientRect(), w = $('writer').getBoundingClientRect()
    m.style.top = (r.bottom - w.top + 4) + 'px'
    m.style.left = Math.max(8, Math.min(r.left - w.left - 220, w.width - m.offsetWidth - 8)) + 'px'
    m.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]'); if (!b || b.disabled) return
      m.remove()
      if (e.target.closest('[data-win]')) openInWindow(b.dataset.id); else openBeside(b.dataset.id)
    })
    document.addEventListener('mousedown', function away(e) {
      if (!e.target.closest('#sideMenu') && !e.target.closest('[data-act="beside"]')) { m.remove(); document.removeEventListener('mousedown', away, true) }
    }, true)
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
    var shown = paneShowing(path)
    if (shown) {
      var v = shown.view, head = v.state.selection.main.head   // keep the cursor where it was
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, selection: { anchor: Math.min(head, text.length) } })
      b.state = v.state
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
      setTimeout(function () {
        panes.slice().forEach(function (p) { if (p !== primary && p.current && cy.getElementById(p.current.nodeId).empty()) closePane(p) })
        if (primary && primary.current && cy.getElementById(primary.current.nodeId).empty()) close()
      }, 0)
    })
    cy.on('data', 'node', function (e) {
      if (primary && primary.current && e.target.id() === primary.current.nodeId) $('wTitle').textContent = e.target.data('label') || ''
      panes.forEach(function (p) { if (p.titleEl && p.current && e.target.id() === p.current.nodeId) setPaneTitle(p, e.target.data('label')) })
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
    panes.slice().forEach(function (p) { if (p !== primary) closePane(p) })
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
    openBeside: openBeside, openInWindow: openInWindow, sideMenu: sideMenu, detachMain: detachMain, panes: function () { return panes.map(function (p) { return { kind: p.kind, path: p.current && p.current.path } }) },
    init: init, reset: reset, openForNode: openForNode, close: close, toggleFull: toggleFull, run: run, togglePreview: togglePreview, exportDocx: exportDocx,
    updatePanel: updatePanel, dirtyFragments: dirtyFragments, willSave: willSave, markSaved: markSaved,
    hasUnsaved: hasUnsaved, loadRecovered: loadRecovered, handleMenu: handleMenu, setSpellcheck: setSpellcheck, spellRefresh: spellRefresh,
    // Text of a loaded buffer (including unsaved edits), or null if not loaded.
    textFor: function (path) { return buffers[path] ? textOf(path) : null },
    // Argument capture (argue.js).
    ensurePassage: function () { return view && current ? passageFor(view) : null },
    paragraphText: paragraphText,
    flash: function (t) { flash(t) },
    focus: function () { if (view && current && !previewOn) view.focus() },
    refreshArgs: function () { panes.forEach(function (p) { p.view.dispatch({}) }) },
    cursorCoords: function () { if (!view || !current) return null; try { return view.coordsAtPos(view.state.selection.main.head) } catch (e) { return null } },
    // Select the paragraph that ends with ^id and bring it into view.
    revealPassage: function (id) {
      if (!view || !current) return false
      if (previewOn) togglePreview()
      var doc = view.state.doc, re = new RegExp('\\s\\^' + id + '\\s*$')
      for (var i = 1; i <= doc.lines; i++) {
        var l = doc.line(i)
        if (!re.test(l.text)) continue
        var a = i; while (a > 1 && doc.line(a - 1).text.trim()) a--
        var from = doc.line(a).from
        view.dispatch({ selection: { anchor: from, head: l.to - (l.text.length - l.text.replace(/\s\^[a-z0-9]{4,12}\s*$/, '').length) }, effects: CM.EditorView.scrollIntoView(from, { y: 'center' }) })
        view.focus()
        return true
      }
      return false
    },
    // Bring the first highlighted change into view (work queue).
    firstMark: function () {
      if (!view || !current) return false
      if (previewOn) togglePreview()
      view.dispatch({ selection: { anchor: 0 } })
      return nextMark(view)
    },
    // Select a found word and bring it to the middle of the pane (search results).
    reveal: function (line, col, len) {
      if (!view || !current) return false
      if (previewOn) togglePreview()
      var doc = view.state.doc
      if (!(line >= 1 && line <= doc.lines)) return false
      var l = doc.line(line), from = Math.min(l.to, l.from + (col || 0)), to = Math.min(l.to, from + (len || 0))
      view.dispatch({ selection: { anchor: from, head: to }, effects: CM.EditorView.scrollIntoView(from, { y: 'center' }) })
      view.focus()
      return true
    },
    // The selected words in the open text ('' when nothing is selected).
    selectionText: function () {
      if (!view || !current) return ''
      var r = view.state.selection.main
      return view.state.sliceDoc(r.from, r.to).trim()
    },
    // Re-mark lens lines after the lens changed.
    refreshLens: function () { panes.forEach(function (p) { p.view.dispatch({}) }) },
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
