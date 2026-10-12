import * as XLSX from 'xlsx'
import { stamp } from './format'

export interface ExportColumn {
  key: string
  label: string
  /** 返回 string / number；返回 number 时 Excel 中保持数值可求和 */
  format?: (row: any) => string | number
}

function toAoa(columns: ExportColumn[], rows: any[]): any[][] {
  const header = columns.map((c) => c.label)
  const body = rows.map((r) =>
    columns.map((c) => {
      const v = c.format ? c.format(r) : r[c.key]
      return v === null || v === undefined ? '' : v
    })
  )
  return [header, ...body]
}

function buildSheet(columns: ExportColumn[], rows: any[]) {
  const ws = XLSX.utils.aoa_to_sheet(toAoa(columns, rows))
  ws['!cols'] = columns.map((c) => ({
    wch: Math.max(10, Math.min(36, Math.max(c.label.length * 2 + 4, 12))),
  }))
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }
  return ws
}

/** 单表导出为 .xlsx */
export function exportExcel(fileName: string, columns: ExportColumn[], rows: any[], sheetName = '数据') {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, buildSheet(columns, rows), sheetName.slice(0, 30))
  XLSX.writeFile(wb, `${fileName}_${stamp()}.xlsx`)
}

export interface SheetSpec {
  name: string
  columns: ExportColumn[]
  rows: any[]
}

/** 主从表导出：主表 + 明细各一个 sheet */
export function exportWorkbook(fileName: string, sheets: SheetSpec[]) {
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()
  sheets.forEach((s, i) => {
    let name = (s.name || `Sheet${i + 1}`).slice(0, 30)
    while (used.has(name)) name = `${name}_`.slice(0, 30)
    used.add(name)
    XLSX.utils.book_append_sheet(wb, buildSheet(s.columns, s.rows), name)
  })
  XLSX.writeFile(wb, `${fileName}_${stamp()}.xlsx`)
}
