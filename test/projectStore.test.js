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

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''))
