import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Building2,
  LayoutDashboard,
  Package,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge, Button, Loading, PageHeader, useUI, cx } from '../components/ui'
import { errText, selectAll, type Row } from '../lib/db'
import { money, moneyText, num, numText } from '../lib/format'
import { useAuth } from '../store/auth'

const PALETTE = ['#2563eb', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#0ea5e9', '#64748b']

interface Bundle {
  inventory: Row[]
  orders: Row[]
  inbounds: Row[]
  outbounds: Row[]
  outboundItems: Row[]
  suppliers: Row[]
  payments: Row[]
  defects: Row[]
  teams: Row[]
  stages: Row[]
}

const EMPTY: Bundle = {
  inventory: [],
  orders: [],
  inbounds: [],
  outbounds: [],
  outboundItems: [],
  suppliers: [],
  payments: [],
  defects: [],
  teams: [],
  stages: [],
}

export default function Dashboard() {
  const { displayName, roleName } = useAuth()
  const { toast } = useUI()
  const [data, setData] = useState<Bundle>(EMPTY)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [inventory, orders, inbounds, outbounds, outboundItems, suppliers, payments, defects, teams, stages] =
        await Promise.all([
          selectAll('v_inventory', { order: 'material_id', asc: true }),
          selectAll('purchase_orders', { order: 'id', asc: false }),
          selectAll('inbound_orders', { order: 'id', asc: false }),
          selectAll('outbound_orders', { order: 'id', asc: false }),
          selectAll('outbound_items', { order: 'id', asc: false }),
          selectAll('suppliers', { order: 'id', asc: false }),
          selectAll('payments', { order: 'id', asc: false }),
          selectAll('defects', { order: 'id', asc: false }),
          selectAll('teams', { order: 'id', asc: true }),
          selectAll('team_stages', { order: 'seq', asc: true }),
        ])
      setData({ inventory, orders, inbounds, outbounds, outboundItems, suppliers, payments, defects, teams, stages })
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

  const kpi = useMemo(() => {
    const stockAmount = data.inventory.reduce(
      (a, r) => a + num(r.stock_qty) * (Number(r.ref_price) || 0),
      0
    )
    const warn = data.inventory.filter((r) => {
      const safety = num(r.safety_stock)
      return safety > 0 && num(r.stock_qty) < safety
    })
    const plan = data.payments.reduce((a, r) => a + (Number(r.plan_amount) || 0), 0)
    const paid = data.payments.reduce((a, r) => a + (Number(r.paid_amount) || 0), 0)
    return {
      suppliers: data.suppliers.length,
      suppliersActive: data.suppliers.filter((s) => s.cooperation === '已合作').length,
      orderAmount: data.orders.reduce((a, r) => a + (Number(r.total_amount) || 0), 0),
      inboundAmount: data.inbounds.reduce((a, r) => a + (Number(r.total_amount) || 0), 0),
      stockAmount,
      outQty: data.outbounds.reduce((a, r) => a + num(r.total_qty), 0),
      defectAmount: data.defects.reduce((a, r) => a + (Number(r.amount) || 0), 0),
      plan,
      paid,
      warnCount: warn.length,
      warnList: warn.sort((a, b) => num(a.stock_qty) - num(b.stock_qty)).slice(0, 6),
    }
  }, [data])

  const monthly = useMemo(() => {
    const now = new Date()
    const months: { key: string; label: string; po: number; inb: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: `${d.getMonth() + 1}月`,
        po: 0,
        inb: 0,
      })
    }
    const idx = new Map(months.map((m, i) => [m.key, i]))
    data.orders.forEach((o) => {
      const i = idx.get(String(o.order_date ?? '').slice(0, 7))
      if (i !== undefined) months[i].po += Number(o.total_amount) || 0
    })
    data.inbounds.forEach((o) => {
      const i = idx.get(String(o.in_date ?? '').slice(0, 7))
      if (i !== undefined) months[i].inb += Number(o.total_amount) || 0
    })
    return months.map((m) => ({ ...m, po: money(m.po), inb: money(m.inb) }))
  }, [data])

  const teamOut = useMemo(() => {
    const byId = new Map(data.outbounds.map((o) => [String(o.id), o]))
    const m = new Map<string, number>()
    data.outboundItems.forEach((i) => {
      const t = byId.get(String(i.outbound_id))?.team_name || '未指定团队'
      m.set(t, (m.get(t) ?? 0) + num(i.qty))
    })
    return [...m.entries()]
      .map(([name, value]) => ({ name, value: money(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [data])

  const catAmount = useMemo(() => {
    const m = new Map<string, number>()
    data.inventory.forEach((r) => {
      const c = r.category_name || '未分类'
      m.set(c, (m.get(c) ?? 0) + num(r.stock_qty) * (Number(r.ref_price) || 0))
    })
    return [...m.entries()]
      .map(([name, value]) => ({ name, value: money(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [data])

  const payPie = useMemo(() => {
    const m = new Map<string, number>()
    data.payments.forEach((p) => m.set(p.status || '未付款', (m.get(p.status) || 0) + (Number(p.plan_amount) || 0)))
    return [...m.entries()].map(([name, value]) => ({ name, value: money(value) }))
  }, [data])

  if (loading) return <Loading label="正在汇总项目数据…" />

  const payRate = kpi.plan > 0 ? (kpi.paid / kpi.plan) * 100 : 0

  return (
    <div>
      <PageHeader
        title={`${greeting()}，${displayName}`}
        subtitle="沿海村落供水管网延伸工程 · 项目物资与采购全景看板"
        icon={LayoutDashboard}
        actions={
          <Button icon={RefreshCw} onClick={() => void load()}>
            刷新数据
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="合作供应商"
          value={`${kpi.suppliersActive}`}
          unit={`/ ${kpi.suppliers} 家`}
          icon={Building2}
          tone="from-brand-500 to-brand-600"
          hint="含未合作与储备入库"
        />
        <KpiCard
          label="采购订单金额"
          value={`¥${moneyText(kpi.orderAmount)}`}
          unit=""
          icon={ShoppingCart}
          tone="from-cyan-500 to-brand-500"
          hint={`共 ${data.orders.length} 张订单`}
        />
        <KpiCard
          label="累计入库金额"
          value={`¥${moneyText(kpi.inboundAmount)}`}
          unit=""
          icon={ArrowDownToLine}
          tone="from-emerald-500 to-teal-500"
          hint={`共 ${data.inbounds.length} 张入库单`}
        />
        <KpiCard
          label="库存金额"
          value={`¥${moneyText(kpi.stockAmount)}`}
          unit=""
          icon={Package}
          tone="from-violet-500 to-brand-500"
          hint={`${kpi.warnCount} 项低于安全库存`}
        />
        <KpiCard
          label="累计出库数量"
          value={numText(kpi.outQty)}
          unit=""
          icon={ArrowUpFromLine}
          tone="from-sky-500 to-cyan-500"
          hint={`${data.outbounds.length} 张出库单 · ${data.teams.length} 个团队`}
        />
        <KpiCard
          label="损耗与不合格"
          value={`¥${moneyText(kpi.defectAmount)}`}
          unit=""
          icon={AlertTriangle}
          tone="from-amber-500 to-orange-500"
          hint={`${data.defects.length} 条记录`}
        />
        <KpiCard
          label="合同已付 / 应付"
          value={`${numText(payRate)}%`}
          unit=""
          icon={Wallet}
          tone="from-rose-500 to-pink-500"
          hint={`已付 ¥${moneyText(kpi.paid)} / 应付 ¥${moneyText(kpi.plan)}`}
        />
        <KpiCard
          label="在建进度节点"
          value={`${data.stages.filter((s) => s.status === '进行中').length}`}
          unit={`/ ${data.stages.length} 个`}
          icon={TrendingUp}
          tone="from-teal-500 to-emerald-500"
          hint={`${data.teams.filter((t) => t.status === '施工中').length} 个团队施工中`}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2">
          <SectionTitle title="近 6 个月采购与入库金额" desc="单位：元" />
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => (Number(v) >= 10000 ? `${Math.round(Number(v) / 10000)}万` : String(v))}
                />
                <Tooltip
                  formatter={(v: any, n: any) => [`¥ ${moneyText(v)}`, n === 'po' ? '采购金额' : '入库金额']}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                />
                <Legend formatter={(v) => (v === 'po' ? '采购金额' : '入库金额')} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="po" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={26} />
                <Bar dataKey="inb" fill="#06b6d4" radius={[6, 6, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <SectionTitle title="付款阶段金额分布" desc="按应付金额统计" />
          <div className="mt-4 h-64">
            {payPie.length === 0 ? (
              <EmptyHint text="暂无付款计划数据" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={payPie}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={82}
                    paddingAngle={2}
                  >
                    {payPie.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: any) => `¥ ${moneyText(v)}`}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card p-5 xl:col-span-2">
          <SectionTitle title="各团队分组出库物资数量" desc="按领用数量汇总，反映施工进度投放节奏" />
          <div className="mt-4 h-64">
            {teamOut.length === 0 ? (
              <EmptyHint text="暂无出库数据，先到「物资出库」录入领用单" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamOut} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v: any) => [numText(v), '出库数量']}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={22}>
                    {teamOut.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card p-5">
          <SectionTitle title="库存金额 TOP 分类" desc="单位：元" />
          <div className="mt-4 space-y-3">
            {catAmount.length === 0 && <EmptyHint text="暂无库存数据" />}
            {catAmount.map((c, i) => {
              const max = catAmount[0]?.value || 1
              return (
                <div key={c.name}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-slate-600">{c.name}</span>
                    <span className="num text-slate-500">¥ {moneyText(c.value)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(4, (c.value / max) * 100)}%`, background: PALETTE[i % PALETTE.length] }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <SectionTitle
            title="库存预警"
            desc="低于安全库存的物资，建议尽快补货"
            action={
              <Link to="/inventory" className="text-xs text-brand-600 hover:underline">
                查看全部 →
              </Link>
            }
          />
          <div className="mt-3 space-y-2">
            {kpi.warnList.length === 0 && <EmptyHint text="库存充足，暂无预警" />}
            {kpi.warnList.map((r) => (
              <div key={r.material_id} className="flex items-center justify-between rounded-lg bg-slate-50/70 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-700">{r.material_name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {r.category_name} · {r.spec || '—'}
                  </p>
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <p className={cx('num text-sm font-semibold', num(r.stock_qty) <= 0 ? 'text-rose-600' : 'text-amber-600')}>
                    {numText(r.stock_qty)} {r.unit}
                  </p>
                  <p className="text-[11px] text-slate-400">安全 {numText(r.safety_stock)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <SectionTitle
            title="最近出库单"
            desc="最新的物资领用记录"
            action={
              <Link to="/outbound" className="text-xs text-brand-600 hover:underline">
                查看全部 →
              </Link>
            }
          />
          <div className="mt-3 space-y-2">
            {data.outbounds.length === 0 && <EmptyHint text="暂无出库记录" />}
            {data.outbounds.slice(0, 6).map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded-lg bg-slate-50/70 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-700">
                    {o.team_name} · {o.stage_name || '未指定节点'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {o.out_no} · {String(o.out_date ?? '').slice(0, 10)}
                  </p>
                </div>
                <div className="ml-3 shrink-0">
                  <Badge tone="brand">{numText(o.total_qty)} 件/延米</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 card p-5">
        <SectionTitle title="快捷入口" desc="常用功能一键直达" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { to: '/orders', label: '采购订单', icon: ShoppingCart },
            { to: '/inbound', label: '物资入库', icon: ArrowDownToLine },
            { to: '/outbound', label: '物资出库', icon: ArrowUpFromLine },
            { to: '/materials', label: '物资台账', icon: Boxes },
            { to: '/contracts', label: '合同管理', icon: Package },
            { to: '/payments', label: '付款进度', icon: Wallet },
          ].map((q) => (
            <Link
              key={q.to}
              to={q.to}
              className="group flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-4 text-center transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-card"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 transition group-hover:bg-brand-100">
                <q.icon size={17} />
              </span>
              <span className="text-xs text-slate-600">{q.label}</span>
            </Link>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-slate-400">
          当前角色：{roleName} · 数据每张表均支持在对应页面右上角「导出 Excel」
        </p>
      </div>
    </div>
  )
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return '凌晨好'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

function SectionTitle({
  title,
  desc,
  action,
}: {
  title: string
  desc?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {desc && <p className="mt-0.5 text-[11px] text-slate-400">{desc}</p>}
      </div>
      {action}
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <p className="py-8 text-center text-xs text-slate-400">{text}</p>
}

function KpiCard({
  label,
  value,
  unit,
  icon: Icon,
  tone,
  hint,
}: {
  label: string
  value: string
  unit: string
  icon: React.ComponentType<{ size?: number | string; className?: string }>
  tone: string
  hint?: string
}) {
  return (
    <div className="card p-4 transition hover:shadow-pop">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-1">
            <span className="num text-lg font-semibold tracking-tight text-slate-900">{value}</span>
            {unit && <span className="text-[11px] text-slate-400">{unit}</span>}
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
