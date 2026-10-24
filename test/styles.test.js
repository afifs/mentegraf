// Run: node test/styles.test.js
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Styles = require('../src/styles')
const Exporter = require('../src/exporter')

let passed = 0, skipped = 0
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name) } catch (e) {
    if (e.skip) { skipped++; console.log('  --  ' + name + ' (skipped: ' + e.message + ')'); return }
    console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1
  }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mentegraf-sty-'))

// A tiny but valid independent CSL style whose citations print MARK.
function csl(title, mark) {
  return '<?xml version="1.0" encoding="utf-8"?>\n<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">\n' +
    '<info><title>' + title + '</title><id>http://www.zotero.org/styles/' + mark.toLowerCase() + '</id><updated>2024-01-01T00:00:00+00:00</updated></info>\n' +
    '<citation><layout><text value="' + mark + '"/></layout></citation>\n' +
    '<bibliography><layout><text variable="title"/></layout></bibliography>\n</style>\n'
}
const dependent = '<?xml version="1.0" encoding="utf-8"?>\n<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" default-locale="en-US">\n' +
  '<info><title>Some Journal</title><id>http://www.zotero.org/styles/some-journal</id><link href="http://www.zotero.org/styles/apa" rel="independent-parent"/></info>\n</style>\n'

function setup() {
  const root = tmp()
  const project = path.join(root, 'Kitabım'), user = path.join(root, 'userData'), zotero = path.join(root, 'Zotero', 'styles')
  fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(zotero, { recursive: true }); fs.mkdirSync(user)
  fs.writeFileSync(path.join(project, 'apa.csl'), csl('American Psychological Association 7th edition', 'APA'))
  fs.writeFileSync(path.join(zotero, 'apa.csl'), csl('American Psychological Association 7th edition', 'APA'))
  fs.writeFileSync(path.join(zotero, 'chicago-note-bibliography.csl'), csl('Chicago Manual of Style 17th edition (note)', 'CHICAGO'))
  fs.writeFileSync(path.join(zotero, 'some-journal.csl'), dependent)
  return { root, project, user, zotero }
}

;(async () => {
  console.log('styles')

  await test('lists project, then Zotero styles; skips dependent styles and duplicates', () => {
    const s = setup()
    const o = Styles.listOptions(s.project, s.user, s.zotero)
    assert.deepStrictEqual(o.styles.map(x => [x.source, x.title]), [
      ['project', 'American Psychological Association 7th edition'],
      ['zotero', 'Chicago Manual of Style 17th edition (note)']
    ])
    assert.strictEqual(o.styles[0].value, 'project:apa.csl')
  })

  await test('untitled project: library and Zotero only', () => {
    const s = setup()
    const o = Styles.listOptions(null, s.user, s.zotero)
    assert.deepStrictEqual(o.styles.map(x => x.source), ['zotero', 'zotero'])
  })

  await test('import a style into the library; dependent and wrong files are refused', () => {
    const s = setup()
    const f = path.join(s.root, 'mla.csl'); fs.writeFileSync(f, csl('Modern Language Association', 'MLA'))
    const r = Styles.importToLibrary(f, 'csl', s.user)
    assert.strictEqual(r.source, 'library'); assert.strictEqual(r.title, 'Modern Language Association')
    assert.ok(fs.existsSync(path.join(s.user, 'styles', 'mla.csl')))
    assert.ok(Styles.listOptions(s.project, s.user, s.zotero).styles.some(x => x.source === 'library'))
    assert.throws(() => Styles.importToLibrary(path.join(s.zotero, 'some-journal.csl'), 'csl', s.user), e => e.code === 'dependent')
    const txt = path.join(s.root, 'x.csl'); fs.writeFileSync(txt, 'hello')
    assert.throws(() => Styles.importToLibrary(txt, 'csl', s.user), e => e.code === 'not-csl')
    assert.throws(() => Styles.importToLibrary(txt, 'docx', s.user), e => e.code === 'not-docx')
  })

  await test('choosing a Zotero style copies it into the project styles/ folder', () => {
    const s = setup()
    const chicago = Styles.listOptions(s.project, s.user, s.zotero).styles.find(x => x.source === 'zotero')
    const rel = Styles.useInProject(s.project, chicago.value)
    assert.strictEqual(rel, 'styles/chicago-note-bibliography.csl')
    assert.ok(fs.existsSync(path.join(s.project, rel)))
    assert.strictEqual(Styles.useInProject(s.project, chicago.value), rel, 'same file is not copied twice')
    assert.strictEqual(Styles.useInProject(s.project, 'project:apa.csl'), 'apa.csl')
  })

  await test('a different file with the same name gets its own name', () => {
    const s = setup()
    fs.mkdirSync(path.join(s.project, 'styles'))
    fs.writeFileSync(path.join(s.project, 'styles', 'chicago-note-bibliography.csl'), csl('Other', 'OTHER'))
    const rel = Styles.useInProject(s.project, 'file:' + path.join(s.zotero, 'chicago-note-bibliography.csl'))
    assert.strictEqual(rel, 'styles/chicago-note-bibliography-2.csl')
  })

  await test('stored paths cannot leave the project', () => {
    const s = setup()
    for (const bad of ['../x.csl', 'styles/../../x.csl', 'notes/a.md']) assert.throws(() => Styles.resolve(s.project, bad), e => e.code === 'bad-path', bad)
    assert.throws(() => Styles.resolve(s.project, 'styles/missing.csl'), e => e.code === 'missing')
    assert.ok(Styles.resolve(s.project, 'apa.csl').endsWith('apa.csl'))
  })

  await test('export follows the choice: chosen style, explicit default, or the project file', async () => {
    if (!Exporter.pandocInfo().ok) { const e = new Error('Pandoc 2.11+ not installed'); e.skip = true; throw e }
    const s = setup()
    const http = require('http')
    const srv = await new Promise(res => {
      const x = http.createServer((q, r) => { let b = ''; q.on('data', c => { b += c }); q.on('end', () => r.end(JSON.stringify({ jsonrpc: '2.0', result: JSON.stringify([{ id: 'w48', type: 'book', title: 'Cybernetics' }]) }))) })
      x.listen(0, '127.0.0.1', () => { Exporter.BBT.port = x.address().port; res(x) })
    })
    const text = 'Text [@w48].\n'
    const run = async (csl) => {
      const out = path.join(s.root, 'o' + Math.random().toString(36).slice(2) + '.docx')
      const opts = { projectDir: s.project, fragmentPath: 'notes/a.md', text, lang: 'en', outFile: out }
      if (csl !== 'unset') opts.csl = csl
      await Exporter.exportDocx(opts)
      return fs.readFileSync(out)
    }
    const has = (buf, mark) => require('child_process').spawnSync(Exporter.findPandoc(), ['-f', 'docx', '-t', 'plain'], { input: buf }).stdout.toString().includes(mark)
    assert.ok(has(await run('unset'), 'APA'), 'unset: uses the project apa.csl')
    assert.ok(has(await run(path.join(s.zotero, 'chicago-note-bibliography.csl')), 'CHICAGO'), 'chosen style')
    const def = await run(null)
    assert.ok(!has(def, 'APA') && !has(def, 'CHICAGO'), 'explicit default ignores the project file')
    srv.close()
  })

  console.log(passed + ' passed' + (skipped ? ', ' + skipped + ' skipped' : '') + (process.exitCode ? ', some FAILED' : ''))
})()
