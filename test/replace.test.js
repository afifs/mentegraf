// Run: node test/replace.test.js
// Replacing one hit at a time: the case rule and the marks (src/replace.js).
'use strict'
const assert = require('assert')
const Replace = require('../src/replace')

let passed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name) } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1 }
}

console.log('replace')

test('the replacement takes the case of the word it replaces', () => {
  assert.strictEqual(Replace.matchCase('kar', 'kâr', 'tr'), 'kâr')
  assert.strictEqual(Replace.matchCase('Kar', 'kâr', 'tr'), 'Kâr')
  assert.strictEqual(Replace.matchCase('KAR', 'kâr', 'tr'), 'KÂR')
})

test('Turkish capitals: i → İ, ı → I', () => {
  assert.strictEqual(Replace.matchCase('Hakim', 'hâkim', 'tr'), 'Hâkim')
  assert.strictEqual(Replace.matchCase('HAKIM', 'hâkim', 'tr'), 'HÂKİM')
  assert.strictEqual(Replace.matchCase('Ilik', 'ılık', 'tr'), 'Ilık')
  assert.strictEqual(Replace.matchCase('Alem', 'âlem', 'en'), 'Âlem')
  assert.strictEqual(Replace.matchCase('ITEM', 'ilem', 'en'), 'ILEM')    // English rules: i → I
})

test('a lower-case word keeps the replacement as typed (also when typed with a capital)', () => {
  assert.strictEqual(Replace.matchCase('kar', 'Kâr', 'tr'), 'Kâr')
  assert.strictEqual(Replace.matchCase('geribildirim', 'geri bildirim', 'tr'), 'geri bildirim')
})

test('a one-letter capital is a capital first letter, not "all capitals"', () => {
  assert.strictEqual(Replace.matchCase('A', 'bir', 'tr'), 'Bir')
})

test('nothing to match against: the replacement as typed; an empty replacement stays empty', () => {
  assert.strictEqual(Replace.matchCase('123', 'kâr', 'tr'), 'kâr')
  assert.strictEqual(Replace.matchCase('Kar', '', 'tr'), '')
})

test('marks: replaced and skipped hits are remembered by place', () => {
  const m = new Replace.Marks()
  m.skip('a.md', 3, 10)
  m.replaced('b.md', 1, 0, 3, 3)
  assert.strictEqual(m.get('a.md', 3, 10), 'skipped')
  assert.strictEqual(m.get('b.md', 1, 0), 'replaced')
  assert.strictEqual(m.get('a.md', 3, 11), null)
  m.unskip('a.md', 3, 10); m.unskip('b.md', 1, 0)                      // a replaced hit stays replaced
  assert.strictEqual(m.get('a.md', 3, 10), null)
  assert.strictEqual(m.get('b.md', 1, 0), 'replaced')
})

test('marks after a replacement on the same line move with the text', () => {
  const m = new Replace.Marks()
  m.skip('a.md', 2, 30)            // later on the line
  m.skip('a.md', 2, 2)             // earlier on the line
  m.skip('a.md', 3, 30)            // another line
  m.skip('b.md', 2, 30)            // another text
  m.replaced('a.md', 2, 10, 12, 13)  // "geribildirim" → "geri bildirim": one longer
  assert.strictEqual(m.get('a.md', 2, 31), 'skipped')
  assert.strictEqual(m.get('a.md', 2, 30), null)
  assert.strictEqual(m.get('a.md', 2, 2), 'skipped')
  assert.strictEqual(m.get('a.md', 3, 30), 'skipped')
  assert.strictEqual(m.get('b.md', 2, 30), 'skipped')
  assert.strictEqual(m.get('a.md', 2, 10), 'replaced')
  m.replaced('a.md', 2, 20, 5, 2)    // shorter: later marks move back
  assert.strictEqual(m.get('a.md', 2, 28), 'skipped')
  assert.strictEqual(m.get('a.md', 2, 20), 'replaced')
  assert.strictEqual(m.size(), 6)
  m.clear()
  assert.strictEqual(m.size(), 0)
})

console.log(passed + ' passed')
