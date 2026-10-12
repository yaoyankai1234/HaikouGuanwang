import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Eye, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Textarea,
  cx,
  useUI,
} from './ui'
import { DataTable, type Column } from './DataTable'
import { ItemsEditor, type ItemsMode } from './ItemsEditor'
import { FilterBar, hasActiveFilters, matchFilters } from './Filters'
import { deleteRow, deleteRows, errText, insertRow, insertRows, selectAll, updateRow, type Row } from '../lib/db'
import { exportWorkbook, type ExportColumn } from '../lib/export'
import { clampNonNegative, money, moneyText, num, numText, sanitizeNumericInput, today } from '../lib/format'
import { STATUS_TONE } from '../lib/options'
import {
  findRefRow,
  nameKeysOf,
  refLabel,
  refNameValue,
  refOptions,
  type FieldDef,
  type FilterDef,
} from '../lib/fields'
import { useAuth } from '../store/auth'
import { useData, type DataValue } from '../store/data'

/**
 * 各单据明细表实际存在的列。
 * 不同明细表结构不同（采购订单明细没有合格数量/批次号，出库明细没有单价/金额），
 * 必须按单据类型分别提交，否则会因为写入不存在的列导致整张单据保存失败。
 */
const ITEM_COLUMNS: Record<ItemsMode, string[]> = {
  order: [
    'category_id',
    'category_name',
    'material_id',
    'material_name',
    'spec',
    'unit',
    'qty',
    'unit_price',
    'amount',
    'arrived_qty',
    'remark',
  ],
  in: [
    'category_id',
    'category_name',
    'material_id',
    'material_name',
    'spec',
    'unit',
    'qty',
    'qualified_qty',
    'unit_price',
    'amount',
    'batch_no',
    'remark',
  ],
  out: ['category_id', 'category_name', 'material_id', 'material_name', 'spec', 'unit', 'qty', 'remark'],
}

/** 数值列：空值归一为 0 */
const NUM_ITEM_COLUMNS = ['qty', 'unit_price', 'amount', 'arrived_qty']
/** 可空数值列：空值必须保持 null（合格数量留空 = 全部合格，写成 0 会被误判为整批不合格） */
const NULLABLE_NUM_ITEM_COLUMNS = ['qualified_qty']
const ID_ITEM_COLUMNS = ['category_id', 'material_id']

export interface DocPageProps {
  title: string
  subtitle?: string
  icon?: React.ComponentType<{ size?: number | string; className?: string }>
  table: string
  itemTable: string
  fk: string
  module: string
  headerFields: FieldDef[]
  columns: Column[]
  itemsMode: ItemsMode
  searchKeys: string[]
  searchPlaceholder?: string
  filters?: FilterDef[]
  initialFilters?: Record<string, string>
  exportName: string
  newLabel?: string
  defaults?: Row
  deriveTotals?: (items: Row[]) => Row
  beforeSave?: (header: Row, items: Row[], isNew: boolean) => Row | Promise<Row>
  /** 提交前的业务校验，返回错误文案即中止保存（不写入任何数据） */
  validate?: (header: Row, items: Row[], isNew: boolean) => string | null | Promise<string | null>
  decorateItem?: (item: Row, doc: Row) => Row
  itemExportColumns: ExportColumn[]
  headerExportColumns: ExportColumn[]
  summaryText?: (rows: Row[]) => React.ReactNode
  extraRowActions?: (row: Row) => React.ReactNode
  onItemSaved?: (doc: Row, items: Row[]) => Promise<void> | void
  /** 单据号字段名；「保存并继续」时清空该字段以便生成新单号 */
  docNoField?: string
  /** 明细数量的上限（用于入库不得超订单、出库不得超库存） */
  maxQtyFor?: (item: Row, header: Row, items: Row[]) => { max: number; label: string } | null
}

export function DocPage({
  title,
  subtitle,
  icon,
  table,
  itemTable,
  fk,
  module,
  headerFields,
  columns,
  itemsMode,
  searchKeys,
  searchPlaceholder,
  filters = [],
  initialFilters,
  exportName,
  newLabel = '新建单据',
  defaults = {},
  deriveTotals,
  beforeSave,
  validate,
  decorateItem,
  itemExportColumns,
  headerExportColumns,
  summaryText,
  extraRowActions,
  onItemSaved,
  docNoField,
  maxQtyFor,
}: DocPageProps) {
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
  const [items, setItems] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ doc: Row; items: Row[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selected, setSelected] = useState<(number | string)[]>([])
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (initialFilters) setFilterVals((prev) => ({ ...prev, ...initialFilters }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialFilters ?? {})])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await selectAll(table, { order: 'id', asc: false }))
    } catch (e: any) {
      toast(errText(e), 'error')
    } finally {
      setLoading(false)
    }
  }, [table, toast])

  useEffect(() => {
    void load()
  }, [load])

  const loadItems = useCallback(
    async (docId: any): Promise<Row[]> => {
      try {
        return await selectAll(itemTable, { order: 'id', asc: true })
          .then((all) => all.filter((r) => String(r[fk]) === String(docId)))
      } catch {
        return []
      }
    },
    [itemTable, fk]
  )

  const nameKeys = useMemo(() => nameKeysOf(headerFields), [headerFields])

  const freshHeader = useCallback((): Row => {
    const init: Row = { ...defaults }
    headerFields.forEach((f) => {
      if (init[f.key] !== undefined) return
      if (f.default !== undefined) init[f.key] = f.default
      else if (f.type === 'date' && f.inForm !== false) init[f.key] = today()
      else if ((f.type === 'number' || f.type === 'money') && f.inForm !== false) init[f.key] = 0
      else if (f.type === 'select' && f.inForm !== false) init[f.key] = f.options?.[0] ?? ''
    })
    return init
  }, [defaults, headerFields])

  const openNew = () => {
    setEditing(null)
    setError(null)
    setForm(freshHeader())
    setItems([])
    setOpen(true)
  }

  const openEdit = async (doc: Row) => {
    setEditing(doc)
    setError(null)
    const init: Row = {}
    headerFields.forEach((f) => {
      init[f.key] = doc[f.key] ?? (f.type === 'number' || f.type === 'money' ? 0 : '')
    })
    // 引用字段的名称列一并带入表单，保存时原样回写，避免编辑后名称丢失
    nameKeys.forEach((k) => {
      init[k] = doc[k] ?? ''
    })
    setForm(init)
    setItems(await loadItems(doc.id))
    setOpen(true)
  }

  const openDetail = async (doc: Row) => {
    setDetailLoading(true)
    setDetail({ doc, items: [] })
    const its = await loadItems(doc.id)
    setDetail({ doc, items: its })
    setDetailLoading(false)
  }

  const remove = async (doc: Row) => {
    const ok = await confirm({
      title: '确认删除该单据？',
      desc: '单据及其全部明细行都会被删除，且不可恢复。',
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      const items = await loadItems(doc.id)
      await deleteRows(itemTable, items.map((i) => i.id))
      await deleteRow(table, doc.id)
      toast('已删除', 'success')
      setSelected([])
      await load()
      await onItemSaved?.({ ...doc, __deleted: true }, [])
    } catch (e: any) {
      toast(errText(e), 'error')
    }
  }

  /** 批量删除单据：先删各单据明细，再删单据头，最后逐单回调节点/联动刷新 */
  const removeMany = async (docs: Row[]) => {
    if (!docs.length) return
    const ok = await confirm({
      title: `确认删除选中的 ${docs.length} 张单据？`,
      desc: `每张单据的全部明细行都会随之一并删除，且不可恢复。`,
      confirmText: `删除 ${docs.length} 张`,
      danger: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      const idSet = new Set(docs.map((d) => String(d.id)))
      const allItems = await selectAll(itemTable, { order: 'id', asc: true })
      const itemIds = allItems.filter((i) => idSet.has(String(i[fk]))).map((i) => i.id)
      if (itemIds.length) await deleteRows(itemTable, itemIds)
      await deleteRows(table, docs.map((d) => d.id))
      toast(`已删除 ${docs.length} 张单据、${itemIds.length} 条明细`, 'success')
      setSelected([])
      await load()
      for (const d of docs) await onItemSaved?.({ ...d, __deleted: true }, [])
    } catch (e: any) {
      toast(errText(e), 'error')
    } finally {
      setDeleting(false)
    }
  }

  /** 组装单据头提交载荷 */
  const buildPayload = (): Row => {
    const payload: Row = {}
    headerFields.forEach((f) => {
      if (f.type === 'readonly' || f.key.startsWith('__')) return
      const present = Object.prototype.hasOwnProperty.call(form, f.key)
      if (f.inForm === false && !present) return
      let v = form[f.key]
      if (v === undefined || v === '') v = null
      if (v !== null && (f.type === 'number' || f.type === 'money')) v = clampNonNegative(v)
      if (v !== null && f.type === 'ref') v = Number(v)
      if (f.type === 'date' && v) v = String(v).slice(0, 10)
      payload[f.key] = v
    })
    // 引用字段的名称列（关联合同号、供应商名称等）必须一起落库，否则列表只会显示一串数字
    nameKeys.forEach((k) => {
      if (!Object.prototype.hasOwnProperty.call(form, k)) return
      const v = form[k]
      payload[k] = v === undefined || v === '' ? null : v
    })
    return payload
  }

  const submit = async (mode: 'close' | 'continue' = 'close') => {
    const missing = headerFields.filter(
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
    const validItems = items.filter((i) => i.material_id && Number(i.qty) > 0)
    if (!validItems.length) {
      setError('请至少录入一条有效明细（选择商品名称并填写数量）')
      return
    }
    setSaving(true)
    setError(null)
    try {
      let payload = buildPayload()
      if (deriveTotals) payload = { ...payload, ...deriveTotals(validItems) }
      if (beforeSave) payload = await beforeSave(payload, validItems, !editing)
      if (validate) {
        const msg = await validate(payload, validItems, !editing)
        if (msg) {
          setError(msg)
          setSaving(false)
          return
        }
      }

      let docId: any
      if (editing) {
        await updateRow(table, editing.id, payload)
        docId = editing.id
        const existing = await loadItems(docId)
        await deleteRows(itemTable, existing.map((i) => i.id))
      } else {
        const created = await insertRow(table, payload)
        docId = created.id
      }

      const cols = ITEM_COLUMNS[itemsMode]
      const itemPayload = validItems.map((i) => {
        const row: Row = { [fk]: docId }
        cols.forEach((k) => {
          const v = i[k]
          if (NULLABLE_NUM_ITEM_COLUMNS.includes(k))
            row[k] = v === null || v === undefined || v === '' ? null : clampNonNegative(v)
          else if (NUM_ITEM_COLUMNS.includes(k)) row[k] = clampNonNegative(v)
          else if (ID_ITEM_COLUMNS.includes(k))
            row[k] = v === null || v === undefined || v === '' ? null : Number(v)
          else row[k] = v === undefined || v === '' ? null : v
        })
        return row
      })
      await insertRows(itemTable, itemPayload)
      // 等外部联动数据处理完，保证「保存并继续」时单号不重复、进度条即时更新
      await onItemSaved?.({ ...payload, id: docId }, validItems)
      toast(editing ? '单据已更新' : '单据已创建', 'success')

      await load()

      if (mode === 'continue' && !editing) {
        // 保留表头信息便于连续录入，只清空单号与明细
        setForm((prev) => (docNoField ? { ...prev, [docNoField]: '' } : freshHeader()))
        setItems([])
        setError(null)
        toast('已保存，可继续录入下一张', 'success')
      } else {
        setOpen(false)
      }
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

  /** 选中项与当前筛选结果取交集：筛选后看不见的单据不会被误删 */
  const selectedDocs = useMemo(() => {
    const s = new Set(selected.map((v) => String(v)))
    return filtered.filter((r) => s.has(String(r.id)))
  }, [filtered, selected])

  const tableColumns: Column[] = useMemo(() => {
    const base = [...columns]
    base.push({
      key: '__actions',
      label: '操作',
      align: 'right',
      width: writable ? 172 : 128,
      render: (row: Row) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {extraRowActions?.(row)}
          <button
            title="查看明细"
            onClick={() => void openDetail(row)}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <Eye size={14} />
          </button>
          {writable && (
            <>
              <button
                title="编辑"
                onClick={() => void openEdit(row)}
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-brand-50 hover:text-brand-600"
              >
                <Pencil size={14} />
              </button>
              <button
                title="删除"
                onClick={() => void remove(row)}
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      ),
    })
    return base
  }, [columns, writable, extraRowActions])

  const doExport = async () => {
    if (!filtered.length) {
      toast('当前没有可导出的数据', 'info')
      return
    }
    try {
      const allItems = await selectAll(itemTable, { order: 'id', asc: true })
      const byDoc = new Map<string, Row[]>()
      allItems.forEach((i) => {
        const k = String(i[fk])
        if (!byDoc.has(k)) byDoc.set(k, [])
        byDoc.get(k)!.push(i)
      })
      const detail: Row[] = []
      filtered.forEach((doc) => {
        ;(byDoc.get(String(doc.id)) ?? []).forEach((it) => {
          detail.push(decorateItem ? decorateItem(it, doc) : it)
        })
      })
      exportWorkbook(exportName, [
        { name: '单据汇总', columns: headerExportColumns, rows: filtered },
        { name: '物资明细', columns: itemExportColumns, rows: detail },
      ])
      toast(`已导出 ${filtered.length} 张单据、${detail.length} 条明细`, 'success')
    } catch (e: any) {
      toast(errText(e), 'error')
    }
  }

  const setValue = (key: string, v: any) => setForm((prev) => ({ ...prev, [key]: v }))

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={
          <>
            <Button icon={RefreshCw} onClick={() => void load()}>
              刷新
            </Button>
            <Button icon={Download} onClick={() => void doExport()}>
              导出 Excel
            </Button>
            {writable && (
              <Button variant="primary" icon={Plus} onClick={openNew}>
                {newLabel}
              </Button>
            )}
          </>
        }
      />

      <DataTable
        columns={tableColumns}
        rows={filtered}
        loading={loading}
        emptyTitle={`暂无${title}数据`}
        emptyDesc={writable ? '点击右上角新建按钮创建第一张单据' : '当前角色为只读'}
        pageSize={15}
        onRowClick={(row) => void openDetail(row)}
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
          </>
        }
        summary={summaryText ? summaryText(filtered) : null}
        selectable={writable}
        selectedIds={selected}
        onSelectionChange={setSelected}
        batchBar={
          <>
            <span className="text-xs text-slate-600">
              已选 <b className="text-brand-600">{selectedDocs.length}</b> 张单据
            </span>
            <Button
              variant="danger"
              icon={Trash2}
              loading={deleting}
              onClick={() => void removeMany(selectedDocs)}
            >
              批量删除
            </Button>
            <Button variant="text" onClick={() => setSelected([])} disabled={deleting}>
              取消选择
            </Button>
            <span className="text-[11px] text-slate-400">单据的明细行会一并删除</span>
          </>
        }
      />

      {/* 详情 */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={`${title}明细 · ${detail?.doc?.order_no ?? detail?.doc?.in_no ?? detail?.doc?.out_no ?? ''}`}
        subtitle="单据头信息与物资明细"
        width="max-w-5xl"
      >
        {detail && (
          <>
            <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl bg-slate-50/70 p-4 sm:grid-cols-3">
              {headerFields
                .filter((f) => f.inForm !== false && f.key !== 'remark' && (!f.visibleWhen || f.visibleWhen(detail.doc)))
                .map((f) => (
                  <div key={f.key}>
                    <p className="text-[11px] text-slate-400">{f.label}</p>
                    <p className="mt-0.5 text-sm text-slate-700">
                      {renderFieldValue(f, detail.doc, data)}
                    </p>
                  </div>
                ))}
            </div>
            <ItemsEditor items={detail.items} onChange={() => {}} mode={itemsMode} readonly />
            {detailLoading && <p className="mt-3 text-center text-xs text-slate-400">明细加载中…</p>}
          </>
        )}
      </Modal>

      {/* 新建 / 编辑 */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `编辑${title}` : newLabel}
        subtitle="带 * 的为必填项；明细行需选择商品名称并填写数量，可点「保存并继续」连续录入"
        width="max-w-6xl"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            {!editing && (
              <Button icon={Plus} loading={saving} onClick={() => void submit('continue')}>
                保存并继续
              </Button>
            )}
            <Button variant="primary" loading={saving} onClick={() => void submit('close')}>
              保存单据
            </Button>
          </>
        }
      >
        {error && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {headerFields
            .filter((f) => f.inForm !== false && (!f.visibleWhen || f.visibleWhen(form)))
            .map((f) => (
              <Field
                key={f.key}
                label={f.label}
                required={f.required}
                hint={f.hint}
                className={cx(f.span === 2 && 'sm:col-span-2', f.span === 3 && 'lg:col-span-3')}
              >
                {f.formRender ? (
                  f.formRender(form, setValue)
                ) : f.type === 'textarea' ? (
                  <Textarea value={form[f.key] ?? ''} onChange={(e) => setValue(f.key, e.target.value)} />
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
                      let next: Row = { ...form, [f.key]: id === '' ? null : Number(id) }
                      if (raw) {
                        if (f.nameKey) next[f.nameKey] = refNameValue(f, raw)
                        if (f.onRefPick) next = { ...next, ...f.onRefPick(raw, next, data) }
                      } else if (f.nameKey) {
                        next[f.nameKey] = null
                      }
                      setForm(next)
                    }}
                  >
                    <option value="">请选择</option>
                    {refOptions(f.ref!, data).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    type={f.type === 'date' ? 'date' : f.type === 'text' ? 'text' : 'number'}
                    step={f.step ?? (f.type === 'money' ? '0.01' : 'any')}
                    min={f.type === 'number' || f.type === 'money' ? 0 : undefined}
                    value={form[f.key] ?? ''}
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

        <div className="mt-5">
          <ItemsEditor
            items={items}
            onChange={setItems}
            mode={itemsMode}
            readonly={false}
            maxQtyFor={maxQtyFor ? (item) => maxQtyFor(item, form, items) : undefined}
          />
        </div>
      </Modal>
    </div>
  )
}

function renderFieldValue(f: FieldDef, doc: Row, data: DataValue): React.ReactNode {
  const v = doc[f.key]
  if (f.type === 'ref') {
    const text = refLabel(f, doc, data)
    return text ? text : <span className="text-slate-300">—</span>
  }
  if (v === null || v === undefined || v === '') return <span className="text-slate-300">—</span>
  if (f.type === 'money') return `¥ ${moneyText(v)}`
  if (f.type === 'number') return numText(v)
  if (f.badge) return <Badge tone={STATUS_TONE[String(v)] ?? 'slate'}>{String(v)}</Badge>
  if (f.type === 'date') return String(v).slice(0, 10)
  return String(v)
}

/* 供页面复用的导出列构造 */
export function moneyCol(key: string, label: string): ExportColumn {
  return { key, label, format: (r) => money(r[key]) }
}

export function numCol(key: string, label: string): ExportColumn {
  return { key, label, format: (r) => num(r[key]) }
}
