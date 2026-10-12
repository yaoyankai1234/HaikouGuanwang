import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpFromLine } from 'lucide-react'
import { DocPage } from '../components/DocPage'
import type { Column } from '../components/DataTable'
import type { FieldDef } from '../lib/fields'
import { OUT_STATUS } from '../lib/options'
import { num, numText } from '../lib/format'
import { Badge, Select } from '../components/ui'
import { nextNo, selectAll, type Row } from '../lib/db'
import { useData } from '../store/data'

const headerExportColumns = [
  { key: 'out_no', label: '出库单号' },
  { key: 'out_date', label: '出库日期' },
  { key: 'team_name', label: '领用团队分组' },
  { key: 'stage_name', label: '对应进度节点' },
  { key: 'usage_desc', label: '用途说明' },
  { key: 'keeper', label: '发料人' },
  { key: 'status', label: '出库状态' },
  { key: 'total_qty', label: '出库总数量', format: (r: any) => Number(r.total_qty) || 0 },
  { key: 'remark', label: '备注' },
]

const itemExportColumns = [
  { key: '__out_no', label: '出库单号' },
  { key: '__out_date', label: '出库日期' },
  { key: '__team', label: '领用团队分组' },
  { key: '__stage', label: '对应进度节点' },
  { key: '__usage', label: '用途说明' },
  { key: 'category_name', label: '物资分类' },
  { key: 'material_name', label: '商品名称' },
  { key: 'spec', label: '规格型号' },
  { key: 'unit', label: '单位' },
  { key: 'qty', label: '出库数量', format: (r: any) => Number(r.qty) || 0 },
  { key: 'remark', label: '备注' },
]

export default function Outbound() {
  const data = useData()
  const [existing, setExisting] = useState<Row[]>([])
  const [outItems, setOutItems] = useState<Row[]>([])
  const [inventory, setInventory] = useState<Row[]>([])
  const [variety, setVariety] = useState<Map<string, number>>(new Map())

  const loadExtra = useCallback(async () => {
    const [orders, items, inv] = await Promise.all([
      selectAll('outbound_orders', { order: 'id', asc: false }).catch(() => [] as Row[]),
      selectAll('outbound_items', { order: 'id', asc: false }).catch(() => [] as Row[]),
      selectAll('v_inventory', { order: 'material_id', asc: true }).catch(() => [] as Row[]),
    ])
    setExisting(orders)
    setOutItems(items)
    setInventory(inv)
    const m = new Map<string, number>()
    items.forEach((i: Row) => {
      const k = String(i.outbound_id)
      m.set(k, (m.get(k) ?? 0) + 1)
    })
    setVariety(m)
  }, [])

  useEffect(() => {
    void loadExtra()
  }, [loadExtra])

  /** 各物资当前可用库存（入库 − 出库 − 损耗/不合格） */
  const stockMap = useMemo(() => {
    const m = new Map<string, number>()
    inventory.forEach((r) => {
      if (r.material_id === null || r.material_id === undefined) return
      m.set(String(r.material_id), num(r.stock_qty))
    })
    return m
  }, [inventory])

  /** 正在编辑的出库单自身占用的数量：校验可用库存时需加回 */
  const selfUsage = useCallback(
    (header: Row) => {
      const m = new Map<string, number>()
      const outNo = String(header.out_no ?? '')
      if (!outNo) return m
      const doc = existing.find((r) => String(r.out_no) === outNo)
      if (!doc) return m
      outItems
        .filter((r) => String(r.outbound_id) === String(doc.id))
        .forEach((r) => {
          if (!r.material_id) return
          const k = String(r.material_id)
          m.set(k, (m.get(k) ?? 0) + (Number(r.qty) || 0))
        })
      return m
    },
    [existing, outItems]
  )

  const remainOf = useCallback(
    (header: Row, materialId: any) => {
      if (!materialId) return null
      const stock = stockMap.get(String(materialId)) ?? 0
      const remain = num(stock + (selfUsage(header).get(String(materialId)) ?? 0))
      return Math.max(0, remain)
    },
    [stockMap, selfUsage]
  )

  const headerFields: FieldDef[] = [
    {
      key: 'out_no',
      label: '出库单号',
      type: 'text',
      required: true,
      placeholder: '如 CK20261009001',
      hint: '留空保存时自动生成',
    },
    { key: 'out_date', label: '出库日期', type: 'date', required: true },
    {
      key: 'team_id',
      label: '领用团队分组',
      type: 'ref',
      ref: 'teams',
      nameKey: 'team_name',
      required: true,
      onRefPick: () => ({ stage_id: null, stage_name: null }),
      hint: '选择团队后可挑选该团队对应的进度节点',
    },
    {
      key: 'stage_id',
      label: '对应进度节点',
      type: 'ref',
      ref: 'stages',
      nameKey: 'stage_name',
      required: true,
      formRender: (form, setValue) => {
        const list = data.stages.filter(
          (s) => !form.team_id || String(s.team_id) === String(form.team_id)
        )
        return (
          <Select
            value={form.stage_id === undefined || form.stage_id === null ? '' : String(form.stage_id)}
            onChange={(e) => {
              const sid = e.target.value
              const s = list.find((x) => String(x.id) === sid)
              setValue('stage_id', sid ? Number(sid) : null)
              setValue('stage_name', s?.name ?? null)
            }}
          >
            <option value="">请选择</option>
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}（当前 {numText(s.progress)}%）
              </option>
            ))}
          </Select>
        )
      },
    },
    { key: 'usage_desc', label: '用途说明', type: 'text', span: 2, placeholder: '如：一标段主管道敷设' },
    { key: 'keeper', label: '发料人', type: 'text' },
    { key: 'status', label: '出库状态', type: 'select', options: OUT_STATUS, default: '已出库', badge: true },
    { key: 'remark', label: '备注说明', type: 'textarea', span: 3, inTable: false },
  ]

  const columns: Column[] = [
    {
      key: 'out_no',
      label: '出库单号',
      width: 150,
      render: (r) => <span className="font-medium text-slate-800">{r.out_no}</span>,
    },
    { key: 'out_date', label: '出库日期', width: 105 },
    {
      key: 'team_name',
      label: '领用团队分组',
      width: 160,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
          {r.team_name ?? '—'}
        </span>
      ),
    },
    {
      key: 'stage_name',
      label: '对应进度节点',
      width: 150,
      render: (r) => (r.stage_name ? <Badge tone="cyan">{r.stage_name}</Badge> : <span className="text-slate-300">—</span>),
    },
    { key: 'usage_desc', label: '用途说明', width: 190 },
    {
      key: '__variety',
      label: '物资品种',
      align: 'right',
      width: 95,
      render: (r) => <span className="num text-slate-600">{variety.get(String(r.id)) ?? 0} 种</span>,
    },
    {
      key: 'total_qty',
      label: '出库总数量',
      align: 'right',
      width: 110,
      render: (r) => <span className="num font-medium text-slate-800">{numText(r.total_qty)}</span>,
    },
    { key: 'keeper', label: '发料人', width: 85 },
    {
      key: 'status',
      label: '状态',
      align: 'center',
      width: 95,
      render: (r) => <Badge tone={r.status === '已出库' ? 'emerald' : 'amber'}>{r.status}</Badge>,
    },
  ]

  return (
    <DocPage
      title="物资出库"
      subtitle="按团队分组与进度节点发料，出库数量不得超过当前可用库存"
      icon={ArrowUpFromLine}
      table="outbound_orders"
      itemTable="outbound_items"
      fk="outbound_id"
      module="outbound"
      headerFields={headerFields}
      columns={columns}
      itemsMode="out"
      searchKeys={['out_no', 'team_name', 'stage_name', 'usage_desc', 'keeper', 'status', 'remark']}
      searchPlaceholder="搜索出库单号 / 团队 / 节点 / 用途"
      filters={[
        {
          key: 'out_no',
          label: '出库单号',
          type: 'combo',
          options: existing.map((r) => String(r.out_no ?? '')).filter(Boolean),
        },
        { key: 'team_name', label: '团队分组', type: 'combo', ref: 'teams', sourceKey: 'name' },
        { key: 'stage_name', label: '进度节点', type: 'combo', ref: 'stages', sourceKey: 'name' },
        { key: 'out_date', label: '出库日期', type: 'dateRange' },
        { key: 'status', label: '出库状态', options: OUT_STATUS },
      ]}
      exportName="物资出库"
      newLabel="新建出库单"
      docNoField="out_no"
      itemExportColumns={itemExportColumns}
      headerExportColumns={headerExportColumns}
      deriveTotals={(items) => ({
        total_qty: items.reduce((a, r) => a + (Number(r.qty) || 0), 0),
      })}
      maxQtyFor={(item, header) => {
        if (!inventory.length) return null
        const r = remainOf(header, item.material_id)
        if (r === null) return null
        return { max: r, label: '当前可用库存' }
      }}
      validate={(header, items) => {
        // 库存数据未加载成功时不做硬拦截，避免误判为 0 而挡住正常发料
        if (!inventory.length) return null
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
          const avail = remainOf(header, k)
          if (avail === null) return
          if (v.qty > avail + 1e-6) {
            problems.push(`${v.name} 超出 ${numText(v.qty - avail)}（可用库存 ${numText(avail)}）`)
          }
        })
        if (problems.length) {
          return `出库数量超过当前可用库存：${problems.join('；')}。请先补货入库，或调整出库数量。`
        }
        return null
      }}
      beforeSave={(header) => ({
        ...header,
        out_no: header.out_no || nextNo('CK', existing, 'out_no'),
      })}
      decorateItem={(it, doc) => ({
        ...it,
        __out_no: doc.out_no,
        __out_date: doc.out_date,
        __team: doc.team_name,
        __stage: doc.stage_name,
        __usage: doc.usage_desc,
      })}
      onItemSaved={async () => {
        await loadExtra()
        await data.refresh()
      }}
      summaryText={(rows) => (
        <span className="flex items-center gap-2">
          <Badge tone="brand">
            覆盖团队 {new Set(rows.map((r) => r.team_name).filter(Boolean)).size} 个
          </Badge>
          <span className="text-slate-400">
            出库总量 <b className="num text-slate-700">{numText(rows.reduce((a, r) => a + (Number(r.total_qty) || 0), 0))}</b>
          </span>
        </span>
      )}
    />
  )
}
