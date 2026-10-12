import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DocPage } from '../components/DocPage'
import { effectiveQualified } from '../components/ItemsEditor'
import type { Column } from '../components/DataTable'
import type { FieldDef } from '../lib/fields'
import { IN_STATUS, WAREHOUSES } from '../lib/options'
import { money, moneyText, num, numText, today } from '../lib/format'
import { Badge, useUI } from '../components/ui'
import { deleteRows, errText, insertRows, nextNo, selectAll, type Row } from '../lib/db'
import { useData } from '../store/data'

const headerFields: FieldDef[] = [
  {
    key: 'in_no',
    label: '入库单号',
    type: 'text',
    required: true,
    placeholder: '如 RK20261009001',
    hint: '留空保存时自动生成',
  },
  { key: 'in_date', label: '入库日期', type: 'date', required: true },
  {
    key: 'order_id',
    label: '来源采购订单',
    type: 'ref',
    ref: 'orders',
    nameKey: 'order_no',
    extraNameKeys: ['contract_id', 'contract_no', 'contract_name'],
    onRefPick: (o) => ({
      supplier_id: o.supplier_id ?? null,
      supplier_name: o.supplier_name ?? null,
      contract_id: o.contract_id ?? null,
      contract_no: o.contract_no ?? null,
      contract_name: o.contract_name ?? null,
    }),
    hint: '选择订单后自动带出供应商与关联合同',
  },
  {
    key: 'contract_id',
    label: '关联合同',
    type: 'ref',
    ref: 'contracts',
    nameKey: 'contract_no',
    extraNameKeys: ['contract_name'],
    inForm: false,
    inTable: false,
  },
  { key: 'contract_name', label: '合同名称', type: 'text', inForm: false, inTable: false },
  {
    key: 'supplier_id',
    label: '供应商',
    type: 'ref',
    ref: 'suppliers',
    nameKey: 'supplier_name',
    required: true,
    onRefPick: (s) => ({ supplier_name: s.name ?? null }),
  },
  { key: 'warehouse', label: '入库仓库', type: 'select', options: WAREHOUSES, default: '项目部主仓' },
  { key: 'inspector', label: '验收人', type: 'text' },
  { key: 'status', label: '入库状态', type: 'select', options: IN_STATUS, default: '已入库', badge: true },
  { key: 'total_amount', label: '入库金额(元)', type: 'money', align: 'right', inForm: false },
  { key: 'remark', label: '备注说明', type: 'textarea', span: 3, inTable: false },
]

const headerExportColumns = [
  { key: 'in_no', label: '入库单号' },
  { key: 'in_date', label: '入库日期' },
  { key: 'supplier_name', label: '供应商' },
  { key: 'order_no', label: '来源采购订单' },
  { key: 'contract_no', label: '关联合同编号' },
  { key: 'contract_name', label: '合同名称' },
  { key: 'warehouse', label: '入库仓库' },
  { key: 'inspector', label: '验收人' },
  { key: 'status', label: '入库状态' },
  { key: 'total_amount', label: '入库金额(元)', format: (r: any) => money(r.total_amount) },
  { key: 'remark', label: '备注' },
]

const itemExportColumns = [
  { key: '__in_no', label: '入库单号' },
  { key: '__in_date', label: '入库日期' },
  { key: '__supplier', label: '供应商' },
  { key: '__order', label: '来源采购订单' },
  { key: '__contract', label: '关联合同' },
  { key: '__warehouse', label: '入库仓库' },
  { key: 'category_name', label: '物资分类' },
  { key: 'material_name', label: '商品名称' },
  { key: 'spec', label: '规格型号' },
  { key: 'unit', label: '单位' },
  { key: 'qty', label: '入库数量', format: (r: any) => Number(r.qty) || 0 },
  { key: 'qualified_qty', label: '合格数量', format: (r: any) => effectiveQualified(r) },
  {
    key: '__unqualified',
    label: '不合格数量',
    format: (r: any) => Math.max(0, (Number(r.qty) || 0) - effectiveQualified(r)),
  },
  { key: 'unit_price', label: '单价(元)', format: (r: any) => money(r.unit_price) },
  { key: 'amount', label: '金额(元)', format: (r: any) => money(r.amount) },
  { key: 'batch_no', label: '批次号' },
  { key: 'remark', label: '备注' },
]

export default function Inbound() {
  const data = useData()
  const { toast, confirm } = useUI()
  const nav = useNavigate()
  const [params] = useSearchParams()

  const [inbounds, setInbounds] = useState<Row[]>([])
  const [inboundItems, setInboundItems] = useState<Row[]>([])
  const [orderItems, setOrderItems] = useState<Row[]>([])

  const orderParam = params.get('order') ?? params.get('no') ?? ''
  const inNoParam = params.get('inno') ?? ''
  const initialFilters = useMemo<Record<string, string> | undefined>(() => {
    const f: Record<string, string> = {}
    if (orderParam) f.order_no = orderParam
    else if (inNoParam) f.in_no = inNoParam
    return Object.keys(f).length ? f : undefined
  }, [orderParam, inNoParam])

  const loadExtra = useCallback(async () => {
    const [ins, items, oitems] = await Promise.all([
      selectAll('inbound_orders', { order: 'id', asc: false }).catch(() => [] as Row[]),
      selectAll('inbound_items', { order: 'id', asc: true }).catch(() => [] as Row[]),
      selectAll('purchase_order_items', { order: 'id', asc: true }).catch(() => [] as Row[]),
    ])
    setInbounds(ins)
    setInboundItems(items)
    setOrderItems(oitems)
  }, [])

  useEffect(() => {
    void loadExtra()
  }, [loadExtra])

  /** 采购订单「订单+物资」维度的采购数量 */
  const orderedMap = useMemo(() => {
    const m = new Map<string, number>()
    orderItems.forEach((r) => {
      if (!r.order_id || !r.material_id) return
      const k = `${r.order_id}|${r.material_id}`
      m.set(k, (m.get(k) ?? 0) + (Number(r.qty) || 0))
    })
    return m
  }, [orderItems])

  /** 入库单「订单+物资」维度已入库数量 */
  const inboundMap = useMemo(() => {
    const orderOf = new Map<string, string>()
    inbounds.forEach((r) => {
      if (r.order_id) orderOf.set(String(r.id), String(r.order_id))
    })
    const m = new Map<string, number>()
    inboundItems.forEach((r) => {
      const oid = orderOf.get(String(r.inbound_id))
      if (!oid || !r.material_id) return
      const k = `${oid}|${r.material_id}`
      m.set(k, (m.get(k) ?? 0) + (Number(r.qty) || 0))
    })
    return m
  }, [inbounds, inboundItems])

  /** 正在编辑的入库单本身占用的数量（按物资汇总），校验时需剔除 */
  const selfUsage = useCallback(
    (header: Row) => {
      const m = new Map<string, number>()
      const inNo = String(header.in_no ?? '')
      if (!inNo) return m
      const doc = inbounds.find((r) => String(r.in_no) === inNo)
      if (!doc) return m
      inboundItems
        .filter((r) => String(r.inbound_id) === String(doc.id))
        .forEach((r) => {
          if (!r.material_id) return
          const k = String(r.material_id)
          m.set(k, (m.get(k) ?? 0) + (Number(r.qty) || 0))
        })
      return m
    },
    [inbounds, inboundItems]
  )

  /** 某物资在本订单下还可入库的数量 */
  const remainOf = useCallback(
    (header: Row, materialId: any) => {
      if (!header.order_id || !materialId) return null
      const key = `${header.order_id}|${materialId}`
      const ordered = orderedMap.get(key) ?? 0
      const usedOthers =
        (inboundMap.get(key) ?? 0) - (selfUsage(header).get(String(materialId)) ?? 0)
      const remain = num(ordered - Math.max(0, usedOthers))
      return { ordered, remain: Math.max(0, remain) }
    },
    [orderedMap, inboundMap, selfUsage]
  )

  /** 自动把「不合格数量」登记到损耗与不合格台账，并按入库单号去重 */
  const syncDefects = useCallback(
    async (doc: Row, items: Row[]) => {
      const inNo = String(doc.in_no ?? '')
      if (!inNo) return
      const unqualified: Row[] = items
        .map(
          (i): Row => ({
            ...i,
            __bad: num(Math.max(0, (Number(i.qty) || 0) - effectiveQualified(i))),
          })
        )
        .filter((i) => (Number(i.__bad) || 0) > 0)

      let existing: Row[] = []
      try {
        existing = (await selectAll('defects', { order: 'id', asc: true })).filter(
          (d) => String(d.source_no ?? '') === inNo
        )
      } catch {
        return
      }

      if (!unqualified.length) {
        if (existing.length) {
          await deleteRows('defects', existing.map((d) => d.id))
          await data.refresh()
          toast('本单已无不合格物资，自动登记记录已同步移除', 'info')
        }
        return
      }

      if (!existing.length) {
        const total = unqualified.reduce((a, i) => a + i.__bad, 0)
        const ok = await confirm({
          title: '是否将不合格物资登记到「损耗与不合格」？',
          desc: `本次入库有 ${unqualified.length} 条明细的合格数量小于入库数量，合计不合格 ${numText(
            total
          )}。确认后将自动生成 ${unqualified.length} 条不合格记录（来源：入库验收，可追溯至本入库单）。`,
          confirmText: '自动登记',
        })
        if (!ok) {
          toast('入库单已保存，未登记不合格记录', 'info')
          return
        }
      }

      if (existing.length) await deleteRows('defects', existing.map((d) => d.id))
      await insertRows(
        'defects',
        unqualified.map((i, idx) => ({
          record_no: `BH-${inNo}-${idx + 1}`,
          record_date: String(doc.in_date ?? today()).slice(0, 10),
          type: '不合格',
          source: '入库验收',
          source_no: inNo,
          category_id: i.category_id ?? null,
          category_name: i.category_name ?? null,
          material_id: i.material_id ?? null,
          material_name: i.material_name ?? null,
          spec: i.spec ?? null,
          unit: i.unit ?? null,
          qty: i.__bad,
          unit_price: Number(i.unit_price) || 0,
          amount: money(i.__bad * (Number(i.unit_price) || 0)),
          supplier_id: doc.supplier_id ?? null,
          supplier_name: doc.supplier_name ?? null,
          reason: `入库验收不合格（来源入库单 ${inNo}）`,
          disposal: '退货',
          status: '待处理',
          handler: doc.inspector ?? null,
          remark: '由入库单验收自动生成，合格数量调整后会自动同步',
        }))
      )
      await data.refresh()
      toast(`已登记 ${unqualified.length} 条不合格记录`, 'success')
    },
    [confirm, toast, data]
  )

  /** 订单 / 合同跳转 */
  const goOrder = (row: Row) =>
    row.order_no ? nav(`/orders?no=${encodeURIComponent(String(row.order_no))}`) : undefined
  const goContract = (row: Row) =>
    row.contract_no ? nav(`/contracts?no=${encodeURIComponent(String(row.contract_no))}`) : undefined

  const orderCell = (r: Row) =>
    r.order_no ? (
      <button
        onClick={(e) => {
          e.stopPropagation()
          goOrder(r)
        }}
        className="truncate font-medium text-brand-600 hover:text-brand-700 hover:underline"
        title={`查看采购订单 ${r.order_no} 与合同`}
      >
        {r.order_no}
      </button>
    ) : (
      <span className="text-slate-300">—</span>
    )

  const contractCell = (r: Row) => {
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
            className="mt-0.5 block max-w-[200px] truncate text-left text-[11px] text-slate-500 hover:text-brand-600 hover:underline"
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
      key: 'in_no',
      label: '入库单号',
      width: 145,
      render: (r) => <span className="font-medium text-slate-800">{r.in_no}</span>,
    },
    { key: 'in_date', label: '入库日期', width: 100 },
    { key: 'supplier_name', label: '供应商', width: 165 },
    {
      key: 'order_no',
      label: '来源采购订单',
      width: 145,
      sortValue: (r) => String(r.order_no ?? ''),
      render: orderCell,
    },
    {
      key: 'contract_no',
      label: '关联合同',
      width: 210,
      sortValue: (r) => String(r.contract_no ?? ''),
      render: contractCell,
    },
    { key: 'warehouse', label: '入库仓库', width: 125 },
    {
      key: 'total_amount',
      label: '入库金额(元)',
      align: 'right',
      width: 118,
      render: (r) => <span className="num font-medium text-slate-800">{moneyText(r.total_amount)}</span>,
    },
    { key: 'inspector', label: '验收人', width: 85 },
    {
      key: 'status',
      label: '状态',
      align: 'center',
      width: 92,
      render: (r) => <Badge tone={r.status === '已入库' ? 'emerald' : 'amber'}>{r.status}</Badge>,
    },
  ]

  return (
    <DocPage
      title="物资入库"
      subtitle="按采购订单验收入库，入库数量不得超过订单采购数量，合格数量不足的差额可自动登记为不合格"
      icon={ArrowDownToLine}
      table="inbound_orders"
      itemTable="inbound_items"
      fk="inbound_id"
      module="inbound"
      headerFields={headerFields}
      columns={columns}
      itemsMode="in"
      searchKeys={[
        'in_no',
        'supplier_name',
        'order_no',
        'contract_no',
        'contract_name',
        'warehouse',
        'inspector',
        'status',
        'remark',
      ]}
      searchPlaceholder="搜索入库单号 / 供应商 / 订单号 / 合同"
      filters={[
        {
          key: 'in_no',
          label: '入库单号',
          type: 'combo',
          options: inbounds.map((r) => String(r.in_no ?? '')).filter(Boolean),
        },
        { key: 'supplier_name', label: '供应商', type: 'combo', ref: 'suppliers', sourceKey: 'name' },
        { key: 'order_no', label: '采购订单', type: 'combo', ref: 'orders', sourceKey: 'order_no' },
        { key: 'contract_no', label: '关联合同', type: 'combo', ref: 'contracts', sourceKey: 'contract_no' },
        { key: 'in_date', label: '入库日期', type: 'dateRange' },
        { key: 'warehouse', label: '入库仓库', options: WAREHOUSES },
        { key: 'status', label: '入库状态', options: IN_STATUS },
      ]}
      initialFilters={initialFilters}
      exportName="物资入库"
      newLabel="新建入库单"
      docNoField="in_no"
      itemExportColumns={itemExportColumns}
      headerExportColumns={headerExportColumns}
      deriveTotals={(items) => ({
        total_amount: money(items.reduce((a, r) => a + (Number(r.amount) || 0), 0)),
      })}
      maxQtyFor={(item, header) => {
        if (!orderItems.length) return null
        const r = remainOf(header, item.material_id)
        if (!r) return null
        return {
          max: r.remain,
          label: r.ordered > 0 ? '订单剩余可入库' : '该订单未包含此物资，可入库',
        }
      }}
      validate={(header, items) => {
        if (!header.order_id) return null
        // 采购明细未加载成功时不拦截，避免误判为 0
        if (!orderItems.length) return null
        const agg = new Map<string, { name: string; qty: number }>()
        items.forEach((i) => {
          if (!i.material_id) return
          const k = String(i.material_id)
          const prev = agg.get(k)
          agg.set(k, {
            name: i.material_name ?? k,
            qty: (prev?.qty ?? 0) + (Number(i.qty) || 0),
          })
        })
        const problems: string[] = []
        agg.forEach((v, k) => {
          const r = remainOf(header, k)
          if (!r) return
          if (v.qty > r.remain + 1e-6) {
            problems.push(
              `${v.name} 超出 ${numText(v.qty - r.remain)}（本订单剩余可入库 ${numText(r.remain)}）`
            )
          }
        })
        if (problems.length) {
          return `入库数量超过关联采购订单的可入库量：${problems.join('；')}。请调整数量或改选采购订单。`
        }
        return null
      }}
      beforeSave={async (header) => ({
        ...header,
        in_no: header.in_no || nextNo('RK', await selectAll<Row>('inbound_orders', { limit: 2000 }), 'in_no'),
      })}
      decorateItem={(it, doc) => ({
        ...it,
        __in_no: doc.in_no,
        __in_date: doc.in_date,
        __supplier: doc.supplier_name,
        __order: doc.order_no,
        __contract: [doc.contract_no, doc.contract_name].filter(Boolean).join(' · '),
        __warehouse: doc.warehouse,
      })}
      onItemSaved={async (doc, items) => {
        await loadExtra()
        await data.refresh()
        try {
          await syncDefects(doc, items)
        } catch (e: any) {
          toast('不合格记录自动登记失败：' + errText(e), 'error')
        }
      }}
      summaryText={(rows) => (
        <span className="flex items-center gap-2">
          <Badge tone="emerald">已入库 {rows.filter((r) => r.status === '已入库').length} 张</Badge>
          <span className="text-slate-400">
            入库金额 <b className="num text-slate-700">¥ {moneyText(rows.reduce((a, r) => a + (Number(r.total_amount) || 0), 0))}</b>
          </span>
        </span>
      )}
    />
  )
}
