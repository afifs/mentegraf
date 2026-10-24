// exporter.js — Zotero citations (Better BibTeX) and DOCX export (Pandoc). Main process only.
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawn, spawnSync } = require('child_process')

const BBT = { host: '127.0.0.1', port: 23119 }

// Pandoc Lua filter: remove Mentegraf passage IDs (" ^abc123" at the end of a block).
const PASSAGE_ID_FILTER = [
  '-- Mentegraf: remove passage IDs (" ^abc123" at the end of a block) on export.',
  'local function strip(block)',
  '  local c = block.content',
  '  local last = c[#c]',
  "  if last and last.t == 'Str' and last.text:match('^%^[a-z0-9]+$') then",
  '    table.remove(c)',
  "    while c[#c] and (c[#c].t == 'Space' or c[#c].t == 'SoftBreak') do table.remove(c) end",
  '  end',
  '  return block',
  'end',
  'return { { Para = strip, Plain = strip, Header = strip } }',
  ''
].join('\n')

// Pandoc Lua filter: figure/table numbering, CSV tables, @fig:/@tbl: references.
const CROSSREF_FILTER = `-- Mentegraf: number figures and tables, turn CSV figures into tables, resolve @fig: / @tbl: references.
local FIG, TBL = 'Şekil', 'Tablo'
local nums, nf, nt = {}, 0, 0

local function read_file(src)
  local function try(p) local f = io.open(p, 'rb'); if f then local c = f:read('a'); f:close(); return c end end
  local c = try(src)
  if c then return c end
  for _, d in ipairs(PANDOC_STATE.resource_path or {}) do
    c = try(d .. '/' .. src) or try(d .. '/' .. src:gsub('^%.%./', ''))
    if c then return c end
  end
end

-- "Şekil 3." in front of a caption (blocks or inlines)
local function label_inlines(word, n) return { pandoc.Str(word), pandoc.Space(), pandoc.Str(n .. '.'), pandoc.Space() } end
local function prefix_blocks(blocks, word, n)
  if #blocks == 0 then return end
  local b = blocks[1]
  if b.content then for i, x in ipairs(label_inlines(word, n)) do table.insert(b.content, i, x) end end
end

local function csv_table(img, id, caption_blocks)
  local data = read_file(img.src)
  if not data then io.stderr:write('Mentegraf: table file not found: ' .. img.src .. '\\n'); return nil end
  local doc = pandoc.read(data, 'csv')
  local t = doc.blocks[1]
  if not t or t.t ~= 'Table' then return nil end
  nt = nt + 1
  if id ~= '' then nums[id] = { TBL, nt } end
  t.caption.long = caption_blocks
  prefix_blocks(t.caption.long, TBL, nt)
  t.attr = pandoc.Attr(id)
  return t
end

local function is_csv(img) return img.src:lower():match('%.csv$') ~= nil end

local function single_image(blocks)
  if #blocks ~= 1 then return nil end
  local b = blocks[1]
  if (b.t == 'Plain' or b.t == 'Para') and #b.content == 1 and b.content[1].t == 'Image' then return b.content[1] end
end

local numbering = {
  traverse = 'topdown',
  -- Pandoc 3: a standalone image is a Figure block
  Figure = function(el)
    local img = single_image(el.content)
    local id = el.identifier ~= '' and el.identifier or (img and img.identifier or '')
    if img and is_csv(img) then
      local t = csv_table(img, id, el.caption.long)
      if t then return t end
      return el
    end
    nf = nf + 1
    if id ~= '' then nums[id] = { FIG, nf } end
    prefix_blocks(el.caption.long, FIG, nf)
    return el
  end,
  -- Pandoc 2: a standalone image is a paragraph holding one image titled "fig:"
  Para = function(el)
    if #el.content ~= 1 or el.content[1].t ~= 'Image' or el.content[1].title ~= 'fig:' then return nil end
    local img = el.content[1]
    if is_csv(img) then return csv_table(img, img.identifier, { pandoc.Plain(img.caption) }) end
    nf = nf + 1
    if img.identifier ~= '' then nums[img.identifier] = { FIG, nf } end
    for i, x in ipairs(label_inlines(FIG, nf)) do table.insert(img.caption, i, x) end
    return el
  end,
  Table = function(el)
    if #el.caption.long == 0 then return nil end
    nt = nt + 1
    if el.identifier and el.identifier ~= '' then nums[el.identifier] = { TBL, nt } end
    prefix_blocks(el.caption.long, TBL, nt)
    return el
  end
}

local references = {
  Cite = function(el)
    for _, c in ipairs(el.citations) do
      if not (c.id:match('^fig:') or c.id:match('^tbl:')) then return nil end   -- a real citation: leave it to citeproc
    end
    local out = {}
    for i, c in ipairs(el.citations) do
      if i > 1 then table.insert(out, pandoc.Str(',')); table.insert(out, pandoc.Space()) end
      local n = nums[c.id]
      if n then
        table.insert(out, pandoc.Str(n[1])); table.insert(out, pandoc.Space()); table.insert(out, pandoc.Str(tostring(n[2])))
      else
        io.stderr:write('Mentegraf: reference to a missing figure or table: ' .. c.id .. '\\n')
        table.insert(out, pandoc.Str('??'))
      end
    end
    return out
  end
}

function Pandoc(doc)
  local m = doc.meta
  if m['mentegraf-figure'] then FIG = pandoc.utils.stringify(m['mentegraf-figure']) end
  if m['mentegraf-table'] then TBL = pandoc.utils.stringify(m['mentegraf-table']) end
  doc = doc:walk(numbering)
  return doc:walk(references)
end
`

function err(code, message) { const e = new Error(message); e.code = code; return e }

// ───────── Better BibTeX ─────────

function bbtRequest(method, pathname, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null
    const req = http.request({
      host: BBT.host, port: BBT.port, path: pathname, method,
      headers: data ? { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': data.length } : {}
    }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', c => { text += c })
      res.on('end', () => resolve({ status: res.statusCode, text }))
    })
    req.on('error', reject)
    if (timeoutMs) req.setTimeout(timeoutMs, () => req.destroy(err('timeout', 'Zotero did not answer in time.')))
    if (data) req.write(data)
    req.end()
  })
}

// Open Zotero's citation picker; resolves with e.g. "[@wiener1948, p. 12]" or "" if cancelled.
async function citePicker() {
  let probe
  try { probe = await bbtRequest('GET', '/better-bibtex/cayw?probe=1', null, 3000) } catch (e) {
    throw err('zotero', 'Zotero is not running.')
  }
  if (probe.status !== 200 || probe.text.trim() !== 'ready') throw err('bbt', 'Better BibTeX is not available in Zotero.')
  const r = await bbtRequest('GET', '/better-bibtex/cayw?format=pandoc&brackets=1', null, 15 * 60 * 1000)
  if (r.status !== 200) throw err('bbt', 'Zotero picker failed (' + r.status + ').')
  return r.text.trim()
}

// Citation keys used in a text: [@key, …; @key2] groups and in-text @key.
function citeKeys(text) {
  const keys = new Set()
  const KEY = /@([A-Za-z0-9_][\w:.#$%&\-+?<>~/]*)/g
  const clean = k => k.replace(/[.,;:?]+$/, '')
  const body = String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  ;(body.match(/\[[^\[\]]*@[^\[\]]*\]/g) || []).forEach(group => {
    let m; KEY.lastIndex = 0
    while ((m = KEY.exec(group))) keys.add(clean(m[1]))
  })
  const inText = /(^|[\s(])@([A-Za-z0-9_][\w:.#$%&\-+?<>~/]*)/g
  let m
  while ((m = inText.exec(body))) keys.add(clean(m[2]))
  // @fig: and @tbl: are references to figures and tables, not bibliography entries.
  return Array.from(keys).filter(k => k && !/^(fig|tbl):/.test(k))
}

// Ask Better BibTeX for the cited items. Writes refs.json (CSL JSON) or refs.bib into dir.
async function exportBibliography(keys, dir) {
  const attempts = [
    ['Better CSL JSON', 'json'],
    ['f4b52ab0-f878-4556-85a0-c7aeedd09dfc', 'json'],   // Better CSL JSON by id
    ['Better BibLaTeX', 'bib']
  ]
  let last = null
  for (const [translator, ext] of attempts) {
    let r
    try {
      r = await bbtRequest('POST', '/better-bibtex/json-rpc', { jsonrpc: '2.0', method: 'item.export', params: [keys, translator] }, 30000)
    } catch (e) { throw err('zotero', 'Zotero is not running.') }
    let reply
    try { reply = JSON.parse(r.text) } catch (e) { last = 'Unexpected answer from Zotero.'; continue }
    if (reply.error) { last = reply.error.message || String(reply.error); continue }
    let out = reply.result
    if (Array.isArray(out)) out = out.filter(x => typeof x === 'string').pop()
    if (typeof out !== 'string' || !out.trim()) { last = 'Zotero returned no bibliography.'; continue }
    const file = path.join(dir, 'refs.' + ext)
    fs.writeFileSync(file, out, 'utf8')
    return file
  }
  throw err('bibliography', last || 'Could not export the bibliography from Zotero.')
}

// ───────── Pandoc ─────────

// Mentegraf needs Pandoc 2.17+ (built-in citations, Lua filters with doc:walk).
const MIN_PANDOC = [2, 17]
let pandocPath = null, pandocVersion = null
function findPandoc() {
  if (pandocPath) return pandocPath
  const candidates = ['pandoc']
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Pandoc', 'pandoc.exe'))
    candidates.push('C:\\Program Files\\Pandoc\\pandoc.exe', 'C:\\Program Files (x86)\\Pandoc\\pandoc.exe')
  } else {
    candidates.push('/usr/local/bin/pandoc', '/opt/homebrew/bin/pandoc', '/usr/bin/pandoc')
  }
  for (const p of candidates) {
    try {
      const r = spawnSync(p, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true })
      if (r.status === 0) {
        pandocPath = p
        pandocVersion = ((/pandoc(?:\.exe)?\s+([\d.]+)/i.exec(r.stdout || '') || [])[1]) || null
        return p
      }
    } catch (e) { /* try next */ }
  }
  return null
}

// Is the Pandoc we found new enough? Returns { path, version, ok }.
function pandocInfo() {
  const p = findPandoc()
  if (!p) return { path: null, version: null, ok: false }
  const v = String(pandocVersion || '0').split('.').map(Number)
  const ok = v[0] > MIN_PANDOC[0] || (v[0] === MIN_PANDOC[0] && (v[1] || 0) >= MIN_PANDOC[1])
  return { path: p, version: pandocVersion, ok }
}

// Project-level styling: a .csl citation style and a reference.docx Word template, if present.
function projectStyles(projectDir) {
  const out = {}
  for (const d of [projectDir, path.join(projectDir, 'styles')]) {
    try {
      const csl = fs.readdirSync(d).filter(n => /\.csl$/i.test(n)).sort()[0]
      if (csl && !out.csl) out.csl = path.join(d, csl)
    } catch (e) { /* folder missing */ }
  }
  for (const n of ['reference.docx', path.join('styles', 'reference.docx')]) {
    const p = path.join(projectDir, n)
    if (!out.reference && fs.existsSync(p)) out.reference = p
  }
  return out
}

function runPandoc(pandoc, args, input, cwd) {
  return new Promise((resolve, reject) => {
    // UTF-8 locale on macOS/Linux so Turkish file names reach Pandoc intact
    // (Windows passes arguments as Unicode already).
    const env = process.platform === 'win32' ? process.env : Object.assign({}, process.env, { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' })
    const child = spawn(pandoc, args, { cwd, env, windowsHide: true })
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(err('timeout', 'Pandoc took too long.')) }, 120000)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', c => { stderr += c })
    child.on('error', e => { clearTimeout(timer); reject(e) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(stderr)
      else reject(err('pandoc-failed', stderr.trim() || 'Pandoc failed (exit code ' + code + ').'))
    })
    child.stdin.end(input, 'utf8')
  })
}

// Export one text to DOCX. Returns { out, warnings }.
// Run Pandoc on Markdown text and write a DOCX or EPUB file. Returns { out, warnings }.
//   csl / reference: absolute path = use it, null = none, undefined = what the project folder has
//   title, toc: book metadata (title page / table of contents)
//   resourceDirs: where images and other files are looked up
async function render({ projectDir, text, lang, outFile, csl, reference, format, title, toc, resourceDirs }) {
  const info = pandocInfo()
  if (!info.path) throw err('pandoc', 'Pandoc was not found.')
  if (!info.ok) throw err('pandoc-old', 'Pandoc ' + info.version + ' is too old; Mentegraf needs 2.17 or newer.')
  const pandoc = info.path
  // Texts point at ../assets/… (relative to manuscript/ or notes/); resolve them from the project folder.
  if (projectDir) {
    text = String(text).replace(/(\]\()(?:\.\.\/)+(assets\/)/g, '$1$2')
    resourceDirs = (resourceDirs && resourceDirs.length ? resourceDirs : []).concat(resourceDirs && resourceDirs.indexOf(projectDir) >= 0 ? [] : [projectDir])
  }
  const to = format === 'epub' ? 'epub3' : 'docx'
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mentegraf-'))
  const warnings = []
  try {
    const filter = path.join(tmp, 'passage-ids.lua')
    fs.writeFileSync(filter, PASSAGE_ID_FILTER, 'utf8')
    const crossref = path.join(tmp, 'crossref.lua')
    fs.writeFileSync(crossref, CROSSREF_FILTER, 'utf8')
    const tr = lang !== 'en'
    // Language and headings go in a UTF-8 metadata file: non-ASCII command-line
    // arguments can be garbled by the system locale.
    const meta = { lang: tr ? 'tr-TR' : 'en-GB', 'mentegraf-figure': tr ? 'Şekil' : 'Figure', 'mentegraf-table': tr ? 'Tablo' : 'Table' }
    if (title) meta.title = String(title)
    // The cross-reference filter must run before citeproc, which would otherwise treat @fig: as citations.
    const args = ['-f', 'markdown', '-t', to, '-o', outFile, '--lua-filter', filter, '--lua-filter', crossref]
    if (toc) { args.push('--toc'); meta['toc-title'] = tr ? 'İçindekiler' : 'Contents' }
    const keys = citeKeys(text)
    if (keys.length) {
      try {
        const bib = await exportBibliography(keys, tmp)
        args.push('--citeproc', '--bibliography', bib)
        meta['reference-section-title'] = tr ? 'Kaynakça' : 'References'
      } catch (e) {
        warnings.push((e.code === 'zotero' ? 'Zotero: ' : 'Bibliography: ') + e.message)
      }
    }
    const metaFile = path.join(tmp, 'meta.yaml')
    fs.writeFileSync(metaFile, Object.keys(meta).map(k => k + ': ' + JSON.stringify(meta[k])).join('\n') + '\n', 'utf8')
    args.push('--metadata-file', metaFile)
    const auto = projectStyles(projectDir)
    const cslFile = csl === undefined ? auto.csl : csl
    const refFile = reference === undefined ? auto.reference : reference
    if (cslFile) args.push('--csl', cslFile)
    if (refFile && to === 'docx') args.push('--reference-doc', refFile)
    args.push('--resource-path', (resourceDirs && resourceDirs.length ? resourceDirs : [projectDir]).join(path.delimiter))
    const stderr = await runPandoc(pandoc, args, text, projectDir)
    stderr.split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(s => warnings.push(s))
    return { out: outFile, warnings }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  }
}

// One text to DOCX (the DOCX button in the text pane).
async function exportDocx({ projectDir, fragmentPath, text, lang, outFile, csl, reference }) {
  const fragDir = path.dirname(path.join(projectDir, fragmentPath))
  return render({ projectDir, text, lang, outFile, csl, reference, format: 'docx', resourceDirs: [fragDir, projectDir] })
}

module.exports = { BBT, PASSAGE_ID_FILTER, CROSSREF_FILTER, citePicker, citeKeys, exportBibliography, findPandoc, pandocInfo, projectStyles, render, exportDocx }
