// exportSettings.js — the Export section of the Settings window: citation style,
// Word template and document language. The choice is stored in the project
// (window.exportSettings → project.mentegraf "export").
/* global L */
var ExportSettings = (function () {
  'use strict'

  var opts = null        // { untitled, styles: [...], templates: [...] } from the main process
  var untitled = true
  var prev = {}          // last real value of each dropdown, to undo a cancelled import

  function $(id) { return document.getElementById(id) }
  function api() { return window.mentegraf }
  function stored() { return window.exportSettings || {} }

  function option(value, text) { var o = document.createElement('option'); o.value = value; o.textContent = text; return o }

  function fill(sel, kind, list, chosen) {
    sel.innerHTML = ''
    sel.appendChild(option('default', L(kind === 'csl' ? 'cfgDefaultStyle' : 'cfgDefaultTemplate')))
    var names = { project: L('grpProject'), library: L('grpLibrary'), zotero: 'Zotero' }
    ;['project', 'library', 'zotero'].forEach(function (src) {
      var items = list.filter(function (i) { return i.source === src })
      if (!items.length) return
      var g = document.createElement('optgroup')
      g.label = names[src]
      items.forEach(function (i) { g.appendChild(option(i.value, i.title)) })
      sel.appendChild(g)
    })
    if (!untitled) sel.appendChild(option('__import', L(kind === 'csl' ? 'cfgImportCsl' : 'cfgImportDocx')))
    sel.value = chosen
    if (sel.value !== chosen) sel.value = 'default'
    prev[sel.id] = sel.value
  }

  // The option matching what is stored. Nothing stored = what the project folder has (as before).
  function chosenValue(value, list) {
    if (value === 'default') return 'default'
    if (value) return 'project:' + value
    var p = list.filter(function (i) { return i.source === 'project' })[0]
    return p ? p.value : 'default'
  }

  async function open() {
    var s = stored()
    $('cfgLang').value = s.language || (window.curLang === 'en' ? 'en' : 'tr')
    var csl = $('cfgCsl'), docx = $('cfgDocx')
    csl.disabled = docx.disabled = true
    $('cfgExportNote').textContent = ''
    if (!api() || !api().stylesList) return
    opts = await api().stylesList()
    untitled = !!opts.untitled
    fill(csl, 'csl', opts.styles || [], chosenValue(s.citationStyle, opts.styles || []))
    fill(docx, 'docx', opts.templates || [], chosenValue(s.wordTemplate, opts.templates || []))
    csl.disabled = docx.disabled = untitled
    $('cfgExportNote').textContent = L(untitled ? 'cfgSaveFirst' : 'cfgStyleNote')
  }

  var ERRORS = { 'not-csl': 'cfgNotCsl', dependent: 'cfgDependent', 'not-docx': 'cfgNotDocx' }

  async function onChange(sel, kind) {
    if (sel.value !== '__import') { prev[sel.id] = sel.value; return }
    var r = await api().stylesImport(kind)
    if (r && r.value) {
      var list = kind === 'csl' ? opts.styles : opts.templates
      if (!list.some(function (i) { return i.value === r.value })) list.push(r)
      fill(sel, kind, list, r.value)
      return
    }
    sel.value = prev[sel.id] || 'default'
    if (r && r.error) alert(L(ERRORS[r.error] || 'cfgImportError') + (ERRORS[r.error] ? '' : '\n\n' + (r.message || '')))
  }

  // Library/Zotero choices are copied into the project; returns the project-relative path.
  async function toStored(value) {
    if (value === 'default') return 'default'
    var r = await api().stylesUse(value)
    if (r && r.rel) return r.rel
    throw new Error((r && r.message) || 'failed')
  }

  // Called when the Settings window is saved.
  async function save() {
    var s = Object.assign({}, stored())
    s.language = $('cfgLang').value
    if (!untitled && opts) {
      try {
        var c = $('cfgCsl').value, d = $('cfgDocx').value
        if (c && c !== '__import') s.citationStyle = await toStored(c)
        if (d && d !== '__import') s.wordTemplate = await toStored(d)
      } catch (e) { alert(L('cfgImportError') + '\n\n' + e.message) }
    }
    window.exportSettings = s
  }

  function bind() {
    var csl = $('cfgCsl'), docx = $('cfgDocx')
    if (!csl || csl._bound) return
    csl._bound = true
    csl.addEventListener('change', function () { onChange(csl, 'csl') })
    docx.addEventListener('change', function () { onChange(docx, 'docx') })
  }

  return { open: open, save: save, bind: bind }
})()
