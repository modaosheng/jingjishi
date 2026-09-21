/**
 * PDF 文本提取（基础设施层）
 *
 * 依赖：pdfjs-dist（`npm install pdfjs-dist`）
 * 策略：
 *   1. 文字版 PDF → getTextContent 直接提取（快、准）
 *   2. 扫描版 PDF → 检测到每页文字过少时，逐页渲染 canvas 走 OCR（慢，需 tesseract.js）
 */
import * as pdfjsLib from 'pdfjs-dist'
// Vite 静态资源导入，让 worker 随构建打包，避免运行时路径问题
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ocrImage } from './ocr'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const MIN_CHARS_PER_PAGE = 30 // 低于此值判定为扫描版

export interface PdfResult {
  text: string
  usedOcr: boolean
}

export async function extractPdfText(
  file: File,
  onProgress?: (p: { status: string; progress: number }) => void,
): Promise<PdfResult> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise

  let text = ''
  let needsOcr = false
  const pageTexts: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    // 关键：必须用 hasEOL 保留换行。
    // 若用 join(' ')，整页文字被拼成一行，题号不再位于行首，后续切题会失败（100 题被识别成 1 题）
    let pageText = ''
    for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
      pageText += item.str ?? ''
      pageText += item.hasEOL ? '\n' : ' '
    }
    pageTexts.push(pageText)
    text += pageText + '\n'
    if (pageText.length < MIN_CHARS_PER_PAGE) needsOcr = true
    onProgress?.({ status: 'parsing', progress: i / pdf.numPages })
  }

  if (!needsOcr) return { text, usedOcr: false }

  // 扫描版：逐页渲染为图片再 OCR
  let ocrText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    if (pageTexts[i - 1].length >= MIN_CHARS_PER_PAGE) {
      ocrText += pageTexts[i - 1] + '\n'
      continue
    }
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    // pdfjs 新版 RenderParameters 要求同时传 canvas 与 canvasContext
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (blob) {
      const imgFile = new File([blob], `page-${i}.png`, { type: 'image/png' })
      ocrText += (await ocrImage(imgFile)) + '\n'
    }
    onProgress?.({ status: 'ocr', progress: i / pdf.numPages })
  }

  return { text: ocrText, usedOcr: true }
}
