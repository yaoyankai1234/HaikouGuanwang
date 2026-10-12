import * as XLSX from 'xlsx'
import { api } from '../lib/api'
import { parseAttachments } from '../components/FileField'
import { selectAllPaged, type Row } from './db'
import { stamp } from './format'
import { buildZip } from './zip'

/* ------------------------------ 备份内容清单 ------------------------------ */

export interface BackupTableDef {
  table: string
  label: string
  group: string
  /** 该表带附件字段（file_path / file_name），勾选「含附件」时会一并下载文件 */
  withFiles?: boolean
}

/** 可备份的业务数据表（覆盖系统里全部自建表） */
export const BACKUP_TABLES: BackupTableDef[] = [
  { table: 'material_categories', label: '物资分类', group: '物资管理' },
  { table: 'materials', label: '物资台账', group: '物资管理' },
  { table: 'suppliers', label: '供应商档案', group: '供应商' },
  { table: 'purchase_orders', label: '采购订单', group: '采购与仓储' },
  { table: 'purchase_order_items', label: '采购订单明细', group: '采购与仓储' },
  { table: 'inbound_orders', label: '物资入库单', group: '采购与仓储' },
  { table: 'inbound_items', label: '入库单明细', group: '采购与仓储' },
  { table: 'outbound_orders', label: '物资出库单', group: '采购与仓储' },
  { table: 'outbound_items', label: '出库单明细', group: '采购与仓储' },
  { table: 'defects', label: '损耗与不合格', group: '采购与仓储' },
  { table: 'contracts', label: '合同管理', group: '合同与财务', withFiles: true },
  { table: 'invoices', label: '发票管理', group: '合同与财务', withFiles: true },
  { table: 'payments', label: '付款进度', group: '合同与财务' },
  { table: 'misc_purchases', label: '非工程采购', group: '日常费用', withFiles: true },
  { table: 'teams', label: '团队分组', group: '团队与进度' },
  { table: 'team_stages', label: '进度节点', group: '团队与进度' },
  { table: 'v_app_users', label: '用户账号', group: '系统配置' },
  { table: 'roles', label: '角色定义', group: '系统配置' },
  { table: 'role_permissions', label: '角色权限', group: '系统配置' },
]

export const BACKUP_GROUPS = [...new Set(BACKUP_TABLES.map((t) => t.group))]

/* -------------------------------- 备份格式 -------------------------------- */

export type BackupFormat = 'excel' | 'csv' | 'json'

export const FORMATS: { value: BackupFormat; label: string; desc: string }[] = [
  { value: 'excel', label: 'Excel 工作簿', desc: '所有表汇总成一个 .xlsx，每张表一个工作表，最便于查看' },
  { value: 'csv', label: 'CSV 表格', desc: '每张表一个 .csv 文件，可用任意工具打开' },
  { value: 'json', label: 'JSON 数据', desc: '每张表一个 .json 文件，保留完整字段，最便于程序还原' },
]

export const formatLabel = (f: BackupFormat): string => FORMATS.find((x) => x.value === f)?.label ?? f

/* -------------------------------- 采集数据 -------------------------------- */

export interface CollectedTable {
  def: BackupTableDef
  rows: Row[]
  error?: string
}

/** 逐表读取数据；单表失败（无权限等）只记录不中断 */
export async function collectTables(
  defs: BackupTableDef[],
  onStep?: (label: string, index: number, total: number) => void
): Promise<CollectedTable[]> {
  const out: CollectedTable[] = []
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i]
    onStep?.(def.label, i + 1, defs.length)
    try {
      const rows = await selectAllPaged<Row>(def.table)
      out.push({ def, rows })
    } catch (e: any) {
      out.push({ def, rows: [], error: e?.message || '读取失败' })
    }
  }
  return out
}

/* -------------------------------- 附件清单 -------------------------------- */

export interface AttachmentTask {
  tableLabel: string
  fileName: string
  path: string
}

const safeName = (name: string): string =>
  name.replace(/[\\/:*?"<>|]/g, '_').replace(/^\s+|\s+$/g, '').slice(-90) || '附件'

/** 汇总所有需要下载的附件（同名自动加序号，避免互相覆盖） */
export function collectAttachmentTasks(tables: CollectedTable[]): AttachmentTask[] {
  const tasks: AttachmentTask[] = []
  tables
    .filter((t) => !t.error && t.def.withFiles)
    .forEach((t) => {
      t.rows.forEach((r) => {
        parseAttachments(r.file_path, r.file_name).forEach((a, i) => {
          tasks.push({
            tableLabel: t.def.label,
            fileName: `${tasks.length + 1}_${safeName(a.name || a.path.split('/').pop() || '附件')}`,
            path: a.path,
          })
        })
      })
    })
  return tasks
}

/* -------------------------------- 文件生成 -------------------------------- */

function tableToAoa(rows: Row[]): any[][] {
  const keys: string[] = []
  const seen = new Set<string>()
  rows.forEach((r) =>
    Object.keys(r).forEach((k) => {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    })
  )
  // id 放最前，方便比对
  const ordered = keys.includes('id') ? ['id', ...keys.filter((k) => k !== 'id')] : keys
  const header = ordered
  const body = rows.map((r) =>
    ordered.map((k) => {
      const v = r[k]
      if (v === null || v === undefined) return ''
      if (typeof v === 'object') return JSON.stringify(v)
      return v
    })
  )
  return [header, ...body]
}

function sheetCols(rows: Row[], keys: string[]) {
  return keys.map((k) => {
    const sample = rows.find((r) => r[k] !== null && r[k] !== undefined)?.[k]
    const wide = typeof sample === 'string' && sample.length > 24
    return { wch: Math.max(10, Math.min(36, wide ? 30 : k.length * 2 + 8)) }
  })
}

function aoaKeys(aoa: any[][]): string[] {
  return (aoa[0] ?? []).map((v) => String(v))
}

/** 生成单个工作表 */
function buildSheet(rows: Row[]) {
  const aoa = tableToAoa(rows)
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = sheetCols(rows, aoaKeys(aoa))
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }
  return ws
}

export interface ManifestInfo {
  appName: string
  appId: string
  backupNo: string
  time: string
  operator: string
  format: BackupFormat
  includeFiles: boolean
  dirName: string
  tables: { table: string; label: string; rows: number; error?: string }[]
  attachmentCount: number
  attachmentFailed: number
  files: string[]
}

/** Excel 工作簿（含「备份说明」工作表） */
export function buildWorkbookBlob(tables: CollectedTable[], info: ManifestInfo): Blob {
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()

  const infoWs = XLSX.utils.aoa_to_sheet([
    ['备份信息', '内容'],
    ['系统名称', info.appName],
    ['系统编号', info.appId],
    ['备份编号', info.backupNo],
    ['备份时间', info.time],
    ['操作人', info.operator],
    ['备份格式', formatLabel(info.format)],
    ['备份目录', info.dirName],
    ['包含附件', info.includeFiles ? '是' : '否'],
    ['附件数量', String(info.attachmentCount)],
    ['', ''],
    ['数据表', '行数'],
    ...info.tables.map((t) => [`${t.label}（${t.table}）`, t.error ? `读取失败：${t.error}` : String(t.rows)]),
  ])
  infoWs['!cols'] = [{ wch: 26 }, { wch: 54 }]
  XLSX.utils.book_append_sheet(wb, infoWs, '备份说明')
  used.add('备份说明')

  tables
    .filter((t) => !t.error)
    .forEach((t, i) => {
      let name = (t.def.label || `Sheet${i + 1}`).slice(0, 28)
      while (used.has(name)) name = `${name}_`.slice(0, 30)
      used.add(name)
      XLSX.utils.book_append_sheet(wb, buildSheet(t.rows), name)
    })

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** 单表 CSV（带 BOM，Excel 打开不乱码） */
export function buildCsvBlob(rows: Row[]): Blob {
  const aoa = tableToAoa(rows)
  const text = aoa
    .map((r) =>
      r
        .map((v) => {
          const s = v === null || v === undefined ? '' : String(v)
          return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(',')
    )
    .join('\r\n')
  return new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' })
}

/** 单表 JSON（带表名等元信息，便于「从备份还原」时自动识别） */
export function buildJsonBlob(def: BackupTableDef, rows: Row[]): Blob {
  const payload = {
    table: def.table,
    label: def.label,
    exportedAt: new Date().toISOString(),
    rowCount: rows.length,
    rows,
  }
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
}

export function buildTextBlob(text: string): Blob {
  return new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' })
}

/** 可读的备份清单（txt） */
export function buildReadme(info: ManifestInfo): string {
  const lines: string[] = []
  lines.push(`${info.appName} 数据备份清单`)
  lines.push('='.repeat(48))
  lines.push(`备份编号：${info.backupNo}`)
  lines.push(`备份时间：${info.time}`)
  lines.push(`操作人　：${info.operator}`)
  lines.push(`备份格式：${formatLabel(info.format)}`)
  lines.push(`是否含附件：${info.includeFiles ? `是（共 ${info.attachmentCount} 个文件）` : '否'}`)
  if (info.attachmentFailed) lines.push(`附件失败：${info.attachmentFailed} 个（见下方说明）`)
  lines.push('')
  lines.push('一、备份内容（数据表行数）')
  info.tables.forEach((t) =>
    lines.push(`  · ${t.label.padEnd(10, '　')} ${t.error ? `未备份：${t.error}` : `${t.rows} 行`}`)
  )
  lines.push('')
  lines.push('二、文件清单')
  info.files.forEach((f) => lines.push(`  · ${f}`))
  lines.push('')
  lines.push('说明：本备份由系统「数据备份」功能生成，包含所选数据表的全部记录；')
  lines.push('　　　如勾选了「包含附件文件」，发票、收据、合同扫描件等原件存放在「附件」目录下。')
  return lines.join('\r\n')
}

/* --------------------------------- 写入端 --------------------------------- */

/** 写入目标：subPath 为备份目录内的子目录（如「数据」「附件/合同管理」） */
export interface BackupSink {
  write: (subPath: string, fileName: string, blob: Blob) => Promise<void>
}

/** 浏览器目录写入（File System Access API，用户在弹窗中选择文件夹） */
export function makeDirectorySink(dirHandle: any): BackupSink {
  const cache = new Map<string, any>()
  const getDir = async (subPath: string) => {
    const key = subPath || ''
    if (cache.has(key)) return cache.get(key)
    let cur = dirHandle
    for (const seg of key.split('/').filter(Boolean)) {
      cur = await cur.getDirectoryHandle(seg, { create: true })
    }
    cache.set(key, cur)
    return cur
  }
  return {
    write: async (subPath, fileName, blob) => {
      const dir = await getDir(subPath)
      const handle = await dir.getFileHandle(fileName, { create: true })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
    },
  }
}

export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/**
 * 打包写入端：所有文件先收在内存里，最后一次性产出单个 zip 下载。
 * 用于浏览器不支持「选择文件夹」写入的场景（如通过 http://IP:端口 访问）。
 */
export function makeZipSink(): BackupSink & {
  finish: (fileName: string, onProgress?: (done: number, total: number, label: string) => void) => Promise<number>
} {
  const entries: { path: string; blob: Blob }[] = []
  return {
    write: async (subPath, fileName, blob) => {
      entries.push({ path: [subPath, fileName].filter(Boolean).join('/'), blob })
    },
    finish: async (fileName, onProgress) => {
      const zip = await buildZip(entries, onProgress)
      downloadBlob(fileName, zip)
      return entries.length
    },
  }
}

/* --------------------------------- 执行器 --------------------------------- */

export interface RunOptions {
  tables: CollectedTable[]
  format: BackupFormat
  includeFiles: boolean
  dirName: string
  backupNo: string
  operator: string
  appName: string
  appId: string
  onLog?: (line: string) => void
  onProgress?: (done: number, total: number, label: string) => void
  shouldStop?: () => boolean
}

export interface RunResult {
  dataRows: number
  attachmentCount: number
  attachmentFailed: number
  fileCount: number
  warnings: string[]
  info: ManifestInfo
}

async function signedUrl(path: string): Promise<string> {
  return api.fileBlobUrl(path)
}

/** 执行备份：写数据文件 + 清单 + （可选）附件 */
export async function runBackup(sink: BackupSink, opt: RunOptions): Promise<RunResult> {
  const log = opt.onLog ?? (() => {})
  const progress = opt.onProgress ?? (() => {})
  const warnings: string[] = []

  const okTables = opt.tables.filter((t) => !t.error)
  const failedTables = opt.tables.filter((t) => t.error)
  failedTables.forEach((t) => warnings.push(`${t.def.label} 未备份：${t.error}`))

  const tasks = opt.includeFiles ? collectAttachmentTasks(okTables) : []
  const dataRows = okTables.reduce((a, t) => a + t.rows.length, 0)
  // 进度步数：Excel 只产出一个文件，CSV / JSON 每张表一个文件
  const dataSteps = opt.format === 'excel' ? 1 : Math.max(1, okTables.length)
  const total = dataSteps + tasks.length + 2
  let done = 0
  const tick = (label: string) => {
    done += 1
    progress(done, total, label)
  }

  const files: string[] = []
  const dataDir = '数据'

  if (opt.format === 'excel') {
    const info = buildInfo({ ...opt, attachmentCount: tasks.length, attachmentFailed: 0, files: [] })
    const blob = buildWorkbookBlob(okTables, info)
    const name = `${opt.dirName}_数据.xlsx`
    await sink.write(dataDir, name, blob)
    files.push(`${dataDir}/${name}`)
    log(`已写出现数据：${dataDir}/${name}（${okTables.length} 张表、${dataRows} 行）`)
    tick('数据文件')
  } else {
    for (const t of okTables) {
      if (opt.shouldStop?.()) break
      const name = `${t.def.label}_${t.def.table}.${opt.format === 'csv' ? 'csv' : 'json'}`
      const blob = opt.format === 'csv' ? buildCsvBlob(t.rows) : buildJsonBlob(t.def, t.rows)
      await sink.write(dataDir, name, blob)
      files.push(`${dataDir}/${name}`)
      log(`${t.def.label}：${t.rows.length} 行 → ${dataDir}/${name}`)
      tick(`${t.def.label}`)
    }
  }

  // 附件
  let attachmentCount = 0
  let attachmentFailed = 0
  if (opt.includeFiles && tasks.length) {
    log(`开始备份附件，共 ${tasks.length} 个文件…`)
    for (const task of tasks) {
      if (opt.shouldStop?.()) break
      try {
        const url = await signedUrl(task.path)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`)
        const blob = await res.blob()
        await sink.write(`附件/${task.tableLabel}`, task.fileName, blob)
        attachmentCount += 1
        files.push(`附件/${task.tableLabel}/${task.fileName}`)
      } catch (e: any) {
        attachmentFailed += 1
        warnings.push(`${task.tableLabel}/${task.fileName} 下载失败：${e?.message || '未知错误'}`)
      }
      tick(`附件 ${task.tableLabel}`)
    }
    log(`附件完成：成功 ${attachmentCount} 个${attachmentFailed ? `，失败 ${attachmentFailed} 个` : ''}`)
  } else if (opt.includeFiles) {
    log('所选数据表中没有可备份的附件')
  }

  const info = buildInfo({ ...opt, attachmentCount, attachmentFailed, files })
  const manifest = new Blob([JSON.stringify(info, null, 2)], { type: 'application/json;charset=utf-8' })
  await sink.write('', '备份清单.json', manifest)
  files.push('备份清单.json')
  tick('备份清单')

  await sink.write('', '备份说明.txt', buildTextBlob(buildReadme(info)))
  files.push('备份说明.txt')
  tick('备份说明')

  return { dataRows, attachmentCount, attachmentFailed, fileCount: files.length, warnings, info }
}

function buildInfo(input: {
  appName: string
  appId: string
  backupNo: string
  operator: string
  format: BackupFormat
  includeFiles: boolean
  dirName: string
  tables: CollectedTable[]
  attachmentCount: number
  attachmentFailed: number
  files: string[]
}): ManifestInfo {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return {
    appName: input.appName,
    appId: input.appId,
    backupNo: input.backupNo,
    time: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
    operator: input.operator,
    format: input.format,
    includeFiles: input.includeFiles,
    dirName: input.dirName,
    tables: input.tables.map((t) => ({
      table: t.def.table,
      label: t.def.label,
      rows: t.rows.length,
      error: t.error,
    })),
    attachmentCount: input.attachmentCount,
    attachmentFailed: input.attachmentFailed,
    files: input.files,
  }
}

/** 备份编号：BK20261010_0952（还原导入用 RS 前缀） */
export function makeBackupNo(prefix = 'BK'): string {
  return `${prefix}${stamp()}`
}

/** 备份目录名：供水管网系统备份_20261010_0952 */
export function makeDirName(): string {
  return `供水管网系统备份_${stamp()}`
}
