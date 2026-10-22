// Vercel function. The code lives in api/_lib (bundled into api/_dist by scripts/build-api.mjs).
export const config = { api: { bodyParser: { sizeLimit: '2mb' } } }
export { process as default } from './_dist/entries.mjs'
