import { useMemo, type ComponentType } from 'react'
import { Coins, ReceiptText, TrendingUp, Wallet } from 'lucide-react'
import { CrudPage, type FieldDef } from '../components/CrudPage'
import { FileField, FileLink } from '../components/FileField'
import { cx } from '../components/ui'
import type { Row } from '../lib/db'
import { moneyText, today } from '../lib/format'
import { MISC_CATEGORIES, MISC_PAY_METHODS, MISC_STATUS } from '../lib/options'

const PALETTE = ['#2563eb', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#0ea5e9', '#64748b']

const fields: FieldDef[] = [
  {
    key: 'bill_no',
    label: '费用单号',
    type: 'text',
    width: 140,
    placeholder: '如 FY20261010001',
    hint: '留空保存时自动生成',
  },
  { key: 'expense_date', label: '发生日期', type: 'date', required: true, width: 110 },
  {
    key: 'category',
    label: '费用类别',
    type: 'select',
    options: MISC_CATEGORIES,
    default: '房租费',
    required: true,
    badge: true,
    width: 100,
  },
  {
    key: 'item_name',
    label: '物品 / 费用名称',
    type: 'text',
    required: true,
    width: 210,
    placeholder: '如 项目部房租 / A4 打印纸 / 92# 汽油',
  },
  { key: 'spec', label: '规格 / 用途说明', type: 'text', width: 170, inTable: false },
  { key: 'qty', label: '数量', type: 'number', width: 80, align: 'right', inTable: false },
  { key: 'unit', label: '单位', type: 'text', width: 70, inTable: false },
  { key: 'unit_price', label: '单价(元)', type: 'money', width: 100, align: 'right', inTable: false },
  {
    key: 'amount',
    label: '金额(元)',
    type: 'money',
    required: true,
    align: 'right',
    width: 110,
    hint: '如需按数量计价，可将「数量 × 单价」的合计填入此处',
  },
  { key: 'vendor', label: '商户 / 供应商', type: 'text', width: 160 },
  { key: 'pay_method', label: '支付方式', type: 'select', options: MISC_PAY_METHODS, width: 100, inTable: false },
  { key: 'handler', label: '经办人', type: 'text', width: 90 },
  {
    key: 'status',
    label: '报销状态',
    type: 'select',
    options: MISC_STATUS,
    default: '待报销',
    badge: true,
    width: 92,
  },
  {
    key: 'file_path',
    label: '发票 / 收据附件',
    type: 'text',
    span: 2,
    width: 200,
    exportValue: (row) => row.file_name ?? '',
    tableRender: (row) => <FileLink path={row.file_path} name={row.file_name} />,
    formRender: (form, setValue) => (
      <FileField
        path={form.file_path}
        fileName={form.file_name}
        folder="misc-purchases"
        onChange={(n) => {
          setValue('file_path', n.file_path)
          setValue('file_name', n.file_name)
        }}
      />
    ),
  },
  { key: 'file_name', label: '附件名称', type: 'text', inForm: false, inTable: false },
  { key: 'remark', label: '备注', type: 'textarea', span: 2, inTable: false },
]

export default function MiscPurchases() {
  return (
    <CrudPage
      title="非工程采购"
      subtitle="非工程项目类的物资采购与日常费用流水（房租、办公用品、加油票等），每条可上传多份发票或收据，并按金额统计"
      icon={Coins}
      table="misc_purchases"
      module="misc_purchases"
      fields={fields}
      orderBy="expense_date"
      orderAsc={false}
      searchKeys={['bill_no', 'item_name', 'category', 'vendor', 'handler', 'spec', 'remark', 'pay_method', 'status']}
      searchPlaceholder="搜索单号 / 名称 / 商户 / 经办人"
      filters={[
        { key: 'category', label: '费用类别', options: MISC_CATEGORIES },
        { key: 'status', label: '报销状态', options: MISC_STATUS },
        { key: 'pay_method', label: '支付方式', options: MISC_PAY_METHODS },
        { key: 'vendor', label: '商户 / 供应商', type: 'combo' },
        { key: 'expense_date', label: '发生日期', type: 'dateRange' },
      ]}
      exportName="非工程采购费用"
      exportSheet="费用流水"
      newLabel="新建费用记录"
      beforeSave={(form, _isNew, rows) => ({
        ...form,
        bill_no: form.bill_no || nextBillNo(rows),
      })}
      topSlot={(rows) => <StatsPanel rows={rows} />}
      summaryText={(rows) => (
        <span className="text-slate-400">
          金额合计 <b className="num text-slate-700">¥ {moneyText(sumAmount(rows))}</b>
        </span>
      )}
    />
  )
}

/* ------------------------------- 金额统计 ------------------------------- */

function StatsPanel({ rows }: { rows: Row[] }) {
  const total = sumAmount(rows)
  const month = today().slice(0, 7)
  const monthTotal = sumAmount(rows.filter((r) => String(r.expense_date ?? '').slice(0, 7) === month))
  const pending = rows.filter((r) => r.status === '待报销')
  const paid = sumAmount(rows.filter((r) => r.status === '已付款' || r.status === '已报销'))

  const byCategory = useMemo(() => {
    const m = new Map<string, number>()
    rows.forEach((r) => {
      const k = String(r.category ?? '其他')
      m.set(k, (m.get(k) ?? 0) + (Number(r.amount) || 0))
    })
    return [...m.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [rows])

  const byMonth = useMemo(() => {
    const now = new Date()
    const out: { key: string; label: string; value: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      out.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: `${d.getMonth() + 1}月`,
        value: 0,
      })
    }
    const idx = new Map(out.map((m, i) => [m.key, i]))
    rows.forEach((r) => {
      const i = idx.get(String(r.expense_date ?? '').slice(0, 7))
      if (i !== undefined) out[i].value += Number(r.amount) || 0
    })
    return out
  }, [rows])

  const catMax = byCategory[0]?.value || 1
  const monthMax = Math.max(1, ...byMonth.map((m) => m.value))

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="费用合计金额" value={`¥ ${moneyText(total)}`} hint={`共 ${rows.length} 笔记录`} icon={Wallet} tone="from-brand-500 to-brand-600" />
        <StatCard label={`本月（${month.slice(5)}月）`} value={`¥ ${moneyText(monthTotal)}`} hint="按发生日期统计" icon={TrendingUp} tone="from-cyan-500 to-brand-500" />
        <StatCard label="待报销金额" value={`¥ ${moneyText(sumAmount(pending))}`} hint={`${pending.length} 笔待处理`} icon={ReceiptText} tone="from-amber-500 to-orange-500" />
        <StatCard label="已报销 / 已付款" value={`¥ ${moneyText(paid)}`} hint="已完成的费用" icon={Coins} tone="from-emerald-500 to-teal-500" />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="card p-4">
          <p className="text-sm font-semibold text-slate-800">按费用类别统计</p>
          <p className="mt-0.5 text-[11px] text-slate-400">随上方筛选条件联动，单位：元</p>
          <div className="mt-3 space-y-2.5">
            {byCategory.length === 0 && <p className="py-6 text-center text-xs text-slate-400">暂无数据</p>}
            {byCategory.map((c, i) => (
              <div key={c.name}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-slate-600">{c.name}</span>
                  <span className="num text-slate-500">¥ {moneyText(c.value)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(3, (c.value / catMax) * 100)}%`, background: PALETTE[i % PALETTE.length] }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <p className="text-sm font-semibold text-slate-800">近 6 个月费用趋势</p>
          <p className="mt-0.5 text-[11px] text-slate-400">按发生日期归集，单位：元</p>
          <div className="mt-4 flex h-[150px] items-end justify-between gap-2">
            {byMonth.map((m, i) => (
              <div key={m.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" title={`${m.key}：¥ ${moneyText(m.value)}`}>
                <span className="num text-[10px] text-slate-400">{m.value > 0 ? compact(m.value) : ''}</span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-brand-500 to-cyan-400"
                    style={{ height: `${Math.max(m.value > 0 ? 6 : 1, (m.value / monthMax) * 100)}%` }}
                  />
                </div>
                <span className={cx('text-[10px]', i === byMonth.length - 1 ? 'font-medium text-brand-600' : 'text-slate-400')}>
                  {m.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  hint?: string
  icon: ComponentType<{ size?: number | string; className?: string }>
  tone: string
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-1.5 truncate">
            <span className="num text-lg font-semibold tracking-tight text-slate-900">{value}</span>
          </p>
        </div>
        <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm', tone)}>
          <Icon size={17} />
        </span>
      </div>
      {hint && <p className="mt-2 truncate text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

/* --------------------------------- utils --------------------------------- */

function sumAmount(rows: Row[]): number {
  return rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)
}

/** 金额紧凑展示：超过 1 万显示 x.x万 */
function compact(v: number): string {
  return v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(Math.round(v))
}

/** 生成 FE 前缀的费用单号，如 FY20261010001 */
function nextBillNo(rows: Row[]): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  const head = `FY${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
  const used = new Set(rows.map((r) => String(r.bill_no ?? '')).filter((v) => v.startsWith(head)))
  let i = 1
  while (used.has(head + String(i).padStart(3, '0'))) i += 1
  return head + String(i).padStart(3, '0')
}
