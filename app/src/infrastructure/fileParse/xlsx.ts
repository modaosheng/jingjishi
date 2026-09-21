/**
 * Excel 表格提取（基础设施层）
 *
 * 依赖：xlsx（`npm install xlsx@0.18.5`）
 * ⚠️ 注意：SheetJS 官方已停止向 npm 发布新版，社区版停留在 0.18.5（有安全告警但功能可用）。
 *        生产环境建议改用 exceljs，或从 SheetJS 官方 CDN 获取最新版。
 *
 * 两种读取方式：
 *   1. `readSheetTable` —— 读出「表头 + 数据行」，供**结构化导入**（表头模板，零识别误差）
 *   2. `extractXlsx`    —— 逐行拼成纯文本，交给 importService 的规则切题（兜底）
 */
import * as XLSX from 'xlsx'

export interface SheetTable {
  /** 首行表头（已 trim） */
  headers: string[]
  /** 数据行（每行与表头等长，已 trim） */
  rows: string[][]
}

/**
 * 读取首个工作表的表格结构（含表头）
 * 用于「表头模板导入」：用户按列填题干/选项/答案，直接结构化，不经过 OCR 与切题
 */
export async function readSheetTable(file: File): Promise<SheetTable | null> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const name = wb.SheetNames[0]
  if (!name) return null
  const ws = wb.Sheets[name]
  if (!ws) return null

  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
  if (!raw.length) return null

  const norm = (v: unknown) => (v == null ? '' : String(v).trim())
  const headers = raw[0].map(norm)
  const rows = raw
    .slice(1)
    .map((r) => r.map(norm))
    .filter((r) => r.some((c) => c))

  return { headers, rows }
}

/**
 * 生成并下载「表头模板」Excel —— 让用户按列填题，实现零误差导入
 * 列名与 importService.COLUMN_ALIASES 对齐，用户也可自行改名（支持常见别名）
 */
export function downloadTemplate(): void {
  const rows = [
    ['题干', '选项A', '选项B', '选项C', '选项D', '选项E', '答案', '解析', '考点'],
    [
      '在我国的资源配置中起决定性作用的是（　）。',
      '国家计划',
      '财政政策',
      '市场机制',
      '行政指令',
      '',
      'C',
      '市场在资源配置中起决定性作用',
      '资源配置方式',
    ],
    [
      '下列属于紧缩性财政政策的有（　）。',
      '降低税率',
      '增加政府购买',
      '减少政府购买',
      '增加财政补贴',
      '',
      'C',
      '减少政府购买会抑制总需求',
      '财政政策工具',
    ],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  // 列宽，便于用户填写
  ws['!cols'] = [{ wch: 40 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 8 }, { wch: 30 }, { wch: 16 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '题库模板')
  XLSX.writeFile(wb, '题库导入模板.xlsx')
}

/**
 * 导出题目为 Excel —— **列结构与导入模板完全一致**，因此可「导出 → 编辑 → 再导入」形成闭环
 */
export function exportQuestions(
  questions: Array<{
    stem: string
    options: Array<{ key: string; content: string }>
    answer: string[]
    explanation?: { keyPoint?: string; analysis?: string }
  }>,
  filename = '我的题库.xlsx',
): void {
  const header = ['题干', '选项A', '选项B', '选项C', '选项D', '选项E', '答案', '解析', '考点']
  const rows: string[][] = [
    header,
    ...questions.map((q) => {
      const opt = (k: string) => q.options.find((o) => o.key === k)?.content ?? ''
      return [
        q.stem,
        opt('A'),
        opt('B'),
        opt('C'),
        opt('D'),
        opt('E'),
        q.answer.join(''),
        q.explanation?.analysis ?? '',
        q.explanation?.keyPoint ?? '',
      ]
    }),
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [
    { wch: 40 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 8 },
    { wch: 30 },
    { wch: 16 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '题库')
  XLSX.writeFile(wb, filename)
}

export async function extractXlsx(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const lines: string[] = []

  wb.SheetNames.forEach((name) => {
    const ws = wb.Sheets[name]
    if (!ws) return
    // header: 1 表示以数组形式读取，保留空单元格
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
    rows.forEach((row) => {
      const cells = row.map((c) => (c == null ? '' : String(c).trim()))
      const joined = cells.join(' ').replace(/\s{2,}/g, ' ').trim()
      if (joined) lines.push(joined)
    })
  })

  return lines.join('\n')
}
