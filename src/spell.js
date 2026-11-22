// spell.js — spell checking in the editor, following the project.
//
// The language is the book's language (Settings → document language, stored in the project's
// export settings), not the language of the menus: a Turkish book is checked in Turkish and US
// English together, so English terms are not marked. On or off is a project setting
// (project.mentegraf → settings.spellcheck, on by default), switched from the View menu.
// The checking, the right-click menu and the project's word list are in main.js.
/* global Writer, setDirty, curLang */
var Spell = (function () {
  'use strict'

  function api() { return window.mentegraf }
  function settings() { return window.projectSettings || {} }

  function language() {
    var s = window.exportSettings, l = s && s.language
    if (l !== 'tr' && l !== 'en') l = window.curLang === 'en' ? 'en' : 'tr'
    return l
  }
  function enabled() { return settings().spellcheck !== false }

  function apply() {
    var on = enabled(), lang = language()
    if (window.Writer && Writer.setSpellcheck) Writer.setSpellcheck(on, lang)
    if (api() && api().spellcheckConfig) api().spellcheckConfig({ enabled: on, lang: lang })
  }

  function toggle() {
    if (!window.projectSettings) return
    projectSettings.spellcheck = !enabled()
    if (typeof setDirty === 'function') setDirty(true)
    apply()
  }

  // The spelling dictionaries could not be loaded: say so once, in the status line.
  var told = {}
  if (api() && api().onSpellcheckProblem) api().onSpellcheckProblem(function (info) {
    if (!info || told[info.lang]) return
    told[info.lang] = true
    var key = info.kind === 'no-dictionary' ? 'spellNoDictionary' : 'spellDownloadFailed'
    var msg = (window.L ? L(key) : 'Spelling dictionary not available: %s').replace('%s', info.lang)
    var m = document.getElementById('ml')
    if (m) { m.textContent = '⚠ ' + msg; setTimeout(function () { if (m.textContent === '⚠ ' + msg) m.textContent = '' }, 12000) }
    console.warn(msg)
  })

  // The project's word lists (main.js sends them when a project opens and after "Add to
  // dictionary" / "Ignore in this project"): these words are never marked.
  var known = new Set()
  function norm(w) { return String(w || '').normalize('NFC') }
  function isKnown(w) {
    w = norm(w)
    return known.has(w) || known.has(w.toLocaleLowerCase(language()))
  }
  function addKnown(w) { w = norm(w); if (w) known.add(w) }
  if (api() && api().onSpellWords) api().onSpellWords(function (words) {
    known = new Set((words || []).map(norm))
    if (window.Writer && Writer.spellRefresh) Writer.spellRefresh(false)
  })
  // a project may already be open when this page starts (reload)
  if (api() && api().spellWords) api().spellWords().then(function (words) { if (words && words.length) { (words || []).forEach(addKnown); if (window.Writer && Writer.spellRefresh) Writer.spellRefresh(false) } })
  // The checker's dictionaries became ready or its languages changed: check again.
  if (api() && api().onSpellReady) api().onSpellReady(function () {
    if (window.Writer && Writer.spellRefresh) Writer.spellRefresh(true)
  })

  return { apply: apply, toggle: toggle, language: language, enabled: enabled, known: isKnown, addKnown: addKnown }
})()
