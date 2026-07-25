import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

const MAX_PAGES = 12
const MAX_CHARS = 40_000

export async function extractTextFromPdf(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: buffer }).promise
  const pageCount = Math.min(pdf.numPages, MAX_PAGES)
  const parts: string[] = []

  for (let i = 1; i <= pageCount; i += 1) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    parts.push(pageText)
  }

  const text = parts.join('\n\n').replace(/\s+/g, ' ').trim()
  if (!text || text.length < 80) {
    throw new Error(
      'Could not extract readable text from this PDF. Try pasting the abstract instead.',
    )
  }

  return text.slice(0, MAX_CHARS)
}
