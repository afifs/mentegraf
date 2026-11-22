// Run: node test/dictionary.test.js
// The project's word lists for the spell checker (.mentegraf/dictionary.txt, ignore.txt).
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Dict = require('../src/dictionary')

let passed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name) } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1 }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mentegraf-dict-'))
const read = (dir, name) => fs.readFileSync(path.join(dir, '.mentegraf', name), 'utf8')

console.log('dictionary')

test('a new list is created in .mentegraf/ with a header and one word per line', () => {
  const dir = tmp()
  assert.strictEqual(Dict.add(dir, 'dictionary', 'karmaşıklık'), 'karmaşıklık')
  assert.strictEqual(Dict.add(dir, 'dictionary', 'öznelerarası'), 'öznelerarası')
  const text = read(dir, 'dictionary.txt')
  assert.ok(text.startsWith('#'), 'header line')
  assert.deepStrictEqual(text.split('\n').slice(1), ['karmaşıklık', 'öznelerarası', ''])
  assert.deepStrictEqual(Dict.read(dir, 'dictionary'), ['karmaşıklık', 'öznelerarası'])
})

test('a word already there is not added twice, also when typed in another Unicode form', () => {
  const dir = tmp()
  Dict.add(dir, 'dictionary', 'kâr')
  assert.strictEqual(Dict.add(dir, 'dictionary', 'kâr'), null)       // k a ◌̂ r
  assert.deepStrictEqual(Dict.read(dir, 'dictionary'), ['kâr'])
})

test('words with spaces, empty words and comments are refused', () => {
  const dir = tmp()
  assert.strictEqual(Dict.add(dir, 'dictionary', 'iki sözcük'), null)
  assert.strictEqual(Dict.add(dir, 'dictionary', '   '), null)
  assert.strictEqual(Dict.add(dir, 'dictionary', '#etiket'), null)
  assert.ok(!fs.existsSync(path.join(dir, '.mentegraf', 'dictionary.txt')))
})

test('hand edits are kept: comments, blank lines, CRLF, BOM, a missing last newline', () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, '.mentegraf'))
  fs.writeFileSync(path.join(dir, '.mentegraf', 'dictionary.txt'), '﻿# benim\r\nSantaFe\r\n\r\n  Wack  \r\nSantaFe', 'utf8')
  assert.deepStrictEqual(Dict.read(dir, 'dictionary'), ['SantaFe', 'Wack'])
  Dict.add(dir, 'dictionary', 'Bateson')
  assert.ok(read(dir, 'dictionary.txt').endsWith('SantaFe\nBateson\n'))
  assert.deepStrictEqual(Dict.read(dir, 'dictionary'), ['SantaFe', 'Wack', 'Bateson'])
})

test('the two lists are kept apart; projectWords gives both', () => {
  const dir = tmp()
  Dict.add(dir, 'dictionary', 'sibernetik')
  Dict.add(dir, 'ignore', 'Rosenblueth')
  Dict.add(dir, 'ignore', 'sibernetik')
  assert.deepStrictEqual(Dict.read(dir, 'dictionary'), ['sibernetik'])
  assert.deepStrictEqual(Dict.read(dir, 'ignore'), ['Rosenblueth', 'sibernetik'])
  assert.deepStrictEqual(Dict.projectWords(dir), ['sibernetik', 'Rosenblueth'])
  assert.deepStrictEqual(Dict.projectWords(null), [])
  assert.deepStrictEqual(Dict.projectWords(tmp()), [])
})

test('saving in a new folder takes the lists along, without overwriting', () => {
  const a = tmp(), b = tmp(), c = tmp()
  Dict.add(a, 'dictionary', 'homeostaz')
  Dict.add(a, 'ignore', 'Wiener')
  Dict.copy(a, b)
  assert.deepStrictEqual(Dict.projectWords(b), ['homeostaz', 'Wiener'])
  Dict.add(c, 'dictionary', 'kendi')
  Dict.copy(a, c)
  assert.deepStrictEqual(Dict.read(c, 'dictionary'), ['kendi'])
  assert.deepStrictEqual(Dict.read(c, 'ignore'), ['Wiener'])
})

test('an unknown list name is an error', () => {
  assert.throws(() => Dict.add(tmp(), 'other', 'x'))
})

console.log(passed + ' passed')
