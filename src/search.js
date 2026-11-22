// search.js — search in all texts (manuscript/ and notes/), shown in the classification pane.
//
// The main process reads the files; texts open in the editor are sent along so that
// unsaved changes are searched too. With a category or tag filter on, the search can be
// limited to the texts of the matching nodes. A result opens its text at the line.
//
// Two boxes shape the search: "Match letters exactly" (case, circumflex and Turkish letters
// count; otherwise "kar" also finds "kâr" and "KAR") and "Whole word" ("kar" does not find
// "karmaşık"). They open with the project's defaults (project.mentegraf → settings.search)
// and change only the search at hand; "Make default" writes the current choice back.
/* global cy, L, snapshot, selNode, curLang, Writer, Classify, ProjectFormat, catById, projectSettings, setDirty, Replace */
var TextSearch = (function () {
  'use strict'

  var timer = null, seq = 0, last = null, bound = false

  function $(id) { return document.getElementById(id) }
  function api() { return window.mentegraf }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }

  // The query exactly as typed: spaces at the start or end are the writer's choice.
  function query() { var i = $('sQuery'); return i ? i.value : '' }

  // ───────── replacing, one hit at a time ─────────
  // With text in "Replace with", each hit shows the change and has Replace and Skip. Nothing
  // is replaced in bulk: each hit opens in the editor and is changed there (Ctrl+Z undoes it).
  var marks = new Replace.Marks()
  function replText() { var i = $('sReplace'); return i ? i.value : '' }
  function replacing() { return replText() !== '' }
  function bookLang() { return window.Spell && Spell.language ? Spell.language() : (curLang === 'en' ? 'en' : 'tr') }
  // What goes into the text in place of `found`: as typed with "Match letters exactly",
  // otherwise with the case of the found word (Kar → Kâr, KAR → KÂR).
  function replacementFor(found) { return choice().exact ? replText() : Replace.matchCase(found, replText(), bookLang()) }
  function resetMarks() { marks.clear() }
  // A warning in the status line (showMsg is for things that went well).
  function warn(msg) {
    var m = $('ml'); if (!m) return
    m.innerHTML = ''
    var sp = document.createElement('span'); sp.style.color = '#b3261e'; sp.textContent = '⚠ ' + msg
    m.appendChild(sp)
    setTimeout(function () { if (m.firstChild === sp) m.textContent = '' }, 6000)
  }

  function usable(q) { return q.length >= 2 && !!q.trim() }
  function active() { return usable(query()) }

  function checked(id) { var c = $(id); return !!(c && c.checked) }
  function choice() { return { exact: checked('sExact'), wholeWord: checked('sWhole') } }
  function defaults() {
    var s = window.projectSettings && projectSettings.search
    return { exact: !!(s && s.exact), wholeWord: !!(s && s.wholeWord) }
  }
  // Put the boxes back to the project's defaults (a project was opened or created).
  function applyDefaults() {
    var d = defaults()
    if ($('sExact')) $('sExact').checked = d.exact
    if ($('sWhole')) $('sWhole').checked = d.wholeWord
    showDefaultLink()
    if (active()) schedule(0)
  }
  // "Make default" is offered only while the boxes differ from the project's defaults.
  function showDefaultLink() {
    var a = $('sMakeDefault'); if (!a) return
    var c = choice(), d = defaults()
    a.style.visibility = c.exact !== d.exact || c.wholeWord !== d.wholeWord ? 'visible' : 'hidden'
  }
  function makeDefault() {
    if (!window.projectSettings) return
    projectSettings.search = choice()
    if (typeof setDirty === 'function') setDirty(true)
    showDefaultLink()
  }

  // path -> node, for the texts that belong to a node
  function nodeByPath() {
    var m = {}
    if (window.cy) cy.nodes().forEach(function (n) { if (n.data('fragment')) m[n.data('fragment')] = n })
    return m
  }

  function lensOn() { return !!(window.Classify && Classify.active()) }
  function onlyInLens() { var c = $('sInLens'); return lensOn() && c && c.checked }

  async function run() {
    var q = query(), pane = $('classes'), on = usable(q)
    pane.classList.toggle('searching', on)
    $('sLensRow').style.display = lensOn() && on ? '' : 'none'
    if (!on) { $('sResults').innerHTML = q ? '<div class="cnone">' + esc(L('searchShort')) + '</div>' : ''; last = null; return }
    if (!api() || !api().textSearch) return
    var overrides = {}
    if (window.Writer && Writer.dirtyFragments) Writer.dirtyFragments().forEach(function (f) { overrides[f.path] = f.text })
    var c = choice()
    var opts = { overrides: overrides, exact: c.exact, wholeWord: c.wholeWord }
    if (onlyInLens()) {
      var only = []
      cy.nodes().forEach(function (n) {
        if (!Classify.matches(n.id())) return
        if (n.data('fragment')) only.push(n.data('fragment'))
        var m = /^(.+\.md)#/.exec(String(n.data('passage') || ''))   // a claim in the filter: search its text too
        if (m) only.push(m[1])
      })
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
    var rep = replacing(), left = 0
    var list = files.map(function (f) {
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
          var where = h.where === 'footnote' || h.where === 'caption' ? '<span class="swhere">' + esc(L(h.where === 'footnote' ? 'searchInFootnote' : 'searchInCaption')) + '</span> ' : ''
          var data = ' data-line="' + h.line + '" data-col="' + h.col + '" data-len="' + h.len + '" data-match="' + esc(h.match) + '"'
          if (!rep || !n) {
            return '<div class="shit"' + data + '><span class="sline">' + h.line + '</span>' +
              '<span class="stext">' + where + esc(h.before) + '<mark>' + esc(h.match) + '</mark>' + esc(h.after) + '</span></div>'
          }
          var target = replacementFor(h.match), same = h.match === target
          var state = marks.get(f.path, h.line, h.col)
          if (state === 'replaced' && !same) state = null        // undone in the editor (Ctrl+Z): to do again
          if (!state && same) state = 'same'                      // already written that way
          if (!state) left++
          var word = state ? '<mark>' + esc(h.match) + '</mark>'
            : '<del>' + esc(h.match) + '</del><ins>' + esc(target) + '</ins>'
          var tail = state === 'replaced' ? '<span class="sstate">✓ ' + esc(L('replaceDoneLbl')) + '</span>'
            : state === 'same' ? '<span class="sstate">' + esc(L('replaceSameLbl')) + '</span>'
            : state === 'skipped' ? '<button class="sact" data-act="unskip" title="' + esc(L('replaceUnskipTip')) + '">' + esc(L('replaceSkippedLbl')) + '</button>'
            : '<span class="sacts"><button class="sact sdo" data-act="rep">' + esc(L('replaceBtn')) + '</button><button class="sact" data-act="skip">' + esc(L('replaceSkipBtn')) + '</button></span>'
          return '<div class="shit' + (state ? ' sdone' : '') + '"' + data + '><span class="sline">' + h.line + '</span>' +
            '<span class="stext">' + where + esc(h.before) + word + esc(h.after) + '</span>' + tail + '</div>'
        }).join('') + '</div>'
    }).join('')
    if (rep) head += '<div class="sreprow"><span>' + esc(L('replaceLeft').replace('%n', left)) + '</span>' +
      (left ? '<button class="sact sdo" data-act="next">' + esc(L('replaceNext')) + '</button>' : '') + '</div>'
    box.innerHTML = head + list
  }

  // The next hit not yet replaced or skipped: open it in the editor, word selected, to be read
  // before deciding.
  async function openNext() {
    var h = document.querySelector('#sResults .sfile:not(.snonode) .shit:not(.sdone)')
    document.querySelectorAll('#sResults .shit.scur').forEach(function (e) { e.classList.remove('scur') })
    if (!h) return false
    h.classList.add('scur')
    h.scrollIntoView({ block: 'nearest' })
    await openHit(h)
    return true
  }

  async function act(el, kind) {
    var h = el.closest('.shit'), file = h && h.closest('.sfile')
    if (!h || !file) return
    var path = file.dataset.path, line = +h.dataset.line, col = +h.dataset.col, len = +h.dataset.len, match = h.dataset.match
    if (kind === 'skip') { marks.skip(path, line, col); render(); await openNext(); return }
    if (kind === 'unskip') { marks.unskip(path, line, col); render(); return }
    if (kind !== 'rep') return
    var text = replacementFor(match)
    await openHit(h)
    if (!Writer.replaceAt || !Writer.replaceAt(path, line, col, len, match, text)) {
      warn(L('replaceStale'))
      await run()
      return
    }
    marks.replaced(path, line, col, len, text.length)
    await run()
    await openNext()
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
      if (e.key === 'Enter') { if (replacing()) { openNext(); return } var first = document.querySelector('#sResults .sfile:not(.snonode) .shit'); if (first) openHit(first) }
    })
    input.addEventListener('input', resetMarks)
    var repl = $('sReplace')
    repl.addEventListener('input', function () { resetMarks(); if (last) render() })
    repl.addEventListener('keydown', function (e) {
      e.stopPropagation()
      if (e.key === 'Escape') { repl.value = ''; resetMarks(); if (last) render() }
      if (e.key === 'Enter') { e.preventDefault(); openNext() }
    })
    $('sInLens').addEventListener('change', function () { schedule(0) })
    ;['sExact', 'sWhole'].forEach(function (id) { $(id).addEventListener('change', function () { resetMarks(); showDefaultLink(); schedule(0) }) })
    $('sMakeDefault').addEventListener('click', function (e) { e.preventDefault(); makeDefault() })
    applyDefaults()
    $('sResults').addEventListener('click', function (e) {
      if (e.target.closest('[data-act="link"]')) { link(e.target.closest('.sfile')); return }
      var b = e.target.closest('[data-act]')
      if (b && b.dataset.act === 'next') { openNext(); return }
      if (b && /^(rep|skip|unskip)$/.test(b.dataset.act)) { act(b, b.dataset.act); return }
      var h = e.target.closest('.shit'); if (h) openHit(h)
    })
    if (window.cy) {
      cy.on('select unselect', 'node', function () { if (last) render() })
    }
  }

  // The filter changed: limit or widen the results.
  function lensChanged() { if (active()) schedule(0) }

  return { init: init, open: open, run: run, textChanged: textChanged, lensChanged: lensChanged, active: active, applyDefaults: applyDefaults }
})()
