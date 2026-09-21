/**
 * Word 文档提取（基础设施层）
 *
 * 依赖：mammoth（`npm install mammoth`）—— 专注 .docx 文本提取，体积小、纯浏览器可用
 * 注意：仅支持 .docx（Office 2007+），老 .doc 需用户另存为 .docx
 */
import mammoth from 'mammoth'

export async function extractDocx(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buf })
  return result.value
}
