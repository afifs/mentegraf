// Run: node test/exporter.test.js   (Pandoc tests are skipped if Pandoc is not installed)
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const zlib = require('zlib')
const Exporter = require('../src/exporter')

let passed = 0, skipped = 0
const results = []
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name) } catch (e) {
    if (e.skip) { skipped++; console.log('  --  ' + name + ' (skipped: ' + e.message + ')'); return }
    console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1
  }
}
function skip(msg) { const e = new Error(msg); e.skip = true; throw e }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mentegraf-exp-'))

// Minimal reader for a .docx (zip) entry, so the test needs no extra packages.
function docxEntry(file, name) {
  const buf = fs.readFileSync(file)
  let i = 0
  while ((i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), i)) >= 0) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18)
    const nameLen = buf.readUInt16LE(i + 26), extraLen = buf.readUInt16LE(i + 28)
    const entry = buf.slice(i + 30, i + 30 + nameLen).toString()
    const start = i + 30 + nameLen + extraLen
    if (entry === name) {
      const data = buf.slice(start, start + size)
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8')
    }
    i = start
  }
  return null
}
const words = xml => (xml || '').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')

const LIB = [
  { id: 'wiener1948', type: 'book', title: 'Cybernetics', author: [{ family: 'Wiener', given: 'Norbert' }], issued: { 'date-parts': [[1948]] }, publisher: 'MIT Press' },
  { id: 'shannon1948', type: 'article-journal', title: 'A Mathematical Theory of Communication', author: [{ family: 'Shannon', given: 'Claude E.' }], issued: { 'date-parts': [[1948]] }, 'container-title': 'Bell System Technical Journal' }
]

// Fake Better BibTeX on a free port.
function fakeBBT(opts) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      if (req.url.startsWith('/better-bibtex/cayw')) {
        if (req.url.includes('probe=1')) return res.end(opts.ready === false ? 'no' : 'ready')
        return res.end(opts.pick || '')
      }
      if (req.url === '/better-bibtex/json-rpc') {
        let body = ''
        req.on('data', c => { body += c })
        req.on('end', () => {
          const q = JSON.parse(body), [keys, translator] = q.params
          opts.calls = (opts.calls || []).concat(translator)
          if (opts.rejectNames && translator === 'Better CSL JSON') {
            return res.end(JSON.stringify({ jsonrpc: '2.0', id: q.id, error: { message: 'unknown translator' } }))
          }
          const missing = keys.filter(k => !LIB.some(i => i.id === k))
          if (missing.length) return res.end(JSON.stringify({ jsonrpc: '2.0', id: q.id, error: { message: 'missing keys: ' + missing.join(', ') } }))
          res.end(JSON.stringify({ jsonrpc: '2.0', id: q.id, result: JSON.stringify(LIB.filter(i => keys.includes(i.id))) }))
        })
        return
      }
      res.statusCode = 404; res.end()
    })
    srv.listen(0, '127.0.0.1', () => { Exporter.BBT.port = srv.address().port; resolve(srv) })
  })
}

const TEXT = [
  '---', 'mentegraf-node: n-abc', '---', '', '# Giriş', '',
  'Sibernetik bir _bilimdir_.[^giris-3f7u-1] Ayrıca [@wiener1948, s. 12]. ^nu2m40', '',
  'İkinci paragraf @shannon1948 der ki. ^ab12cd', '',
  '[^giris-3f7u-1]: Wiener 1948.', ''
].join('\n')

;(async () => {
  console.log('exporter')

  await test('citation keys are found in brackets and in running text, not in e-mail addresses', () => {
    assert.deepStrictEqual(Exporter.citeKeys(TEXT + '\nmail: a@b.com; see [see @kosko1986, p. 3; @ashby1956].').sort(),
      ['ashby1956', 'kosko1986', 'shannon1948', 'wiener1948'])
  })

  await test('Pandoc version is detected', () => {
    const i = Exporter.pandocInfo()
    if (!i.path) skip('Pandoc not installed')
    assert.ok(/^\d+\.\d+/.test(i.version), 'version: ' + i.version)
    console.log('       (found Pandoc ' + i.version + (i.ok ? '' : ', too old for export') + ')')
  })

  await test('an old Pandoc is refused with a clear message', async () => {
    const i = Exporter.pandocInfo()
    if (!i.path || i.ok) skip('needs an old Pandoc to check')
    await assert.rejects(Exporter.exportDocx({ projectDir: tmp(), fragmentPath: 'notes/a.md', text: 'x', lang: 'tr', outFile: path.join(tmp(), 'a.docx') }),
      e => e.code === 'pandoc-old' && e.message.includes(i.version))
  })

  await test('picker returns what Zotero sends', async () => {
    const srv = await fakeBBT({ pick: '[@wiener1948]' })
    try { assert.strictEqual(await Exporter.citePicker(), '[@wiener1948]') } finally { srv.close() }
  })

  await test('picker reports Zotero not running', async () => {
    Exporter.BBT.port = 1
    await assert.rejects(Exporter.citePicker(), e => e.code === 'zotero')
  })

  await test('picker reports Better BibTeX missing', async () => {
    const srv = await fakeBBT({ ready: false })
    try { await assert.rejects(Exporter.citePicker(), e => e.code === 'bbt') } finally { srv.close() }
  })

  await test('bibliography falls back to the translator id', async () => {
    const opts = { rejectNames: true }, srv = await fakeBBT(opts), dir = tmp()
    try {
      const f = await Exporter.exportBibliography(['wiener1948'], dir)
      assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8'))[0].id, 'wiener1948')
      assert.deepStrictEqual(opts.calls.slice(0, 2), ['Better CSL JSON', 'f4b52ab0-f878-4556-85a0-c7aeedd09dfc'])
    } finally { srv.close() }
  })

  await test('DOCX: real footnote, formatted citations, bibliography, no passage IDs', async () => {
    if (!Exporter.pandocInfo().ok) skip('Pandoc 2.11+ not installed')
    const srv = await fakeBBT({}), dir = tmp(), out = path.join(dir, 'exports', 'giris.docx')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    try {
      const r = await Exporter.exportDocx({ projectDir: dir, fragmentPath: 'manuscript/giris.md', text: TEXT, lang: 'tr', outFile: out })
      const doc = words(docxEntry(out, 'word/document.xml')), notes = words(docxEntry(out, 'word/footnotes.xml'))
      assert.ok(notes.includes('Wiener 1948.'), 'footnote text in footnotes.xml')
      assert.ok(doc.includes('Wiener 1948, 12'), 'formatted citation: ' + doc.slice(0, 300))
      assert.ok(doc.includes('Shannon (1948)'), 'in-text citation')
      assert.ok(doc.includes('Kaynakça'), 'bibliography heading')
      assert.ok(doc.includes('Bell System Technical Journal'), 'bibliography entry')
      assert.ok(!/\^[a-z0-9]{6}/.test(doc), 'passage IDs removed')
      assert.ok(!doc.includes('mentegraf-node'), 'metadata not printed')
      assert.deepStrictEqual(r.warnings, [])
    } finally { srv.close() }
  })

  await test('DOCX without Zotero: exported anyway, with a warning', async () => {
    if (!Exporter.pandocInfo().ok) skip('Pandoc 2.11+ not installed')
    Exporter.BBT.port = 1
    const dir = tmp(), out = path.join(dir, 'x.docx')
    const r = await Exporter.exportDocx({ projectDir: dir, fragmentPath: 'notes/x.md', text: TEXT, lang: 'en', outFile: out })
    assert.ok(fs.existsSync(out))
    assert.ok(r.warnings.some(w => w.startsWith('Zotero')), JSON.stringify(r.warnings))
  })

  await test('DOCX uses the project reference.docx when present', async () => {
    if (!Exporter.pandocInfo().ok) skip('Pandoc 2.11+ not installed')
    const pandoc = Exporter.findPandoc()
    const dir = tmp()
    const ref = require('child_process').spawnSync(pandoc, ['-o', path.join(dir, 'reference.docx'), '--print-default-data-file', 'reference.docx'])
    if (ref.status !== 0) skip('could not create a reference.docx')
    assert.ok(Exporter.projectStyles(dir).reference)
    const out = path.join(dir, 'y.docx')
    await Exporter.exportDocx({ projectDir: dir, fragmentPath: 'notes/y.md', text: '# Hello\n\nText.', lang: 'en', outFile: out })
    assert.ok(fs.existsSync(out))
  })

  await test('figure and CSV table: numbered captions, references resolved, image embedded', async () => {
    if (!Exporter.pandocInfo().ok) skip('Pandoc 2.17+ not installed')
    Exporter.BBT.port = 1
    const dir = path.join(tmp(), 'Kitabım')
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true }); fs.mkdirSync(path.join(dir, 'manuscript'))
    // a tiny valid PNG
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082', 'hex')
    fs.writeFileSync(path.join(dir, 'assets', 'loop.png'), png)
    fs.writeFileSync(path.join(dir, 'assets', 'nufus.csv'), 'Yıl,Nüfus\n1950,20.9\n2000,67.8\n')
    const text = '# Giriş\n\n@fig:loop-ab12 ve @tbl:nufus-cd34 bunu gösterir.\n\n![Geri besleme döngüsü](../assets/loop.png){#fig:loop-ab12 width=60%}\n\n![Türkiye nüfusu](../assets/nufus.csv){#tbl:nufus-cd34}\n\n@fig:yok-0000 eksik.\n'
    const out = path.join(dir, 'a.docx')
    const r = await Exporter.exportDocx({ projectDir: dir, fragmentPath: 'manuscript/giris.md', text, lang: 'tr', outFile: out })
    const doc = words(docxEntry(out, 'word/document.xml'))
    assert.ok(doc.includes('Şekil 1 ve Tablo 1 bunu gösterir'), 'references: ' + doc.slice(0, 200))
    assert.ok(doc.includes('Şekil 1. Geri besleme döngüsü'), 'figure caption')
    assert.ok(doc.includes('Tablo 1. Türkiye nüfusu') && doc.includes('1950') && doc.includes('67.8'), 'CSV became a table')
    assert.ok(docxEntry(out, 'word/media/' ) !== null || fs.readFileSync(out).includes(Buffer.from('word/media/')), 'image embedded')
    assert.ok(doc.includes('?? eksik') && r.warnings.some(w => w.includes('fig:yok-0000')), 'missing reference reported')
    assert.deepStrictEqual(Exporter.citeKeys(text), [], 'figure references are not sent to Zotero')
  })

  await test('DOCX into a folder with Turkish letters (Kitabım/dışa aktarım)', async () => {
    if (!Exporter.pandocInfo().ok) skip('Pandoc 2.11+ not installed')
    Exporter.BBT.port = 1
    const dir = path.join(tmp(), 'Kitabım Çağ'), out = path.join(dir, 'dışa aktarım', 'Giriş.docx')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    await Exporter.exportDocx({ projectDir: dir, fragmentPath: 'manuscript/giris.md', text: '# Giriş\n\nÇağdaş düşünce.', lang: 'tr', outFile: out })
    assert.ok(fs.existsSync(out))
    assert.ok(words(docxEntry(out, 'word/document.xml')).includes('Çağdaş düşünce.'))
  })

  console.log(passed + ' passed' + (skipped ? ', ' + skipped + ' skipped' : '') + (process.exitCode ? ', some FAILED' : ''))
})()
