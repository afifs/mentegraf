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

  // A dictionary could not be downloaded (no internet, or a blocker such as Pi-hole on
  // redirector.gvt1.com): say so once, in the status line.
  var told = {}
  if (api() && api().onSpellcheckProblem) api().onSpellcheckProblem(function (info) {
    if (!info || told[info.lang]) return
    told[info.lang] = true
    var msg = (window.L ? L('spellDownloadFailed') : 'Spelling dictionary could not be downloaded: %s').replace('%s', info.lang)
    var m = document.getElementById('ml')
    if (m) { m.textContent = '⚠ ' + msg; setTimeout(function () { if (m.textContent === '⚠ ' + msg) m.textContent = '' }, 12000) }
    console.warn(msg)
  })

  return { apply: apply, toggle: toggle, language: language, enabled: enabled }
})()
