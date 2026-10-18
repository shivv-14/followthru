/** Allowed attachment types. The type is decided by extension and confirmed by the file's own bytes; the browser's MIME type is never trusted. */
const TYPES: Record<string, { mime: string; check: (b: Uint8Array) => boolean }> = {
  png: { mime: 'image/png', check: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: { mime: 'image/jpeg', check: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  jpeg: { mime: 'image/jpeg', check: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  gif: { mime: 'image/gif', check: (b) => ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a') },
  webp: { mime: 'image/webp', check: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP') },
  pdf: { mime: 'application/pdf', check: (b) => ascii(b, 0, '%PDF-') },
  zip: { mime: 'application/zip', check: isZip },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: isZip },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', check: isZip },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', check: isZip },
  txt: { mime: 'text/plain', check: isText },
  csv: { mime: 'text/csv', check: isText },
  json: { mime: 'application/json', check: (b) => isText(b) && parses(b) },
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024

function starts(b: Uint8Array, sig: number[]) {
  return sig.every((x, i) => b[i] === x)
}
function ascii(b: Uint8Array, at: number, s: string) {
  return [...s].every((ch, i) => b[at + i] === ch.charCodeAt(0))
}
function isZip(b: Uint8Array) {
  return starts(b, [0x50, 0x4b, 0x03, 0x04]) || starts(b, [0x50, 0x4b, 0x05, 0x06])
}
function isText(b: Uint8Array) {
  if (b.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b)
    return true
  } catch {
    return false
  }
}
function parses(b: Uint8Array) {
  try {
    JSON.parse(new TextDecoder().decode(b))
    return true
  } catch {
    return false
  }
}

export const extensionOf = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '')

/** Returns the trusted MIME type, or a reason the file is refused. */
export function checkFile(name: string, bytes: Uint8Array): { ok: true; mime: string } | { ok: false; reason: string } {
  if (bytes.byteLength === 0) return { ok: false, reason: 'The file is empty' }
  if (bytes.byteLength > MAX_FILE_BYTES) return { ok: false, reason: 'Files must be 10 MB or smaller' }
  if (/[\\/]|\.\./.test(name) || name.length > 255) return { ok: false, reason: 'Rename the file and try again' }
  const type = TYPES[extensionOf(name)]
  if (!type) return { ok: false, reason: 'That file type is not allowed. Use PNG, JPEG, WebP, GIF, PDF, TXT, CSV, JSON, DOCX, XLSX, PPTX or ZIP.' }
  if (!type.check(bytes)) return { ok: false, reason: `The file's contents do not match .${extensionOf(name)}` }
  return { ok: true, mime: type.mime }
}
