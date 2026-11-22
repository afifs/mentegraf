// replace.js — the small rules behind replacing one hit at a time (search.js).
//
// Nothing is ever replaced in bulk: each hit is opened in the editor and replaced (or skipped)
// on its own, and the change goes through the editor, so Ctrl+Z undoes it. This file holds the
// parts that can be tested on their own:
//   matchCase  the replacement takes the case of the word it replaces (Kar → Kâr, KAR → KÂR)
//   Marks      which hits were replaced or skipped, kept in place while a line changes
/* exported Replace */
var Replace = (function () {
  'use strict'

  function upperFirst(s, loc) { return s ? s.charAt(0).toLocaleUpperCase(loc) + s.slice(1) : s }
  function hasLetters(s, loc) { return s.toLocaleUpperCase(loc) !== s.toLocaleLowerCase(loc) }

  // The replacement as it goes into the text. found: the text that was found; repl: what the
  // writer typed; loc: the book's language ('tr' or 'en'). Only in flexible search — with
  // "Match letters exactly" the replacement goes in exactly as typed.
  //   KAR  → all capitals            (Turkish rules: i → İ)
  //   Kar  → capital first letter
  //   kar  → as typed
  function matchCase(found, repl, loc) {
    found = String(found || ''); repl = String(repl == null ? '' : repl)
    if (!found || !repl || !hasLetters(found, loc)) return repl
    var letters = found.replace(/[^\p{L}]/gu, '')
    if (letters.length > 1 && letters === letters.toLocaleUpperCase(loc)) return repl.toLocaleUpperCase(loc)
    var first = found.charAt(0)
    if (first !== first.toLocaleLowerCase(loc)) return upperFirst(repl, loc)
    return repl
  }

  // Replaced and skipped hits, by place: path, line, column. When a replacement changes the
  // length of a line, the marks after it on that line move with the text.
  function Marks() { this.map = new Map() }
  function key(path, line, col) { return path + '\u0000' + line + '\u0000' + col }
  Marks.prototype.get = function (path, line, col) { return this.map.get(key(path, line, col)) || null }
  Marks.prototype.skip = function (path, line, col) { this.map.set(key(path, line, col), 'skipped') }
  Marks.prototype.unskip = function (path, line, col) { if (this.get(path, line, col) === 'skipped') this.map.delete(key(path, line, col)) }
  // A hit at col (len characters long) was replaced by text newLen characters long.
  Marks.prototype.replaced = function (path, line, col, len, newLen) {
    var delta = newLen - len, moved = new Map()
    this.map.forEach(function (v, k) {
      var p = k.split('\u0000')
      if (p[0] === path && +p[1] === line && +p[2] > col) moved.set(key(path, line, +p[2] + delta), v)
      else moved.set(k, v)
    })
    moved.set(key(path, line, col), 'replaced')
    this.map = moved
  }
  Marks.prototype.clear = function () { this.map.clear() }
  Marks.prototype.size = function () { return this.map.size }

  return { matchCase: matchCase, Marks: Marks }
})()
if (typeof module !== 'undefined') module.exports = Replace
