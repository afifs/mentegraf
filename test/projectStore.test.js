// Run: node test/projectStore.test.js
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Store = require('../src/projectStore')

let passed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name) } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1 }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mentegraf-test-'))
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8')

function sample() {
  return {
    version: '2.1', app: 'Mentegraf', lang: 'tr',
    config: {
      categories: [{ id: 'book', tr: 'Kitap', en: 'Book', color: '#c5a05e' }, { id: 'person', tr: 'Kişi', en: 'Person', color: '#7b8cc4' }],
      connectionTypes: [{ id: '', tr: 'Genel', en: 'General' }, { id: 'influences', tr: 'Etkiliyor', en: 'Influences' }],
      nodeSizing: false
    },
    elements: {
      nodes: [
        { data: { id: 'n-book', label: 'Cybernetics', type: 'book', color: '#c5a05e', description: 'd', notes: '', tags: ['x'], zoteroKey: 'ABC123', x: 10, y: 20 }, position: { x: 10.04, y: 20 } },
        { data: { id: 'n1', label: 'Wiener', type: 'person', color: '#7b8cc4', description: '', notes: '', tags: [], x: 0, y: 0 }, position: { x: 0, y: 0 } }
      ],
      edges: [{ data: { id: 'e1', source: 'n1', target: 'n-book', weight: 4, edgeType: 'influences', note: 'wrote it' } }]
    }
  }
}

console.log('projectStore')

test('write creates the folder layout', () => {
  const dir = path.join(tmp(), 'Book')
  Store.writeProject(dir, sample())
  for (const rel of ['project.mentegraf', 'graph/edges.json', 'graph/layout.json', 'graph/nodes/n-book.json', 'graph/nodes/n1.json']) {
    assert.ok(fs.existsSync(path.join(dir, rel)), rel + ' missing')
  }
  for (const d of ['manuscript', 'notes', '.mentegraf/backups']) assert.ok(fs.statSync(path.join(dir, d)).isDirectory(), d)
  const m = JSON.parse(read(dir, 'project.mentegraf'))
  assert.strictEqual(m.format, '3.0')
  assert.strictEqual(m.nodeTypes.length, 2)
  assert.strictEqual(m.settings.nodeSizing, false)
  const node = JSON.parse(read(dir, 'graph/nodes/n-book.json'))
  assert.strictEqual(node.zoteroKey, 'ABC123')
  assert.ok(!('x' in node) && !('color' in node), 'position/colour must not be in node files')
})

test('round trip keeps data, positions and types', () => {
  const dir = path.join(tmp(), 'Book')
  Store.writeProject(dir, sample())
  const { project, warnings } = Store.readProject(dir)
  assert.deepStrictEqual(warnings, [])
  const book = project.elements.nodes.find(n => n.data.id === 'n-book')
  assert.strictEqual(book.data.zoteroKey, 'ABC123')
  assert.strictEqual(book.data.color, '#c5a05e')
  assert.deepStrictEqual(book.position, { x: 10, y: 20 })
  assert.strictEqual(project.elements.edges[0].data.note, 'wrote it')
  assert.strictEqual(project.config.nodeSizing, false)
  assert.strictEqual(project.lang, 'tr')
})

test('saving unchanged project writes nothing', () => {
  const dir = path.join(tmp(), 'Book')
  Store.writeProject(dir, sample())
  const again = Store.writeProject(dir, Store.readProject(dir).project)
  assert.deepStrictEqual(again, { written: 0, deleted: 0 })
})

test('moving a node only rewrites layout.json', () => {
  const dir = path.join(tmp(), 'Book')
  Store.writeProject(dir, sample())
  const p = Store.readProject(dir).project
  p.elements.nodes[0].position = { x: 999, y: 999 }
  const r = Store.writeProject(dir, p)
  assert.deepStrictEqual(r, { written: 1, deleted: 0 })
  assert.strictEqual(JSON.parse(read(dir, 'graph/layout.json'))[p.elements.nodes[0].data.id].x, 999)
})

test('deleted node removes its file; backup is made', () => {
  const dir = path.join(tmp(), 'Book')
  Store.writeProject(dir, sample())
  const p = Store.readProject(dir).project
  p.elements.nodes = p.elements.nodes.filter(n => n.data.id !== 'n1')
  p.elements.edges = []
  const r = Store.writeProject(dir, p)
  assert.strictEqual(r.deleted, 1)
  assert.ok(!fs.existsSync(path.join(dir, 'graph/nodes/n1.json')))
  const backups = fs.readdirSync(path.join(dir, '.mentegraf/backups'))
  assert.strictEqual(backups.length, 1)
  const b = JSON.parse(read(dir, '.mentegraf/backups/' + backups[0]))
  assert.strictEqual(b.elements.nodes.length, 2, 'backup holds the state before the save')
})

test('sync conflict copies are reported, not loaded, not deleted', () => {
  const dir = path.join(tmp(), 'Book')
  Store.writeProject(dir, sample())
  const conflict = 'n1 (SFConflict afif 2026-10-23-17-00-00).json'
  fs.writeFileSync(path.join(dir, 'graph/nodes', conflict), JSON.stringify({ id: 'n1', label: 'Wiener (other machine)' }))
  const { project, warnings } = Store.readProject(dir)
  assert.strictEqual(project.elements.nodes.find(n => n.data.id === 'n1').data.label, 'Wiener')
  assert.ok(warnings.some(w => w.kind === 'conflict' && w.file.includes('SFConflict')))
  Store.writeProject(dir, project)
  assert.ok(fs.existsSync(path.join(dir, 'graph/nodes', conflict)), 'conflict copy must be kept')
})

test('unreadable node file is reported and skipped', () => {
  const dir = path.join(tmp(), 'Book')
  Store.writeProject(dir, sample())
  fs.writeFileSync(path.join(dir, 'graph/nodes/n1.json'), '{ broken')
  const { project, warnings } = Store.readProject(dir)
  assert.ok(warnings.some(w => w.kind === 'unreadable'))
  assert.ok(warnings.some(w => w.kind === 'dangling'), 'edge to the lost node is reported')
  assert.strictEqual(project.elements.nodes.length, 1)
})

test('old single-file project converts to a folder next to it, original untouched', () => {
  const root = tmp()
  const file = path.join(root, 'Kitabim.mentegraf')
  const original = JSON.stringify(Object.assign(sample(), { version: '2.0' }))
  fs.writeFileSync(file, original)
  assert.strictEqual(Store.classify(file), 'legacy')
  const dir = Store.convertLegacy(file)
  assert.strictEqual(path.basename(dir), 'Kitabim')
  assert.strictEqual(fs.readFileSync(file, 'utf8'), original)
  assert.strictEqual(Store.classify(path.join(dir, 'project.mentegraf')), 'folder')
  assert.strictEqual(Store.readProject(dir).project.elements.nodes.length, 2)
  assert.strictEqual(path.basename(Store.convertLegacy(file)), 'Kitabim (2)', 'never overwrites an existing folder')
})

test('refuses newer formats and non-projects', () => {
  const dir = path.join(tmp(), 'Future')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'project.mentegraf'), JSON.stringify({ format: '4.0' }))
  assert.throws(() => Store.readProject(dir), e => e.code === 'too-new')
  const junk = path.join(tmp(), 'x.json')
  fs.writeFileSync(junk, '{"hello":1}')
  assert.throws(() => Store.classify(junk), e => e.code === 'not-a-project')
})

test('Save As target must be new or empty', () => {
  const root = tmp()
  assert.strictEqual(Store.checkNewProjectDir(path.join(root, 'New')), null)
  fs.writeFileSync(path.join(root, 'file'), 'x')
  assert.strictEqual(Store.checkNewProjectDir(root), 'not-empty')
  assert.strictEqual(Store.checkNewProjectDir(path.join(root, 'file')), 'not-a-folder')
})

test('odd ids give safe file names', () => {
  assert.strictEqual(Store.safeName('n-abc'), 'n-abc')
  assert.strictEqual(Store.safeName('a/b:c'), 'a%2fb%3ac')
  assert.strictEqual(Store.safeName('con'), '_con')
})

test('export settings are kept in the manifest', () => {
  const dir = path.join(tmp(), 'Book'), p = sample()
  p.config.export = { citationStyle: 'styles/apa.csl', wordTemplate: 'default', language: 'tr' }
  Store.writeProject(dir, p)
  assert.deepStrictEqual(JSON.parse(read(dir, 'project.mentegraf')).export, p.config.export)
  assert.deepStrictEqual(Store.readProject(dir).project.config.export, p.config.export)
  const old = path.join(tmp(), 'Old'); Store.writeProject(old, sample())
  assert.deepStrictEqual(Store.readProject(old).project.config.export, {})
})

console.log('manuscript')

test('book structure is saved in graph/manuscript.json and read back', () => {
  const dir = path.join(tmp(), 'Book'), p = sample()
  p.manuscript = { title: 'Bilişimsel Düşünme', items: [
    { id: 'part-a', kind: 'part', title: 'Temeller', children: [
      { id: 'n-book', kind: 'node', node: 'n-book', include: true, children: [{ id: 'n1', kind: 'node', node: 'n1', include: false, children: [] }] }] }] }
  Store.writeProject(dir, p)
  const back = Store.readProject(dir).project.manuscript
  assert.deepStrictEqual(back, p.manuscript)
  assert.deepStrictEqual(JSON.parse(read(dir, 'graph/manuscript.json')), p.manuscript)
})

test('book structure: missing nodes, duplicates, nested parts and too-deep items are dropped', () => {
  const m = Store.normalizeManuscript({ items: [
    { kind: 'node', node: 'a', children: [{ kind: 'part', title: 'nested part' }, { kind: 'node', node: 'b', children: [{ kind: 'node', node: 'c', children: [{ kind: 'node', node: 'd' }] }] }] },
    { kind: 'node', node: 'a' }, { kind: 'node', node: 'gone' }, 'junk' ] }, { a: true, b: true, c: true, d: true })
  assert.deepStrictEqual(m, { title: '', items: [{ id: 'a', kind: 'node', node: 'a', include: true, children: [
    { id: 'b', kind: 'node', node: 'b', include: true, children: [{ id: 'c', kind: 'node', node: 'c', include: true, children: [] }] }] }] })
  assert.deepStrictEqual(Store.normalizeManuscript(null), { title: '', items: [] })
})

test('older projects without a book structure open with an empty one', () => {
  const dir = path.join(tmp(), 'Book')
  Store.writeProject(dir, sample())
  fs.unlinkSync(path.join(dir, 'graph/manuscript.json'))
  assert.deepStrictEqual(Store.readProject(dir).project.manuscript, { title: '', items: [] })
})

console.log('classification')

test('category tree is saved in graph/categories.json; nodes keep their categories', () => {
  const dir = path.join(tmp(), 'Book'), p = sample()
  p.classification = { categories: [{ id: 'c1', name: 'Sibernetik', parent: null }, { id: 'c2', name: 'Geri besleme', parent: 'c1' }, { id: 'c3', name: 'Homeostaz', parent: 'c2' }] }
  p.elements.nodes[0].data.cats = ['c2', 'gone']
  Store.writeProject(dir, p)
  const back = Store.readProject(dir).project
  assert.deepStrictEqual(back.classification, p.classification)
  assert.deepStrictEqual(JSON.parse(read(dir, 'graph/categories.json')), p.classification)
  assert.deepStrictEqual(back.elements.nodes.find(n => n.data.id === p.elements.nodes[0].data.id).data.cats, ['c2'])
})

test('category tree: unknown parents and cycles go to the top level; duplicates dropped', () => {
  const c = Store.normalizeClassification({ categories: [
    { id: 'a', name: 'A', parent: 'b' }, { id: 'b', name: 'B', parent: 'a' }, { id: 'c', name: 'C', parent: 'nope' },
    { id: 'd', name: 'D', parent: 'c' }, { id: 'd', name: 'dup' }, { name: 'no id' }, null] })
  assert.deepStrictEqual(c.categories.map(x => [x.id, x.parent]), [['a', null], ['b', 'a'], ['c', null], ['d', 'c']])
  assert.deepStrictEqual(Store.normalizeClassification(undefined), { categories: [] })
})

test('older projects open with no categories; a node without categories has no cats field', () => {
  const dir = path.join(tmp(), 'Book')
  Store.writeProject(dir, sample())
  fs.unlinkSync(path.join(dir, 'graph/categories.json'))
  const back = Store.readProject(dir).project
  assert.deepStrictEqual(back.classification, { categories: [] })
  assert.ok(back.elements.nodes.every(n => !('cats' in n.data)))
})

console.log('search')

test('search is case- and accent-tolerant and treats ı/i/I/İ alike', () => {
  assert.strictEqual(Store.foldText('İSTANBUL Işık Düşünme ÇAĞ'), 'istanbul isik dusunme cag')
  const dir = path.join(tmp(), 'Book'); Store.writeProject(dir, sample())
  Store.writeFragments(dir, [
    { path: 'manuscript/a.md', text: '---\nmentegraf-node: x\n---\n\n# Bilişimsel Düşünme\n\nDüşünmek ve düşünme. İnsan düşünür.' },
    { path: 'notes/b.md', text: 'Hiç düşünme yok burada? Var: DÜŞÜNME.' },
    { path: 'notes/c.md', text: 'Başka bir şey.' }])
  const r = Store.searchTexts(dir, 'dusunme')
  assert.deepStrictEqual(r.files.map(f => [f.path, f.count]), [['manuscript/a.md', 3], ['notes/b.md', 2]])
  assert.strictEqual(r.total, 5)
  const h = r.files[0].hits[0]
  assert.deepStrictEqual([h.line, h.col, h.len, h.match], [5, 13, 7, 'Düşünme'])
  assert.strictEqual(Store.searchTexts(dir, 'insan').files[0].hits[0].match, 'İnsan')
})

test('search: the metadata block is skipped; unsaved texts and "only" are honoured; short queries do nothing', () => {
  const dir = path.join(tmp(), 'Book'); Store.writeProject(dir, sample())
  Store.writeFragments(dir, [{ path: 'manuscript/a.md', text: '---\nmentegraf-node: wiener\n---\n\nWiener burada.' }, { path: 'notes/b.md', text: 'Wiener orada.' }])
  assert.deepStrictEqual(Store.searchTexts(dir, 'wiener').files.map(f => f.hits[0].line), [5, 1])
  const r = Store.searchTexts(dir, 'wiener', { overrides: { 'notes/b.md': 'Artık yok.', 'notes/new.md': 'Yeni Wiener notu.' } })
  assert.deepStrictEqual(r.files.map(f => f.path), ['manuscript/a.md', 'notes/new.md'])
  assert.deepStrictEqual(Store.searchTexts(dir, 'wiener', { only: ['notes/b.md'] }).files.map(f => f.path), ['notes/b.md'])
  assert.strictEqual(Store.searchTexts(dir, 'w').total, 0)
  assert.strictEqual(Store.searchTexts(null, 'wiener', { overrides: { 'notes/x.md': 'wiener' } }).total, 1)
})

test('search: long lines are cut around the match; many hits are capped but counted', () => {
  const dir = path.join(tmp(), 'Book'); Store.writeProject(dir, sample())
  Store.writeFragments(dir, [{ path: 'notes/long.md', text: 'x'.repeat(200) + ' hedef ' + 'y'.repeat(200) + '\n' + 'hedef '.repeat(400) }])
  const r = Store.searchTexts(dir, 'hedef', { limit: 50 })
  const h = r.files[0].hits[0]
  assert.ok(h.before.startsWith('…') && h.after.endsWith('…') && h.before.length <= 51 && h.match === 'hedef')
  assert.strictEqual(r.total, 401); assert.strictEqual(r.files[0].hits.length, 50); assert.ok(r.truncated)
})

test('word counts of texts on disk', () => {
  const dir = path.join(tmp(), 'Book')
  Store.writeProject(dir, sample())
  Store.writeFragments(dir, [{ path: 'manuscript/a.md', text: '---\nmentegraf-node: x\n---\n\n# Giriş\n\nÇağdaş düşünce, 1948\'de.' }])
  assert.deepStrictEqual(Store.fragmentStats(dir, ['manuscript/a.md', 'notes/missing.md', '../x.md']), { 'manuscript/a.md': 4 })
})

console.log('text fragments')

test('slugs handle Turkish letters', () => {
  assert.strictEqual(Store.slugify('Bilişimsel Düşünme: Giriş'), 'bilisimsel-dusunme-giris')
  assert.strictEqual(Store.slugify('ÇĞİÖŞÜ çğıöşü'), 'cgiosu-cgiosu')
  assert.strictEqual(Store.slugify('???'), 'metin')
})

test('new text paths: chapters in manuscript/, others in notes/, never reused', () => {
  const dir = path.join(tmp(), 'Book')
  Store.writeProject(dir, sample())
  assert.strictEqual(Store.newFragmentPath(dir, 'Giriş', 'chapter', 'n-abcd1234', []), 'manuscript/giris-1234.md')
  const p1 = Store.newFragmentPath(dir, 'Wiener', 'person', 'n1', [])
  assert.strictEqual(p1, 'notes/wiener-n1.md')
  assert.strictEqual(Store.newFragmentPath(dir, 'Wiener', 'person', 'n1', [p1]), 'notes/wiener-n1-2.md')
  Store.writeFragments(dir, [{ path: p1, text: 'x' }])
  assert.strictEqual(Store.newFragmentPath(dir, 'Wiener', 'person', 'n1', []), 'notes/wiener-n1-2.md', 'existing file counts as taken')
})

test('write and read texts; unchanged texts are not rewritten; old versions kept', () => {
  const dir = path.join(tmp(), 'Book')
  Store.writeProject(dir, sample())
  assert.deepStrictEqual(Store.writeFragments(dir, [{ path: 'notes/a.md', text: 'one' }]), ['notes/a.md'])
  assert.deepStrictEqual(Store.readFragment(dir, 'notes/a.md'), { exists: true, text: 'one' })
  assert.deepStrictEqual(Store.writeFragments(dir, [{ path: 'notes/a.md', text: 'one' }]), [])
  Store.writeFragments(dir, [{ path: 'notes/a.md', text: 'two' }])
  const versions = fs.readdirSync(path.join(dir, '.mentegraf/backups/text'))
  assert.strictEqual(versions.length, 1)
  assert.strictEqual(read(dir, '.mentegraf/backups/text/' + versions[0]), 'one')
  assert.deepStrictEqual(Store.readFragment(dir, 'notes/missing.md'), { exists: false })
})

test('text paths cannot escape the project', () => {
  const dir = path.join(tmp(), 'Book')
  for (const bad of ['../x.md', 'notes/../../x.md', 'graph/nodes/n1.md', 'notes/x.txt', 'C:/x.md', '/etc/x.md']) {
    assert.throws(() => Store.fragmentAbs(dir, bad), e => e.code === 'bad-path', bad)
  }
})

test('Save As copies the text folders', () => {
  const a = path.join(tmp(), 'A'), b = path.join(tmp(), 'B')
  Store.writeProject(a, sample())
  Store.writeFragments(a, [{ path: 'manuscript/ch1.md', text: 'chapter' }, { path: 'notes/n.md', text: 'note' }])
  Store.copyTextFolders(a, b)
  assert.strictEqual(read(b, 'manuscript/ch1.md'), 'chapter')
  assert.strictEqual(read(b, 'notes/n.md'), 'note')
})

console.log('assets')

test('images and CSV files are copied into assets/ with readable, unique names', () => {
  const dir = path.join(tmp(), 'Book'); Store.writeProject(dir, sample())
  const src = path.join(tmp(), 'Geri Besleme Döngüsü.PNG'), png = Buffer.from('89504e470d0a1a0a0000', 'hex')
  fs.writeFileSync(src, png)
  const a = Store.importAsset(dir, { file: src })
  assert.deepStrictEqual(a, { rel: 'assets/geri-besleme-dongusu.png', kind: 'figure', name: 'Geri Besleme Döngüsü' })
  assert.ok(Buffer.compare(fs.readFileSync(path.join(dir, a.rel)), png) === 0, 'bytes copied exactly')
  assert.strictEqual(Store.importAsset(dir, { file: src }).rel, 'assets/geri-besleme-dongusu-2.png')
  const csv = Store.importAsset(dir, { data: Buffer.from('a,b\n1,2\n'), name: 'Nüfus.csv' })
  assert.deepStrictEqual(csv, { rel: 'assets/nufus.csv', kind: 'table', name: 'Nüfus' })
  const pasted = Store.importAsset(dir, { data: new Uint8Array([137, 80, 78, 71]), name: 'yapistirilan.png' })
  assert.strictEqual(fs.readFileSync(path.join(dir, pasted.rel)).length, 4, 'pasted bytes written as binary')
})

test('other file types and empty files are refused', () => {
  const dir = path.join(tmp(), 'Book'); Store.writeProject(dir, sample())
  assert.throws(() => Store.importAsset(dir, { data: Buffer.from('x'), name: 'virus.exe' }), e => e.code === 'bad-type')
  assert.throws(() => Store.importAsset(dir, { data: Buffer.alloc(0), name: 'bos.png' }), e => e.code === 'empty')
  assert.strictEqual(Store.assetKind('a.SVG'), 'figure'); assert.strictEqual(Store.assetKind('a.txt'), null)
})

test('Save As brings assets along', () => {
  const a = path.join(tmp(), 'A'), b = path.join(tmp(), 'B'); Store.writeProject(a, sample())
  Store.importAsset(a, { data: Buffer.from('a,b\n'), name: 't.csv' })
  Store.copyTextFolders(a, b)
  assert.ok(fs.existsSync(path.join(b, 'assets', 't.csv')))
})

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''))
