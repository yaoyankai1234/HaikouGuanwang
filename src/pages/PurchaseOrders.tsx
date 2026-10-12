import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownToLine, ShoppingCart } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DocPage } from '../components/DocPage'
import type { Column } from '../components/DataTable'
import type { FieldDef } from '../lib/fields'
import { useData } from '../store/data'
import { useAuth } from '../store/auth'
import { ORDER_STATUS } from '../lib/options'
import { money, moneyText, numText } from '../lib/format'
import { Badge } from '../components/ui'
import { nextNo, selectAll, type Row } from '../lib/db'

const headerFields: FieldDef[] = [
  {
    key: 'order_no',
    label: '采购订单号',
    type: 'text',
    required: true,
    placeholder: '如 CG20261009001',
    hint: '留空保存时自动生成',
  },
  {
    key: 'supplier_id',
    label: '供应商',
    type: 'ref',
    ref: 'suppliers',
    nameKey: 'supplier_name',
    required: true,
  },
  { key: 'order_date', label: '下单日期', type: 'date', required: true },
  { key: 'expect_date', label: '期望到货日期', type: 'date' },
  {
    key: 'has_contract',
    label: '是否涉及合同',
    type: 'select',
    options: ['是', '否'],
    default: '是',
    required: true,
    badge: true,
    hint: '选择「否」时无需关联合同，可不填合同信息',
  },
  {
    key: 'contract_id',
    label: '关联合同',
    type: 'ref',
    ref: 'contracts',
    nameKey: 'contract_no',
    extraNameKeys: ['contract_name'],
    visibleWhen: (f) => f.has_contract !== '否',
    onRefPick: (c) => ({
      supplier_id: c.supplier_id ?? null,
      supplier_name: c.supplier_name ?? null,
      contract_name: c.name ?? null,
    }),
    hint: '选择合同后自动带出供应商与合同名称',
  },
  { key: 'contract_name', label: '合同名称', type: 'text', inForm: false, inTable: false },
  { key: 'status', label: '订单状态', type: 'select', options: ORDER_STATUS, default: '待审核', badge: true },
  { key: 'buyer', label: '采购经办人', type: 'text' },
  { key: 'remark', label: '备注说明', type: 'textarea', span: 3, inTable: false },
]

const headerExportColumns = [
  { key: 'order_no', label: '采购订单号' },
  { key: 'supplier_name', label: '供应商' },
  { key: 'order_date', label: '下单日期' },
  { key: 'expect_date', label: '期望到货日期' },
  { key: 'has_contract', label: '是否涉及合同' },
  { key: 'contract_no', label: '关联合同编号' },
  { key: 'contract_name', label: '合同名称' },
  { key: 'status', label: '订单状态' },
  { key: 'buyer', label: '采购经办人' },
  { key: 'total_amount', label: '订单金额(元)', format: (r: any) => money(r.total_amount) },
  { key: 'remark', label: '备注' },
]

const itemExportColumns = [
  { key: '__order_no', label: '采购订单号' },
  { key: '__order_date', label: '下单日期' },
  { key: '__supplier', label: '供应商' },
  { key: '__contract', label: '关联合同' },
  { key: '__status', label: '订单状态' },
  { key: 'category_name', label: '物资分类' },
  { key: 'material_name', label: '商品名称' },
  { key: 'spec', label: '规格型号' },
  { key: 'unit', label: '单位' },
  { key: 'qty', label: '采购数量', format: (r: any) => Number(r.qty) || 0 },
  { key: 'unit_price', label: '单价(元)', format: (r: any) => money(r.unit_price) },
  { key: 'amount', label: '金额(元)', format: (r: any) => money(r.amount) },
  { key: 'arrived_qty', label: '到货数量', format: (r: any) => Number(r.arrived_qty) || 0 },
  { key: 'remark', label: '备注' },
]

export default function PurchaseOrders() {
  const data = useData()
  const { canEdit } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [existing, setExisting] = useState<Row[]>([])
  /** 关联入库单金额汇总（未手工回填到货数量时的兜底口径） */
  const [arrived, setArrived] = useState<Map<string, number>>(new Map())
  /** 采购明细「到货数量 × 单价」汇总（手工回填口径，优先） */
  const [arrivedManual, setArrivedManual] = useState<Map<string, number>>(new Map())

  const orderNo = params.get('no') ?? ''
  const initialFilters = useMemo(() => (orderNo ? { order_no: orderNo } : undefined), [orderNo])

  const loadExtra = useCallback(async () => {
    try {
      const [orders, inbounds, items] = await Promise.all([
        selectAll('purchase_orders', { order: 'id', asc: false }),
        selectAll('inbound_orders', { order: 'id', asc: false }),
        selectAll('purchase_order_items', { order: 'id', asc: true }),
      ])
      setExisting(orders)
      const m = new Map<string, number>()
      inbounds.forEach((r) => {
        const k = String(r.order_id ?? '')
        if (!k) return
        m.set(k, (m.get(k) ?? 0) + (Number(r.total_amount) || 0))
      })
      setArrived(m)
      const mi = new Map<string, number>()
      items.forEach((r) => {
        const k = String(r.order_id ?? '')
        if (!k) return
        const v = (Number(r.arrived_qty) || 0) * (Number(r.unit_price) || 0)
        if (!v) return
        mi.set(k, (mi.get(k) ?? 0) + v)
      })
      setArrivedManual(mi)
    } catch {
      /* 忽略 */
    }
  }, [])

  /** 到货金额：优先取明细回填的到货数量，其次取关联入库单金额 */
  const arrivedAmount = useCallback(
    (id: any) => arrivedManual.get(String(id)) ?? arrived.get(String(id)) ?? 0,
    [arrivedManual, arrived]
  )

  useEffect(() => {
    void loadExtra()
  }, [loadExtra])

  /** 合同编号 / 名称统一跳转到合同管理并自动筛选 */
  const goContract = (row: Row) =>
    row.contract_no ? nav(`/contracts?no=${encodeURIComponent(String(row.contract_no))}`) : undefined

  const contractCell = (r: Row) => {
    if (r.has_contract === '否')
      return <span className="text-xs text-slate-400">不涉及合同</span>
    if (!r.contract_no && !r.contract_name) return <span className="text-slate-300">—</span>
    return (
      <div className="leading-tight" onClick={(e) => e.stopPropagation()}>
        {r.contract_no ? (
          <button
            onClick={() => goContract(r)}
            className="block truncate text-left font-medium text-brand-600 hover:text-brand-700 hover:underline"
            title={`查看合同 ${r.contract_no}`}
          >
            {r.contract_no}
          </button>
        ) : null}
        {r.contract_name ? (
          <button
            onClick={() => goContract(r)}
            className="mt-0.5 block max-w-[210px] truncate text-left text-[11px] text-slate-500 hover:text-brand-600 hover:underline"
            title={`查看合同 ${r.contract_name}`}
          >
            {r.contract_name}
          </button>
        ) : null}
      </div>
    )
  }

  const columns: Column[] = [
    {
      key: 'order_no',
      label: '采购订单号',
      width: 150,
      render: (r) => <span className="font-medium text-slate-800">{r.order_no}</span>,
    },
    { key: 'supplier_name', label: '供应商', width: 190 },
    {
      key: 'has_contract',
      label: '是否涉及合同',
      align: 'center',
      width: 108,
      render: (r) => (
        <Badge tone={r.has_contract === '否' ? 'slate' : 'brand'}>{r.has_contract === '否' ? '否' : '是'}</Badge>
      ),
    },
    { key: 'order_date', label: '下单日期', width: 100 },
    {
      key: 'contract_no',
      label: '关联合同',
      width: 225,
      sortValue: (r) => String(r.contract_no ?? ''),
      render: contractCell,
    },
    {
      key: 'total_amount',
      label: '订单金额(元)',
      align: 'right',
      width: 118,
      render: (r) => <span className="num font-medium text-slate-800">{moneyText(r.total_amount)}</span>,
    },
    {
      key: '__arrived',
      label: '到货进度',
      width: 140,
      sortValue: (r) => {
        const t = Number(r.total_amount) || 0
        return t ? arrivedAmount(r.id) / t : 0
      },
      render: (r) => {
        const total = Number(r.total_amount) || 0
        const got = arrivedAmount(r.id)
        const pct = total > 0 ? Math.min(100, (got / total) * 100) : got > 0 ? 100 : 0
        const manual = arrivedManual.has(String(r.id))
        return (
          <div className="flex items-center gap-2" title={manual ? '按采购明细的到货数量汇总' : '按关联入库单金额汇总'}>
            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
              <div
                className={pct >= 100 ? 'h-full bg-emerald-500' : 'h-full bg-gradient-to-r from-brand-500 to-cyan-500'}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="num text-xs text-slate-500">{numText(pct)}%</span>
          </div>
        )
      },
    },
    {
      key: '__gap',
      label: '未到货金额',
      align: 'right',
      width: 115,
      render: (r) => {
        const gap = (Number(r.total_amount) || 0) - arrivedAmount(r.id)
        return <span className={gap > 0 ? 'num text-amber-600' : 'num text-slate-300'}>{moneyText(Math.max(0, gap))}</span>
      },
    },
    {
      key: 'status',
      label: '订单状态',
      align: 'center',
      width: 100,
      render: (r) => <Badge tone={r.status === '已完成' ? 'emerald' : r.status === '已取消' ? 'slate' : 'brand'}>{r.status}</Badge>,
    },
    { key: 'buyer', label: '经办人', width: 88 },
  ]

  return (
    <DocPage
      title="采购订单"
      subtitle="按供应商与合同下达采购订单，明细含物资分类与商品名称，自动汇总订单金额"
      icon={ShoppingCart}
      table="purchase_orders"
      itemTable="purchase_order_items"
      fk="order_id"
      module="purchase_orders"
      headerFields={headerFields}
      columns={columns}
      itemsMode="order"
      searchKeys={['order_no', 'supplier_name', 'contract_no', 'contract_name', 'buyer', 'status', 'remark', 'has_contract']}
      searchPlaceholder="搜索订单号 / 供应商 / 合同 / 经办人"
      filters={[
        { key: 'order_no', label: '采购订单号', type: 'combo', ref: 'orders', sourceKey: 'order_no' },
        { key: 'supplier_name', label: '供应商', type: 'combo', ref: 'suppliers', sourceKey: 'name' },
        { key: 'has_contract', label: '是否涉及合同', options: ['是', '否'] },
        { key: 'contract_no', label: '关联合同', type: 'combo', ref: 'contracts', sourceKey: 'contract_no' },
        { key: 'order_date', label: '下单日期', type: 'dateRange' },
        { key: 'expect_date', label: '期望到货日', type: 'date' },
        { key: 'status', label: '订单状态', options: ORDER_STATUS },
      ]}
      initialFilters={initialFilters}
      exportName="采购订单"
      newLabel="新建采购订单"
      docNoField="order_no"
      itemExportColumns={itemExportColumns}
      headerExportColumns={headerExportColumns}
      deriveTotals={(items) => ({
        total_amount: money(items.reduce((a, r) => a + (Number(r.amount) || 0), 0)),
      })}
      beforeSave={(header) => {
        // 「不涉及合同」时清空合同关联，避免残留在列表与导出中
        const cleared =
          header.has_contract === '否'
            ? { contract_id: null, contract_no: null, contract_name: null }
            : {}
        return {
          ...header,
          ...cleared,
          order_no: header.order_no || nextNo('CG', existing, 'order_no'),
        }
      }}
      decorateItem={(it, doc) => ({
        ...it,
        __order_no: doc.order_no,
        __order_date: doc.order_date,
        __supplier: doc.supplier_name,
        __contract:
          doc.has_contract === '否'
            ? '不涉及合同'
            : [doc.contract_no, doc.contract_name].filter(Boolean).join(' · '),
        __status: doc.status,
      })}
      onItemSaved={async () => {
        await loadExtra()
        await data.refresh()
      }}
      extraRowActions={(row) =>
        canEdit('inbound') ? (
          <button
            title="查看关联入库单"
            onClick={() => nav(`/inbound?order=${encodeURIComponent(String(row.order_no))}`)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-600 transition hover:bg-brand-50"
          >
            <ArrowDownToLine size={12} /> 入库
          </button>
        ) : null
      }
      summaryText={(rows) => (
        <span className="flex items-center gap-2">
          <Badge tone="brand">待处理 {rows.filter((r) => r.status === '待审核' || r.status === '已下单').length} 张</Badge>
          {rows.some((r) => r.has_contract === '否') && (
            <Badge tone="slate">不涉及合同 {rows.filter((r) => r.has_contract === '否').length} 张</Badge>
          )}
          <span className="text-slate-400">
            金额合计 <b className="num text-slate-700">¥ {moneyText(rows.reduce((a, r) => a + (Number(r.total_amount) || 0), 0))}</b>
          </span>
        </span>
      )}
    />
  )
}
