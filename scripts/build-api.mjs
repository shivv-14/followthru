// Bundles the server code for Vercel into one ES module (api/_dist/entries.mjs).
// The small api/*.js entry files import from it. Run by `npm run build`.
import { build } from 'esbuild'

await build({
  entryPoints: ['api/_lib/entries.ts'],
  outfile: 'api/_dist/entries.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  logLevel: 'warning',
  // Some dependencies still call require(); give the ES module bundle one
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
})
