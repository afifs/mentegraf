// Run: node test/obsidian.test.js
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Obs = require('../src/obsidian')

let passed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name) } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1 }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'obs-'))
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8')

function project() {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, 'manuscript'))
  fs.writeFileSync(path.join(dir, 'manuscript/giris.md'), '# Giriş\n\nİlk paragraf.\n\nEhven mevcut seçenekler arasından seçer;\nsıçrama yeniyi görünür kılar. ^abc123\n\nSon.\n')
  return dir
}
const nodes = () => [
  { id: 'ch', label: 'Giriş', type: 'chapter', typeLabel: 'Bölüm', description: 'İlk bölüm.', tags: [], cats: [], catTags: [], fragment: 'manuscript/giris.md', links: [{ to: 'c1', dir: 'in', type: 'İçeriyor', marker: '◉', note: '' }] },
  { id: 'c1', label: 'Ehven seçer, sıçrama görünür kılar', type: 'claim', typeLabel: 'İddia', description: '', tags: ['tez'], cats: ['Sezgi ve Karar › Ehven'], catTags: ['Sezgi ve Karar/Ehven'], status: 'Tez',
    passage: 'manuscript/giris.md#abc123', passageOwner: 'ch', links: [{ to: 'p1', dir: 'out', type: 'Kaynak', marker: '❝', note: 'Simon 1973' }, { to: 'ch', dir: 'out', type: '', marker: '', note: '' }] },
  { id: 'p1', label: 'Herbert Simon', type: 'person', typeLabel: 'Kişi', description: 'Sınırlı rasyonellik: ehven.', notes: 'Nobel 1978.', tags: [], cats: [], catTags: [], links: [{ to: 'c1', dir: 'in', type: 'Kaynak', marker: '❝', note: 'Simon 1973' }] },
  { id: 'p2', label: 'Schiller', type: 'person', typeLabel: 'Kişi', description: 'Friedrich.', tags: [], cats: [], catTags: [], links: [] },
  { id: 'p3', label: 'Schiller', type: 'concept', typeLabel: 'Kavram', description: 'Aynı ad, başka tür.', tags: [], cats: [], catTags: [], links: [] }
]

test('safe names keep Turkish letters and drop what files cannot hold', () => {
  assert.strictEqual(Obs.safeName('Cırcır Dişlisi: İşaret/Sembol?'), 'Cırcır Dişlisi- İşaret-Sembol-')
  assert.strictEqual(Obs.safeName('  '), 'Adsız')
  assert.strictEqual(Obs.safeTag('Sezgi ve Karar/Ehven'), 'Sezgi-ve-Karar/Ehven')
})

test('first export: one note per node in the book folder, with front matter, links and the passage', () => {
  const p = project(), vault = tmp()
  const r = Obs.exportVault({ vaultDir: vault, folderName: 'Sezginin Gizli Mantığı', projectTitle: 'Sezginin Gizli Mantığı', projectDir: p, nodes: nodes() })
  assert.strictEqual(r.folder, path.join(vault, 'Sezginin Gizli Mantığı'))
  assert.deepStrictEqual([r.created, r.updated, r.orphaned], [6, 0, 0])
  const files = fs.readdirSync(r.folder).sort()
  assert.deepStrictEqual(files, ['Dizin - Sezginin Gizli Mantığı.md', 'Ehven seçer, sıçrama görünür kılar.md', 'Giriş.md', 'Herbert Simon.md', 'Schiller (Kavram).md', 'Schiller (Kişi).md'])
  const claim = read(r.folder, 'Ehven seçer, sıçrama görünür kılar.md')
  assert.ok(claim.startsWith('---\nmentegraf-id: c1\n'), claim)
  assert.ok(claim.includes('mentegraf-type: claim\ntür: İddia\ndurum: Tez\n'))
  assert.ok(claim.includes('tags:\n  - tez\n  - Sezgi-ve-Karar/Ehven\n'))
  assert.ok(claim.includes('> Ehven mevcut seçenekler arasından seçer; sıçrama yeniyi görünür kılar.\n>\n> — [[Giriş]]'), 'passage quoted, marker gone')
  assert.ok(claim.includes('- → Kaynak ❝ [[Herbert Simon]] — Simon 1973'))
  assert.ok(claim.includes('- İlişkili [[Giriş]]'), 'untyped link')
  const simon = read(r.folder, 'Herbert Simon.md')
  assert.ok(simon.includes('- ← Kaynak ❝ [[Ehven seçer, sıçrama görünür kılar]]') && simon.includes('## Notlar\n\nNobel 1978.'))
  const index = read(r.folder, 'Dizin - Sezginin Gizli Mantığı.md')
  assert.ok(/## Kişi\n\n- \[\[Herbert Simon\]\]\n- \[\[Schiller \(Kişi\)\|Schiller\]\]/.test(index), index)
})

test('re-export keeps what the author wrote, follows renames, merges tags, counts orphans', () => {
  const p = project(), vault = tmp()
  const opts = { vaultDir: vault, folderName: 'Kitap', projectTitle: 'Kitap', projectDir: p, nodes: nodes() }
  const r1 = Obs.exportVault(opts), dir = r1.folder
  // the author works in Obsidian: adds text and a tag to Simon, renames him, deletes nothing
  let s = read(dir, 'Herbert Simon.md')
  s = s.replace('---\n', '---\ntags:\n  - okunacak\nkaynak: kitaplık\n').replace(/\n*$/, '\n\nKendi notum: GPS ve iyi tanımlanmamış problemler.\n')
  fs.writeFileSync(path.join(dir, 'H. A. Simon.md'), s); fs.unlinkSync(path.join(dir, 'Herbert Simon.md'))
  fs.writeFileSync(path.join(dir, 'Benim notum.md'), 'Mentegraf dışı not.\n')
  // the map changes: Simon gets a new description; Schiller (concept) is removed
  const n2 = nodes().filter(n => n.id !== 'p3'); n2[2].description = 'Sınırlı rasyonellik ve ehven (satisficing).'
  const r2 = Obs.exportVault(Object.assign({}, opts, { nodes: n2 }))
  assert.strictEqual(r2.orphaned, 1)
  assert.ok(!fs.existsSync(path.join(dir, 'Herbert Simon.md')), 'renamed note is reused, not recreated')
  const after = read(dir, 'H. A. Simon.md')
  assert.ok(after.includes('Sınırlı rasyonellik ve ehven (satisficing).') && !after.includes('Sınırlı rasyonellik: ehven.'), 'our part updated')
  assert.ok(after.includes('Kendi notum: GPS ve iyi tanımlanmamış problemler.'), 'author text kept')
  assert.ok(after.includes('kaynak: kitaplık') && after.includes('  - okunacak'), 'author keys and tags kept')
  assert.strictEqual((after.match(/mentegraf-id/g) || []).length, 1)
  assert.strictEqual((after.match(/<!-- mentegraf:start -->/g) || []).length, 1)
  assert.ok(read(dir, 'Ehven seçer, sıçrama görünür kılar.md').includes('[[H. A. Simon|Herbert Simon]]'), 'links follow the new name')
  assert.strictEqual(read(dir, 'Benim notum.md'), 'Mentegraf dışı not.\n')
  assert.ok(fs.existsSync(path.join(dir, 'Schiller (Kavram).md')), 'orphan left in place')
  const r3 = Obs.exportVault(Object.assign({}, opts, { nodes: n2 }))
  assert.strictEqual(r3.created + r3.updated, 0, 'nothing changes on a third run')
})

test('long claims get a short file name with the full text as alias; a node named like the index keeps its own note', () => {
  const p = project(), vault = tmp()
  const long = 'Sıçrama son hamle değil, seçeneğin görünür olmasıdır; bu süreç insan ve makine biriminde gerçekleşebilir, ama seçeneği tanıyan büküm bedende kalır.'
  const r = Obs.exportVault({ vaultDir: vault, folderName: 'Kitap', projectTitle: 'Kitap', projectDir: p, nodes: [
    { id: 'c9', label: long, type: 'claim', typeLabel: 'İddia', links: [] },
    { id: 'b', label: 'Dizin - Kitap', type: 'book', typeLabel: 'Kitap', links: [] }] })
  const files = fs.readdirSync(r.folder).sort()
  const claimFile = files.find(f => f.startsWith('Sıçrama'))
  assert.ok(claimFile.length <= 84 && claimFile.endsWith('….md'), claimFile)
  assert.ok(read(r.folder, claimFile).includes('aliases:\n  - ' + JSON.stringify(long)))
  assert.ok(files.includes('Dizin - Kitap (Kitap).md') && files.includes('Dizin - Kitap.md'))
})

test('a note without markers gets the block on top, the author text below', () => {
  const t = Obs.mergeNote('Elle yazılmış.\n', { keys: { 'mentegraf-id': 'x' }, tags: ['a b'] }, 'Açıklama.')
  assert.strictEqual(t, '---\nmentegraf-id: x\ntags:\n  - a b\n---\n<!-- mentegraf:start -->\nAçıklama.\n<!-- mentegraf:end -->\n\nElle yazılmış.\n')
})

// ── import ──
const exported = () => {
  const p = project(), vault = tmp()
  const opts = { vaultDir: vault, folderName: 'Kitap', projectTitle: 'Kitap', projectDir: p, nodes: nodes() }
  const r = Obs.exportVault(opts)
  return { p, vault, opts, r, dir: r.folder }
}
const scan = (x, ns, base) => Obs.scanImport({ folder: x.dir, folderName: 'Kitap', nodes: ns || nodes(), baseline: base === undefined ? x.r.baseline : base, quoteOf: n => Obs.passageText(x.p, n.passage) })
const edit = (x, file, fn) => { const f = path.join(x.dir, file + '.md'); fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8'))) }

test('block parsing gets description, notes and quote back', () => {
  const b = Obs.parseBlock('Bir.\n\nİki.\n\n> Alıntı satırı.\n>\n> — [[Giriş]]\n\n**Durum:** Tez\n\n## Bağlantılar\n\n- x\n\n## Notlar\n\nNot bir.\n\n## Alt başlık\n\nNot iki.', { status: 'Durum', categories: 'Kategoriler', links: 'Bağlantılar', notes: 'Notlar' })
  assert.deepStrictEqual(b, { description: 'Bir.\n\nİki.', notes: 'Not bir.\n\n## Alt başlık\n\nNot iki.', quote: 'Alıntı satırı.' })
  assert.deepStrictEqual(Obs.wikiLinks('a [[X]] b [[Y|y]] ![[img.png]] [[Z#h]]\n> [[Q]]'), ['X', 'Y', 'Z'])
})

test('an untouched vault brings nothing back', () => {
  const x = exported(), pl = scan(x)
  assert.ok(pl.hasBaseline)
  ;['updates', 'tagsAdd', 'tagsRemove', 'links', 'created', 'orphans', 'quotes'].forEach(k => assert.deepStrictEqual(pl[k], [], k))
})

test('edits in the block, tags, links and new notes come back as proposals', () => {
  const x = exported()
  edit(x, 'Herbert Simon', t => t.replace('Sınırlı rasyonellik: ehven.', 'Sınırlı rasyonellik: ehven (satisficing).').replace('Nobel 1978.', 'Nobel 1978. Carnegie Mellon.')
    .replace('---\n', '---\ntags:\n  - okunacak\n') + '\nBkz. [[Schiller (Kişi)]] ve [[Yeni fikir]].\n')
  edit(x, 'Ehven seçer, sıçrama görünür kılar', t => t.replace('  - tez\n', '').replace('sıçrama yeniyi görünür kılar.\n>', 'sıçrama yeniyi gösterir.\n>'))
  fs.mkdirSync(path.join(x.dir, 'Taslaklar'))
  fs.writeFileSync(path.join(x.dir, 'Taslaklar', 'Yeni fikir.md'), '---\ntür: Kavram\ntags: [deneme]\n---\nSerbest metin, [[Herbert Simon]] ile ilgili.\n')
  const pl = scan(x)
  assert.deepStrictEqual(pl.updates.map(u => [u.id, u.field, u.to, u.conflict]), [['p1', 'description', 'Sınırlı rasyonellik: ehven (satisficing).', false], ['p1', 'notes', 'Nobel 1978. Carnegie Mellon.', false]])
  assert.deepStrictEqual(pl.tagsAdd.map(t => [t.id, t.tag]), [['p1', 'okunacak']])
  assert.deepStrictEqual(pl.tagsRemove.map(t => [t.id, t.tag]), [['c1', 'tez']])
  assert.deepStrictEqual(pl.created, [{ file: 'Taslaklar/Yeni fikir', label: 'Yeni fikir', typeHint: 'Kavram', tags: ['deneme'] }])
  assert.deepStrictEqual(pl.links.map(l => [l.from, l.to].sort()).sort(), [['new:Taslaklar/Yeni fikir', 'p1'], ['p1', 'p2']].sort(), 'Simon–Yeni fikir once, Simon–Schiller; existing Simon–claim link skipped')
  assert.deepStrictEqual(pl.quotes.map(q => q.id), ['c1'])
})

test('both sides changed is a conflict; only the map changed is not a proposal; no baseline marks everything', () => {
  const x = exported()
  edit(x, 'Herbert Simon', t => t.replace('Sınırlı rasyonellik: ehven.', 'Obsidian sürümü.'))
  const ns = nodes(); ns[2].description = 'Harita sürümü.'; ns[3].description = 'Friedrich Schiller, şair.'
  const pl = scan(x, ns)
  assert.deepStrictEqual(pl.updates.map(u => [u.id, u.from, u.to, u.conflict]), [['p1', 'Harita sürümü.', 'Obsidian sürümü.', true]])
  const nb = scan(x, ns, null)
  assert.ok(!nb.hasBaseline && nb.updates.length === 2 && nb.updates.every(u => u.noBaseline))
})

test('the index note is skipped; notes of deleted nodes are listed; re-export adopts new notes without moving the author text', () => {
  const x = exported()
  fs.writeFileSync(path.join(x.dir, 'Yeni fikir.md'), 'Serbest metin.\n')
  const ns = nodes().filter(n => n.id !== 'p3')
  const pl = scan(x, ns)
  assert.deepStrictEqual(pl.orphans, ['Schiller (Kavram)'])
  assert.deepStrictEqual(pl.created.map(c => c.file), ['Yeni fikir'])
  ns.push({ id: 'n9', label: 'Yeni fikir', type: 'idea', typeLabel: 'Fikir', description: '', tags: [], links: [] })
  const r = Obs.exportVault(Object.assign({}, x.opts, { nodes: ns, adopt: { n9: 'Yeni fikir' } }))
  assert.strictEqual(r.created, 0)
  const t = read(x.dir, 'Yeni fikir.md')
  assert.ok(t.startsWith('---\nmentegraf-id: n9\n') && t.endsWith('-->\n\nSerbest metin.\n'), t)
  assert.ok(!fs.existsSync(path.join(x.dir, 'Yeni fikir (Fikir).md')))
  assert.strictEqual(r.baseline.nodes.n9.file, 'Yeni fikir')
  const again = scan(Object.assign({}, x, { r }), ns)
  assert.strictEqual(again.created.length + again.updates.length + again.links.length, 0)
})

test('a note moved into a subfolder is still the same node', () => {
  const x = exported()
  fs.mkdirSync(path.join(x.dir, 'Kişiler'))
  fs.renameSync(path.join(x.dir, 'Herbert Simon.md'), path.join(x.dir, 'Kişiler', 'Herbert Simon.md'))
  const r = Obs.exportVault(x.opts)
  assert.strictEqual(r.created, 0)
  assert.ok(!fs.existsSync(path.join(x.dir, 'Herbert Simon.md')))
  assert.ok(read(x.dir, 'Ehven seçer, sıçrama görünür kılar.md').includes('[[Herbert Simon]]'))
})

console.log(passed + ' passed')
