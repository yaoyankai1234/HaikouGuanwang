import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Table2,
  UploadCloud,
} from 'lucide-react'
import { Badge, Button, Modal, cx, useUI } from './ui'
import { errText, insertRows } from '../lib/db'
import {
  commitImport,
  downloadBadRows,
  downloadTemplate,
  parseImportFile,
  problemType,
  type ImportPreview,
  type ImportSpec,
} from '../lib/importRows'

const PREVIEW_LIMIT = 200

/**
 * 批量导入弹窗：下载模板 → 上传 → 自动校验重复与异常 → 确认导入。
 * 未通过的行可一键导出为 Excel（含问题说明）供修正后重传。
 */
export function ImportModal({
  open,
  spec,
  onClose,
  onDone,
}: {
  open: boolean
  spec: ImportSpec | null
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const { toast } = useUI()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [tab, setTab] = useState<'valid' | 'bad'>('valid')

  useEffect(() => {
    if (!open) return
    setPreview(null)
    setParsing(false)
    setImporting(false)
    setDragging(false)
    setTab('valid')
    if (inputRef.current) inputRef.current.value = ''
  }, [open])

  const pick = useCallback(
    async (file: File | null | undefined) => {
      if (!file || !spec) return
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
        toast('只支持 .xlsx / .xls / .csv 格式', 'error')
        return
      }
      setParsing(true)
      try {
        const res = await parseImportFile(file, spec)
        setPreview(res)
        setTab(res.valid.length ? 'valid' : 'bad')
        if (res.missing.length) {
          toast(`模板缺少必填列：${res.missing.join('、')}`, 'error')
        } else if (res.bad.length) {
          toast(`解析 ${res.total} 行：可导入 ${res.valid.length} 条，未通过 ${res.bad.length} 条`, 'info')
        } else {
          toast(`解析完成：${res.valid.length} 条数据全部通过校验`, 'success')
        }
      } catch (e: any) {
        setPreview(null)
        toast(e?.message || '文件解析失败', 'error')
      } finally {
        setParsing(false)
      }
    },
    [spec, toast]
  )

  const doImport = async () => {
    if (!spec || !preview?.valid.length) return
    setImporting(true)
    try {
      const r = await commitImport(spec, preview.valid, insertRows)
      if (r.message) {
        toast(`已导入 ${r.ok} 条；第 ${r.failedAt} 行起的批次写入失败：${r.message}`, 'error')
      } else {
        toast(`成功导入 ${r.ok} 条${spec.title}数据`, 'success')
      }
      if (r.ok) await onDone()
      if (r.message) {
        // 部分失败时保留未处理的行，方便用户导出后核对
        setPreview({ ...preview, bad: [...preview.bad, ...preview.valid.slice(r.ok)] })
      } else {
        onClose()
      }
    } catch (e: any) {
      toast(errText(e), 'error')
    } finally {
      setImporting(false)
    }
  }

  if (!spec) return null

  const valid = preview?.valid ?? []
  const bad = preview?.bad ?? []
  const dupCount = bad.filter((r) => r.dup.length).length
  const errCount = bad.filter((r) => r.errors.length).length
  const list = tab === 'valid' ? valid : bad
  const shown = list.slice(0, PREVIEW_LIMIT)
  const canImport = valid.length > 0 && !importing

  return (
    <Modal
      open={open}
      onClose={importing ? () => {} : onClose}
      title={`批量导入${spec.title}`}
      subtitle="先下载模板填写，再上传；系统会自动校验重复与异常数据，通过的记录可一键导入"
      width="max-w-5xl"
      footer={
        <>
          <Button
            icon={Download}
            onClick={() => {
              downloadTemplate(spec)
              toast('模板已下载，请按「填写说明」页填写', 'success')
            }}
          >
            下载导入模板
          </Button>
          {bad.length > 0 && (
            <Button
              icon={Download}
              onClick={() => {
                downloadBadRows(spec, bad)
                toast(`已导出 ${bad.length} 条未通过数据，修正后可重新上传`, 'success')
              }}
            >
              下载未通过数据（{bad.length}）
            </Button>
          )}
          <Button onClick={onClose} disabled={importing}>
            取消
          </Button>
          <Button variant="primary" loading={importing} disabled={!canImport} onClick={() => void doImport()}>
            确认导入 {valid.length} 条
          </Button>
        </>
      }
    >
      {/* 操作指引 */}
      <ol className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">
        <li className="flex items-center gap-1.5">
          <Step n={1} /> 下载模板并填写
        </li>
        <ArrowRight size={12} className="text-slate-300" />
        <li className="flex items-center gap-1.5">
          <Step n={2} /> 上传文件自动校验
        </li>
        <ArrowRight size={12} className="text-slate-300" />
        <li className="flex items-center gap-1.5">
          <Step n={3} /> 确认导入通过的数据
        </li>
      </ol>

      {/* 上传区 */}
      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void pick(e.dataTransfer.files?.[0])
        }}
        className={cx(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-7 text-center transition',
          dragging
            ? 'border-brand-400 bg-brand-50/70'
            : preview
              ? 'border-slate-200 bg-white hover:border-brand-300'
              : 'border-slate-200 bg-slate-50/60 hover:border-brand-300 hover:bg-brand-50/40'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <span
          className={cx(
            'flex h-11 w-11 items-center justify-center rounded-full',
            preview ? 'bg-emerald-50 text-emerald-500' : 'bg-brand-50 text-brand-500'
          )}
        >
          {parsing ? (
            <Table2 size={20} className="animate-pulse" />
          ) : preview ? (
            <FileSpreadsheet size={20} />
          ) : (
            <UploadCloud size={20} />
          )}
        </span>
        <div className="text-sm font-medium text-slate-700">
          {parsing ? '正在解析文件…' : preview ? preview.fileName : '点击选择文件，或把文件拖到这里'}
        </div>
        <div className="text-xs text-slate-400">
          支持 .xlsx / .xls / .csv{preview ? ' · 重新选择可替换当前文件' : ' · 请使用上方模板，勿改动表头'}
        </div>
      </label>

      {/* 缺少必填列 */}
      {preview?.missing.length ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-600">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">文件表头不完整，无法校验</p>
            <p className="mt-1">
              缺少必填列：{preview.missing.join('、')}。请重新下载模板填写，勿改动表头文字。
            </p>
          </div>
        </div>
      ) : null}

      {/* 校验结果 */}
      {preview && !preview.missing.length && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Chip label="文件总行数" value={preview.total} tone="slate" />
            <Chip label="可导入" value={valid.length} tone="emerald" />
            <Chip label="未通过" value={bad.length} tone={bad.length ? 'rose' : 'slate'} />
            {dupCount > 0 && <Chip label="其中重复" value={dupCount} tone="amber" />}
            {errCount > 0 && <Chip label="其中异常" value={errCount} tone="rose" />}
            <div className="ml-auto flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
              <TabBtn active={tab === 'valid'} onClick={() => setTab('valid')}>
                可导入 {valid.length}
              </TabBtn>
              <TabBtn active={tab === 'bad'} onClick={() => setTab('bad')}>
                未通过 {bad.length}
              </TabBtn>
            </div>
          </div>

          {list.length === 0 ? (
            <div className="mt-3 flex flex-col items-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-8 text-center">
              {tab === 'valid' ? (
                <>
                  <AlertTriangle size={20} className="text-amber-400" />
                  <p className="text-sm text-slate-600">没有可导入的数据</p>
                  <p className="text-xs text-slate-400">
                    请切到「未通过」查看原因，或下载未通过数据修正后重新上传
                  </p>
                </>
              ) : (
                <>
                  <CheckCircle2 size={20} className="text-emerald-400" />
                  <p className="text-sm text-slate-600">全部数据均通过校验</p>
                  <p className="text-xs text-slate-400">可以直接点击右下角「确认导入」</p>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="mt-3 max-h-[38vh] overflow-auto rounded-xl border border-slate-100">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-slate-200">
                      <th className="th w-16 bg-slate-50 text-center">行号</th>
                      {spec.columns.map((c) => (
                        <th key={c.key} className="th whitespace-nowrap bg-slate-50">
                          {c.label}
                        </th>
                      ))}
                      {tab === 'bad' && <th className="th min-w-[240px] bg-slate-50">问题说明</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.rowNo} className="border-b border-slate-50 last:border-0">
                        <td className="td text-center text-slate-400">{r.rowNo}</td>
                        {spec.columns.map((c) => (
                          <td key={c.key} className="td whitespace-nowrap text-slate-700">
                            {r.data[c.key] === '' || r.data[c.key] === undefined || r.data[c.key] === null ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              String(r.data[c.key])
                            )}
                          </td>
                        ))}
                        {tab === 'bad' && (
                          <td className="td">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge tone={problemType(r) === 'error' ? 'rose' : problemType(r) === 'dup' ? 'amber' : 'violet'}>
                                {problemType(r) === 'error' ? '异常' : problemType(r) === 'dup' ? '重复' : '重复+异常'}
                              </Badge>
                              <span className="text-rose-500">{[...r.dup, ...r.errors].join('；')}</span>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {list.length > PREVIEW_LIMIT
                  ? `共 ${list.length} 行，此处仅预览前 ${PREVIEW_LIMIT} 行；完整数据请导出查看。`
                  : `共 ${list.length} 行。`}
                {tab === 'bad' && bad.length > 0 ? ' 未通过的数据可导出为 Excel 修正后重新上传。' : ''}
              </p>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
function Step({ n }: { n: number }) {
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-brand-600 ring-1 ring-brand-100">
      {n}
    </span>
  )
}

function Chip({ label, value, tone }: { label: string; value: number; tone: string }) {
  const map: Record<string, string> = {
    slate: 'border-slate-200 bg-white text-slate-600',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-600',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
  }
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs', map[tone])}>
      {label}
      <b className="text-sm tabular-nums">{value}</b>
    </span>
  )
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'rounded-md px-2.5 py-1 text-xs font-medium transition',
        active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
      )}
    >
      {children}
    </button>
  )
}
