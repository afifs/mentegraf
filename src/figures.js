// figures.js — figures (images) and tables (CSV) as graph nodes, used in texts.
//
// Every image or CSV that enters a text becomes a node of type "figure" (Şekil) or
// "table" (Tablo) that owns a file in <project>/assets. The text gets standard
// Pandoc Markdown:  ![Caption](../assets/file.png){#fig:caption-ab12}
// and references to it are written  @fig:caption-ab12  (numbered at export).
/* global cy, L, snapshot, mkNode, catById, categories, Writer, ProjectFormat */
var Figures = (function () {
  'use strict'

  var TYPES = [
    { id: 'figure', tr: 'Şekil', en: 'Figure', color: '#5b8fb0', svgPath: 'M2 20l6-8 4 5 3-4 7 7H2zM16 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6z' },
    { id: 'table', tr: 'Tablo', en: 'Table', color: '#7a9a5a', svgPath: 'M3 3h8v5H3zM13 3h8v5h-8zM3 10h8v5H3zM13 10h8v5h-8zM3 17h8v4H3zM13 17h8v4h-8z' }
  ]
  var IMAGE_EXT = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, svg: 1 }
  var base = null                          // file:// URL of the project folder, ending in /
  var bound = false

  function $(id) { return document.getElementById(id) }
  function api() { return window.mentegraf }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }

  var TR_MAP = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'İ': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'Ç': 'c', 'Ğ': 'g', 'Ö': 'o', 'Ş': 's', 'Ü': 'u' }
  function slug(s) {
    var out = String(s || '').replace(/[çğıİöşüÇĞÖŞÜ]/g, function (c) { return TR_MAP[c] })
      .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '')
    return out || 'sekil'
  }
  function tail(id) { return String(id).replace(/[^A-Za-z0-9]/g, '').slice(-4).toLowerCase() }

  // ───────── node types ─────────

  // Older projects store their own type list: add Şekil and Tablo if missing.
  function ensureTypes() {
    if (!window.categories || typeof catById !== 'function') return
    TYPES.forEach(function (t) { if (!catById(t.id)) categories.push(JSON.parse(JSON.stringify(t))) })
  }

  function isAssetNode(n) { return n && n.length && (n.data('type') === 'figure' || n.data('type') === 'table') && n.data('asset') }

  function hostNode() {
    var c = Writer.current && Writer.current()
    var h = c && window.cy ? cy.getElementById(c.nodeId) : null
    return h && h.length ? h : null
  }

  // Connect the text's node and the figure in the graph (once).
  function link(host, n) {
    if (!host || !n || host.id() === n.id() || host.edgesWith(n).length) return
    cy.add({ data: { id: ProjectFormat.newId('e'), source: host.id(), target: n.id(), weight: 3, edgeType: 'contains', note: '' } })
  }

  // a = { rel, kind, name } from the main process
  function createNode(a) {
    var host = hostNode()
    var p = host ? host.position() : (function () { var e = cy.extent(); return { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 } })()
    var ang = Math.random() * Math.PI * 2
    var n = mkNode(p.x + Math.cos(ang) * 140, p.y + Math.sin(ang) * 140)
    var cat = catById(a.kind)
    var label = a.name && !/^(gorsel|image|pasted)/i.test(a.name) ? a.name : L(a.kind === 'table' ? 'newTable' : 'newFigure')
    n.data({ label: label, type: a.kind, color: cat ? cat.color : '#888', asset: a.rel })
    n.data('figId', (a.kind === 'table' ? 'tbl:' : 'fig:') + slug(label) + '-' + tail(n.id()))
    link(host, n)
    return n
  }

  function blockFor(n) {
    var cap = String(n.data('label') || '').replace(/[\[\]]/g, '')
    return '![' + cap + '](../' + n.data('asset') + '){#' + n.data('figId') + '}'
  }

  function insertNode(n) {
    if (!Writer.insert(blockFor(n), true)) return
    link(hostNode(), n)
    snapshot()
  }

  function insertRef(n) { Writer.insert('@' + n.data('figId'), false) }

  // Import, create the node, put it into the text. src: { kind } (file dialog) | { path } | { name, data }
  async function addAsset(src) {
    var r
    if (src.path) r = await api().assetImportPath(src.path)
    else if (src.data) r = await api().assetImportData(src.name, src.data)
    else r = await api().assetImport(src.kind)
    if (!r || r.canceled) return null
    if (r.error) { alert(r.error === 'untitled' ? L('saveFirst') : L('figError') + '\n\n' + (r.message || '')); return null }
    var n = createNode(r)
    insertNode(n)
    return n
  }

  // ───────── paste and drop into the text ─────────

  function imageFiles(list) {
    return Array.prototype.filter.call(list || [], function (f) {
      var ext = (f.name.split('.').pop() || '').toLowerCase()
      return IMAGE_EXT[ext] || ext === 'csv' || /^image\//.test(f.type)
    })
  }

  function extFor(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase()
    if (IMAGE_EXT[ext] || ext === 'csv') return ext
    return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' })[file.type] || 'png'
  }

  async function fromFile(file) {
    var p = api().pathForFile ? api().pathForFile(file) : ''
    if (p) return addAsset({ path: p })
    var buf = new Uint8Array(await file.arrayBuffer())
    var name = file.name && file.name.indexOf('.') > 0 ? file.name : 'gorsel.' + extFor(file)
    return addAsset({ name: name, data: buf })
  }

  function onPaste(e) {
    var files = imageFiles(e.clipboardData && e.clipboardData.files)
    if (!files.length || !api() || !api().assetImportData) return false
    e.preventDefault()
    files.reduce(function (p, f) { return p.then(function () { return fromFile(f) }) }, Promise.resolve())
    return true
  }

  function onDrop(e, view) {
    var files = imageFiles(e.dataTransfer && e.dataTransfer.files)
    if (!files.length || !api() || !api().assetImportPath) return false
    e.preventDefault()
    var pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos != null) view.dispatch({ selection: { anchor: pos } })
    files.reduce(function (p, f) { return p.then(function () { return fromFile(f) }) }, Promise.resolve())
    return true
  }

  // ───────── picker (toolbar button) ─────────

  function closePicker() { var m = $('figPicker'); if (m) m.remove() }

  function iconFor(type) {
    var t = TYPES.filter(function (x) { return x.id === type })[0] || TYPES[0]
    return '<svg viewBox="0 0 24 24" width="16" height="16"><path d="' + t.svgPath + '" fill="' + t.color + '"/></svg>'
  }

  function rows(filter) {
    var q = String(filter || '').toLocaleLowerCase('tr')
    var list = cy.nodes().filter(function (n) { return isAssetNode(n) && String(n.data('label')).toLocaleLowerCase('tr').indexOf(q) >= 0 })
      .sort(function (a, b) { return String(a.data('label')).localeCompare(String(b.data('label')), 'tr') })
    if (!list.length) return '<div class="fnone">' + esc(L(q ? 'figNoMatch' : 'figNone')) + '</div>'
    return list.map(function (n) {
      return '<div class="frow" data-id="' + esc(n.id()) + '">' + iconFor(n.data('type')) +
        '<span class="flabel" title="' + esc(n.data('asset')) + '">' + esc(n.data('label')) + '</span>' +
        '<button data-act="insert" title="' + esc(L('figInsertTip')) + '">' + esc(L('figInsert')) + '</button>' +
        '<button data-act="ref" title="' + esc(L('figRefTip')) + '">' + esc(L('figRef')) + '</button></div>'
    }).join('')
  }

  function openPicker(btn) {
    if ($('figPicker')) { closePicker(); return }
    var box = document.createElement('div')
    box.id = 'figPicker'
    box.className = 'fpick'
    box.innerHTML = '<input class="fsearch" placeholder="' + esc(L('figSearch')) + '">' +
      '<div class="flist">' + rows('') + '</div>' +
      '<div class="fnew"><button data-new="figure">' + esc(L('figNewImage')) + '</button><button data-new="table">' + esc(L('figNewTable')) + '</button></div>'
    $('writer').appendChild(box)
    var r = btn.getBoundingClientRect(), w = $('writer').getBoundingClientRect()
    box.style.top = (r.bottom - w.top + 4) + 'px'
    box.style.left = Math.max(8, Math.min(r.left - w.left, w.width - box.offsetWidth - 8)) + 'px'
    var input = box.querySelector('.fsearch')
    input.addEventListener('input', function () { box.querySelector('.flist').innerHTML = rows(input.value) })
    input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closePicker(); e.stopPropagation() } })
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button')
      if (!b) return
      if (b.dataset.new) { closePicker(); addAsset({ kind: b.dataset.new }); return }
      var n = cy.getElementById(b.closest('.frow').dataset.id)
      if (!n.length) return
      closePicker()
      if (b.dataset.act === 'insert') insertNode(n); else insertRef(n)
    })
    document.addEventListener('mousedown', function away(e) {
      if (!e.target.closest('#figPicker') && !e.target.closest('button[data-cmd="figure"]')) { closePicker(); document.removeEventListener('mousedown', away, true) }
    }, true)
    input.focus()
  }

  // ───────── preview and node panel ─────────

  function assetUrl(src) {
    if (!base) return null
    var rel = String(src).replace(/^(\.\.\/)+/, '')
    if (!/^assets\//.test(rel)) return null
    return base + rel.split('/').map(encodeURIComponent).join('/')
  }
  var CAP = '\u2063'                      // invisible separator: marks figure captions in the preview
  // Preview HTML: give figure captions their own class (plain italic paragraphs stay as they are).
  function markCaptions(html) { return String(html).split('<p><em>' + CAP).join('<p class="pv-cap"><em>').split(CAP).join('') }
  function isAssetUrl(u) { return !!(base && typeof u === 'string' && u.indexOf(base + 'assets/') === 0) }

  // Markdown for the read-only preview: numbered captions, images from the project, CSV placeholders,
  // @fig:/@tbl: references as "Şekil N".
  function previewMarkdown(text) {
    var nums = {}, nf = 0, nt = 0, FIG = L('figWord'), TBL = L('tblWord')
    var out = String(text).replace(/^!\[([^\]]*)\]\(([^)\s]+)\)(\{[^}\n]*\})?[ \t]*$/gm, function (all, cap, src, attrs) {
      var id = attrs ? (/#((?:fig|tbl):[^\s}]+)/.exec(attrs) || [])[1] : null
      var csv = /\.csv$/i.test(src)
      var label = csv ? TBL + ' ' + (++nt) : FIG + ' ' + (++nf)
      if (id) nums[id] = label
      if (csv) return '> **' + label + '.** ' + cap + '  \n> _' + L('csvTable') + ': ' + src.split('/').pop() + '_'
      return '![' + cap + '](' + (assetUrl(src) || src) + ')\n\n_' + CAP + label + '. ' + cap + '_'
    })
    return out.replace(/@((?:fig|tbl):[A-Za-z0-9_.:-]*[A-Za-z0-9_])/g, function (all, id) { return nums[id] || all })
  }

  function isFigType(n) { return n && n.length && n.isNode && n.isNode() && (n.data('type') === 'figure' || n.data('type') === 'table') }

  // Give a figure/table node a file (or a new one): a node made in the map, or one whose file changes.
  async function attachFile(n) {
    if (!isFigType(n) || !api() || !api().assetImport) return null
    var kind = n.data('type')
    var r = await api().assetImport(kind)
    if (!r || r.canceled) return null
    if (r.error) { alert(r.error === 'untitled' ? L('saveFirst') : L('figError') + '\n\n' + (r.message || '')); return null }
    if (r.kind !== kind) { alert(L('figError')); return null }
    n.data('asset', r.rel)
    if (!n.data('figId')) n.data('figId', (kind === 'table' ? 'tbl:' : 'fig:') + slug(n.data('label')) + '-' + tail(n.id()))
    snapshot()
    updatePanel(n)
    return r.rel
  }

  function updatePanel(n) {
    var fld = $('nAssetFld'), box = $('nAsset')
    if (!fld) return
    var html = ''
    if (isFigType(n)) {
      var rel = n.data('asset'), url = rel ? assetUrl(rel) : null
      if (!rel) {
        html = '<div class="nanone">' + esc(L(n.data('type') === 'table' ? 'figNoTable' : 'figNoFile')) + '</div>' +
          '<button class="bt naattach" data-act="attach">' + esc(L(n.data('type') === 'table' ? 'figNewTable' : 'figNewImage')) + '</button>'
      } else {
        var thumb = n.data('type') === 'figure' && url ? '<img src="' + esc(url) + '" alt="">' : '<div class="nacsv">' + esc(L('csvTable')) + '</div>'
        html = thumb + '<div class="napath">' + esc(rel) + ' <button class="nachange" data-act="attach">' + esc(L('figChange')) + '</button></div>' +
          '<div class="naref" title="' + esc(L('figRefTip')) + '">@' + esc(n.data('figId')) + '</div>'
      }
    }
    fld.style.display = html ? '' : 'none'
    if (box._html !== html) { box.innerHTML = html; box._html = html }   // unchanged: keep the image (no reload/flicker)
  }

  function init() {
    if (bound) return
    bound = true
    ensureTypes()
    var box = $('nAsset')
    if (box) box.addEventListener('click', function (e) {
      if (e.target.closest('[data-act="attach"]') && window.selEle) attachFile(selEle)
    })
    // Changing a node's type to Şekil/Tablo in the panel shows the file field at once.
    if (window.cy) cy.on('data', 'node', function (e) {
      if (window.selEle && selEle.isNode && selEle.isNode() && selEle.id() === e.target.id()) updatePanel(e.target)
    })
    if (api() && api().onProjectBase) api().onProjectBase(function (url) {
      base = url || null
      if (window.selEle && selEle.isNode && selEle.isNode()) updatePanel(selEle)
    })
  }

  return {
    init: init, ensureTypes: ensureTypes, openPicker: openPicker, closePicker: closePicker,
    onPaste: onPaste, onDrop: onDrop, addAsset: addAsset, insertNode: insertNode, insertRef: insertRef,
    previewMarkdown: previewMarkdown, markCaptions: markCaptions, isAssetUrl: isAssetUrl, updatePanel: updatePanel, attachFile: attachFile,
    _setBase: function (u) { base = u }, _slug: slug
  }
})()
