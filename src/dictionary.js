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
const SUSPICIOUS_FILE = 'suspicious.txt'
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

// Saving the project in a new folder: take the word lists along, the suspicious words too
// (an existing list is kept).
function copy(fromDir, toDir) {
  if (!fromDir || !toDir || path.resolve(fromDir) === path.resolve(toDir)) return
  Object.keys(FILES).concat(['suspicious']).forEach(kind => {
    const from = kind === 'suspicious' ? suspiciousPath(fromDir) : filePath(fromDir, kind)
    const to = kind === 'suspicious' ? suspiciousPath(toDir) : filePath(toDir, kind)
    if (!fs.existsSync(from) || fs.existsSync(to)) return
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  })
}

// ───────── suspicious words (.mentegraf/suspicious.txt) ─────────
//
// Words the spell checker cannot catch because every form is a real word: "kar" (snow) and
// "kâr" (profit), "hala" and "hâlâ". Each line lists forms that are easily confused, then an
// optional note after a long dash:
//     kar | kâr* — kâr: kazanç; kar: yağış
// A form ending in * also stands for the word with endings (kâr* → kârı, kârlı). Letters
// are matched without regard to case, but a circumflex counts. Lines starting with # are notes.
const SUSPICIOUS_HEADER = [
  '# Mentegraf — şüpheli sözcükler / suspicious words',
  '# Yazım denetiminin yakalayamadığı, kolayca karışan yazılışlar. Satır başına bir grup:',
  '#   yazılış | yazılış — açıklama',
  '# Sonuna * konan yazılış ekli hâlleri de bulur (kâr* → kârı, kârlı). Büyük/küçük harf fark etmez; şapka eder.',
  '# Forms that are easily confused, one group per line: form | form — note. A * at the end also finds the word with endings.',
  ''
].join('\n')
const SUSPICIOUS_DEFAULT = [
  'kar | kâr* — kâr: kazanç; kar: yağış',
  'hala | hâlâ — hâlâ: henüz, şimdi bile; hala: babanın kız kardeşi',
  'adet | âdet* — âdet: gelenek, alışkanlık; adet: sayı',
  'hakim* | hâkim* — hâkim: yargıç, egemen (hakîm: bilge)',
  'ama | âmâ — âmâ: görme engelli; ama: bağlaç',
  'alem | âlem* — âlem: dünya, evren; alem: bayrak, sancak',
  'kağıt* | kağıd* | kâğıt* | kâğıd* — TDK yazımı: kâğıt',
  ''
].join('\n')

const lowerTr = s => s.toLocaleLowerCase('tr')

// Text -> [{ key, forms: [{ form, prefix }], note }]
function parseSuspicious(text) {
  const out = []
  String(text || '').replace(/^\uFEFF/, '').split(/\r\n?|\n/).forEach(line => {
    const t = line.normalize('NFC').trim()
    if (!t || t[0] === '#') return
    const cut = t.search(/\s[—–]\s|\s--\s/)
    const head = cut >= 0 ? t.slice(0, cut) : t
    const note = cut >= 0 ? t.slice(cut).replace(/^\s*(?:[—–]|--)\s*/, '').trim() : ''
    const forms = []
    head.split('|').forEach(f => {
      let w = lowerTr(f.trim()), prefix = false
      if (w.endsWith('*')) { prefix = true; w = w.slice(0, -1).trim() }
      if (w && !/\s/.test(w) && !forms.some(x => x.form === w)) forms.push({ form: w, prefix })
    })
    if (forms.length) out.push({ key: 'sw:' + forms.map(f => f.form + (f.prefix ? '*' : '')).join('|'), forms, note })
  })
  return out
}

function suspiciousPath(dir) { return path.join(dir, '.mentegraf', SUSPICIOUS_FILE) }

// The project's list. A project without one gets the starting list written into its folder
// (so it can be edited and travels with the book); a project not yet saved uses it unwritten.
function readSuspicious(dir) {
  if (!dir) return parseSuspicious(SUSPICIOUS_DEFAULT)
  const file = suspiciousPath(dir)
  try { return parseSuspicious(fs.readFileSync(file, 'utf8')) } catch (e) { /* missing */ }
  try {
    if (fs.existsSync(dir)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, SUSPICIOUS_HEADER + SUSPICIOUS_DEFAULT, { encoding: 'utf8', flag: 'wx' }) }
  } catch (e) { /* written meanwhile, or read-only: use the starting list */ }
  try { return parseSuspicious(fs.readFileSync(file, 'utf8')) } catch (e) { return parseSuspicious(SUSPICIOUS_DEFAULT) }
}

module.exports = { FILES, clean, parse, read, add, projectWords, copy, filePath, parseSuspicious, readSuspicious, suspiciousPath, SUSPICIOUS_DEFAULT }
