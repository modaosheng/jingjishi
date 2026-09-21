/**
 * 文件解析统一入口（基础设施层）
 *
 * 按文件类型分派到对应解析器，对外只暴露一个 extractFileText()。
 * 解析结果是纯文本，后续切题与归类由业务层 importService 承担，职责分离。
 */
import { ocrImage } from './ocr'
import { extractPdfText } from './pdf'
import { extractDocx } from './docx'
import { extractXlsx } from './xlsx'

export type FileKind = 'image' | 'pdf' | 'docx' | 'xlsx' | 'text' | 'unknown'

const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp', 'image/gif']

const EXT_MAP: Record<string, FileKind> = {
  pdf: 'pdf',
  docx: 'docx',
  doc: 'docx',
  xlsx: 'xlsx',
  xls: 'xlsx',
  csv: 'xlsx', // CSV 也走表格解析
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  bmp: 'image',
  gif: 'image',
  txt: 'text',
  md: 'text',
}

export function detectKind(file: File): FileKind {
  if (IMAGE_MIME.includes(file.type)) return 'image'
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MAP[ext] ?? 'unknown'
}

export interface ExtractProgress {
  status: string
  /** 0-1 */
  progress: number
}

export interface ExtractResult {
  text: string
  kind: FileKind
  /** 是否走了 OCR（用于 UI 提示「已做图文识别」） */
  usedOcr: boolean
}

export const SUPPORTED_HINT = '支持图片 / PDF / Word(.docx) / Excel(.xlsx) / 文本'

export async function extractFileText(
  file: File,
  onProgress?: (p: ExtractProgress) => void,
): Promise<ExtractResult> {
  const kind = detectKind(file)

  switch (kind) {
    case 'image': {
      onProgress?.({ status: '正在识别图片文字…', progress: 0 })
      const text = await ocrImage(file, onProgress)
      return { text, kind, usedOcr: true }
    }
    case 'pdf': {
      const r = await extractPdfText(file, onProgress)
      return { text: r.text, kind, usedOcr: r.usedOcr }
    }
    case 'docx':
      return { text: await extractDocx(file), kind, usedOcr: false }
    case 'xlsx':
      return { text: await extractXlsx(file), kind, usedOcr: false }
    case 'text':
      return { text: await file.text(), kind, usedOcr: false }
    default:
      throw new Error(`不支持的文件类型。${SUPPORTED_HINT}`)
  }
}
