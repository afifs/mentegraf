// Entry for src/lib/codemirror.bundle.js — rebuild with: npm run build:cm
// Exposes the parts of CodeMirror 6 that src/writer.js uses as window.CM.
import { EditorState, Compartment, EditorSelection } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine, placeholder, ViewPlugin, Decoration } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, undo, redo, deleteCharForward, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { tags } from '@lezer/highlight'

window.CM = {
  EditorState, Compartment, EditorSelection,
  EditorView, keymap, drawSelection, highlightActiveLine, placeholder, ViewPlugin, Decoration,
  defaultKeymap, history, historyKeymap, undo, redo, deleteCharForward, indentWithTab,
  markdown, markdownLanguage, yamlFrontmatter,
  syntaxHighlighting, HighlightStyle,
  search, searchKeymap, highlightSelectionMatches,
  tags
}
