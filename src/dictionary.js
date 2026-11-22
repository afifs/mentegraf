// dictionary.js — the project's own word lists for the spell checker.
//
// Both live in the project folder, so they travel with the book and sync with it:
//   .mentegraf/dictionary.txt   words added with "Add to dictionary" (real words the checker lacks)
//   .mentegraf/ignore.txt       words skipped with "Ignore in this project" (names, quotations …)
// Plain UTF-8 text, one word per line; empty lines and lines starting with # are skipped, so
// the files can be edited by hand. New words are appended, so edits made elsewhere (another
// computer, Seafile) are kept.
'use strict'
const fs = require('fs')
const path = require('path')

const FILES = { dictionary: 'dictionary.txt', ignore: 'ignore.txt' }
const HEADER = {
  dictionary: '# Mentegraf — bu projenin yazım sözlüğü / this project\'s spelling dictionary. One word per line.\n',
  ignore: '# Mentegraf — bu projede yok sayılan sözcükler / words ignored in this project. One word per line.\n'
}

function filePath(dir, kind) {
  if (!dir || !FILES[kind]) throw new Error('unknown word list: ' + kind)
  return path.join(dir, '.mentegraf', FILES[kind])
}

// A word as it is kept: NFC (so "kâr" typed two ways is one word), no surrounding space.
// Anything with a space inside, or too long to be a word, is refused (null).
function clean(word) {
  const w = String(word == null ? '' : word).normalize('NFC').trim()
  if (!w || w.length > 64 || /\s/.test(w) || w[0] === '#') return null
  return w
}

function parse(text) {
  const seen = new Set(), out = []
  String(text || '').replace(/^﻿/, '').split(/\r\n?|\n/).forEach(line => {
    const t = line.trim()
    if (!t || t[0] === '#') return
    const w = clean(t)
    if (w && !seen.has(w)) { seen.add(w); out.push(w) }
  })
  return out
}

function read(dir, kind) {
  try { return parse(fs.readFileSync(filePath(dir, kind), 'utf8')) } catch (e) { return [] }
}

// Add a word to one list. Returns the word as stored, or null if it was refused or already there.
function add(dir, kind, word) {
  const w = clean(word)
  if (!w) return null
  const file = filePath(dir, kind)
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch (e) { text = null }
  if (text != null && parse(text).indexOf(w) >= 0) return null
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (text == null) fs.writeFileSync(file, HEADER[kind] + w + '\n', 'utf8')
  else fs.appendFileSync(file, (text && !/\n$/.test(text) ? '\n' : '') + w + '\n', 'utf8')
  return w
}

// Every word the checker should accept in this project (both lists).
function projectWords(dir) {
  if (!dir) return []
  const seen = new Set()
  return read(dir, 'dictionary').concat(read(dir, 'ignore')).filter(w => !seen.has(w) && seen.add(w))
}

// Saving the project in a new folder: take the word lists along (an existing list is kept).
function copy(fromDir, toDir) {
  if (!fromDir || !toDir || path.resolve(fromDir) === path.resolve(toDir)) return
  Object.keys(FILES).forEach(kind => {
    const from = filePath(fromDir, kind), to = filePath(toDir, kind)
    if (!fs.existsSync(from) || fs.existsSync(to)) return
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  })
}

// Spell checker languages for a book: a Turkish book is checked in Turkish and US English
// together, so English terms in it are not marked. The codes are matched to the ones this
// computer's checker offers ("tr" may be offered as "tr-TR", "en-US" only as "en"); codes it
// does not have are left out.
const SPELL_LANGS = { tr: ['tr', 'en-US'], en: ['en-US'] }
function spellLanguages(lang, available) {
  const avail = Array.isArray(available) ? available.map(String) : []
  const low = avail.map(a => a.toLowerCase()), base = c => c.split('-')[0]
  const out = []
  ;(SPELL_LANGS[lang] || SPELL_LANGS.tr).forEach(code => {
    const c = code.toLowerCase()
    let i = low.indexOf(c)
    if (i < 0) i = low.indexOf(base(c))
    if (i < 0) i = low.findIndex(a => base(a) === base(c))
    if (i >= 0 && out.indexOf(avail[i]) < 0) out.push(avail[i])
  })
  return out
}

module.exports = { FILES, clean, parse, read, add, projectWords, copy, filePath, spellLanguages }
