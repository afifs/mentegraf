// Run: node test/compiler.test.js   (Pandoc tests are skipped if Pandoc 2.11+ is not installed)
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawnSync } = require('child_process')
const C = require('../src/compiler')
const Exporter = require('../src/exporter')

let passed = 0, skipped = 0
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name) } catch (e) {
    if (e.skip) { skipped++; console.log('  --  ' + name + ' (skipped: ' + e.message + ')'); return }
    console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1
  }
}
function needPandoc() { if (!Exporter.pandocInfo().ok) { const e = new Error('Pandoc 2.11+ not installed'); e.skip = true; throw e } }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mentegraf-cmp-'))
// Read one entry of a .docx (zip) without extra packages.
function docxEntry(file, name) {
  const zlib = require('zlib'), buf = fs.readFileSync(file)
  let i = 0
  while ((i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), i)) >= 0) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), n = buf.readUInt16LE(i + 26), x = buf.readUInt16LE(i + 28)
    const entry = buf.slice(i + 30, i + 30 + n).toString(), start = i + 30 + n + x
    if (entry === name) { const d = buf.slice(start, start + size); return (method === 8 ? zlib.inflateRawSync(d) : d).toString('utf8') }
    i = start
  }
  return ''
}
const plain = file => spawnSync(Exporter.findPandoc(), ['-t', 'plain', '--wrap=none', file], { encoding: 'utf8' }).stdout
const native = file => spawnSync(Exporter.findPandoc(), ['-t', 'native', file], { encoding: 'utf8' }).stdout

const TEXTS = {
  'manuscript/giris.md': '---\nmentegraf-node: n-1\n---\n\n# Giriş\n\nKitabın amacı.[^giris-1-1] ^aaaaaa\n\n## Yöntem\n\nYöntem metni.\n\n[^giris-1-1]: Giriş notu.\n',
  'manuscript/sibernetik.md': '# Sibernetik\n\nWiener [@wiener1948].[^giris-1-1]\n\n```\n# not a heading\n```\n\n[^giris-1-1]: Aynı etiket, başka not.\n',
  'notes/wiener.md': '# Wiener\n\nHayatı.\n',
  'notes/arsiv.md': '# Arşiv\n\nDerlenmemeli.\n'
}
const ITEMS = [
  { kind: 'part', title: 'Temeller', level: 1 },
  { kind: 'node', title: 'Giriş', level: 2, path: 'manuscript/giris.md', text: null },
  { kind: 'node', title: 'Sibernetik', level: 2, path: 'manuscript/sibernetik.md', text: null },
  { kind: 'node', title: 'Wiener', level: 3, path: 'notes/wiener.md', text: '# Wiener\n\nHayatı (kaydedilmemiş düzenleme).\n' },
  { kind: 'node', title: 'Taslak bölüm', level: 2, path: null, text: null }
]
const read = rel => TEXTS[rel] != null ? TEXTS[rel] : null

;(async () => {
  console.log('compiler')

  await test('headings follow the plan: part #, chapters ##, sections ###', () => {
    const { markdown } = C.assemble(ITEMS, read)
    let code = false
    const hs = markdown.split('\n').filter(l => { if (/^```/.test(l)) code = !code; return !code && /^#{1,6} /.test(l) })
    assert.deepStrictEqual(hs, ['# Temeller', '## Giriş', '### Yöntem', '## Sibernetik', '### Wiener', '## Taslak bölüm'])
  })

  await test('lines inside code blocks are not treated as headings', () => {
    assert.ok(C.assemble(ITEMS, read).markdown.includes('```\n# not a heading\n```'))
  })

  await test('same footnote label in two chapters becomes two different notes', () => {
    const md = C.assemble(ITEMS, read).markdown
    assert.ok(md.includes('[^c2-giris-1-1]: Giriş notu.') && md.includes('[^c3-giris-1-1]: Aynı etiket, başka not.'))
    assert.ok(md.includes('amacı.[^c2-giris-1-1]') && md.includes('].[^c3-giris-1-1]'))
  })

  await test('unsaved text from the editor wins over the file; metadata blocks are removed', () => {
    const md = C.assemble(ITEMS, read).markdown
    assert.ok(md.includes('kaydedilmemiş düzenleme') && !md.includes('mentegraf-node'))
  })

  await test('a chapter without text keeps its heading and is reported', () => {
    const r = C.assemble(ITEMS, read)
    assert.ok(r.warnings.some(w => w.includes('Taslak bölüm')))
    assert.strictEqual(r.chapters, 4)
  })

  await test('a text without its own title gets the node name as heading', () => {
    const r = C.assemble([{ kind: 'node', title: 'Önsöz', level: 1, text: 'Sadece metin.\n\n# İçerideki başlık' }], read)
    assert.strictEqual(r.markdown, '# Önsöz\n\nSadece metin.\n\n## İçerideki başlık\n')
  })

  await test('an empty plan is refused', async () => {
    await assert.rejects(C.compileBook({ projectDir: tmp(), items: [{ kind: 'part', title: 'X', level: 1 }], format: 'md', outFile: path.join(tmp(), 'x.md'), readText: read }), e => e.code === 'empty')
  })

  await test('Markdown: one file with title, no passage IDs', async () => {
    const out = path.join(tmp(), 'Kitap.md')
    await C.compileBook({ projectDir: tmp(), items: ITEMS, title: 'Bilişimsel Düşünme', format: 'md', lang: 'tr', outFile: out, readText: read })
    const md = fs.readFileSync(out, 'utf8')
    assert.ok(md.startsWith('---\ntitle: "Bilişimsel Düşünme"\nlang: tr-TR\n---\n\n# Temeller'))
    assert.ok(!md.includes('^aaaaaa'))
  })

  let srv
  const zotero = () => new Promise(res => {
    srv = http.createServer((q, r) => { let b = ''; q.on('data', c => { b += c }); q.on('end', () => r.end(JSON.stringify({ jsonrpc: '2.0', result: JSON.stringify([{ id: 'wiener1948', type: 'book', title: 'Cybernetics', author: [{ family: 'Wiener', given: 'Norbert' }], issued: { 'date-parts': [[1948]] } }]) }))) })
    srv.listen(0, '127.0.0.1', () => { Exporter.BBT.port = srv.address().port; res() })
  })

  await test('DOCX: whole book with contents, real footnotes, bibliography', async () => {
    needPandoc(); await zotero()
    const dir = path.join(tmp(), 'Kitabım'), out = path.join(dir, 'exports', 'Kitap.docx')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    try {
      const r = await C.compileBook({ projectDir: dir, items: ITEMS, title: 'Bilişimsel Düşünme', format: 'docx', lang: 'tr', outFile: out, readText: read })
      const nat = native(out), txt = plain(out)
      assert.ok(/Header\s+1[\s\S]{0,80}"Temeller"/.test(nat), 'part = Heading 1')
      assert.ok(/Header\s+2[\s\S]{0,80}"Giri\\351\\351?|Header\s+2[\s\S]{0,80}Giri/.test(nat), 'chapter = Heading 2')
      assert.ok(txt.includes('Giriş notu.') && txt.includes('Aynı etiket, başka not.'), 'both notes survive')
      assert.ok(txt.includes('Wiener 1948'), 'citation formatted')
      assert.ok(txt.includes('Kaynakça') && txt.includes('Cybernetics'), 'bibliography')
      assert.ok(!txt.includes('^aaaaaa'), 'passage IDs removed')
      assert.ok(docxEntry(out, 'word/document.xml').includes('TOC \\o'), 'table of contents field')
      assert.ok(!r.warnings.some(w => /Zotero|Bibliography/.test(w)))
    } finally { srv.close() }
  })

  await test('EPUB: whole book with title and chapters', async () => {
    needPandoc(); Exporter.BBT.port = 1
    const out = path.join(tmp(), 'Kitap.epub')
    const r = await C.compileBook({ projectDir: tmp(), items: ITEMS, title: 'Bilişimsel Düşünme', format: 'epub', lang: 'tr', outFile: out, readText: read })
    assert.ok(fs.statSync(out).size > 2000)
    const txt = plain(out)
    assert.ok(txt.includes('Temeller') && txt.includes('Sibernetik') && txt.includes('Hayatı'))
    assert.ok(r.warnings.some(w => w.startsWith('Zotero')), 'Zotero missing is only a warning')
  })

  await test('figures and CSV tables from assets/ are numbered across chapters', async () => {
    needPandoc(); Exporter.BBT.port = 1
    const dir = path.join(tmp(), 'Kitap'); fs.mkdirSync(path.join(dir, 'assets'), { recursive: true }); fs.mkdirSync(path.join(dir, 'exports'))
    fs.writeFileSync(path.join(dir, 'assets', 'g.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
    fs.writeFileSync(path.join(dir, 'assets', 't.csv'), 'Yıl,Nüfus\n1950,20\n2000,64\n')
    const items = [
      { kind: 'node', title: 'Bir', level: 1, text: '# Bir\n\n![Döngü](../assets/g.png){#fig:dongu-aa}\n\nMetin.' },
      { kind: 'node', title: 'İki', level: 1, text: '# İki\n\n![Grafik](../assets/g.png){#fig:grafik-bb}\n\n![Nüfus](../assets/t.csv){#tbl:nufus-cc}\n\n@fig:dongu-aa, @fig:grafik-bb ve @tbl:nufus-cc.' }]
    const out = path.join(dir, 'exports', 'k.docx')
    await C.compileBook({ projectDir: dir, items, title: 'K', format: 'docx', lang: 'tr', outFile: out, readText: read })
    const txt = plain(out)
    assert.ok(txt.includes('Şekil 2. Grafik') && txt.includes('Tablo 1. Nüfus') && txt.includes('1950'), txt)
    assert.ok(txt.includes('Şekil 1, Şekil 2 ve Tablo 1.'), txt)
    assert.ok(docxEntry(out, 'word/_rels/document.xml.rels').includes('media/'), 'image embedded')
  })

  console.log(passed + ' passed' + (skipped ? ', ' + skipped + ' skipped' : '') + (process.exitCode ? ', some FAILED' : ''))
})()
