import * as XLSX from 'xlsx'
import { BACKUP_TABLES } from './backup'
import { deleteAllRows, insertRows, selectAll, type Row } from './db'

/* ---------------------------- 数据表字段白名单 ---------------------------- */
/** 与数据库实际列一一对应；导入时只保留这里的列，避免脏列导致整体失败 */
export const TABLE_COLUMNS: Record<string, string[]> = {
  material_categories: ['id', 'code', 'name', 'spec_range', 'unit', 'remark', 'created_at'],
  materials: [
    'id', 'code', 'name', 'category_id', 'category_name', 'spec', 'unit', 'brand',
    'ref_price', 'safety_stock', 'remark', 'created_at',
  ],
  suppliers: [
    'id', 'code', 'name', 'cooperation', 'main_type', 'supply_scope', 'contact',
    'phone', 'address', 'rating', 'remark', 'created_at',
  ],
  purchase_orders: [
    'id', 'order_no', 'supplier_id', 'supplier_name', 'order_date', 'expect_date',
    'contract_id', 'contract_no', 'total_amount', 'status', 'buyer', 'remark',
    'created_at', 'contract_name', 'has_contract',
  ],
  purchase_order_items: [
    'id', 'order_id', 'category_id', 'category_name', 'material_id', 'material_name',
    'spec', 'unit', 'qty', 'unit_price', 'amount', 'arrived_qty', 'remark', 'created_at',
  ],
  inbound_orders: [
    'id', 'in_no', 'in_date', 'supplier_id', 'supplier_name', 'order_id', 'order_no',
    'warehouse', 'inspector', 'status', 'total_amount', 'remark', 'created_at',
    'contract_name', 'contract_id', 'contract_no',
  ],
  inbound_items: [
    'id', 'inbound_id', 'category_id', 'category_name', 'material_id', 'material_name',
    'spec', 'unit', 'qty', 'qualified_qty', 'unit_price', 'amount', 'batch_no', 'remark', 'created_at',
  ],
  outbound_orders: [
    'id', 'out_no', 'out_date', 'team_id', 'team_name', 'stage_id', 'stage_name',
    'usage_desc', 'keeper', 'status', 'total_qty', 'remark', 'created_at',
  ],
  outbound_items: [
    'id', 'outbound_id', 'category_id', 'category_name', 'material_id', 'material_name',
    'spec', 'unit', 'qty', 'remark', 'created_at',
  ],
  defects: [
    'id', 'record_no', 'record_date', 'type', 'source', 'category_id', 'category_name',
    'material_id', 'material_name', 'spec', 'unit', 'qty', 'unit_price', 'amount',
    'supplier_id', 'supplier_name', 'team_id', 'team_name', 'reason', 'disposal',
    'handler', 'status', 'remark', 'created_at', 'source_no',
  ],
  contracts: [
    'id', 'contract_no', 'name', 'supplier_id', 'supplier_name', 'amount', 'sign_date',
    'start_date', 'end_date', 'pay_terms', 'status', 'file_path', 'file_name', 'remark', 'created_at',
  ],
  invoices: [
    'id', 'invoice_no', 'invoice_type', 'supplier_id', 'supplier_name', 'contract_id',
    'contract_no', 'amount', 'tax_rate', 'invoice_date', 'status', 'file_path', 'file_name',
    'remark', 'created_at',
  ],
  payments: [
    'id', 'contract_id', 'contract_no', 'supplier_id', 'supplier_name', 'stage_name',
    'stage_seq', 'ratio', 'plan_amount', 'paid_amount', 'status', 'plan_date', 'paid_date',
    'pay_method', 'remark', 'created_at', 'contract_name',
  ],
  misc_purchases: [
    'id', 'bill_no', 'category', 'item_name', 'spec', 'qty', 'unit', 'unit_price', 'amount',
    'vendor', 'pay_method', 'handler', 'expense_date', 'status', 'file_path', 'file_name',
    'remark', 'created_at',
  ],
  teams: ['id', 'name', 'leader', 'phone', 'section', 'village', 'progress', 'status', 'plan_start', 'plan_end', 'remark', 'created_at'],
  team_stages: ['id', 'team_id', 'team_name', 'name', 'seq', 'progress', 'start_date', 'end_date', 'status', 'remark', 'created_at'],
  roles: ['id', 'code', 'name', 'description', 'is_system', 'sort', 'created_at'],
  role_permissions: ['id', 'role_code', 'module', 'can_view', 'can_edit', 'created_at'],
}

/* ---------------------------- 父子关联（外键） ---------------------------- */

/** 各父表用于「还原时重新挂接」的业务键：新记录 id 会重新分配，靠业务键找回对应关系 */
const PARENT_KEYS: Record<string, (r: Row) => string> = {
  material_categories: (r) => String(r.code ?? ''),
  purchase_orders: (r) => String(r.order_no ?? ''),
  inbound_orders: (r) => String(r.in_no ?? ''),
  outbound_orders: (r) => String(r.out_no ?? ''),
  teams: (r) => [r.name, r.section].filter(Boolean).join('|'),
}

interface FkLink {
  child: string
  column: string
  parent: string
  nullable: boolean
}

const FK_LINKS: FkLink[] = [
  { child: 'materials', column: 'category_id', parent: 'material_categories', nullable: true },
  { child: 'purchase_order_items', column: 'order_id', parent: 'purchase_orders', nullable: true },
  { child: 'inbound_items', column: 'inbound_id', parent: 'inbound_orders', nullable: false },
  { child: 'outbound_items', column: 'outbound_id', parent: 'outbound_orders', nullable: false },
  { child: 'team_stages', column: 'team_id', parent: 'teams', nullable: true },
]

/* --------------------------------- 解析 --------------------------------- */

export interface RestoreEntry {
  source: string
  table: string
  label: string
  rows: Row[]
  error?: string
}

export interface ParseOutcome {
  entries: RestoreEntry[]
  unknown: string[]
  errors: string[]
}

const labelOf = (table: string): string => BACKUP_TABLES.find((t) => t.table === table)?.label ?? table

/** 文件名 / 工作表名 → 数据表：支持「表名」「中文名」「中文名_表名」「中文名（表名）」 */
export function matchTable(raw: string): string | undefined {
  const clean = String(raw ?? '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[（(].*?[)）]/g, ' ')
    .trim()
  if (!clean) return undefined
  const lower = clean.toLowerCase()
  const exactCode = BACKUP_TABLES.find((t) => t.table === lower)
  if (exactCode) return exactCode.table
  const exactLabel = BACKUP_TABLES.find((t) => t.label === clean)
  if (exactLabel) return exactLabel.table

  const byLength = [...BACKUP_TABLES].sort((a, b) => b.label.length - a.label.length)
  for (const t of byLength) {
    if (lower.endsWith(`_${t.table}`) || lower.endsWith(`-${t.table}`)) return t.table
  }
  for (const t of [...BACKUP_TABLES].sort((a, b) => b.table.length - a.table.length)) {
    if (lower.includes(t.table)) return t.table
  }
  for (const t of byLength) {
    if (clean.includes(t.label)) return t.table
  }
  return undefined
}

function sheetToRows(ws: XLSX.WorkSheet): Row[] {
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: null, blankrows: false, raw: true })
  return rows.filter((r) => Object.keys(r).length > 0)
}

/** 解析用户选择的备份文件（.xlsx / .xls / .csv / .json，可多选） */
export async function parseBackupFiles(files: File[]): Promise<ParseOutcome> {
  const entries: RestoreEntry[] = []
  const unknown: string[] = []
  const errors: string[] = []

  for (const file of files) {
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    try {
      if (ext === 'json') {
        const text = await file.text()
        const parsed: any = JSON.parse(text)
        const rows: Row[] = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.rows)
            ? parsed.rows
            : Array.isArray(parsed?.data)
              ? parsed.data
              : []
        const table = matchTable(String(parsed?.table ?? '')) ?? matchTable(file.name)
        if (!table) {
          unknown.push(file.name)
          continue
        }
        entries.push({ source: file.name, table, label: labelOf(table), rows })
      } else if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        const wb = XLSX.read(await file.text(), { type: 'string' })
        const rows = sheetToRows(wb.Sheets[wb.SheetNames[0]])
        const table = matchTable(file.name)
        if (!table) {
          unknown.push(file.name)
          continue
        }
        entries.push({ source: file.name, table, label: labelOf(table), rows })
      } else if (ext === 'xlsx' || ext === 'xls') {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
        let hit = 0
        wb.SheetNames.forEach((sn) => {
          if (/备份说明|说明|readme/i.test(sn)) return
          const ws = wb.Sheets[sn]
          const rows = sheetToRows(ws)
          const table = matchTable(sn)
          if (!table) {
            if (rows.length) unknown.push(`${file.name} · ${sn}`)
            return
          }
          hit += 1
          entries.push({ source: `${file.name} · ${sn}`, table, label: labelOf(table), rows })
        })
        if (!hit) unknown.push(file.name)
      } else {
        unknown.push(file.name)
      }
    } catch (e: any) {
      errors.push(`${file.name}：${e?.message || '解析失败'}`)
    }
  }
  return { entries, unknown, errors }
}

/* --------------------------------- 导入 --------------------------------- */

export interface ImportOptions {
  entries: RestoreEntry[]
  /** append=只新增；replace=先清空所选表再导入 */
  mode: 'append' | 'replace'
  onLog?: (line: string) => void
  onProgress?: (done: number, total: number, label: string) => void
  shouldStop?: () => boolean
}

export interface ImportDetail {
  table: string
  label: string
  rows: number
  inserted: number
  failed: number
  skipped: number
  deleted: number
}

export interface ImportResult {
  inserted: number
  failed: number
  skipped: number
  deleted: number
  details: ImportDetail[]
  warnings: string[]
}

const CHUNK = 200

const norm = (v: any): any => {
  if (v === undefined) return null
  if (typeof v === 'string') {
    const t = v.trim()
    return t === '' ? null : t
  }
  return v
}

/**
 * 执行还原导入。
 * 说明：数据库主键为自增（GENERATED ALWAYS），导入无法沿用原 id，
 * 因此导入后按业务键（如采购订单号、物资分类编码）自动重建父子关联。
 */
export async function runImport(opt: ImportOptions): Promise<ImportResult> {
  const log = opt.onLog ?? (() => {})
  const progress = opt.onProgress ?? (() => {})
  const warnings: string[] = []

  const order = BACKUP_TABLES.map((t) => t.table)
  const byTable = new Map<string, RestoreEntry[]>()
  opt.entries.forEach((e) => {
    if (e.error) return
    const list = byTable.get(e.table) ?? []
    list.push(e)
    byTable.set(e.table, list)
  })

  const tables = [...byTable.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const totalRows = [...byTable.values()].reduce((a, list) => a + list.reduce((b, e) => b + e.rows.length, 0), 0)
  log(`待导入 ${tables.length} 张表，共 ${totalRows} 行；方式：${opt.mode === 'replace' ? '覆盖导入' : '仅新增'}`)

  // 预先取出各父表当前的 id 集合，用于校验关联是否仍然有效
  const idSets: Record<string, Set<string>> = {}
  const parentTables = new Set(FK_LINKS.map((l) => l.parent))
  await Promise.all(
    [...parentTables].map(async (p) => {
      try {
        const rows = await selectAll<Row>(p, { select: 'id' })
        idSets[p] = new Set(rows.map((r) => String(r.id)))
      } catch {
        idSets[p] = new Set()
      }
    })
  )

  const idMaps: Record<string, Map<string, any>> = {}
  const details: ImportDetail[] = []
  let inserted = 0
  let failed = 0
  let skipped = 0
  let deleted = 0

  for (let ti = 0; ti < tables.length; ti++) {
    const table = tables[ti]
    const label = labelOf(table)
    const entries = byTable.get(table) ?? []
    const rawRows = entries.flatMap((e) => e.rows)
    const detail: ImportDetail = {
      table,
      label,
      rows: rawRows.length,
      inserted: 0,
      failed: 0,
      skipped: 0,
      deleted: 0,
    }

    if (opt.shouldStop?.()) break

    // 1) 覆盖模式：先清空该表
    if (opt.mode === 'replace') {
      try {
        const n = await deleteAllRows(table)
        detail.deleted = n
        deleted += n
        log(`${label}：已清空 ${n} 行现有数据`)
      } catch (e: any) {
        detail.failed += rawRows.length
        failed += rawRows.length
        warnings.push(`${label} 清空失败：${e?.message || '未知错误'}`)
        details.push(detail)
        continue
      }
    }

    // 2) 规整每一行：白名单列 + 关联列按新 id 改写
    const cols = new Set(TABLE_COLUMNS[table] ?? [])
    const links = FK_LINKS.filter((l) => l.child === table)
    const payloads: Row[] = []
    const olds: Row[] = []
    rawRows.forEach((raw, idx) => {
      const payload: Row = {}
      Object.keys(raw).forEach((k) => {
        if (!cols.has(k) || k === 'id') return
        payload[k] = norm(raw[k])
      })
      for (const link of links) {
        const v = payload[link.column]
        if (v === null || v === undefined) continue
        const mapped = idMaps[link.parent]?.get(String(v)) ?? v
        const valid = idSets[link.parent]?.has(String(mapped)) ?? true
        if (valid) {
          payload[link.column] = mapped
        } else if (link.nullable) {
          payload[link.column] = null
          warnings.push(
            `${label} 第 ${idx + 1} 行：关联的「${labelOf(link.parent)}」记录不存在，已置空`
          )
        } else {
          detail.skipped += 1
          skipped += 1
          warnings.push(`${label} 第 ${idx + 1} 行：找不到对应的「${labelOf(link.parent)}」记录，已跳过`)
          return
        }
      }
      payloads.push(payload)
      olds.push(raw)
    })

    if (!payloads.length) {
      log(`${label}：没有可导入的数据行`)
      details.push(detail)
      continue
    }

    // 3) 分批写入，整批失败时逐行重试，最大化导入成功率
    const pairs: { old: Row; new: Row }[] = []
    for (let i = 0; i < payloads.length; i += CHUNK) {
      if (opt.shouldStop?.()) break
      const chunk = payloads.slice(i, i + CHUNK)
      const chunkOlds = olds.slice(i, i + CHUNK)
      try {
        const created = await insertRows(table, chunk)
        created.forEach((c, k) => pairs.push({ old: chunkOlds[k] ?? {}, new: c }))
        detail.inserted += created.length
        inserted += created.length
      } catch {
        for (let k = 0; k < chunk.length; k++) {
          if (opt.shouldStop?.()) break
          try {
            const [c] = await insertRows(table, [chunk[k]])
            pairs.push({ old: chunkOlds[k] ?? {}, new: c })
            detail.inserted += 1
            inserted += 1
          } catch (e: any) {
            detail.failed += 1
            failed += 1
            warnings.push(`${label} 第 ${i + k + 1} 行导入失败：${e?.message || '未知错误'}`)
          }
        }
      }
      progress(ti + 1, tables.length, `导入 ${label}（${Math.min(i + CHUNK, payloads.length)}/${payloads.length}）`)
    }
    log(`${label}：成功 ${detail.inserted} 行${detail.failed ? `，失败 ${detail.failed} 行` : ''}`)

    // 4) 刷新父表 id 集合，并建立「旧 id → 新 id」映射，供明细表重新挂接
    if (parentTables.has(table)) {
      try {
        const rows = await selectAll<Row>(table, { select: 'id' })
        idSets[table] = new Set(rows.map((r) => String(r.id)))
      } catch {
        /* 忽略：后续按「不存在」处理 */
      }
      const keyOf = PARENT_KEYS[table]
      if (keyOf) {
        const keyCount = new Map<string, number>()
        const keyId = new Map<string, any>()
        pairs.forEach(({ new: nw }) => {
          const k = keyOf(nw ?? {})
          if (!k) return
          keyCount.set(k, (keyCount.get(k) ?? 0) + 1)
          keyId.set(k, nw.id)
        })
        const map = new Map<string, any>()
        pairs.forEach(({ old: o, new: nw }) => {
          if (o.id === null || o.id === undefined) return
          const k = keyOf(o)
          let id = nw?.id
          if (k && keyOf(nw ?? {}) !== k && keyCount.get(k) === 1) id = keyId.get(k)
          if (id !== undefined) map.set(String(o.id), id)
        })
        idMaps[table] = map
      }
    }

    progress(ti + 1, tables.length, `完成 ${label}`)
    details.push(detail)
  }

  return { inserted, failed, skipped, deleted, details, warnings }
}
