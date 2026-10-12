/**
 * 数据访问统一入口。
 * 现已切换到自建后端（src/lib/api.ts），对外保持原有函数签名，
 * 页面 / 组件无需感知底层变化。
 */
import { api, ApiError, type SelectOpts } from './api'

export type Row = Record<string, any>
export type { SelectOpts }

/** 把错误转成给用户看的中文提示 */
export function errText(e: any): string {
  if (!e) return '操作失败'
  if (e instanceof ApiError) {
    if (e.code === 'unauthenticated' || e.status === 401) return '登录状态已失效，请重新登录后再试'
    return e.message
  }
  return e?.message || '操作失败'
}

export function unwrap<T = any>(v: T): T {
  return v
}

export async function selectAll<T = Row>(table: string, opts: SelectOpts = {}): Promise<T[]> {
  return api.selectAll<T>(table, opts)
}

export function selectAllPaged<T = Row>(
  table: string,
  opts: { pageSize?: number; maxRows?: number } = {}
): Promise<T[]> {
  return api.selectAllPaged<T>(table, opts)
}

export function countRows(table: string): Promise<number> {
  return api.countRows(table)
}

export function insertRow(table: string, payload: Row): Promise<Row> {
  return api.insertRow(table, payload)
}

export function insertRows(table: string, payload: Row[]): Promise<Row[]> {
  return api.insertRows(table, payload)
}

export function updateRow(table: string, id: number | string, payload: Row): Promise<Row> {
  return api.updateRow(table, id, payload)
}

export function deleteRow(table: string, id: number | string): Promise<void> {
  return api.deleteRow(table, id)
}

export function deleteRows(
  table: string,
  ids: (number | string)[]
): Promise<{ deleted: number; skipped: number[] }> {
  return api.deleteRows(table, ids)
}

export function deleteAllRows(table: string): Promise<number> {
  return api.deleteAllRows(table)
}

/** 生成一个不与现存编号冲突的业务单号 */
export function nextNo(prefix: string, existing: Row[], field: string): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  const head = `${prefix}${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
  const used = new Set(
    existing.map((r) => String(r[field] ?? '')).filter((v) => v.startsWith(head))
  )
  let i = 1
  while (used.has(head + String(i).padStart(3, '0'))) i += 1
  return head + String(i).padStart(3, '0')
}
