// Run: node test/search.test.js
// Search in texts: flexible (folded) and exact letters, whole words, where a hit stands.
'use strict'
const assert = require('assert')
const Store = require('../src/projectStore')

let passed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name) } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1 }
}

// Search only the given texts (no project folder).
function search(texts, query, opts) {
  const overrides = {}
  Object.keys(texts).forEach(k => { overrides['manuscript/' + k] = texts[k] })
  return Store.searchTexts(null, query, Object.assign({ overrides }, opts || {}))
}
const matches = r => r.files.reduce((a, f) => a.concat(f.hits.map(h => h.match)), [])

console.log('search')

const BOOK = {
  'a.md': 'Kâr payı düştü. Kar yağdı, KAR fırtınası.\nKarmaşık dünya, karmaşıklık. ^ab12cd\n'
}

test('flexible search is the default: kar finds kâr, Kar, KAR and karmaşık', () => {
  const r = search(BOOK, 'kar')
  assert.deepStrictEqual(matches(r), ['Kâr', 'Kar', 'KAR', 'Kar', 'kar'])
})

test('exact letters: kâr finds only kâr, not Kâr or kar', () => {
  assert.deepStrictEqual(matches(search({ 'a.md': 'kâr ve kar, Kâr.' }, 'kâr', { exact: true })), ['kâr'])
  assert.deepStrictEqual(matches(search({ 'a.md': 'kâr ve kar, Kâr.' }, 'kar', { exact: true })), ['kar'])
})

test('exact letters keep Turkish i/ı/İ/I apart', () => {
  const t = { 'a.md': 'ılık ILIK ilik İLİK' }
  assert.deepStrictEqual(matches(search(t, 'ılık', { exact: true })), ['ılık'])
  assert.deepStrictEqual(matches(search(t, 'İLİK', { exact: true })), ['İLİK'])
  assert.strictEqual(search(t, 'ılık').total, 4)          // flexible: all four
})

test('whole word: kar does not find karmaşık (flexible and exact)', () => {
  assert.deepStrictEqual(matches(search(BOOK, 'kar', { wholeWord: true })), ['Kâr', 'Kar', 'KAR'])
  assert.deepStrictEqual(matches(search(BOOK, 'Kar', { wholeWord: true, exact: true })), ['Kar'])
})

test('whole word knows Turkish letters as word letters (\\b would not)', () => {
  // with \b, "kar" would stand alone in "şkar" and "karş", since ş is not \w
  const t = { 'a.md': 'şkar karş kar' }
  assert.deepStrictEqual(search(t, 'kar', { wholeWord: true }).files[0].hits.map(h => h.col), [10])
})

test('whole word: an apostrophe or hyphen ends the word', () => {
  const t = { 'a.md': "Ankara'da geri-bildirim" }
  assert.strictEqual(search(t, 'ankara', { wholeWord: true }).total, 1)
  assert.strictEqual(search(t, 'geri', { wholeWord: true }).total, 1)
})

test('whole word: a circumflex typed as a separate mark is part of the word', () => {
  const t = { 'a.md': 'kâr kar' }                     // k a ◌̂ r
  assert.deepStrictEqual(search(t, 'ka', { wholeWord: true }).total, 0)
  assert.deepStrictEqual(search(t, 'kar', { wholeWord: true, exact: true }).files[0].hits.map(h => h.col), [5])
})

test('whole word: a skipped match does not hide the one right after it', () => {
  const t = { 'a.md': 'aaa aa' }
  assert.deepStrictEqual(search(t, 'aa', { wholeWord: true }).files[0].hits.map(h => h.col), [4])
})

test('the query is not trimmed: spaces at either end are part of it', () => {
  const t = { 'a.md': 'kar karmaşık\nkar' }
  assert.strictEqual(search(t, 'kar').total, 3)
  assert.strictEqual(search(t, 'kar ').total, 1)
  assert.strictEqual(search(t, ' kar').total, 1)
  assert.strictEqual(search({ 'a.md': 'bir  iki bir iki' }, 'bir  iki').total, 1)   // two spaces stay two
})

test('a query of only spaces, or a single letter, finds nothing', () => {
  assert.strictEqual(search(BOOK, '   ').total, 0)
  assert.strictEqual(search(BOOK, 'k').total, 0)
})

test('hits tell whether they are in the text, a footnote or a caption', () => {
  const t = { 'a.md': [
    'Kar yağdı.[^1] ^ab12cd',
    '',
    '![Karlı bir dağ](../assets/kar.png){#fig:kar-ab12}',
    '',
    '[^1]: Kar üstüne bir not.',
    '    Kar, ikinci paragrafta da.',
    '',
    'Yine kar.'
  ].join('\n') }
  const hits = search(t, 'kar').files[0].hits.map(h => h.line + ':' + h.where)
  assert.deepStrictEqual(hits, ['1:text', '3:caption', '5:footnote', '6:footnote', '8:text'])
})

test('a figure\'s file name and id are not searched', () => {
  const t = { 'a.md': '![Dağ](../assets/kar.png){#fig:kar-ab12} sonra kar' }
  const h = search(t, 'kar').files[0].hits
  assert.deepStrictEqual(h.map(x => x.where), ['text'])
  assert.strictEqual(h[0].col, t['a.md'].lastIndexOf('kar'))
})

test('columns point into the original line in flexible and exact search', () => {
  const line = 'Düşünme ve DÜŞÜNME'
  const r = search({ 'a.md': line }, 'dusunme').files[0].hits
  assert.deepStrictEqual(r.map(h => line.slice(h.col, h.col + h.len)), ['Düşünme', 'DÜŞÜNME'])
})

test('the metadata block is skipped', () => {
  const t = { 'a.md': '---\ntitle: Kar\n---\nKar yağdı.' }
  assert.deepStrictEqual(search(t, 'kar').files[0].hits.map(h => h.line), [4])
})

test('settings other than nodeSizing survive a save and an open', () => {
  const fs = require('fs'), os = require('os'), path = require('path')
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mentegraf-test-')), 'Book')
  const project = {
    version: '2.1', app: 'Mentegraf', lang: 'tr',
    config: { categories: [], connectionTypes: [], nodeSizing: false, settings: { search: { exact: true, wholeWord: false }, spellcheck: false } },
    elements: { nodes: [], edges: [] }
  }
  Store.writeProject(dir, project)
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'project.mentegraf'), 'utf8'))
  assert.deepStrictEqual(m.settings, { search: { exact: true, wholeWord: false }, spellcheck: false, nodeSizing: false })
  const back = Store.readProject(dir).project
  assert.deepStrictEqual(back.config.settings, { search: { exact: true, wholeWord: false }, spellcheck: false })
  assert.strictEqual(back.config.nodeSizing, false)
})

console.log(passed + ' passed')
