// projectFormat.js — Mentegraf project file format: versioning, migration,
// serialization helpers and collision-free IDs.
// Loaded by the renderer (<script>, exposes window.ProjectFormat) and by the
// main process (require), so both sides apply exactly the same rules.
(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.ProjectFormat = api
})(this, function () {
  'use strict'

  // Version written by this build. 2.1 = 2.0 + all node/edge data fields kept
  // (e.g. zoteroKey) + computed fields (leading "_") never stored.
  var CURRENT_VERSION = '2.1'
  // Highest major version this build can open. A future folder-based
  // format (3.x) must be refused, not silently overwritten.
  var SUPPORTED_MAJOR = 2

  function parseVersion(v) {
    var parts = String(v || '2.0').split('.')
    return { major: parseInt(parts[0], 10) || 0, minor: parseInt(parts[1], 10) || 0 }
  }

  function compareVersions(a, b) {
    var x = parseVersion(a), y = parseVersion(b)
    if (x.major !== y.major) return x.major - y.major
    return x.minor - y.minor
  }

  // Random, collision-free ID: prefix + "-" + 10 base36 characters
  // (~51 bits). Safe across files and machines, unlike a counter or a timestamp.
  function newId(prefix) {
    var chars = '0123456789abcdefghijklmnopqrstuvwxyz'
    var bytes = new Uint8Array(10)
    var c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto
      : (typeof require === 'function' ? require('crypto').webcrypto : null)
    if (c && c.getRandomValues) c.getRandomValues(bytes)
    else for (var j = 0; j < bytes.length; j++) bytes[j] = Math.floor(Math.random() * 256)
    var s = ''
    for (var i = 0; i < bytes.length; i++) s += chars.charAt(bytes[i] % 36)
    return (prefix || 'x') + '-' + s
  }

  // Copy a node/edge data object for storage: keep every field except
  // computed ones (leading "_") and values JSON cannot hold.
  function cleanData(d) {
    var out = {}
    Object.keys(d || {}).forEach(function (k) {
      if (k.charAt(0) === '_') return
      var v = d[k]
      if (v === undefined || typeof v === 'function') return
      out[k] = v
    })
    return out
  }

  function normalizeNode(n) {
    var d = cleanData(n && n.data)
    if (typeof d.description !== 'string') d.description = d.description ? String(d.description) : ''
    if (typeof d.notes !== 'string') d.notes = d.notes ? String(d.notes) : ''
    if (!Array.isArray(d.tags)) d.tags = d.tags ? [String(d.tags)] : []
    var node = { data: d }
    if (n && n.position) node.position = n.position
    else if (typeof d.x === 'number' && typeof d.y === 'number') node.position = { x: d.x, y: d.y }
    return node
  }

  function normalizeEdge(e) {
    var d = cleanData(e && e.data)
    if (typeof d.weight !== 'number') d.weight = d.weight ? Number(d.weight) || 3 : 3
    if (typeof d.edgeType !== 'string') d.edgeType = ''
    if (typeof d.note !== 'string') d.note = d.note ? String(d.note) : ''
    return { data: d }
  }

  // Validate and bring any supported file up to CURRENT_VERSION.
  // Returns { data, from, migrated }. Throws an Error with .code on refusal:
  //   'not-a-project'  — not a Mentegraf file
  //   'too-new'        — written by a newer Mentegraf than this build
  // Never mutates its input.
  function migrate(input) {
    if (!input || typeof input !== 'object' || !input.elements || typeof input.elements !== 'object') {
      var err = new Error('This file is not a Mentegraf project.')
      err.code = 'not-a-project'
      throw err
    }
    var from = input.version || '2.0'
    if (parseVersion(from).major > SUPPORTED_MAJOR) {
      var tooNew = new Error('This project was saved by a newer version of Mentegraf (format ' + from + ').')
      tooNew.code = 'too-new'
      throw tooNew
    }
    var data = JSON.parse(JSON.stringify(input))

    // 2.0 (and unversioned) -> 2.1: normalize elements, drop computed fields.
    var nodes = Array.isArray(data.elements.nodes) ? data.elements.nodes : []
    var edges = Array.isArray(data.elements.edges) ? data.elements.edges : []
    var nodeIds = {}
    data.elements.nodes = nodes.filter(function (n) { return n && n.data && n.data.id != null })
      .map(function (n) { var x = normalizeNode(n); nodeIds[x.data.id] = true; return x })
    // An edge pointing at a missing node would make Cytoscape throw on load.
    data.elements.edges = edges.filter(function (e) {
      return e && e.data && e.data.id != null && nodeIds[e.data.source] && nodeIds[e.data.target]
    }).map(normalizeEdge)

    if (compareVersions(from, CURRENT_VERSION) < 0) data.version = CURRENT_VERSION
    data.app = 'Mentegraf'
    return { data: data, from: from, migrated: compareVersions(from, CURRENT_VERSION) < 0 }
  }

  return {
    CURRENT_VERSION: CURRENT_VERSION,
    SUPPORTED_MAJOR: SUPPORTED_MAJOR,
    compareVersions: compareVersions,
    newId: newId,
    cleanData: cleanData,
    migrate: migrate
  }
})
