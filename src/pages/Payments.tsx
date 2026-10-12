import { useMemo } from 'react'
import { Wallet } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { CrudPage, type FieldDef } from '../components/CrudPage'
import { useData } from '../store/data'
import { PAY_METHODS, PAY_STAGES, PAY_STATUS } from '../lib/options'
import { money, moneyText, numText } from '../lib/format'
import { Badge } from '../components/ui'

export const paymentFields: FieldDef[] = [
  { key: 'contract_id', label: '关联合同', type: 'ref', ref: 'contracts', nameKey: 'contract_no', extraNameKeys: ['contract_name'], required: true, width: 170,
    onRefPick: (c) => ({
      supplier_id: c.supplier_id ?? null,
      supplier_name: c.supplier_name ?? null,
      plan_amount: Number(c.amount) || 0,
      contract_name: c.name ?? null,
    }),
  },
  { key: 'contract_name', label: '合同名称', type: 'text', inForm: false, inTable: false },
  { key: 'supplier_id', label: '供应商', type: 'ref', ref: 'suppliers', nameKey: 'supplier_name', width: 200 },
  {
    key: 'stage_name',
    label: '付款阶段',
    type: 'select',
    options: PAY_STAGES,
    required: true,
    default: '预付款',
    width: 100,
  },
  { key: 'stage_seq', label: '阶段序号', type: 'number', default: 1, align: 'right', width: 90 },
  { key: 'ratio', label: '占合同比例(%)', type: 'number', default: 0, align: 'right', width: 130 },
  { key: 'plan_amount', label: '应付金额(元)', type: 'money', required: true, align: 'right', width: 125 },
  { key: 'paid_amount', label: '已付金额(元)', type: 'money', default: 0, align: 'right', width: 125 },
  {
    key: 'status',
    label: '付款状态',
    type: 'select',
    options: PAY_STATUS,
    default: '未付款',
    badge: true,
    width: 90,
  },
  {
    key: '__progress',
    label: '支付进度',
    type: 'text',
    inForm: false,
    width: 140,
    sortValue: (row) => {
      const p = Number(row.plan_amount) || 0
      return p ? (Number(row.paid_amount) || 0) / p : 0
    },
    tableRender: (row) => {
      const plan = Number(row.plan_amount) || 0
      const paid = Number(row.paid_amount) || 0
      const pct = plan > 0 ? Math.min(100, (paid / plan) * 100) : paid > 0 ? 100 : 0
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
            <div
              className={
                pct >= 100
                  ? 'h-full rounded-full bg-emerald-500'
                  : 'h-full rounded-full bg-gradient-to-r from-brand-500 to-cyan-500'
              }
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="num text-xs text-slate-500">{numText(pct)}%</span>
        </div>
      )
    },
  },
  { key: 'plan_date', label: '计划付款日', type: 'date', width: 115 },
  { key: 'paid_date', label: '实际付款日', type: 'date', width: 115 },
  { key: 'pay_method', label: '付款方式', type: 'select', options: PAY_METHODS, width: 105 },
  { key: 'remark', label: '备注', type: 'textarea', span: 2, inTable: false },
]

export default function Payments() {
  const data = useData()
  const [params] = useSearchParams()

  const initialFilters = useMemo(() => {
    const c = params.get('contract')
    return c ? { contract_no: c } : undefined
  }, [params])

  return (
    <CrudPage
      title="付款进度"
      subtitle="按合同分阶段跟踪应付款、已付款与逾期情况，状态自动联动"
      icon={Wallet}
      table="payments"
      module="payments"
      fields={paymentFields}
      orderBy="contract_id"
      orderAsc
      initialFilters={initialFilters}
      searchKeys={['contract_no', 'supplier_name', 'stage_name', 'pay_method', 'remark']}
      searchPlaceholder="搜索合同编号 / 供应商 / 阶段"
      filters={[
        { key: 'contract_no', label: '所属合同', type: 'combo', ref: 'contracts', sourceKey: 'contract_no' },
        { key: 'supplier_name', label: '供应商', type: 'combo', ref: 'suppliers', sourceKey: 'name' },
        { key: 'stage_name', label: '付款阶段', options: PAY_STAGES },
        { key: 'status', label: '付款状态', options: PAY_STATUS },
        { key: 'plan_date', label: '计划付款日', type: 'dateRange' },
        { key: 'paid_date', label: '实际付款日', type: 'dateRange' },
      ]}
      exportName="付款进度"
      exportSheet="付款进度"
      newLabel="新增付款阶段"
      beforeSave={(form) => {
        const plan = money(form.plan_amount)
        const paid = money(form.paid_amount)
        let status = form.status || '未付款'
        if (status !== '已逾期') {
          if (plan > 0 && paid >= plan) status = '已付款'
          else if (paid > 0) status = '部分付款'
          else status = '未付款'
        }
        return { ...form, status, plan_amount: plan, paid_amount: paid }
      }}
      onChanged={() => void data.refresh()}
      summaryText={(rows) => {
        const plan = rows.reduce((a, r) => a + (Number(r.plan_amount) || 0), 0)
        const paid = rows.reduce((a, r) => a + (Number(r.paid_amount) || 0), 0)
        return (
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="emerald">已付 ¥ {moneyText(paid)}</Badge>
            <Badge tone="amber">未付 ¥ {moneyText(Math.max(0, plan - paid))}</Badge>
            <span className="text-slate-400">
              应付合计 <b className="num text-slate-700">¥ {moneyText(plan)}</b>
            </span>
          </span>
        )
      }}
    />
  )
}
