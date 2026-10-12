import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import {
  Button,
  Badge,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Textarea,
  useUI,
  cx,
} from './ui'
import { DataTable, type Column } from './DataTable'
import { ImportModal } from './ImportModal'
import { FilterBar, hasActiveFilters, matchFilters } from './Filters'
import type { ImportSpec } from '../lib/importRows'
import { useAuth } from '../store/auth'
import { useData } from '../store/data'
import { deleteRow, deleteRows, errText, insertRow, selectAll, updateRow, type Row } from '../lib/db'
import { exportExcel } from '../lib/export'
import { clampNonNegative, money, moneyText, num, numText, sanitizeNumericInput, today } from '../lib/format'
import { STATUS_TONE } from '../lib/options'
import {
  fieldExportColumns,
  findRefRow,
  nameKeysOf,
  refLabel,
  refNameValue,
  refOptions,
  withNameKeys,
  type FieldDef,
  type FilterDef,
  type RefName,
} from '../lib/fields'

export { fieldExportColumns, findRefRow, refLabel, refOptions }
export type { FieldDef, FilterDef, RefName }

export function exportRows(fileName: string, fields: FieldDef[], rows: Row[], sheetName = '数据') {
  exportExcel(fileName, fieldExportColumns(fields), rows, sheetName)
}

/** 通用表格页：搜索 + 筛选 + 排序 + 分页 + 表单弹窗 + 导出 */
export function CrudPage({
  title,
  subtitle,
  icon,
  table,
  module,
  fields,
  columns: customColumns,
  orderBy = 'id',
  orderAsc = false,
  searchKeys,
  searchPlaceholder,
  filters = [],
  exportName,
  exportSheet,
  newLabel = '新建',
  defaults = {},
  beforeSave,
  rowActions,
  extraToolbar,
  formWidth = 'max-w-3xl',
  onChanged,
  noCreate = false,
  noExport = false,
  initialFilters,
  summaryText,
  topSlot,
  importSpec,
}: {
  title: string
  subtitle?: string
  icon?: React.ComponentType<{ size?: number | string; className?: string }>
  table: string
  module: string
  fields: FieldDef[]
  columns?: Column[]
  orderBy?: string
  orderAsc?: boolean
  searchKeys: string[]
  searchPlaceholder?: string
  filters?: FilterDef[]
  exportName: string
  exportSheet?: string
  newLabel?: string
  defaults?: Row
  beforeSave?: (form: Row, isNew: boolean, rows: Row[], editingId?: number | string) => Row
  rowActions?: (row: Row, helpers: RowActions) => React.ReactNode
  extraToolbar?: React.ReactNode
  formWidth?: string
  onChanged?: () => void
  noCreate?: boolean
  noExport?: boolean
  initialFilters?: Record<string, string>
  summaryText?: (rows: Row[]) => React.ReactNode
  /** 表格上方的自定义区域（如金额统计面板），入参为当前筛选后的行 */
  topSlot?: (rows: Row[]) => React.ReactNode
  /** 配置后显示「批量导入」：入参为当前表全部记录，用于查重与引用解析 */
  importSpec?: (rows: Row[]) => ImportSpec
}) {
  const data = useData()
  const { canEdit } = useAuth()
  const { toast, confirm } = useUI()
  const writable = canEdit(module)

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [filterVals, setFilterVals] = useState<Record<string, string>>(initialFilters ?? {})
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [form, setForm] = useState<Row>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [selected, setSelected] = useState<(number | string)[]>([])
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (initialFilters) setFilterVals((prev) => ({ ...prev, ...initialFilters }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialFilters ?? {})])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await selectAll(table, { order: orderBy, asc: orderAsc })
      setRows(res)
    } catch (e: any) {
      toast(errText(e), 'error')
    } finally {
      setLoading(false)
    }
  }, [table, orderBy, orderAsc, toast])

  useEffect(() => {
    void load()
  }, [load])

  const setValue = useCallback((key: string, v: any) => {
    setForm((prev) => ({ ...prev, [key]: v }))
  }, [])

  const openNew = () => {
    setEditing(null)
    setError(null)
    const init: Row = {}
    fields.forEach((f) => {
      if (f.default !== undefined) init[f.key] = f.default
      else if (f.type === 'date' && f.inForm !== false) init[f.key] = today()
      else if ((f.type === 'number' || f.type === 'money') && f.inForm !== false) init[f.key] = 0
    })
    setForm(init)
    setOpen(true)
  }

  const openEdit = (row: Row) => {
    setEditing(row)
    setError(null)
    const init: Row = {}
    fields.forEach((f) => {
      init[f.key] = row[f.key] ?? (f.type === 'number' || f.type === 'money' ? 0 : '')
    })
    // 引用字段的名称列一并带入表单，保存时原样回写，避免编辑后名称丢失
    nameKeysOf(fields).forEach((k) => {
      init[k] = row[k] ?? ''
    })
    setForm(init)
    setOpen(true)
  }

  const remove = async (row: Row) => {
    const ok = await confirm({
      title: '确认删除该记录？',
      desc: '删除后不可恢复，且与之关联的明细数据会一并移除。',
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteRow(table, row.id)
      toast('已删除', 'success')
      setSelected([])
      await load()
      onChanged?.()
    } catch (e: any) {
      toast(errText(e), 'error')
    }
  }

  /** 批量删除：一次确认、一次请求，逐条核对删除结果 */
  const removeMany = async (targets: Row[]) => {
    if (!targets.length) return
    const ok = await confirm({
      title: `确认删除选中的 ${targets.length} 条记录？`,
      desc: `将一次性删除 ${title}里的 ${targets.length} 条数据，删除后不可恢复，与之关联的明细数据也会一并移除。`,
      confirmText: `删除 ${targets.length} 条`,
      danger: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      const ids = targets.map((r) => r.id).filter((v) => v !== null && v !== undefined)
      const res = await deleteRows(table, ids)
      const skipped = res.skipped?.length ?? 0
      toast(
        skipped
          ? `已删除 ${res.deleted} 条，跳过 ${skipped} 条（可能已被其他操作移除）`
          : `已删除 ${res.deleted} 条记录`,
        res.deleted ? 'success' : 'error'
      )
      setSelected([])
      await load()
      onChanged?.()
    } catch (e: any) {
      toast(errText(e), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const submit = async () => {
    const missing = fields.filter(
      (f) =>
        f.inForm !== false &&
        (!f.visibleWhen || f.visibleWhen(form)) &&
        f.required &&
        (form[f.key] === '' || form[f.key] === null || form[f.key] === undefined)
    )
    if (missing.length) {
      setError(`请填写：${missing.map((f) => f.label).join('、')}`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload: Row = {}
      fields.forEach((f) => {
        if (f.type === 'readonly' || f.key.startsWith('__')) return
        // 隐藏字段（如附件名）只在表单状态中确实存在时才提交，避免覆盖既有数据
        const present = Object.prototype.hasOwnProperty.call(form, f.key)
        if (f.inForm === false && !present) return
        let v = form[f.key]
        if (v === undefined || v === '') v = null
        if (v !== null && (f.type === 'number' || f.type === 'money')) v = clampNonNegative(v)
        if (v !== null && f.type === 'ref') v = Number(v)
        if (f.type === 'date' && v) v = String(v).slice(0, 10)
        payload[f.key] = v
      })
      withNameKeys(payload, form, fields)
      const finalPayload = beforeSave ? beforeSave({ ...payload }, !editing, rows, editing?.id) : payload
      if (editing) await updateRow(table, editing.id, finalPayload)
      else await insertRow(table, finalPayload)
      toast(editing ? '已保存修改' : '已新建记录', 'success')
      setOpen(false)
      await load()
      onChanged?.()
    } catch (e: any) {
      setError(errText(e))
    } finally {
      setSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return rows.filter((r) => {
      if (!matchFilters(r, filters, filterVals)) return false
      if (!kw) return true
      return searchKeys.some((k) =>
        String(r[k] ?? '')
          .toLowerCase()
          .includes(kw)
      )
    })
  }, [rows, keyword, filterVals, searchKeys, filters])

  /** 选中项与当前筛选结果取交集：筛选后看不见的记录不会被误删 */
  const selectedRows = useMemo(() => {
    const s = new Set(selected.map((v) => String(v)))
    return filtered.filter((r) => s.has(String(r.id)))
  }, [filtered, selected])

  const columns: Column[] = useMemo(() => {
    const base: Column[] =
      customColumns ??
      fields
        .filter((f) => f.inTable !== false)
        .map((f) => ({
          key: f.key,
          label: f.label,
          width: f.width,
          align: f.align,
          sortValue: (row: Row) =>
            f.sortValue
              ? f.sortValue(row)
              : f.type === 'money' || f.type === 'number'
                ? Number(row[f.key]) || 0
                : f.type === 'ref'
                  ? (refLabel(f, row, data) ?? '')
                  : String(row[f.key] ?? ''),
          render: (row: Row) => {
            if (f.tableRender) return f.tableRender(row, data)
            const v = row[f.key]
            if (f.type === 'ref') {
              const text = refLabel(f, row, data)
              return text ? (
                <span className="whitespace-nowrap" title={text}>
                  {text}
                </span>
              ) : (
                <span className="text-slate-300">—</span>
              )
            }
            if (v === null || v === undefined || v === '') return <span className="text-slate-300">—</span>
            if (f.type === 'money')
              return <span className="num">{moneyText(v)}</span>
            if (f.type === 'number')
              return <span className="num">{numText(v)}</span>
            if (f.badge)
              return <Badge tone={STATUS_TONE[String(v)] ?? 'slate'}>{String(v)}</Badge>
            return String(v)
          },
        }))
    const withActions: Column[] = rowActions
      ? [
          ...base,
          {
            key: '__actions',
            label: '操作',
            align: 'right',
            width: 132,
            render: (row: Row) => (
              <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {rowActions(row, { edit: openEdit, remove, refresh: load, writable })}
                {writable && (
                  <>
                    <button
                      title="编辑"
                      onClick={() => openEdit(row)}
                      className="rounded-md p-1.5 text-slate-400 transition hover:bg-brand-50 hover:text-brand-600"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      title="删除"
                      onClick={() => remove(row)}
                      className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            ),
          },
        ]
      : writable
        ? [
            ...base,
            {
              key: '__actions',
              label: '操作',
              align: 'right',
              width: 92,
              render: (row: Row) => (
                <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    title="编辑"
                    onClick={() => openEdit(row)}
                    className="rounded-md p-1.5 text-slate-400 transition hover:bg-brand-50 hover:text-brand-600"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    title="删除"
                    onClick={() => remove(row)}
                    className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ),
            },
          ]
        : base
    return withActions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, customColumns, data, rowActions, writable])

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={
          <>
            <Button icon={RefreshCw} onClick={() => void load()} title="刷新">
              刷新
            </Button>
            {writable && importSpec && (
              <Button icon={Upload} onClick={() => setImportOpen(true)}>
                批量导入
              </Button>
            )}
            {!noExport && (
              <Button
                icon={Download}
                onClick={() => {
                  if (!filtered.length) return toast('当前没有可导出的数据', 'info')
                  exportRows(exportName, fields, filtered, exportSheet ?? exportName)
                  toast(`已导出 ${filtered.length} 条数据`, 'success')
                }}
              >
                导出 Excel
              </Button>
            )}
            {writable && !noCreate && (
              <Button variant="primary" icon={Plus} onClick={openNew}>
                {newLabel}
              </Button>
            )}
          </>
        }
      />

      {topSlot && <div className="mb-4">{topSlot(filtered)}</div>}

      <DataTable
        columns={columns}
        rows={filtered}
        loading={loading}
        emptyTitle={`暂无${title}数据`}
        emptyDesc={writable ? '点击右上角新建按钮添加第一条记录' : '当前角色为只读，请联系管理员录入数据'}
        toolbar={
          <>
            <SearchInput
              value={keyword}
              onChange={setKeyword}
              placeholder={searchPlaceholder ?? '搜索…'}
              className="w-full sm:w-72"
            />
            <FilterBar
              filters={filters}
              values={filterVals}
              data={data}
              onChange={(k, v) => setFilterVals((p) => ({ ...p, [k]: v }))}
            />
            {hasActiveFilters(filterVals, keyword) ? (
              <Button
                variant="text"
                onClick={() => {
                  setKeyword('')
                  setFilterVals({})
                }}
              >
                重置
              </Button>
            ) : null}
            {extraToolbar}
          </>
        }
        summary={summaryText ? summaryText(filtered) : null}
        selectable={writable}
        selectedIds={selected}
        onSelectionChange={setSelected}
        batchBar={
          <>
            <span className="text-xs text-slate-600">
              已选 <b className="text-brand-600">{selectedRows.length}</b> 条
            </span>
            <Button
              variant="danger"
              icon={Trash2}
              loading={deleting}
              onClick={() => void removeMany(selectedRows)}
            >
              批量删除
            </Button>
            <Button variant="text" onClick={() => setSelected([])} disabled={deleting}>
              取消选择
            </Button>
            <span className="text-[11px] text-slate-400">勾选作用于当前筛选出来的全部记录，不只当前页</span>
          </>
        }
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `编辑${title}` : newLabel}
        subtitle={editing ? '修改后点击保存生效' : '带 * 的为必填项'}
        width={formWidth}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()}>
              保存
            </Button>
          </>
        }
      >
        {error && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          {fields
            .filter((f) => f.inForm !== false && (!f.visibleWhen || f.visibleWhen(form)))
            .map((f) => (
              <Field
                key={f.key}
                label={f.label}
                required={f.required}
                hint={f.hint}
                className={cx(f.span === 2 && 'sm:col-span-2')}
              >
                {f.formRender ? (
                  f.formRender(form, setValue)
                ) : f.type === 'textarea' ? (
                  <Textarea
                    value={form[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setValue(f.key, e.target.value)}
                  />
                ) : f.type === 'select' ? (
                  <Select value={form[f.key] ?? ''} onChange={(e) => setValue(f.key, e.target.value)}>
                    <option value="">请选择</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                ) : f.type === 'ref' ? (
                  <Select
                    value={form[f.key] === undefined || form[f.key] === null ? '' : String(form[f.key])}
                    onChange={(e) => {
                      const id = e.target.value
                      const raw = id ? findRefRow(f.ref!, id, data) : undefined
                      setForm((prev) => {
                        let next: Row = { ...prev, [f.key]: id === '' ? null : Number(id) }
                        if (raw) {
                          if (f.nameKey) next[f.nameKey] = refNameValue(f, raw)
                          if (f.onRefPick) next = { ...next, ...f.onRefPick(raw, next, data) }
                        } else if (f.nameKey) {
                          next[f.nameKey] = null
                        }
                        return next
                      })
                    }}
                  >
                    <option value="">请选择</option>
                    {refOptions(f.ref!, data).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : f.type === 'readonly' ? (
                  <div className="input flex cursor-not-allowed items-center bg-slate-50 text-slate-500">
                    {form[f.key] || '—'}
                  </div>
                ) : (
                  <Input
                    type={f.type === 'date' ? 'date' : f.type === 'text' ? 'text' : 'number'}
                    step={f.step ?? (f.type === 'money' ? '0.01' : 'any')}
                    min={f.type === 'number' || f.type === 'money' ? 0 : undefined}
                    value={form[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) =>
                      setValue(
                        f.key,
                        f.type === 'number' || f.type === 'money'
                          ? sanitizeNumericInput(e.target.value, form[f.key])
                          : e.target.value
                      )
                    }
                  />
                )}
              </Field>
            ))}
        </div>
      </Modal>

      {importSpec && (
        <ImportModal
          open={importOpen}
          spec={importOpen ? importSpec(rows) : null}
          onClose={() => setImportOpen(false)}
          onDone={async () => {
            await load()
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}

export interface RowActions {
  edit: (row: Row) => void
  remove: (row: Row) => void
  refresh: () => Promise<void> | void
  writable: boolean
}
