import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  DatabaseBackup,
  FileArchive,
  FolderOpen,
  HardDriveDownload,
  History,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react'
import { Badge, Button, Field, PageHeader, Select, cx, useUI } from '../components/ui'
import { useAuth } from '../store/auth'
import { countRows, errText, insertRow, selectAll, type Row } from '../lib/db'
import {
  BACKUP_GROUPS,
  BACKUP_TABLES,
  FORMATS,
  collectTables,
  downloadBlob,
  formatLabel,
  makeBackupNo,
  makeDirName,
  makeDirectorySink,
  makeZipSink,
  runBackup,
  type BackupFormat,
  type CollectedTable,
} from '../lib/backup'
import { parseBackupFiles, runImport, type ImportResult, type ParseOutcome } from '../lib/restore'
import { APP_NAME, APP_REGION } from '../cloud'

/* ------------------------------ 目录选择能力 ------------------------------ */

/**
 * 「选择文件夹」写入依赖 File System Access API，浏览器只在安全上下文
 * （https 或 localhost）下才提供；用 http://IP:端口 打开时该能力被禁用，
 * 此时改用「打包下载 ZIP」。
 */
const isSecure = (): boolean =>
  typeof window !== 'undefined' && (window as any).isSecureContext !== false

const supportsDirectory = (): boolean =>
  typeof window !== 'undefined' &&
  typeof (window as any).showDirectoryPicker === 'function' &&
  isSecure()

/** 明确是「明文 http 访问导致能力被禁用」，而不是浏览器本身太老 */
const blockedByInsecure = (): boolean => !isSecure() && !supportsDirectory()

/** 备份去向 */
type BackupTarget = 'folder' | 'zip' | 'download'

async function pickDirectory(): Promise<any | null> {
  try {
    return await (window as any).showDirectoryPicker({ id: 'pms-backup', mode: 'readwrite' })
  } catch (e: any) {
    if (e?.name === 'AbortError') return null
    throw e
  }
}

/* ---------------------------------- 页面 ---------------------------------- */

export default function Backup() {
  const { displayName, user } = useAuth()
  const { toast, confirm } = useUI()

  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    BACKUP_TABLES.forEach((t) => (init[t.table] = true))
    return init
  })
  const [format, setFormat] = useState<BackupFormat>('excel')
  const [includeFiles, setIncludeFiles] = useState(false)
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const [countLoading, setCountLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' })
  const [logs, setLogs] = useState<string[]>([])
  const [result, setResult] = useState<{ ok: boolean; text: string; warnings: string[] } | null>(null)
  const [history, setHistory] = useState<Row[]>([])
  const logRef = useRef<HTMLDivElement | null>(null)
  const stopRef = useRef(false)

  /* ------------------------------ 还原导入状态 ------------------------------ */
  const [files, setFiles] = useState<File[]>([])
  const [parsed, setParsed] = useState<ParseOutcome | null>(null)
  const [parsing, setParsing] = useState(false)
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  const [ackReplace, setAckReplace] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importLogs, setImportLogs] = useState<string[]>([])
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0, label: '' })
  const fileRef = useRef<HTMLInputElement | null>(null)
  const importLogRef = useRef<HTMLDivElement | null>(null)

  const chosen = useMemo(() => BACKUP_TABLES.filter((t) => selected[t.table]), [selected])
  const groups = useMemo(
    () =>
      BACKUP_GROUPS.map((g) => ({ group: g, items: BACKUP_TABLES.filter((t) => t.group === g) })).filter(
        (g) => g.items.length
      ),
    []
  )

  const loadCounts = async () => {
    setCountLoading(true)
    const out: Record<string, number | null> = {}
    await Promise.all(
      BACKUP_TABLES.map(async (t) => {
        try {
          out[t.table] = await countRows(t.table)
        } catch {
          out[t.table] = null
        }
      })
    )
    setCounts(out)
    setCountLoading(false)
  }

  const loadHistory = async () => {
    try {
      const rows = await selectAll<Row>('backup_logs', { order: 'created_at', asc: false, limit: 50 })
      setHistory(rows)
    } catch {
      setHistory([])
    }
  }

  useEffect(() => {
    void loadCounts()
    void loadHistory()
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  useEffect(() => {
    if (importLogRef.current) importLogRef.current.scrollTop = importLogRef.current.scrollHeight
  }, [importLogs])

  const appendLog = (line: string) => setLogs((prev) => [...prev, line])

  const totalRows = chosen.reduce((a, t) => a + (counts[t.table] ?? 0), 0)

  const toggleGroup = (keys: string[], on: boolean) =>
    setSelected((prev) => {
      const next = { ...prev }
      keys.forEach((k) => (next[k] = on))
      return next
    })

  /* ------------------------------- 执行备份 ------------------------------- */

  const doBackup = async (target: BackupTarget) => {
    if (!chosen.length) {
      toast('请先勾选要备份的数据内容', 'error')
      return
    }
    if (target === 'folder' && !supportsDirectory()) {
      toast('当前环境不支持直接写入文件夹，请改用「打包下载 ZIP」', 'error')
      return
    }

    let dirHandle: any = null
    if (target === 'folder') {
      try {
        dirHandle = await pickDirectory()
      } catch (e: any) {
        toast(e?.message || '无法打开文件夹选择窗口', 'error')
        return
      }
      if (!dirHandle) return // 用户取消
    }

    stopRef.current = false
    setRunning(true)
    setResult(null)
    setProgress({ done: 0, total: 0, label: '准备中…' })
    setLogs([])

    const dirName = makeDirName()
    const backupNo = makeBackupNo()

    try {
      // 1) 采集数据
      appendLog(`开始备份，备份编号 ${backupNo}`)
      appendLog(`数据范围：${chosen.map((t) => t.label).join('、')}`)
      const collected: CollectedTable[] = await collectTables(chosen, (label, i, total) => {
        setProgress({ done: i, total, label: `读取 ${label}` })
        appendLog(`读取 ${label}（${i}/${total}）`)
      })
      const rowTotal = collected.reduce((a, t) => a + t.rows.length, 0)
      appendLog(`数据读取完成：${rowTotal} 行`)

      // 2) 写入目标
      const zipSink = target === 'zip' ? makeZipSink() : null
      const sink = zipSink
        ? zipSink
        : target === 'folder'
          ? makeDirectorySink(await dirHandle.getDirectoryHandle(dirName, { create: true }))
          : { write: async (_sub: string, fileName: string, blob: Blob) => downloadBlob(fileName, blob) }

      const res = await runBackup(sink, {
        tables: collected,
        format,
        includeFiles,
        dirName,
        backupNo,
        operator: displayName,
        appName: APP_NAME,
        appId: 'wbapp_6WyVwdgdCuGKAxZEe9S5hT',
        onLog: appendLog,
        onProgress: (done, total, label) => setProgress({ done, total, label }),
        shouldStop: () => stopRef.current,
      })

      // 3) 打包下载
      let packed = 0
      if (zipSink) {
        appendLog('正在打包为 ZIP…')
        setProgress({ done: 0, total: 0, label: '正在打包…' })
        packed = await zipSink.finish(`${dirName}.zip`, (done, total, path) => {
          setProgress({ done, total, label: `打包 ${path}` })
        })
        appendLog(`已打包 ${packed} 个文件，浏览器开始下载 ${dirName}.zip`)
      }

      const place =
        target === 'folder'
          ? `已备份到所选文件夹下的「${dirName}」`
          : target === 'zip'
            ? `已打包成单个文件「${dirName}.zip」并开始下载`
            : '已开始下载'
      const text = `${place}：${res.dataRows} 行数据、${zipSink ? packed : res.fileCount} 个文件${
        res.attachmentCount ? `，附件 ${res.attachmentCount} 个` : ''
      }`
      setResult({ ok: true, text, warnings: res.warnings })
      toast('备份完成', 'success')
      appendLog('备份完成')

      // 4) 记录备份台账
      try {
        await insertRow('backup_logs', {
          backup_no: backupNo,
          operator_id: user?.id ?? null,
          operator_name: displayName,
          table_count: collected.filter((t) => !t.error).length,
          row_count: res.dataRows,
          format: formatLabel(format),
          file_name: target === 'folder' ? dirName : `${dirName}.zip`,
          include_files: includeFiles ? `是（${res.attachmentCount} 个）` : '否',
          status: res.attachmentFailed ? '部分完成' : '已完成',
          detail: chosen.map((t) => t.label).join('、'),
          remark: res.warnings.length ? res.warnings.slice(0, 3).join('；') : null,
        })
        await loadHistory()
      } catch (e) {
        appendLog(`备份记录写入失败：${errText(e)}`)
      }
    } catch (e: any) {
      const msg = errText(e)
      setResult({ ok: false, text: `备份失败：${msg}`, warnings: [] })
      appendLog(`备份失败：${msg}`)
      toast(msg, 'error')
    } finally {
      setRunning(false)
    }
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const importPct = importProgress.total ? Math.round((importProgress.done / importProgress.total) * 100) : 0

  /* ------------------------------- 还原导入 ------------------------------- */

  const pickFiles = async (list: File[]) => {
    if (!list.length) return
    setFiles(list)
    setImportResult(null)
    setImportLogs([])
    setParsing(true)
    try {
      const outcome = await parseBackupFiles(list)
      setParsed(outcome)
      if (!outcome.entries.length) {
        toast('没有识别到可导入的数据表，请确认文件来自本系统的备份', 'error')
      }
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setParsing(false)
    }
  }

  const clearFiles = () => {
    setFiles([])
    setParsed(null)
    setImportResult(null)
    setImportLogs([])
    setAckReplace(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const doImport = async () => {
    const entries = parsed?.entries ?? []
    if (!entries.length) return
    if (mode === 'replace' && !ackReplace) {
      toast('请先勾选确认：覆盖导入会清空所选表的现有数据', 'error')
      return
    }
    const totalRows = entries.reduce((a, e) => a + e.rows.length, 0)
    const ok = await confirm({
      title: mode === 'replace' ? '确认覆盖导入？' : '确认导入备份数据？',
      desc:
        mode === 'replace'
          ? `将先清空所选 ${entries.length} 张表的现有数据，再导入 ${totalRows} 行。此操作不可撤销，建议先做一次备份。`
          : `将新增导入 ${totalRows} 行数据到 ${entries.length} 张表，现有数据保持不变。`,
      confirmText: mode === 'replace' ? '确认覆盖导入' : '开始导入',
      danger: mode === 'replace',
    })
    if (!ok) return

    stopRef.current = false
    setImporting(true)
    setImportResult(null)
    setImportLogs([])
    setImportProgress({ done: 0, total: entries.length, label: '准备中…' })

    const log = (line: string) => setImportLogs((prev) => [...prev, line])
    try {
      const res = await runImport({
        entries,
        mode,
        onLog: log,
        onProgress: (done, total, label) => setImportProgress({ done, total, label }),
        shouldStop: () => stopRef.current,
      })
      setImportResult(res)
      toast(res.failed ? `导入完成，${res.failed} 行失败` : '导入完成', res.failed ? 'info' : 'success')
      log('导入完成')

      try {
        await insertRow('backup_logs', {
          kind: '还原导入',
          backup_no: makeBackupNo('RS'),
          operator_id: user?.id ?? null,
          operator_name: displayName,
          table_count: res.details.length,
          row_count: res.inserted,
          format: mode === 'replace' ? '覆盖导入' : '仅新增',
          file_name: files.map((f) => f.name).join('、').slice(0, 200),
          include_files: `${files.length} 个文件`,
          status: res.failed ? '部分完成' : '已完成',
          detail: res.details.map((d) => d.label).join('、'),
          remark: res.warnings.length ? res.warnings.slice(0, 3).join('；') : null,
        })
        await loadHistory()
      } catch (e) {
        log(`导入记录写入失败：${errText(e)}`)
      }
      void loadCounts()
    } catch (e: any) {
      const msg = errText(e)
      log(`导入失败：${msg}`)
      toast(msg, 'error')
    } finally {
      setImporting(false)
    }
  }

  const importRows = parsed?.entries.reduce((a, e) => a + e.rows.length, 0) ?? 0

  return (
    <div>
      <PageHeader
        title="数据备份"
        subtitle="按需把系统数据备份到本机指定文件夹（可含发票、收据、合同附件原件），也可用备份文件把数据还原导入回系统"
        icon={DatabaseBackup}
        actions={
          <>
            <Button icon={RefreshCw} onClick={() => void loadCounts()} disabled={running || countLoading}>
              刷新数据量
            </Button>
            {supportsDirectory() ? (
              <Button
                variant="primary"
                icon={FolderOpen}
                loading={running}
                onClick={() => void doBackup('folder')}
              >
                选择文件夹并备份
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={FileArchive}
                loading={running}
                onClick={() => void doBackup('zip')}
              >
                打包下载备份
              </Button>
            )}
          </>
        }
      />

      {!supportsDirectory() && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            {blockedByInsecure() ? (
              <>
                当前是 <b>http 明文地址</b>访问（浏览器只在 https 或 localhost 下开放「选择文件夹」写入能力），
                所以「选择文件夹并备份」不可用。已改用
                <b>「打包下载备份」</b>：所有文件会打成一个 zip 一次性下载，效果等同。
                希望直接写入指定文件夹，可用 Chrome / Edge 并通过 https 访问本系统。
              </>
            ) : (
              <>
                当前浏览器不支持「选择文件夹」写入（建议使用 Chrome / Edge）。可改用
                <b>「打包下载备份」</b>，或「下载到默认目录」。
              </>
            )}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_1fr]">
        {/* ----------------------------- 备份内容 ----------------------------- */}
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">一、选择备份内容</p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                已勾选 {chosen.length} / {BACKUP_TABLES.length} 项，约 {totalRows} 行数据
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button onClick={() => toggleGroup(BACKUP_TABLES.map((t) => t.table), true)} disabled={running}>
                全选
              </Button>
              <Button onClick={() => toggleGroup(BACKUP_TABLES.map((t) => t.table), false)} disabled={running}>
                清空
              </Button>
            </div>
          </div>

          <div className="max-h-[430px] overflow-y-auto px-4 py-3">
            {groups.map((g) => {
              const keys = g.items.map((i) => i.table)
              const allOn = keys.every((k) => selected[k])
              return (
                <div key={g.group} className="mb-3 last:mb-0">
                  <div className="mb-1.5 flex items-center gap-2">
                    <button
                      onClick={() => toggleGroup(keys, !allOn)}
                      disabled={running}
                      className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 transition hover:text-brand-600"
                    >
                      {g.group}
                    </button>
                    <span className="h-px flex-1 bg-slate-100" />
                    <button
                      onClick={() => toggleGroup(keys, !allOn)}
                      disabled={running}
                      className="text-[11px] text-brand-500 transition hover:text-brand-700"
                    >
                      {allOn ? '取消本组' : '选择本组'}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {g.items.map((t) => {
                      const on = !!selected[t.table]
                      const n = counts[t.table]
                      return (
                        <label
                          key={t.table}
                          className={cx(
                            'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition',
                            on
                              ? 'border-brand-200 bg-brand-50/60 text-slate-700'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={running}
                            onChange={(e) => setSelected((p) => ({ ...p, [t.table]: e.target.checked }))}
                            className="h-3.5 w-3.5 shrink-0 accent-brand-500"
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {t.label}
                            <span className="ml-1 text-[10px] text-slate-400">{t.table}</span>
                          </span>
                          {t.withFiles && <span title="该表含附件">📎</span>}
                          <span className="num shrink-0 text-[11px] text-slate-400">
                            {countLoading && n === undefined ? '…' : n === null || n === undefined ? '—' : `${n} 行`}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ----------------------------- 备份设置 ----------------------------- */}
        <div className="space-y-3">
          <div className="card p-4">
            <p className="text-sm font-semibold text-slate-800">二、备份设置</p>
            <div className="mt-3 space-y-3">
              <Field label="备份格式" hint={FORMATS.find((f) => f.value === format)?.desc}>
                <Select
                  value={format}
                  disabled={running}
                  onChange={(e) => setFormat(e.target.value as BackupFormat)}
                >
                  {FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <label
                className={cx(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs transition',
                  includeFiles ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200 bg-white'
                )}
              >
                <input
                  type="checkbox"
                  checked={includeFiles}
                  disabled={running}
                  onChange={(e) => setIncludeFiles(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand-500"
                />
                <span className="leading-relaxed">
                  <span className="font-medium text-slate-700">同时备份附件原件</span>
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    合同扫描件、发票 / 收据照片等文件会下载到备份目录的「附件」文件夹；
                    文件较多时耗时较长，建议在线上环境使用。
                  </span>
                </span>
              </label>

              <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
                本次备份：<b className="text-slate-700">{chosen.length}</b> 项数据、约{' '}
                <b className="text-slate-700">{totalRows}</b> 行，格式 {formatLabel(format)}
                {includeFiles ? '，含附件原件' : ''}。
              </div>

              <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
                备份目录结构：
                <br />
                <span className="text-slate-600">
                  供水管网系统备份_日期_时间 /
                  <br />
                  ├─ 数据（Excel 或 CSV / JSON 文件）
                  <br />
                  ├─ 附件（按模块分文件夹，可选）
                  <br />
                  └─ 备份清单.json、备份说明.txt
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {supportsDirectory() && (
                  <Button
                    variant="primary"
                    icon={FolderOpen}
                    loading={running}
                    onClick={() => void doBackup('folder')}
                  >
                    选择文件夹并备份
                  </Button>
                )}
                <Button
                  variant={supportsDirectory() ? 'ghost' : 'primary'}
                  icon={FileArchive}
                  loading={running}
                  onClick={() => void doBackup('zip')}
                >
                  打包下载 ZIP
                </Button>
                <Button icon={HardDriveDownload} loading={running} onClick={() => void doBackup('download')}>
                  下载到默认目录
                </Button>
                {running && <Button onClick={() => (stopRef.current = true)}>停止</Button>}
              </div>

              <p className="text-[11px] leading-relaxed text-slate-400">
                {supportsDirectory() ? (
                  <>
                    「选择文件夹并备份」可直接写入你指定的文件夹；「打包下载 ZIP」把全部文件打成一个 zip
                    一次性下载，适合浏览器限制或只想拿一个文件的场景；「下载到默认目录」会把 CSV / JSON
                    拆成多个文件，浏览器可能询问是否允许下载多个文件。
                  </>
                ) : (
                  <>
                    当前环境（http 明文访问）不支持直接写入文件夹，请用
                    <b className="text-slate-500">「打包下载 ZIP」</b>
                    ——所有数据文件与附件会打包成一个 zip 下载，解压后目录结构与「选择文件夹」完全一致。
                  </>
                )}
              </p>
            </div>
          </div>

          {/* ------------------------------ 进度 ------------------------------ */}
          {(running || logs.length > 0) && (
            <div className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  {running ? '正在备份…' : '备份过程'}
                </p>
                {result && (
                  <Badge tone={result.ok ? (result.warnings.length ? 'amber' : 'emerald') : 'rose'}>
                    {result.ok ? (result.warnings.length ? '完成（有提醒）' : '已完成') : '失败'}
                  </Badge>
                )}
              </div>

              <div className="mt-2.5">
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                  <span>{progress.label || '准备中…'}</span>
                  <span className="num">
                    {progress.done}/{progress.total}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-cyan-400 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              {result && (
                <p className={cx('mt-2.5 text-xs', result.ok ? 'text-slate-600' : 'text-rose-600')}>
                  {result.text}
                </p>
              )}

              {result?.warnings.length ? (
                <div className="mt-2 max-h-24 overflow-y-auto rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700">
                  {result.warnings.map((w) => (
                    <p key={w}>· {w}</p>
                  ))}
                </div>
              ) : null}

              <div
                ref={logRef}
                className="mt-2.5 max-h-40 overflow-y-auto rounded-lg bg-slate-900/95 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-300"
              >
                {logs.length === 0 && <p className="text-slate-500">等待开始…</p>}
                {logs.map((l, i) => (
                  <p key={`${i}-${l}`} className="whitespace-pre-wrap">
                    {l}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* ---------------------------- 备份记录 ---------------------------- */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <History size={15} className="text-slate-400" />
                <p className="text-sm font-semibold text-slate-800">三、备份与还原记录</p>
              </div>
              <Button onClick={() => void loadHistory()}>刷新</Button>
            </div>
            {history.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-400">暂无备份记录</p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">时间</th>
                      <th className="px-3 py-2 font-medium">类型</th>
                      <th className="px-3 py-2 font-medium">操作人</th>
                      <th className="px-3 py-2 font-medium">内容</th>
                      <th className="px-3 py-2 text-right font-medium">行数</th>
                      <th className="px-3 py-2 font-medium">方式</th>
                      <th className="px-3 py-2 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={String(h.id)} className="border-t border-slate-100 text-slate-600">
                        <td className="whitespace-nowrap px-3 py-2">
                          {String(h.created_at ?? '').replace('T', ' ').slice(0, 16)}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={h.kind === '还原导入' ? 'violet' : 'brand'}>{h.kind ?? '备份'}</Badge>
                        </td>
                        <td className="px-3 py-2">{h.operator_name ?? '—'}</td>
                        <td className="max-w-[220px] truncate px-3 py-2" title={String(h.detail ?? '')}>
                          {h.table_count ?? 0} 张表 · {String(h.detail ?? '').split('、').slice(0, 3).join('、')}
                          {String(h.detail ?? '').split('、').length > 3 ? '…' : ''}
                        </td>
                        <td className="num px-3 py-2 text-right">{h.row_count ?? 0}</td>
                        <td className="px-3 py-2">
                          {h.format ?? '—'}
                          {String(h.include_files ?? '').startsWith('是') && (
                            <span className="ml-1 text-[10px] text-brand-500">含附件</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={h.status === '已完成' ? 'emerald' : h.status === '部分完成' ? 'amber' : 'slate'}>
                            {h.status ?? '已完成'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[11px] leading-relaxed text-slate-500">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-500" />
            <span>
              备份数据直接写入你本机选择的文件夹，不经过第三方；导出的数据请妥善保管。
              当前系统：{APP_NAME.replace(APP_REGION, '')}（{APP_REGION}）。
            </span>
          </div>
        </div>
      </div>

      {/* --------------------------- 从备份还原导入 --------------------------- */}
      <div className="card mt-3 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">四、从备份还原导入</p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              选择备份出来的文件即可导回系统：Excel 工作簿、每张表的 CSV / JSON 都能识别，可一次多选
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="primary"
              icon={Upload}
              onClick={() => fileRef.current?.click()}
              disabled={importing || parsing}
              loading={parsing}
            >
              选择备份文件
            </Button>
            {files.length > 0 && (
              <Button icon={X} onClick={clearFiles} disabled={importing}>
                清空
              </Button>
            )}
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".xlsx,.xls,.csv,.tsv,.json"
          className="hidden"
          onChange={(e) => void pickFiles(Array.from(e.target.files ?? []))}
        />

        <div className="grid grid-cols-1 gap-4 px-4 py-3.5 lg:grid-cols-[1.15fr_1fr]">
          {/* 识别结果 */}
          <div>
            {files.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 px-4 py-9 text-center text-xs leading-relaxed text-slate-400">
                还没有选择文件。
                <br />
                备份目录里「数据」文件夹下的 Excel 工作簿，或每张表的 CSV / JSON 文件，都可以直接选来导入。
              </div>
            ) : (
              <>
                <p className="mb-1.5 text-[11px] text-slate-400">
                  已选 {files.length} 个文件，识别到 <b className="text-slate-600">{parsed?.entries.length ?? 0}</b> 张表、
                  <b className="text-slate-600">{importRows}</b> 行数据
                </p>
                <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">来源</th>
                        <th className="px-3 py-2 font-medium">识别为</th>
                        <th className="px-3 py-2 text-right font-medium">行数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(parsed?.entries ?? []).map((e) => (
                        <tr key={e.source} className="border-t border-slate-100 text-slate-600">
                          <td className="max-w-[250px] truncate px-3 py-1.5" title={e.source}>
                            {e.source}
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            {e.label}
                            <span className="ml-1 text-[10px] text-slate-400">{e.table}</span>
                          </td>
                          <td className="num px-3 py-1.5 text-right">{e.rows.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!!parsed?.unknown.length && (
                  <p className="mt-2 text-[11px] text-amber-600">
                    未识别、将跳过：{parsed.unknown.join('、')}
                  </p>
                )}
                {!!parsed?.errors.length && (
                  <p className="mt-1 text-[11px] text-rose-500">解析失败：{parsed.errors.join('；')}</p>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                  说明：系统的数据主键由数据库自动编号，还原时会重新编号，并按采购订单号、入库单号、出库单号、
                  物资分类编码、团队名称等业务键自动把明细数据重新挂接到对应主表。
                </p>
              </>
            )}
          </div>

          {/* 导入方式与执行 */}
          <div className="space-y-3">
            <Field label="导入方式">
              <div className="space-y-1.5">
                {(
                  [
                    {
                      value: 'append',
                      label: '仅新增（推荐）',
                      desc: '把备份里的数据追加进系统，不影响现有记录',
                    },
                    {
                      value: 'replace',
                      label: '覆盖导入',
                      desc: '先清空所选表的现有数据，再完整导入备份内容',
                    },
                  ] as const
                ).map((m) => (
                  <label
                    key={m.value}
                    className={cx(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs transition',
                      mode === m.value
                        ? 'border-brand-200 bg-brand-50/60'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    )}
                  >
                    <input
                      type="radio"
                      name="import-mode"
                      checked={mode === m.value}
                      disabled={importing}
                      onChange={() => setMode(m.value)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand-500"
                    />
                    <span className="leading-relaxed">
                      <span className="font-medium text-slate-700">{m.label}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">{m.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>

            {mode === 'replace' && (
              <div className="rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2.5 text-[11px] leading-relaxed text-rose-600">
                <p className="flex items-start gap-1.5 font-medium">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  覆盖导入会删除所选表里的现有数据，且不可撤销。
                </p>
                <p className="mt-1 pl-5">
                  若所选表包含主表（采购订单、入库单、出库单、团队、物资分类），其明细数据会被级联删除，
                  建议主表与明细表一起导入；操作前建议先做一次完整备份。
                </p>
                <label className="mt-2 flex cursor-pointer items-center gap-2 pl-5 text-rose-700">
                  <input
                    type="checkbox"
                    checked={ackReplace}
                    disabled={importing}
                    onChange={(e) => setAckReplace(e.target.checked)}
                    className="h-3.5 w-3.5 accent-rose-500"
                  />
                  我已了解，同意覆盖导入
                </label>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                icon={DatabaseBackup}
                loading={importing}
                disabled={!parsed?.entries.length || (mode === 'replace' && !ackReplace)}
                onClick={() => void doImport()}
              >
                开始导入
              </Button>
              {importing && <Button onClick={() => (stopRef.current = true)}>停止</Button>}
            </div>

            {(importing || importLogs.length > 0) && (
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                  <span>{importProgress.label || '准备中…'}</span>
                  <span className="num">
                    {importProgress.done}/{importProgress.total}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-cyan-400 transition-all"
                    style={{ width: `${importPct}%` }}
                  />
                </div>

                {importResult && (
                  <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                    导入完成：成功 <b className="text-emerald-600">{importResult.inserted}</b> 行
                    {importResult.deleted ? `，清空 ${importResult.deleted} 行` : ''}
                    {importResult.failed ? `，失败 ${importResult.failed} 行` : ''}
                    {importResult.skipped ? `，跳过 ${importResult.skipped} 行` : ''}。
                    {!!importResult.warnings.length && (
                      <span className="mt-1 block max-h-20 overflow-y-auto text-amber-600">
                        {importResult.warnings.slice(0, 20).map((w) => (
                          <span key={w} className="block">
                            · {w}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                )}

                <div
                  ref={importLogRef}
                  className="mt-2 max-h-36 overflow-y-auto rounded-lg bg-slate-900/95 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-300"
                >
                  {importLogs.length === 0 && <p className="text-slate-500">等待开始…</p>}
                  {importLogs.map((l, i) => (
                    <p key={`${i}-${l}`} className="whitespace-pre-wrap">
                      {l}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 兼容旧浏览器：无目录写入能力时以「打包下载 / 下载」为主 */}
      {!supportsDirectory() && (
        <p className="mt-3 text-[11px] text-slate-400">
          提示：需要「备份到指定文件夹」时，可用 Chrome / Edge 并通过 https（或 localhost）打开本系统；
          用 http 地址访问时请用「打包下载 ZIP」，效果等同。
        </p>
      )}
    </div>
  )
}
