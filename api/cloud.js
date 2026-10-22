// Vercel function for /api/cloud/<route>. The code lives in api/_lib/cloud (bundled into api/_dist by scripts/build-api.mjs).
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } }
export { cloud as default } from './_dist/entries.mjs'
