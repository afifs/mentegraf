// compiler.js — join the book plan's texts into one book (DOCX, EPUB or one Markdown file).
// Main process only. The renderer sends the plan already flattened, in order:
//   [{ kind: 'part', title, level }, { kind: 'node', title, level, path, text|null }]
// level = heading level of the item (part 1, chapter 1 or 2, section one deeper…).
'use strict'

const fs = require('fs')
const path = require('path')
const Exporter = require('./exporter')

function stripFrontMatter(text) { return String(text || '').replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, '') }

// Shift every ATX heading (# …) by `by` levels, outside fenced code blocks; levels stay within 1–6.
function shiftHeadings(md, by) {
  if (!by) return md
  let fence = null
  return md.split('\n').map(line => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (!fence) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
      return line
    }
    if (fence) return line
    const m = /^(#{1,6})(?=\s)/.exec(line)
    if (!m) return line
    return '#'.repeat(Math.max(1, Math.min(6, m[1].length + by))) + line.slice(m[1].length)
  }).join('\n')
}

// Footnote labels get a prefix per text, so labels can never clash across chapters.
function prefixFootnotes(md, prefix) {
  return md.replace(/\[\^([^\]\s]+)\]/g, (all, label) => '[^' + prefix + label + ']')
}

function heading(level, title) { return '#'.repeat(Math.max(1, Math.min(6, level))) + ' ' + String(title || '').replace(/\s+/g, ' ').trim() }

// Build the book's Markdown. readText(path) supplies texts not sent by the renderer.
// Returns { markdown, warnings, chapters }.
function assemble(items, readText) {
  const parts = [], warnings = []
  let chapters = 0
  ;(items || []).forEach((it, i) => {
    if (!it || typeof it !== 'object') return
    const level = Math.max(1, Math.min(6, parseInt(it.level, 10) || 1))
    if (it.kind === 'part') { parts.push(heading(level, it.title)); return }
    if (it.kind !== 'node') return
    chapters++
    let text = typeof it.text === 'string' ? it.text : null
    if (text == null && it.path) {
      try { text = readText(it.path) } catch (e) { text = null }
    }
    if (text == null) {
      warnings.push((it.path ? 'Text not found: ' + it.path : 'No text yet') + ' (' + (it.title || '?') + ')')
      parts.push(heading(level, it.title))
      return
    }
    let body = stripFrontMatter(text).replace(/\r\n/g, '\n').trim()
    const first = /^(#{1,6})\s/.exec(body)
    if (first) body = shiftHeadings(body, level - first[1].length)    // its own title becomes the item's heading
    else body = heading(level, it.title) + (body ? '\n\n' + shiftHeadings(body, level) : '')
    parts.push(prefixFootnotes(body, 'c' + (i + 1) + '-'))
  })
  return { markdown: parts.join('\n\n') + '\n', warnings, chapters }
}

const PASSAGE_ID_LINE_END = /[ \t]\^[a-z0-9]{4,12}[ \t]*$/gm

// Compile the book. format: 'docx' | 'epub' | 'md'. Returns { out, warnings }.
async function compileBook({ projectDir, items, title, format, lang, csl, reference, outFile, readText }) {
  const { markdown, warnings, chapters } = assemble(items, readText)
  if (!chapters) { const e = new Error('The book plan has no chapters to compile.'); e.code = 'empty'; throw e }
  if (format === 'md') {
    const tr = lang !== 'en'
    const head = '---\ntitle: ' + JSON.stringify(String(title || '')) + '\nlang: ' + (tr ? 'tr-TR' : 'en-GB') + '\n---\n\n'
    fs.writeFileSync(outFile, head + markdown.replace(PASSAGE_ID_LINE_END, ''), 'utf8')
    return { out: outFile, warnings }
  }
  const dirs = [path.join(projectDir, 'manuscript'), path.join(projectDir, 'notes'), projectDir]
  const r = await Exporter.render({ projectDir, text: markdown, lang, outFile, csl, reference, format, title, toc: true, resourceDirs: dirs })
  return { out: r.out, warnings: warnings.concat(r.warnings) }
}

module.exports = { stripFrontMatter, shiftHeadings, prefixFootnotes, assemble, compileBook }
