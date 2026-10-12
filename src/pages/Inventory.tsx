import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Boxes, Download, PackageCheck, RefreshCw, Warehouse } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, PageHeader, SearchInput, Select, useUI, cx } from '../components/ui'
import { DataTable, type Column } from '../components/DataTable'
import { useData } from '../store/data'
import { errText, selectAll, type Row } from '../lib/db'
import { exportExcel } from '../lib/export'
import { money, moneyText, num, numText } from '../lib/format'

export default function Inventory() {
  const data = useData()
  const { toast } = useUI()
  const [params, setParams] = useSearchParams()

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState('')
  const [warnOnly, setWarnOnly] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await selectAll('v_inventory', { order: 'material_id', asc: true })
      setRows(res)
    } catch (e: any) {
      toast(errText(e), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const materialParam = params.get('material')
  useEffect(() => {
    if (materialParam) {
      const hit = rows.find((r) => String(r.material_id) === materialParam)
      if (hit) {
        setKeyword(String(hit.material_name))
        setParams({}, { replace: true })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialParam, rows])

  const enriched = useMemo(
    () =>
      rows.map(
        (r): Row => {
          const stock = num(r.stock_qty)
          const safety = num(r.safety_stock)
          return {
            ...r,
            __stock: stock,
            __amount: money(stock * (Number(r.ref_price) || 0)),
            __state: safety > 0 && stock <= 0 ? '缺货' : safety > 0 && stock < safety ? '低于安全库存' : '正常',
          }
        }
      ),
    [rows]
  )

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return enriched.filter((r) => {
      if (category && String(r.category_name ?? '') !== category) return false
      if (warnOnly && r.__state === '正常') return false
      if (!kw) return true
      return ['material_name', 'material_code', 'spec', 'category_name'].some((k) =>
        String(r[k] ?? '')
          .toLowerCase()
          .includes(kw)
      )
    })
  }, [enriched, keyword, category, warnOnly])

  const kpi = useMemo(() => {
    const amount = enriched.reduce((a, r) => a + r.__amount, 0)
    const warn = enriched.filter((r) => r.__state !== '正常').length
    const categories = new Set(enriched.map((r) => r.category_name).filter(Boolean)).size
    return { amount, warn, categories, count: enriched.length }
  }, [enriched])

  const columns: Column[] = [
    {
      key: 'category_name',
      label: '物资分类',
      width: 130,
      render: (r) => <span className="text-slate-600">{r.category_name ?? '—'}</span>,
    },
    {
      key: 'material_name',
      label: '商品名称',
      width: 220,
      render: (r) => (
        <div className="leading-tight">
          <p className="font-medium text-slate-800">{r.material_name}</p>
          {r.material_code && <p className="mt-0.5 text-[11px] text-slate-400">{r.material_code}</p>}
        </div>
      ),
    },
    { key: 'spec', label: '规格型号', width: 130 },
    { key: 'unit', label: '单位', width: 70, align: 'center' },
    {
      key: 'in_qty',
      label: '累计入库',
      align: 'right',
      width: 105,
      render: (r) => <span className="num text-slate-600">{numText(r.in_qty)}</span>,
    },
    {
      key: 'out_qty',
      label: '累计出库',
      align: 'right',
      width: 105,
      render: (r) => <span className="num text-slate-600">{numText(r.out_qty)}</span>,
    },
    {
      key: 'defect_qty',
      label: '损耗/不合格',
      align: 'right',
      width: 110,
      render: (r) =>
        num(r.defect_qty) > 0 ? (
          <span className="num text-rose-500">{numText(r.defect_qty)}</span>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
    {
      key: '__stock',
      label: '当前库存',
      align: 'right',
      width: 110,
      render: (r) => (
        <span
          className={cx(
            'num font-semibold',
            r.__state === '缺货' ? 'text-rose-600' : r.__state === '低于安全库存' ? 'text-amber-600' : 'text-emerald-600'
          )}
        >
          {numText(r.__stock)}
        </span>
      ),
    },
    {
      key: 'safety_stock',
      label: '安全库存',
      align: 'right',
      width: 100,
      render: (r) => <span className="num text-slate-400">{numText(r.safety_stock)}</span>,
    },
    {
      key: '__state',
      label: '库存状态',
      align: 'center',
      width: 120,
      render: (r) =>
        r.__state === '正常' ? (
          <Badge tone="emerald">正常</Badge>
        ) : r.__state === '缺货' ? (
          <Badge tone="rose">缺货</Badge>
        ) : (
          <Badge tone="amber">低于安全库存</Badge>
        ),
    },
    {
      key: '__amount',
      label: '库存金额(元)',
      align: 'right',
      width: 125,
      render: (r) => <span className="num text-slate-700">{moneyText(r.__amount)}</span>,
    },
  ]

  const exportCols = [
    { key: 'category_name', label: '物资分类' },
    { key: 'material_code', label: '物资编码' },
    { key: 'material_name', label: '商品名称' },
    { key: 'spec', label: '规格型号' },
    { key: 'unit', label: '单位' },
    { key: 'in_qty', label: '累计入库', format: (r: any) => num(r.in_qty) },
    { key: 'out_qty', label: '累计出库', format: (r: any) => num(r.out_qty) },
    { key: 'defect_qty', label: '损耗/不合格', format: (r: any) => num(r.defect_qty) },
    { key: '__stock', label: '当前库存', format: (r: any) => num(r.__stock) },
    { key: 'safety_stock', label: '安全库存', format: (r: any) => num(r.safety_stock) },
    { key: '__state', label: '库存状态' },
    { key: 'ref_price', label: '参考单价(元)', format: (r: any) => money(r.ref_price) },
    { key: '__amount', label: '库存金额(元)', format: (r: any) => money(r.__amount) },
  ]

  return (
    <div>
      <PageHeader
        title="库存总览"
        subtitle="由入库 − 出库 − 损耗/不合格自动计算，实时反映各物资可用库存"
        icon={Warehouse}
        actions={
          <>
            <Button icon={RefreshCw} onClick={() => void load()}>
              刷新
            </Button>
            <Button
              icon={Download}
              onClick={() => {
                if (!filtered.length) return toast('当前没有可导出的数据', 'info')
                exportExcel('库存总览', exportCols as any, filtered, '库存总览')
                toast(`已导出 ${filtered.length} 条`, 'success')
              }}
            >
              导出 Excel
            </Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: '物资品种', value: numText(kpi.count), unit: '种', icon: Boxes, tone: 'from-brand-500 to-brand-600' },
          { label: '覆盖分类', value: numText(kpi.categories), unit: '类', icon: PackageCheck, tone: 'from-cyan-500 to-brand-500' },
          { label: '库存金额', value: moneyText(kpi.amount), unit: '元', icon: Warehouse, tone: 'from-emerald-500 to-teal-500' },
          { label: '库存预警', value: numText(kpi.warn), unit: '项', icon: AlertTriangle, tone: 'from-amber-500 to-orange-500' },
        ].map((k) => (
          <div key={k.label} className="card p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-500">{k.label}</p>
                <p className="mt-1.5 flex items-baseline gap-1">
                  <span className="num text-xl font-semibold text-slate-900">{k.value}</span>
                  <span className="text-xs text-slate-400">{k.unit}</span>
                </p>
              </div>
              <span className={cx('flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white', k.tone)}>
                <k.icon size={17} />
              </span>
            </div>
          </div>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        loading={loading}
        emptyTitle="暂无库存数据"
        emptyDesc="请先在「物资台账」建立物资，再通过入库单录入库存"
        pageSize={15}
        toolbar={
          <>
            <SearchInput
              value={keyword}
              onChange={setKeyword}
              placeholder="搜索商品名称 / 编码 / 规格"
              className="w-full sm:w-72"
            />
            <Select className="w-full sm:w-44" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">物资分类（全部）</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </Select>
            <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={warnOnly}
                onChange={(e) => setWarnOnly(e.target.checked)}
                className="h-3.5 w-3.5 accent-brand-600"
              />
              仅看库存预警
            </label>
            {(keyword || category || warnOnly) && (
              <Button
                variant="text"
                onClick={() => {
                  setKeyword('')
                  setCategory('')
                  setWarnOnly(false)
                }}
              >
                重置
              </Button>
            )}
          </>
        }
        summary={
          <span className="text-slate-400">
            筛选结果库存金额 <b className="num text-slate-700">¥ {moneyText(filtered.reduce((a, r) => a + r.__amount, 0))}</b>
          </span>
        }
      />
    </div>
  )
}
