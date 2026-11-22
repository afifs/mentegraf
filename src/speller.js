// speller.js — spell checking with Hunspell dictionaries that ship with Mentegraf.
//
// Chromium's own checker cannot be asked about a word on Windows (webFrame.isWordMisspelled is
// always false there), and it needs its dictionaries from Google's servers. So the words are
// checked here instead, with nspell (a Hunspell reader in JavaScript) and the dictionaries in
// node_modules: dictionary-tr (Turkish, MIT) and dictionary-en (US English, MIT AND BSD).
// The same results on every system, and no internet needed.
//
// Loading the Turkish dictionary takes a second or two and some 200 MB, so it runs in a
// process of its own (spellerProcess.js), started by main.js.
'use strict'
const fs = require('fs')
const path = require('path')

// Spell checker language code -> npm package holding index.aff / index.dic
const PACKAGES = { tr: 'dictionary-tr', 'en-US': 'dictionary-en' }

// The package folder, wherever node_modules is (also inside app.asar).
function packageDir(name) {
  const dirs = (require.resolve.paths(name) || []).concat(module.paths || [])
  for (const d of dirs) {
    const p = path.join(d, name)
    try { if (fs.existsSync(path.join(p, 'index.aff'))) return p } catch (e) { /* next */ }
  }
  return null
}

function createSpeller() {
  const nspell = require('nspell')
  const loaded = {}        // code -> nspell instance
  const errors = {}        // code -> message
  let langs = []

  function load(code) {
    if (loaded[code] || errors[code]) return loaded[code] || null
    const dir = PACKAGES[code] && packageDir(PACKAGES[code])
    if (!dir) { errors[code] = 'no dictionary for ' + code; return null }
    try {
      loaded[code] = nspell(fs.readFileSync(path.join(dir, 'index.aff')), fs.readFileSync(path.join(dir, 'index.dic')))
    } catch (e) { errors[code] = e.message; return null }
    return loaded[code]
  }

  // The languages to check in, e.g. ['tr', 'en-US']: a word is right if any of them knows it.
  function setLanguages(codes) {
    langs = (Array.isArray(codes) ? codes : []).filter(c => PACKAGES[c])
    langs.forEach(load)
    return langs.filter(c => loaded[c])
  }

  function knows(word) { return langs.some(c => loaded[c] && loaded[c].correct(word)) }

  // A circumflex the dictionary does not have (kâğıt, resmî) is not a spelling mistake: whether
  // it belongs there is the suspicious-words check's business.
  const PLAIN = { 'â': 'a', 'Â': 'A', 'î': 'i', 'Î': 'İ', 'û': 'u', 'Û': 'U' }
  function misspelled(word) {
    const w = String(word || '').normalize('NFC')
    if (!w || !langs.some(c => loaded[c])) return false
    if (knows(w)) return false
    if (/[âîûÂÎÛ]/.test(w) && knows(w.replace(/[âÂîÎûÛ]/g, c => PLAIN[c]))) return false
    return true
  }

  function check(words) { return (Array.isArray(words) ? words : []).map(misspelled) }

  // Suggestions from each language in turn, at most `max`. nspell upper-cases with English rules
  // (KELIME for kelime): a suggestion in capitals for a word that is not is put back in small letters.
  function suggest(word, max) {
    const w = String(word || '').normalize('NFC'), out = []
    const caps = w === w.toUpperCase() && w !== w.toLowerCase()
    langs.forEach(c => {
      if (!loaded[c]) return
      loaded[c].suggest(w).forEach(s => {
        if (!caps && s.length > 1 && s === s.toUpperCase() && s !== s.toLowerCase()) s = s.toLowerCase()
        if (s !== w && out.indexOf(s) < 0) out.push(s)
      })
    })
    return out.slice(0, max || 6)
  }

  function status() { return { languages: langs.slice(), loaded: Object.keys(loaded), errors: Object.assign({}, errors) } }

  return { setLanguages, check, suggest, status }
}

module.exports = { createSpeller, PACKAGES, packageDir }
