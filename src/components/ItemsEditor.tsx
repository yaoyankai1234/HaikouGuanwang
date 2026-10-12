import React, { useMemo } from 'react'
import { Plus, TriangleAlert, Trash2 } from 'lucide-react'
import { Button, Input, Select, cx } from './ui'
import { useData } from '../store/data'
import { clampNonNegative, money, moneyText, num, numText, sanitizeNumericInput } from '../lib/format'
import type { Row } from '../lib/db'

export type ItemsMode = 'order' | 'in' | 'out'

const TITLES: Record<ItemsMode, string> = {
  order: '采购明细',
  in: '入库明细',
  out: '出库明细',
}

export interface QtyLimit {
  /** 该明细允许的最大数量 */
  max: number
  /** 上限口径说明，如「采购订单剩余可入库」「当前可用库存」 */
  label: string
}

function blankItem(): Row {
  return {
    category_id: null,
    category_name: null,
    material_id: null,
    material_name: '',
    spec: '',
    unit: '',
    qty: 0,
    // 空值语义 = 全部合格；用户一旦手动填写，就按填写值（并收敛到不超过入库数量）计算
    qualified_qty: '',
    arrived_qty: 0,
    unit_price: 0,
    amount: 0,
    batch_no: '',
    remark: '',
  }
}

/** 合格数量是否处于「未填写」状态 */
const isQualifiedBlank = (v: any) => v === '' || v === null || v === undefined

/** 明细的有效合格数量：未填写视为全部合格，填写了则不得超过入库数量 */
export function effectiveQualified(item: Row): number {
  const qty = Number(item?.qty) || 0
  if (isQualifiedBlank(item?.qualified_qty)) return qty
  return Math.max(0, Math.min(qty, Number(item.qualified_qty) || 0))
}

export function ItemsEditor({
  items,
  onChange,
  mode,
  readonly,
  maxQtyFor,
}: {
  items: Row[]
  onChange: (items: Row[]) => void
  mode: ItemsMode
  readonly?: boolean
  /** 逐行返回该明细的数量上限（入库不得超订单、出库不得超库存） */
  maxQtyFor?: (item: Row) => QtyLimit | null
}) {
  const data = useData()

  const update = (idx: number, patch: Row) => {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it))
    onChange(next)
  }

  const recalc = (row: Row): Row => {
    // 数量与单价一律按非负计算，负数输入已在输入框层被拦下
    const qty = clampNonNegative(row.qty)
    const price = clampNonNegative(row.unit_price)
    const amount = mode === 'out' ? 0 : money(qty * price)
    if (mode !== 'in') return { ...row, amount }
    // 合格数量不得超过入库总数量；保持「未填写 = 全部合格」的语义不做覆盖
    if (isQualifiedBlank(row.qualified_qty)) return { ...row, amount, qualified_qty: '' }
    const n = clampNonNegative(row.qualified_qty)
    return { ...row, amount, qualified_qty: qty > 0 ? Math.max(0, Math.min(qty, n)) : n }
  }

  const pickMaterial = (idx: number, materialId: string) => {
    const m = data.materials.find((x) => String(x.id) === materialId)
    if (!m) {
      update(idx, { material_id: null, material_name: '', spec: '', unit: '', unit_price: 0, amount: 0 })
      return
    }
    const cat = data.categories.find((c) => String(c.id) === String(m.category_id))
    update(
      idx,
      recalc({
        ...items[idx],
        material_id: Number(m.id),
        material_name: m.name,
        spec: m.spec ?? '',
        unit: m.unit ?? '',
        unit_price:
          mode === 'out'
            ? Number(items[idx]?.unit_price) || 0
            : Number(m.ref_price) || Number(items[idx]?.unit_price) || 0,
        category_id: m.category_id ?? null,
        category_name: cat?.name ?? m.category_name ?? null,
      })
    )
  }

  const optionsFor = (categoryId: any) =>
    data.materials.filter((m) => !categoryId || String(m.category_id) === String(categoryId))

  const limits = useMemo(() => items.map((it) => (maxQtyFor ? maxQtyFor(it) : null)), [items, maxQtyFor])

  const overLimit = useMemo(
    () =>
      items.map((it, i) => {
        const lim = limits[i]
        const q = Number(it.qty) || 0
        return !!lim && q > lim.max + 1e-6
      }),
    [items, limits]
  )

  const totals = useMemo(() => {
    const qty = items.reduce((a, r) => a + (Number(r.qty) || 0), 0)
    const amount = items.reduce((a, r) => a + (Number(r.amount) || 0), 0)
    const arrived = items.reduce((a, r) => a + (Number(r.arrived_qty) || 0), 0)
    const unqualified =
      mode === 'in'
        ? items.reduce(
            (a, r) => a + Math.max(0, (Number(r.qty) || 0) - effectiveQualified(r)),
            0
          )
        : 0
    return { qty, amount, arrived, unqualified }
  }, [items, mode])

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-slate-800">{TITLES[mode]}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            先选物资分类，再选商品名称，规格/单位/单价会自动带出
            {mode === 'order' && '；到货数量可随收货情况随时回填'}
            {mode === 'in' && '；合格数量不得超过入库数量，差额会自动登记为不合格'}
            {mode === 'out' && '；出库数量不得超过当前可用库存'}
          </p>
        </div>
        {!readonly && (
          <Button icon={Plus} onClick={() => onChange([...items, blankItem()])}>
            添加一行
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className={cx('w-full border-collapse text-sm', mode === 'order' ? 'min-w-[1040px]' : 'min-w-[960px]')}>
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70">
              <th className="th w-10 text-center">#</th>
              <th className="th w-40">物资分类</th>
              <th className="th w-48">商品名称 *</th>
              <th className="th w-28">规格</th>
              <th className="th w-16">单位</th>
              <th className="th w-28 text-right">{mode === 'out' ? '出库数量' : '数量'}</th>
              {mode !== 'out' && <th className="th w-24 text-right">单价(元)</th>}
              {mode !== 'out' && <th className="th w-28 text-right">金额(元)</th>}
              {mode === 'order' && <th className="th w-24 text-right">到货数量</th>}
              {mode === 'in' && <th className="th w-24 text-right">合格数量</th>}
              {mode === 'in' && <th className="th w-20 text-right">不合格</th>}
              {mode === 'in' && <th className="th w-28">批次号</th>}
              <th className="th w-36">备注</th>
              {!readonly && <th className="th w-12" />}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={20} className="px-4 py-10 text-center text-xs text-slate-400">
                  暂无明细，点击「添加一行」开始录入
                </td>
              </tr>
            )}
            {items.map((it, idx) => {
              const lim = limits[idx]
              const over = overLimit[idx]
              const q = Number(it.qty) || 0
              const unqualified =
                mode === 'in' ? Math.max(0, q - effectiveQualified(it)) : 0
              return (
                <tr key={idx} className="border-b border-slate-50 align-top last:border-0">
                  <td className="td text-center text-xs text-slate-400">{idx + 1}</td>
                  <td className="td">
                    <Select
                      className="h-8 text-xs"
                      value={it.category_id ?? ''}
                      disabled={readonly}
                      onChange={(e) => {
                        const cid = e.target.value
                        const cat = data.categories.find((c) => String(c.id) === cid)
                        update(idx, {
                          category_id: cid ? Number(cid) : null,
                          category_name: cat?.name ?? null,
                          material_id: null,
                          material_name: '',
                          spec: '',
                          unit: '',
                        })
                      }}
                    >
                      <option value="">请选择</option>
                      {data.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="td">
                    <Select
                      className="h-8 text-xs"
                      value={it.material_id ?? ''}
                      disabled={readonly}
                      onChange={(e) => pickMaterial(idx, e.target.value)}
                    >
                      <option value="">请选择</option>
                      {optionsFor(it.category_id).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="td">
                    <Input
                      className="h-8 text-xs"
                      value={it.spec ?? ''}
                      disabled={readonly}
                      onChange={(e) => update(idx, { spec: e.target.value })}
                    />
                  </td>
                  <td className="td">
                    <Input
                      className="h-8 text-xs"
                      value={it.unit ?? ''}
                      disabled={readonly}
                      onChange={(e) => update(idx, { unit: e.target.value })}
                    />
                  </td>
                  <td className="td">
                    <Input
                      type="number"
                      step="any"
                      min={0}
                      className={cx(
                        'h-8 text-right text-xs',
                        over && 'border-rose-300 bg-rose-50 text-rose-600 focus:border-rose-400'
                      )}
                      value={it.qty ?? 0}
                      disabled={readonly}
                      onChange={(e) => update(idx, recalc({ ...it, qty: sanitizeNumericInput(e.target.value, it.qty) }))}
                    />
                    {lim && (
                      <p
                        className={cx(
                          'mt-1 flex items-center gap-1 text-[10px] leading-tight',
                          over ? 'font-medium text-rose-500' : 'text-slate-400'
                        )}
                      >
                        {over && <TriangleAlert size={10} className="shrink-0" />}
                        {lim.label} {numText(lim.max)} {it.unit ?? ''}
                      </p>
                    )}
                  </td>
                  {mode !== 'out' && (
                    <td className="td">
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        className="h-8 text-right text-xs"
                        value={it.unit_price ?? 0}
                        disabled={readonly}
                        onChange={(e) =>
                          update(idx, recalc({ ...it, unit_price: sanitizeNumericInput(e.target.value, it.unit_price) }))
                        }
                      />
                    </td>
                  )}
                  {mode !== 'out' && (
                    <td className="td text-right">
                      <span className="num font-medium text-slate-800">{moneyText(it.amount)}</span>
                    </td>
                  )}
                  {mode === 'order' && (
                    <td className="td">
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        className="h-8 text-right text-xs"
                        value={it.arrived_qty ?? 0}
                        disabled={readonly}
                        title="到货数量，汇总后即为该订单的到货进度"
                        onChange={(e) =>
                          update(idx, { arrived_qty: sanitizeNumericInput(e.target.value, it.arrived_qty) })
                        }
                      />
                    </td>
                  )}
                  {mode === 'in' && (
                    <td className="td">
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        max={Number(it.qty) || 0}
                        className="h-8 text-right text-xs"
                        value={it.qualified_qty ?? ''}
                        disabled={readonly}
                        placeholder="全部"
                        title="不得超过入库数量；留空表示全部合格"
                        onChange={(e) =>
                          update(idx, recalc({ ...it, qualified_qty: sanitizeNumericInput(e.target.value, it.qualified_qty) }))
                        }
                      />
                    </td>
                  )}
                  {mode === 'in' && (
                    <td className="td text-right">
                      {unqualified > 0 ? (
                        <span className="num text-xs font-medium text-rose-500">{numText(unqualified)}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  )}
                  {mode === 'in' && (
                    <td className="td">
                      <Input
                        className="h-8 text-xs"
                        value={it.batch_no ?? ''}
                        disabled={readonly}
                        onChange={(e) => update(idx, { batch_no: e.target.value })}
                      />
                    </td>
                  )}
                  <td className="td">
                    <Input
                      className="h-8 text-xs"
                      value={it.remark ?? ''}
                      disabled={readonly}
                      onChange={(e) => update(idx, { remark: e.target.value })}
                    />
                  </td>
                  {!readonly && (
                    <td className="td text-center">
                      <button
                        onClick={() => onChange(items.filter((_, i) => i !== idx))}
                        className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                        title="删除该行"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div
        className={cx(
          'flex flex-wrap items-center justify-end gap-6 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs'
        )}
      >
        <span className="text-slate-500">
          明细行数 <b className="num text-slate-800">{items.length}</b>
        </span>
        <span className="text-slate-500">
          合计数量 <b className="num text-slate-800">{numText(totals.qty)}</b>
        </span>
        {mode !== 'out' && (
          <span className="text-slate-500">
            合计金额 <b className="num text-brand-600">¥ {moneyText(totals.amount)}</b>
          </span>
        )}
        {mode === 'order' && (
          <span className="text-slate-500">
            到货合计 <b className="num text-slate-800">{numText(totals.arrived)}</b>
          </span>
        )}
        {mode === 'in' && (
          <span className="text-slate-500">
            合格合计 <b className="num text-emerald-600">{numText(totals.qty - totals.unqualified)}</b>
            <span className="ml-3">不合格合计</span>{' '}
            <b className={cx('num', totals.unqualified > 0 ? 'text-rose-500' : 'text-slate-800')}>
              {numText(totals.unqualified)}
            </b>
          </span>
        )}
      </div>
    </div>
  )
}
