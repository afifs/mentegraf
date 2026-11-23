// markup.js — small text rules for the editor's formatting commands (writer.js).
//
// italic: Ctrl+I and the I button write *italic*, not _italic_. Pandoc does not read an
// underscore inside a word ("_kâr_ı" stays as typed), while "*kâr*ı" gives kâr in italics
// with the suffix upright. An asterisk is also half of **bold**, so the toggle looks at the
// whole run of asterisks: one or three (bold italic) around the selection means italic is on.
// Italics written earlier with underscores are still taken off by the same command.
/* exported Markup */
var Markup = (function () {
  'use strict'

  function runBefore(s, at, ch) { var n = 0; while (at - n - 1 >= 0 && s[at - n - 1] === ch) n++; return n }
  function runAfter(s, at, ch) { var n = 0; while (at + n < s.length && s[at + n] === ch) n++; return n }

  // text: the document (or a window of it); [from, to): the selection in it.
  // Returns { changes: [{ from, to, insert }], from, to } — the new selection after the changes.
  function toggleItalic(text, from, to) {
    var sel = text.slice(from, to)
    // 1. italic marks just outside the selection: take them off
    var b = runBefore(text, from, '*'), a = runAfter(text, to, '*')
    if (b % 2 === 1 && a % 2 === 1) {
      return { changes: [{ from: from - 1, to: from, insert: '' }, { from: to, to: to + 1, insert: '' }], from: from - 1, to: to - 1 }
    }
    if (text[from - 1] === '_' && text[to] === '_' && text[from - 2] !== '_' && text[to + 1] !== '_') {
      return { changes: [{ from: from - 1, to: from, insert: '' }, { from: to, to: to + 1, insert: '' }], from: from - 1, to: to - 1 }
    }
    // 2. the marks are inside the selection: take them off
    if (sel.length > 2) {
      var sb = runAfter(sel, 0, '*'), sa = runBefore(sel, sel.length, '*')
      if (sb % 2 === 1 && sa % 2 === 1 && sb + sa < sel.length) {
        return { changes: [{ from: from, to: from + 1, insert: '' }, { from: to - 1, to: to, insert: '' }], from: from, to: to - 2 }
      }
      if (sel[0] === '_' && sel[sel.length - 1] === '_' && sel[1] !== '_' && sel[sel.length - 2] !== '_') {
        return { changes: [{ from: from, to: from + 1, insert: '' }, { from: to - 1, to: to, insert: '' }], from: from, to: to - 2 }
      }
    }
    // 3. not italic: put the marks around it
    return { changes: [{ from: from, to: from, insert: '*' }, { from: to, to: to, insert: '*' }], from: from + 1, to: to + 1 }
  }

  // Apply the result to a string (for tests).
  function apply(text, r) {
    var out = text
    r.changes.slice().sort(function (x, y) { return y.from - x.from }).forEach(function (c) { out = out.slice(0, c.from) + c.insert + out.slice(c.to) })
    return out
  }

  return { toggleItalic: toggleItalic, apply: apply }
})()
if (typeof module !== 'undefined') module.exports = Markup
