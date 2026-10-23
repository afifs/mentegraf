// Builds src/lib/codemirror.bundle.js from tools/codemirror-entry.js.
// Run: npm install && npm run build:cm
import { build } from 'esbuild'
await build({
  entryPoints: ['tools/codemirror-entry.js'],
  bundle: true, minify: true, format: 'iife', target: 'chrome120',
  outfile: 'src/lib/codemirror.bundle.js',
  legalComments: 'eof'
})
console.log('built src/lib/codemirror.bundle.js')
