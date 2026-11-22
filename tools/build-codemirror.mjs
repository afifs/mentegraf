// Builds src/lib/codemirror.bundle.js from tools/codemirror-entry.js.
// Run: npm install && npm run build:cm
import { build } from 'esbuild'
import { readFile } from 'fs/promises'

// The editor's search panel (Ctrl+F) lower-cases with the book's language when "match case"
// is off, so that in a Turkish text I/ı and İ/i pair up (writer.js sets the locale).
const SEARCH_FROM = 'spec.caseSensitive ? undefined : x => x.toLowerCase()'
const SEARCH_TO = 'spec.caseSensitive ? undefined : x => x.toLocaleLowerCase(globalThis.MENTEGRAF_SEARCH_LOCALE || undefined)'
const localeSearch = {
  name: 'locale-search',
  setup(b) {
    b.onLoad({ filter: /@codemirror[\\/]search[\\/]dist[\\/]index\.js$/ }, async (args) => {
      const src = await readFile(args.path, 'utf8')
      if (src.indexOf(SEARCH_FROM) < 0) throw new Error('@codemirror/search changed: update the locale patch in tools/build-codemirror.mjs')
      return { contents: src.replace(SEARCH_FROM, SEARCH_TO), loader: 'js' }
    })
  }
}

await build({
  plugins: [localeSearch],
  entryPoints: ['tools/codemirror-entry.js'],
  bundle: true, minify: true, format: 'iife', target: 'chrome120',
  outfile: 'src/lib/codemirror.bundle.js',
  legalComments: 'eof'
})
console.log('built src/lib/codemirror.bundle.js')
