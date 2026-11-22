// spellerProcess.js — the spell checker's own process (Electron utilityProcess, started by
// main.js), so that loading the dictionaries never holds up the windows.
// Messages in:  { type: 'languages', codes }  { type: 'check', id, words }  { type: 'suggest', id, word }
// Messages out: { type: 'ready', languages, status }  { type: 'result', id, value }
'use strict'
const { createSpeller } = require('./speller')

const speller = createSpeller()
const port = process.parentPort

port.on('message', (e) => {
  const m = e && e.data
  if (!m || typeof m !== 'object') return
  try {
    if (m.type === 'languages') {
      const t0 = Date.now()
      const languages = speller.setLanguages(m.codes)
      port.postMessage({ type: 'ready', languages, ms: Date.now() - t0, status: speller.status() })
    } else if (m.type === 'check') {
      port.postMessage({ type: 'result', id: m.id, value: speller.check(m.words) })
    } else if (m.type === 'suggest') {
      port.postMessage({ type: 'result', id: m.id, value: speller.suggest(m.word, 6) })
    }
  } catch (err) {
    if (m.id != null) port.postMessage({ type: 'result', id: m.id, value: null, error: err.message })
  }
})
