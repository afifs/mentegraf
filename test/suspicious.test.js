// Run: node test/suspicious.test.js
// Suspicious words: the project's list (.mentegraf/suspicious.txt) and where its words occur.
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Dict = require('../src/dictionary')
const Store = require('../src/projectStore')

let passed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name) } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1 }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mentegraf-sw-'))
// groups of one kind, from texts given as { 'a.md': text }
function groups(texts, dir, kind) {
  const overrides = {}
  Object.keys(texts).forEach(k => { overrides['manuscript/' + k] = texts[k] })
  return Store.spellingVariants(dir || null, { overrides }).groups.filter(g => g.kind === (kind || 'suspicious'))
}
const counts = g => g.forms.map(f => f.form + ':' + f.n).join(' ')

console.log('suspicious words')

test('the list format: forms, * for endings, a note after a long dash, comments', () => {
  const l = Dict.parseSuspicious('# not this\n\nkar | Kâr* — kâr: kazanç\nhala|hâlâ\nkağıt -- TDK\n   \n|  \n')
  assert.deepStrictEqual(l.map(g => g.key), ['sw:kar|kâr*', 'sw:hala|hâlâ', 'sw:kağıt'])
  assert.deepStrictEqual(l[0].forms, [{ form: 'kar', prefix: false }, { form: 'kâr', prefix: true }])
  assert.strictEqual(l[0].note, 'kâr: kazanç')
  assert.strictEqual(l[1].note, '')
  assert.strictEqual(l[2].note, 'TDK')
})

test('the starting list has the seven pairs', () => {
  const firsts = Dict.parseSuspicious(Dict.SUSPICIOUS_DEFAULT).map(g => g.forms[0].form)
  assert.deepStrictEqual(firsts, ['kar', 'hala', 'adet', 'hakim', 'ama', 'alem', 'kağıt'])
})

test('a project without a list gets the starting list written into .mentegraf/', () => {
  const dir = tmp()
  const l = Dict.readSuspicious(dir)
  assert.strictEqual(l.length, 7)
  const text = fs.readFileSync(Dict.suspiciousPath(dir), 'utf8')
  assert.ok(text.startsWith('# Mentegraf'), 'header')
  assert.ok(text.indexOf('kar | kâr* — kâr: kazanç; kar: yağış') >= 0)
})

test('an edited list is used as it is, and is not overwritten', () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, '.mentegraf'))
  fs.writeFileSync(Dict.suspiciousPath(dir), 'resmi | resmî\n', 'utf8')
  assert.deepStrictEqual(Dict.readSuspicious(dir).map(g => g.key), ['sw:resmi|resmî'])
  assert.strictEqual(fs.readFileSync(Dict.suspiciousPath(dir), 'utf8'), 'resmi | resmî\n')
})

test('every place of each form is found; case does not count, the circumflex does', () => {
  const g = groups({ 'a.md': 'Kar yağdı. Şirketin kârı arttı, KÂR payı. Karmaşık bir kara gün.' })
  const kar = g.filter(x => x.key === 'sw:kar|kâr*')[0]
  assert.strictEqual(counts(kar), 'kar:1 kâr:2')
  assert.deepStrictEqual(kar.hits.map(h => h.col), [0, 20, 32])
  assert.strictEqual(kar.note, 'kâr: kazanç; kar: yağış')
})

test('headings, footnotes and captions are read; code blocks, links and keys are not', () => {
  const t = ['# Hâlâ başlıkta', '', 'Metin.[^1]', '', '![Hala alt yazıda](../assets/hala.png){#fig:hala-ab}', '',
    '```', 'hala kodda', '```', '', 'Bkz. <https://ornek.org/hala> ve [@hala2020].', '', '[^1]: Dipnotta hâlâ.'].join('\n')
  const h = groups({ 'a.md': t }).filter(x => x.key === 'sw:hala|hâlâ')[0]
  assert.deepStrictEqual(h.hits.map(x => x.line + ':' + x.form), ['1:hâlâ', '5:hala', '13:hâlâ'])
})

test('one form alone is listed too (perhaps the other was meant)', () => {
  const g = groups({ 'a.md': 'Hala gelmedi.' })
  assert.deepStrictEqual(g.map(x => x.key + ' ' + counts(x)), ['sw:hala|hâlâ hala:1 hâlâ:0'])
})

test('a word on the list is not shown again as a circumflex variant', () => {
  const t = { 'a.md': 'Kar ve kâr. Hala ve hâlâ. Resmî ve resmi.' }
  assert.deepStrictEqual(groups(t, null, 'circumflex').map(g => g.key), ['cf:resmi'])
  assert.deepStrictEqual(groups(t).map(g => g.key), ['sw:kar|kâr*', 'sw:hala|hâlâ'])
})

test('the project\'s own list is read, and a change to it is seen at once', () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, '.mentegraf'))
  fs.writeFileSync(Dict.suspiciousPath(dir), 'resmi | resmî — resmî: devlete ait\n', 'utf8')
  const t = { 'a.md': 'Resmî yazı, resmi tören. Kar yağdı.' }
  assert.deepStrictEqual(groups(t, dir).map(g => g.key + ' ' + counts(g)), ['sw:resmi|resmî resmi:1 resmî:1'])
  fs.writeFileSync(Dict.suspiciousPath(dir), 'kar | kâr\n', 'utf8')
  assert.deepStrictEqual(groups(t, dir).map(g => g.key + ' ' + counts(g)), ['sw:kar|kâr kar:1 kâr:0'])
})

test('Save As takes the list along', () => {
  const a = tmp(), b = tmp()
  fs.mkdirSync(path.join(a, '.mentegraf'))
  fs.writeFileSync(Dict.suspiciousPath(a), 'resmi | resmî\n', 'utf8')
  Dict.copy(a, b)
  assert.strictEqual(fs.readFileSync(Dict.suspiciousPath(b), 'utf8'), 'resmi | resmî\n')
})

console.log(passed + ' passed')
