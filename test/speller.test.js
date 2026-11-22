// Run: node test/speller.test.js
// Spell checking with the dictionaries that ship with Mentegraf (src/speller.js).
'use strict'
const assert = require('assert')
const { createSpeller } = require('../src/speller')

let passed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name) } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1 }
}

console.log('speller')

const sp = createSpeller()
const t0 = Date.now()
const langs = sp.setLanguages(['tr', 'en-US'])
console.log('       (dictionaries loaded in ' + (Date.now() - t0) + ' ms)')
const bad = words => words.filter((w, i) => sp.check(words)[i])

test('both dictionaries load', () => {
  assert.deepStrictEqual(langs, ['tr', 'en-US'])
  assert.deepStrictEqual(sp.status().errors, {})
})

test('Turkish words with their suffixes are right; misspellings are found', () => {
  const words = ['kelime', 'karmaşıklığını', 'araştırıyordu', 'bağlantısını', 'gerçekleştirerek', 'Muhteşem', 'düşünür',
    'kelme', 'Yanlışşş', 'dipnott']
  assert.deepStrictEqual(bad(words), ['kelme', 'Yanlışşş', 'dipnott'])
})

test('a Turkish book is also checked in English: English terms are right', () => {
  assert.deepStrictEqual(bad(['computer', 'feedback', 'compter']), ['compter'])
})

test('circumflex forms are right (kâr, hâlâ, kâğıt, hâkim, resmî)', () => {
  assert.deepStrictEqual(bad(['kâr', 'hâlâ', 'kâğıt', 'hâkim', 'resmî', 'kar', 'hala']), [])
})

test('a word typed in decomposed form (a + ◌̂) is checked as the same word', () => {
  assert.deepStrictEqual(sp.check(['kâr']), [false])
})

test('suggestions: Turkish first, never the word itself, in small letters for a small word', () => {
  const s = sp.suggest('kelme')
  assert.ok(s.length > 0 && s.length <= 6, JSON.stringify(s))
  assert.ok(s.indexOf('kelme') < 0)
  assert.ok(s.every(x => x !== x.toUpperCase()), JSON.stringify(s))
  assert.ok(sp.suggest('dipnott').indexOf('dipnot') >= 0)
})

test('an English-only book does not know Turkish words', () => {
  const en = createSpeller()
  en.setLanguages(['en-US'])
  assert.deepStrictEqual(en.check(['kelime', 'computer']), [true, false])
})

test('no languages, or unknown ones: nothing is marked', () => {
  const none = createSpeller()
  assert.deepStrictEqual(none.setLanguages(['xx']), [])
  assert.deepStrictEqual(none.check(['kelme']), [false])
})

console.log(passed + ' passed')
