import type { ReactNode } from 'react'
import type { ExportColumn } from './export'
import { money, num } from './format'
import type { Row } from './db'
import type { DataValue } from '../store/data'

/** 可被引用的数据集合 */
export type RefName =
  | 'suppliers'
  | 'categories'
  | 'materials'
  | 'teams'
  | 'stages'
  | 'contracts'
  | 'orders'

/** 引用集合默认的展示字段 */
export const REF_LABEL_KEY: Record<RefName, string> = {
  suppliers: 'name',
  categories: 'name',
  materials: 'name',
  teams: 'name',
  stages: 'name',
  contracts: 'contract_no',
  orders: 'order_no',
}

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'money'
  | 'date'
  | 'select'
  | 'ref'
  | 'readonly'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  options?: string[]
  ref?: RefName
  /** 引用字段的次要展示字段（如合同名称），会一并落库 */
  nameKey?: string
  /** ref 选中后同步写入的名称字段，如 supplier_name */
  extraNameKeys?: string[]
  required?: boolean
  inTable?: boolean
  inForm?: boolean
  width?: number
  span?: 1 | 2 | 3
  placeholder?: string
  hint?: string
  step?: number
  default?: any
  align?: 'left' | 'right' | 'center'
  badge?: boolean
  /** 表格排序取值（默认按键值） */
  sortValue?: (row: Row) => string | number
  /** 表格中的自定义渲染（优先级最高） */
  tableRender?: (row: Row, ctx: DataValue) => ReactNode
  /** 表单中的自定义渲染 */
  formRender?: (form: Row, setValue: (key: string, v: any) => void) => ReactNode
  /** 选中引用记录后，联动回填其它字段（实现数据联动） */
  onRefPick?: (picked: Row, form: Row, ctx: DataValue) => Row
  /** 导出时的取值覆盖（如附件字段导出文件名而非存储路径） */
  exportValue?: (row: Row) => any
  /**
   * 条件显示：返回 false 时该字段在表单与详情中隐藏，且不参与必填校验。
   * 例：采购订单选择「不涉及合同」时隐藏「关联合同」。
   */
  visibleWhen?: (form: Row) => boolean
}

/** 列表页筛选条件 */
export interface FilterDef {
  key: string
  label: string
  /**
   * select —— 下拉精确匹配（默认）
   * combo  —— 可输入文本 + 下拉建议，按「包含」模糊匹配（适合供应商、单号、合同这类长文本）
   * date   —— 指定某一天精确匹配
   * dateRange —— 起止日期区间匹配
   */
  type?: 'select' | 'combo' | 'date' | 'dateRange'
  /** 下拉选项展示文案 */
  options?: string[]
  /** 与 options 一一对应的实际取值（不传时值等于文案） */
  optionValues?: string[]
  /** 引用集合 */
  ref?: RefName
  /** ref 筛选时，取引用记录上的哪个字段作为筛选值（默认按引用类型推断） */
  sourceKey?: string
}

/** 引用集合 → {value,label} 选项；合同额外拼接合同名称，便于一眼区分 */
export function refOptions(ref: RefName, data: DataValue, nameKey?: string) {
  const rows: Row[] = ((data as any)[ref] ?? []) as Row[]
  if (ref === 'contracts') {
    return rows.map((r) => ({
      value: String(r.id),
      label:
        [r.contract_no, r.name].filter((x) => x !== null && x !== undefined && String(x).trim() !== '').join(' · ') ||
        String(r.id),
    }))
  }
  if (ref === 'orders') {
    return rows.map((r) => ({
      value: String(r.id),
      label:
        [r.order_no, r.supplier_name].filter((x) => x !== null && x !== undefined && String(x).trim() !== '').join(' · ') ||
        String(r.id),
    }))
  }
  const key = nameKey ?? REF_LABEL_KEY[ref] ?? 'name'
  return rows.map((r) => ({
    value: String(r.id),
    label: String(r[key] ?? r.name ?? r.id),
  }))
}

export function findRefRow(ref: RefName, id: any, data: DataValue): Row | undefined {
  const rows: Row[] = ((data as any)[ref] ?? []) as Row[]
  return rows.find((r) => String(r.id) === String(id))
}

/**
 * 解析引用字段的展示文案。
 * 优先使用同步落库的名称列（如 contract_no / supplier_name）；
 * 若该列为空（历史数据），则按 id 回查引用表得到可读名称，避免直接显示一串数字。
 */
export function refLabel(f: FieldDef, row: Row, data: DataValue): string | null {
  if (f.nameKey) {
    const v = row[f.nameKey]
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v)
  }
  if (!f.ref) return null
  const hit = findRefRow(f.ref, row[f.key], data)
  if (!hit) return null
  const keys = [f.nameKey, REF_LABEL_KEY[f.ref], 'name', 'contract_no', 'order_no', 'code']
  for (const k of keys) {
    if (!k) continue
    const v = hit[k]
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v)
  }
  return null
}

/**
 * 取引用记录中应当写入 nameKey 落库列的值。
 * 例：供应商表的名称列是 name，而落库列叫 supplier_name，需要做一次映射；
 * 合同表的 nameKey 是 contract_no，则直接命中。
 */
export function refNameValue(f: FieldDef, raw: Row): string | null {
  if (!f.nameKey) return null
  const direct = raw[f.nameKey]
  if (direct !== null && direct !== undefined && String(direct).trim() !== '') return String(direct)
  const fallbackKeys = [f.ref ? REF_LABEL_KEY[f.ref] : null, 'name', 'code', 'contract_no', 'order_no']
  for (const k of fallbackKeys) {
    if (!k) continue
    const v = raw[k]
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v)
  }
  return null
}

/** 筛选下拉的可选值；ref 类型会取引用记录上的目标字段作为取值 */
export function filterOptions(f: FilterDef, data: DataValue): { value: string; label: string }[] {
  if (f.options) {
    return f.options.map((o, i) => ({ value: f.optionValues?.[i] ?? o, label: o }))
  }
  if (f.ref) {
    const rows: Row[] = ((data as any)[f.ref] ?? []) as Row[]
    const vk = f.sourceKey ?? REF_LABEL_KEY[f.ref] ?? 'name'
    const labels = refOptions(f.ref, data)
    return rows.map((r, i) => ({
      value: String(r[vk] ?? ''),
      label: labels[i]?.label ?? String(r[vk] ?? ''),
    }))
  }
  return []
}

/** 收集 fields 中所有需要随主记录一并落库的名称列 */
export function nameKeysOf(fields: FieldDef[]): string[] {
  const keys = new Set<string>()
  fields.forEach((f) => {
    if (f.type === 'ref' && f.nameKey) keys.add(f.nameKey)
    f.extraNameKeys?.forEach((k) => keys.add(k))
  })
  return [...keys]
}

/** 把引用字段同步写入的名称列补进提交载荷，避免只存了 id */
export function withNameKeys(payload: Row, form: Row, fields: FieldDef[]): Row {
  nameKeysOf(fields).forEach((k) => {
    if (!Object.prototype.hasOwnProperty.call(form, k)) return
    const v = form[k]
    payload[k] = v === undefined || v === '' ? null : v
  })
  return payload
}

export function fieldExportColumns(fields: FieldDef[]): ExportColumn[] {
  return fields
    .filter((f) => f.inTable !== false && f.key !== 'id' && !f.key.startsWith('__'))
    .map((f) => ({
      key: f.key,
      label: f.label,
      format: (row: Row) => {
        const v = row[f.key]
        if (f.exportValue) return f.exportValue(row)
        if (f.type === 'money') return money(v)
        if (f.type === 'number') return num(v, 3)
        if (f.type === 'ref') return (f.nameKey ? row[f.nameKey] : '') ?? v ?? ''
        return v === null || v === undefined ? '' : v
      },
    }))
}
