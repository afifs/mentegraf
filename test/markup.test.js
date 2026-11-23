// Run: node test/markup.test.js
// The editor's italic command (src/markup.js).
'use strict'
const assert = require('assert')
const Markup = require('../src/markup')

let passed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name) } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1 }
}
// "[" and "]" mark the selection in these strings
function italic(s) {
  const from = s.indexOf('['), to = s.indexOf(']') - 1, text = s.replace('[', '').replace(']', '')
  const r = Markup.toggleItalic(text, from, to)
  const out = Markup.apply(text, r)
  return out.slice(0, r.from) + '[' + out.slice(r.from, r.to) + ']' + out.slice(r.to)
}

console.log('markup')

test('italic is written with asterisks, so a suffix can follow directly', () => {
  assert.strictEqual(italic('şirketin [kâr]ı'), 'şirketin *[kâr]*ı')
  assert.strictEqual(italic('[Faust]’ta'), '*[Faust]*’ta')
})

test('italic again takes it off (marks outside or inside the selection)', () => {
  assert.strictEqual(italic('*[kâr]*ı'), '[kâr]ı')
  assert.strictEqual(italic('[*kâr*]ı'), '[kâr]ı')
})

test('bold is not mistaken for italic', () => {
  assert.strictEqual(italic('**[kalın]**'), '***[kalın]***')            // bold + italic
  assert.strictEqual(italic('***[ikisi]***'), '**[ikisi]**')            // italic off, bold stays
  assert.strictEqual(italic('[**kalın**]'), '*[**kalın**]*')
})

test('italics written earlier with underscores are taken off too', () => {
  assert.strictEqual(italic('_[Faust]_’ta'), '[Faust]’ta')
  assert.strictEqual(italic('[_Faust_]’ta'), '[Faust]’ta')
  assert.strictEqual(italic('__[kalın]__'), '__*[kalın]*__')             // __bold__ is not italic
})

test('an empty selection gets a pair of marks with the cursor between them', () => {
  assert.strictEqual(italic('a [] b'), 'a *[]* b')
})

console.log(passed + ' passed')
