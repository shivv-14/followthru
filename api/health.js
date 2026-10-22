// Vercel function. The code lives in api/_lib (bundled into api/_dist by scripts/build-api.mjs).
export { health as default } from './_dist/entries.mjs'
