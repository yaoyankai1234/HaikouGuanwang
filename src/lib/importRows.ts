/**
 * 通用批量导入引擎。
 *
 * 职责：
 *  1. 生成导入模板（数据表 + 填写说明）
 *  2. 解析上传的 Excel / CSV
 *  3. 逐行校验（必填 / 类型 / 长度 / 自定义规则）并识别重复
 *  4. 把「不能导入」的行导出成 Excel，附问题类型与说明，供用户修正后重传
 *
 * 设计原则：只做纯函数式的解析与判定，不直接写库；
 * 落库由调用方（ImportModal）用 spec.toPayload 生成载荷后统一提交。
 */
import * as XLSX from 'xlsx'
import { exportWorkbook } from './export'
import type { Row } from './db'

export type ImportColType = 'text' | 'number' | 'int'

export interface ImportColumn {
  key: string
  label: string
  required?: boolean
  type?: ImportColType
  /** 文本长度上限 */
  maxLen?: number
  example?: string
  hint?: string
}

/** 重复判据：同一行内 fields 全部非空时才参与查重 */
export interface UniqueRule {
  label: string
  fields: string[]
  /** 命中已有记录时用于提示的展示值；不传则取行内对应字段值 */
  display?: (hit: Row) => string
}

export interface ImportSpec {
  /** 业务名称，如「物资分类」 */
  title: string
  table: string
  columns: ImportColumn[]
  unique: UniqueRule[]
  /** 当前表中已有记录，用于查重 */
  existing: Row[]
  /** 自定义校验：把异常原因 push 进 errors */
  check?: (row: Row, errors: string[]) => void
  /** 通过校验的行 → 落库载荷 */
  toPayload: (row: Row) => Row
  /** 模板「填写说明」页尾部的注意事项 */
  notes: string[]
}

export interface ImportRow {
  /** 原表行号（含表头，与用户在 Excel 里看到的一致） */
  rowNo: number
  data: Row
  /** 重复原因（可多条） */
  dup: string[]
  /** 异常原因（可多条） */
  errors: string[]
}

export interface ImportPreview {
  fileName: string
  total: number
  valid: ImportRow[]
  bad: ImportRow[]
  /** 模板缺失的必填列 */
  missing: string[]
}

const TYPE_LABEL: Record<ImportColType, string> = {
  text: '文本',
  number: '数字（不小于 0）',
  int: '整数（不小于 0）',
}

/* ------------------------------- 取值与归一 ------------------------------- */

function cellText(v: any): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? '是' : '否'
  return String(v).trim()
}

/** 折叠空白后用于表头 / 查重的宽松比较 */
const fold = (s: any) => cellText(s).replace(/\s+/g, ' ').toLowerCase()

/** 解析数字：容忍千分位、货币符号、百分号与全角逗号；解析不出来返回 null */
function toNumber(raw: string): number | null {
  const s = raw.replace(/[,，\s]/g, '').replace(/[¥￥元%]/g, '')
  if (!s) return null
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const isBlank = (v: any) => v === null || v === undefined || v === ''

/* ------------------------------- 模板与导出 ------------------------------- */

/** 下载导入模板：第一页是只有表头的数据表，第二页是逐列填写说明 */
export function downloadTemplate(spec: ImportSpec) {
  const dataCols = spec.columns.map((c) => ({ key: c.key, label: c.label }))

  const infoCols = [
    { key: 'label', label: '列名' },
    { key: 'required', label: '必填' },
    { key: 'type', label: '字段类型' },
    { key: 'example', label: '填写示例' },
    { key: 'hint', label: '填写说明' },
  ]
  const infoRows: Record<string, string>[] = spec.columns.map((c) => ({
    label: c.label,
    required: c.required ? '必填' : '选填',
    type: TYPE_LABEL[c.type ?? 'text'],
    example: c.example ?? '',
    hint: c.hint ?? '',
  }))
  spec.notes.forEach((n) =>
    infoRows.push({ label: '※ 注意事项', required: '', type: '', example: '', hint: n })
  )

  exportWorkbook(`${spec.title}_导入模板`, [
    { name: `${spec.title}导入模板`, columns: dataCols, rows: [] },
    { name: '填写说明', columns: infoCols, rows: infoRows },
  ])
}

/** 把不能导入的行导出成 Excel，附问题类型与说明，用户修正后可再次上传 */
export function downloadBadRows(spec: ImportSpec, bad: ImportRow[]) {
  const columns = [
    { key: '__rowNo', label: '原表行号' },
    ...spec.columns.map((c) => ({ key: c.key, label: c.label })),
    { key: '__type', label: '问题类型' },
    { key: '__why', label: '问题说明' },
  ]
  const rows = bad.map((r) => ({
    __rowNo: r.rowNo,
    ...r.data,
    __type: r.dup.length && r.errors.length ? '重复 + 异常' : r.dup.length ? '重复' : '异常',
    __why: [...r.dup, ...r.errors].join('；'),
  }))
  exportWorkbook(`${spec.title}_导入未通过`, [{ name: '未通过数据', columns, rows }])
}

export const problemType = (r: ImportRow): 'dup' | 'error' | 'both' => {
  if (r.dup.length && r.errors.length) return 'both'
  return r.dup.length ? 'dup' : 'error'
}

/* --------------------------------- 解析 --------------------------------- */

export async function parseImportFile(file: File, spec: ImportSpec): Promise<ImportPreview> {
  const isCsv = /\.csv$/i.test(file.name)
  let wb: XLSX.WorkBook
  try {
    wb = isCsv
      ? XLSX.read(await file.text(), { type: 'string' })
      : XLSX.read(await file.arrayBuffer(), { type: 'array' })
  } catch {
    throw new Error('文件无法解析，请确认是 .xlsx / .xls / .csv 格式，或重新下载模板填写')
  }

  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('文件里没有可读取的工作表')
  const aoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  }) as any[][]
  if (!aoa.length) throw new Error('表格是空的，请先下载模板并填写数据')

  // 表头定位：优先按中文列名匹配，其次按字段 key，允许列顺序被打乱
  const headerIndex = new Map<string, number>()
  ;(aoa[0] ?? []).forEach((h, i) => {
    const k = fold(h)
    if (k && !headerIndex.has(k)) headerIndex.set(k, i)
  })

  const missing: string[] = []
  const colIndex = new Map<string, number>()
  spec.columns.forEach((c) => {
    const i = headerIndex.get(fold(c.label)) ?? headerIndex.get(fold(c.key))
    if (i === undefined) {
      if (c.required) missing.push(c.label)
    } else {
      colIndex.set(c.key, i)
    }
  })
  if (missing.length) return { fileName: file.name, total: 0, valid: [], bad: [], missing }

  // 逐行取值 + 校验
  const rows: ImportRow[] = []
  for (let r = 1; r < aoa.length; r += 1) {
    const line = aoa[r] ?? []
    const data: Row = {}
    let notEmpty = false
    spec.columns.forEach((c) => {
      const i = colIndex.get(c.key)
      if (i === undefined) return
      const text = cellText(line[i])
      if (text !== '') notEmpty = true
      const type = c.type ?? 'text'
      if (type === 'text') {
        data[c.key] = text
      } else {
        const n = text === '' ? null : toNumber(text)
        // 数字列解析不出来时保留原文，便于提示里回显用户填了什么
        data[c.key] = text === '' ? '' : (n ?? text)
      }
    })
    if (!notEmpty) continue // 整行空白直接跳过

    const row: ImportRow = { rowNo: r + 1, data, dup: [], errors: [] }
    spec.columns.forEach((c) => {
      const v = data[c.key]
      const label = `「${c.label}」`
      if (c.required && isBlank(v)) {
        row.errors.push(`必填项${label}为空`)
        return
      }
      if (isBlank(v)) return
      const type = c.type ?? 'text'
      if (type === 'number' || type === 'int') {
        const n = typeof v === 'number' ? v : toNumber(String(v))
        if (n === null) row.errors.push(`${label}应为数字，当前填写为「${v}」`)
        else if (n < 0) row.errors.push(`${label}不能为负数，当前为 ${n}`)
        else if (type === 'int' && !Number.isInteger(n)) row.errors.push(`${label}应为整数，当前为 ${n}`)
      }
      if (c.maxLen && String(v).length > c.maxLen) {
        row.errors.push(`${label}超出 ${c.maxLen} 字上限，当前 ${String(v).length} 字`)
      }
    })
    spec.check?.(data, row.errors)

    rows.push(row)
  }

  // 查重：先与库内已有数据比对，再看文件内部；已判定异常的行不占用键位，
  // 避免一条错行把它后面本可正常导入的数据也一起拖下水。
  // 库内命中的行同样不占用键位——这样后面同键的行会得到「系统中已存在」这条更准确的提示。
  const seen = new Map<string, number>()
  rows.forEach((row) => {
    if (row.errors.length) return
    spec.unique.forEach((u) => {
      const vals = u.fields.map((f) => fold(row.data[f]))
      if (vals.some((v) => !v)) return

      const hit = spec.existing.find((e) => u.fields.every((f) => fold(e[f]) === fold(row.data[f])))
      if (hit) {
        const shown = u.display
          ? u.display(hit)
          : u.fields.map((f) => cellText(row.data[f])).join(' / ')
        row.dup.push(`系统中已存在相同${u.label}：${shown}`)
        return
      }

      const sig = `${u.label}\u0001${vals.join('\u0002')}`
      const first = seen.get(sig)
      if (first !== undefined) {
        row.dup.push(`与第 ${first} 行重复（${u.label}）`)
        return
      }
      seen.set(sig, row.rowNo)
    })
  })

  return {
    fileName: file.name,
    total: rows.length,
    valid: rows.filter((r) => !r.dup.length && !r.errors.length),
    bad: rows.filter((r) => r.dup.length > 0 || r.errors.length > 0),
    missing: [],
  }
}

/**
 * 分块写入。单块失败时保留此前已成功的记录，并回报失败批次的起始行，
 * 便于用户在「未通过数据」里定位问题后重传。
 */
export async function commitImport(
  spec: ImportSpec,
  rows: ImportRow[],
  insert: (table: string, payloads: Row[]) => Promise<any>,
  chunkSize = 200
): Promise<{ ok: number; failedAt: number | null; message: string | null }> {
  let ok = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    try {
      await insert(
        spec.table,
        chunk.map((r) => spec.toPayload(r.data))
      )
      ok += chunk.length
    } catch (e: any) {
      return { ok, failedAt: chunk[0]?.rowNo ?? null, message: e?.message || '写入失败' }
    }
  }
  return { ok, failedAt: null, message: null }
}
