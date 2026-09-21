/**
 * 图片 OCR（基础设施层）
 *
 * 依赖：tesseract.js（`npm install tesseract.js`）
 * 语言包：首次识别时会自动从 CDN 下载 chi_sim（简体中文）+ eng，
 *        约 10-20MB；也可设置本地语言包路径加快离线加载。
 */
import { createWorker } from 'tesseract.js'

export interface OcrProgress {
  status: string
  /** 0-1 */
  progress: number
}

export async function ocrImage(file: File, onProgress?: (p: OcrProgress) => void): Promise<string> {
  // tesseract.js v6：named export createWorker(langs, oem, options)，无 default 导出
  const worker = await createWorker('chi_sim+eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress({ status: m.status, progress: m.progress })
      }
    },
  })
  try {
    const { data } = await worker.recognize(file)
    return data.text
  } finally {
    await worker.terminate()
  }
}
