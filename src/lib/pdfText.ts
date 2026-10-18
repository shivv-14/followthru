/** Reads the text of a PDF in the browser, one string per visual line. Loaded only when a PDF is chosen. */
export async function pdfTextLines(data: ArrayBuffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise
  const lines: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    // Group text pieces that share a baseline into one line, top to bottom
    const rows = new Map<number, { x: number; s: string }[]>()
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue
      const y = Math.round(item.transform[5])
      const row = rows.get(y) ?? []
      row.push({ x: item.transform[4], s: item.str })
      rows.set(y, row)
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      lines.push(
        rows
          .get(y)!
          .sort((a, b) => a.x - b.x)
          .map((r) => r.s)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
    }
  }
  return lines
}
