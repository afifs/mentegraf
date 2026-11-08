// audit.js — checks over the whole book, listed in the work queue under "Denetim".
//
//  early        a person or concept is named in a chapter that comes before the chapter that
//               introduces it (people: where the full name first appears; others: the chapter
//               the map links them to). Found from the texts, in book-plan order.
//  unsupported  a claim marked Desteklenen or Tez with nothing behind it in the map: no
//               Destekliyor link into it and no Kaynak link.
//  orphan       a person, concept, term, idea, book… with no link in the map and not named in
//               any chapter.
//
// The author can mark an item as intended ("bilinçli"); it is stored on the node (auditOk)
// and no longer listed, unless finished items are shown.
/* global cy, L, Binder, Writer, Gloss, Argue, snapshot */
var Audit = (function () {
  'use strict'

  var ENTITY = ['person', 'institution', 'event', 'concept', 'term', 'idea']
  var ORPHAN = ENTITY.concat(['book', 'document'])
  var items = [], seq = 0

  function api() { return window.mentegraf }

  // Chapters of the book plan in order: [{ node, path, order }].
  function chapters() {
    var out = [], i = 0
    var walk = function (list) {
      (list || []).forEach(function (it) {
        if (it.kind === 'node' && it.include !== false) { var n = cy.getElementById(it.node); if (n.length && n.data('fragment')) out.push({ node: n, path: n.data('fragment'), order: i++ }) }
        walk(it.children)
      })
    }
    if (window.Binder && Binder.get) walk(Binder.get().items)
    return out
  }

  function isOk(n, kind) { var a = n.data('auditOk'); return Array.isArray(a) && a.indexOf(kind) >= 0 }

  function dismiss(n, kind, on) {
    var a = (n.data('auditOk') || []).filter(function (k) { return k !== kind })
    if (on !== false) a.push(kind)
    if (a.length) n.data('auditOk', a); else n.removeData('auditOk')
    if (typeof snapshot === 'function') snapshot()
    items.forEach(function (it) { if (it.node === n && it.sub === kind) it.done = on !== false })
  }

  function fullName(label) { return String(label || '').replace(/\s*\([^)]*\)\s*$/, '').trim() }

  async function compute() {
    var my = ++seq
    var chs = chapters(), byPath = {}, plan = {}
    chs.forEach(function (c) { byPath[c.path] = c; plan[c.node.id()] = c })
    var out = []

    // which chapter names which word
    var cands = cy.nodes().filter(function (n) { return ENTITY.indexOf(n.data('type')) >= 0 && !plan[n.id()] })
    var terms = window.Gloss && Gloss._searchTerms ? Gloss._searchTerms(cands) : {}
    // people are introduced where the full name appears, or the first name and the surname both
    // appear ("John Henry Holland" introduces "John Holland")
    var full = {}, given = {}, family = {}
    cands.forEach(function (n) {
      if (n.data('type') !== 'person') return
      var f = fullName(n.data('label')); if (f.length >= 3) full[n.id()] = f
      var w = f.split(/\s+/)
      if (w.length >= 2 && w[0].length >= 3 && w[0].indexOf('.') < 0 && w[w.length - 1].length >= 3) { given[n.id()] = w[0]; family[n.id()] = w[w.length - 1] }
    })
    var list = []
    Object.keys(terms).forEach(function (id) { terms[id].forEach(function (t) { if (list.indexOf(t) < 0) list.push(t) }) })
    Object.keys(full).forEach(function (id) { if (list.indexOf(full[id]) < 0) list.push(full[id]) })
    Object.keys(given).forEach(function (id) { [given[id], family[id]].forEach(function (w) { if (list.indexOf(w) < 0) list.push(w) }) })
    var counts = {}
    if (list.length && chs.length && api() && api().textMentions) {
      var overrides = {}
      if (window.Writer && Writer.dirtyFragments) Writer.dirtyFragments().forEach(function (f) { overrides[f.path] = f.text })
      var r = await api().textMentions(list, { only: chs.map(function (c) { return c.path }), overrides: overrides })
      counts = (r && r.counts) || {}
    }
    if (my !== seq) return items
    var firstIn = function (words) {
      var best = null, word = null
      words.forEach(function (w) { Object.keys(counts[w] || {}).forEach(function (p) { var c = byPath[p]; if (c && (!best || c.order < best.order)) { best = c; word = w } }) })
      return best ? { ch: best, word: word } : null
    }

    cands.forEach(function (n) {
      var first = firstIn(terms[n.id()] || [])
      var linked = n.neighborhood().nodes().filter(function (o) { return !!plan[o.id()] }).map(function (o) { return plan[o.id()] }).sort(function (a, b) { return a.order - b.order })
      // early mention
      var intro = null
      if (n.data('type') === 'person' && full[n.id()]) {
        var f = firstIn([full[n.id()]]), both = null
        if (given[n.id()]) chs.forEach(function (c) { if (!both && (counts[given[n.id()]] || {})[c.path] && (counts[family[n.id()]] || {})[c.path]) both = c })
        var cand = [f && f.ch, both].filter(Boolean).sort(function (a, b) { return a.order - b.order })[0]
        intro = cand || linked[0] || null
      } else intro = linked[0] || null
      if (first && intro && first.ch.order < intro.order) {
        out.push({ sub: 'early', node: n, group: first.ch.node, word: first.word, path: first.ch.path,
          text: L('au_earlyText').replace('%s', n.data('label')).replace('%c', intro.node.data('label')), done: isOk(n, 'early') })
      }
      // orphan
      if (ORPHAN.indexOf(n.data('type')) >= 0 && n.connectedEdges().length === 0 && !first) {
        out.push({ sub: 'orphan', node: n, group: null, text: n.data('label'), done: isOk(n, 'orphan') })
      }
    })
    cy.nodes().forEach(function (n) {
      if (ORPHAN.indexOf(n.data('type')) >= 0 && ENTITY.indexOf(n.data('type')) < 0 && n.connectedEdges().length === 0) {
        out.push({ sub: 'orphan', node: n, group: null, text: n.data('label'), done: isOk(n, 'orphan') })
      }
    })

    // unsupported claims
    cy.nodes().forEach(function (n) {
      if (n.data('type') !== 'claim' || !window.Argue) return
      var st = Argue.statusOf(n)
      if (st !== 'supported' && st !== 'thesis') return
      var backed = n.connectedEdges().some(function (e) {
        var t = e.data('edgeType')
        return t === 'source' || (t === 'supports' && e.target().id() === n.id())
      })
      if (backed) return
      var p = Argue._split(n.data('passage')), owner = p && byPath[p.path] ? byPath[p.path].node : null
      out.push({ sub: 'unsupported', node: n, group: owner, text: n.data('label'), passage: n.data('passage'), status: st, done: isOk(n, 'unsupported') })
    })

    // highlighted changes ([..]{.mark}) still waiting to be accepted, per chapter
    if (chs.length && api() && api().textSearch) {
      var ov = {}
      if (window.Writer && Writer.dirtyFragments) Writer.dirtyFragments().forEach(function (f) { ov[f.path] = f.text })
      var mr = await api().textSearch('{.mark}', { only: chs.map(function (c) { return c.path }), overrides: ov })
      if (my !== seq) return items
      ;((mr && mr.files) || []).forEach(function (f) {
        var c = byPath[f.path]
        if (!c) return
        out.push({ sub: 'marks', node: c.node, group: c.node, path: f.path, count: f.count,
          text: L('au_marksText').replace('%c', c.node.data('label')).replace('%n', f.count), done: isOk(c.node, 'marks') })
      })
    }

    items = out
    return items
  }

  // Open the earlier chapter at the first place the word occurs.
  async function open(it) {
    if (it.sub === 'marks') {
      await Writer.openForNode(it.group, { focus: true })
      if (Writer.firstMark) Writer.firstMark()
      return true
    }
    if (it.sub !== 'early' || !it.path || !api() || !api().textSearch) return false
    var r = await api().textSearch(it.word, { only: [it.path] })
    var f = r && r.files && r.files[0], h = f && f.hits && f.hits[0]
    await Writer.openForNode(it.group, { focus: true })
    if (h) Writer.reveal(h.line, h.col, h.len)
    return true
  }

  return { compute: compute, items: function () { return items }, dismiss: dismiss, open: open, isOk: isOk, _chapters: chapters }
})()
