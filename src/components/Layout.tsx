import React, { useMemo, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Building2,
  ChevronRight,
  Coins,
  DatabaseBackup,
  Droplets,
  FileText,
  HardHat,
  LayoutDashboard,
  LogOut,
  Menu,
  Milestone,
  Package,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  TriangleAlert,
  UserCircle2,
  Users,
  Warehouse,
  Wallet,
  X,
} from 'lucide-react'
import { useAuth } from '../store/auth'
import { cx } from './ui'
import { Footer } from './Footer'
import { APP_REGION, APP_SHORT } from '../cloud'

type IconType = React.ComponentType<{ size?: number | string; className?: string }>

export interface NavItem {
  to: string
  label: string
  icon: IconType
  /** 对应的功能模块权限键 */
  module: string
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  {
    title: '总览',
    items: [{ to: '/', label: '工作台', icon: LayoutDashboard, module: 'dashboard' }],
  },
  {
    title: '物资管理',
    items: [
      { to: '/categories', label: '物资分类', icon: Boxes, module: 'material_categories' },
      { to: '/materials', label: '物资台账', icon: Package, module: 'materials' },
      { to: '/inventory', label: '库存总览', icon: Warehouse, module: 'inventory' },
    ],
  },
  {
    title: '采购与仓储',
    items: [
      { to: '/orders', label: '采购订单', icon: ShoppingCart, module: 'purchase_orders' },
      { to: '/inbound', label: '物资入库', icon: ArrowDownToLine, module: 'inbound' },
      { to: '/outbound', label: '物资出库', icon: ArrowUpFromLine, module: 'outbound' },
      { to: '/defects', label: '损耗与不合格', icon: TriangleAlert, module: 'defects' },
    ],
  },
  {
    title: '供应商',
    items: [{ to: '/suppliers', label: '供应商档案', icon: Building2, module: 'suppliers' }],
  },
  {
    title: '合同与财务',
    items: [
      { to: '/contracts', label: '合同管理', icon: FileText, module: 'contracts' },
      { to: '/invoices', label: '发票管理', icon: Receipt, module: 'invoices' },
      { to: '/payments', label: '付款进度', icon: Wallet, module: 'payments' },
    ],
  },
  {
    title: '日常费用',
    items: [
      { to: '/misc', label: '非工程采购', icon: Coins, module: 'misc_purchases' },
    ],
  },
  {
    title: '团队与进度',
    items: [
      { to: '/teams', label: '团队分组', icon: HardHat, module: 'teams' },
      { to: '/stages', label: '进度节点', icon: Milestone, module: 'team_stages' },
    ],
  },
  {
    title: '系统',
    items: [
      { to: '/roles', label: '角色与权限', icon: ShieldCheck, module: 'users' },
      { to: '/users', label: '用户管理', icon: Users, module: 'users' },
      { to: '/backup', label: '数据备份', icon: DatabaseBackup, module: 'backup' },
      { to: '/profile', label: '我的账号', icon: UserCircle2, module: '__account' },
    ],
  },
]

const ALL: NavItem[] = NAV.flatMap((g) => g.items)

export function Layout({ children }: { children: React.ReactNode }) {
  const { displayName, roleName, signOut, canView } = useAuth()
  const [drawer, setDrawer] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()

  const groups = useMemo(
    () =>
      NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.module || canView(i.module)) })).filter(
        (g) => g.items.length > 0
      ),
    [canView]
  )

  const current = ALL.find((i) => i.to === loc.pathname)
  const group = NAV.find((g) => g.items.some((i) => i.to === loc.pathname))?.title ?? '总览'

  const Sidebar = (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#151A20]">
      {/* 品牌区微光，让深色底不平板 */}
      <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-brand-500/25 blur-3xl" />

      <div className="relative flex items-start gap-2.5 px-4 py-5">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-aqua-500 text-white shadow-[0_10px_24px_-10px_rgba(6,182,212,0.95)]">
          <Droplets size={20} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[12.5px] font-semibold leading-snug text-white">沿海村落供水管网延伸工程</p>
          <p className="mt-0.5 text-[10px] leading-snug text-slate-400">{APP_REGION}</p>
          <p className="text-[10px] leading-snug text-slate-500">工程管理系统</p>
        </div>
      </div>

      <nav className="sidebar-scroll relative flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((g) => (
          <div key={g.title}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {g.title}
            </p>
            <div className="space-y-0.5">
              {g.items.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setDrawer(false)}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cx(
                        'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-all duration-150',
                        isActive
                          ? 'bg-gradient-to-r from-brand-500 to-aqua-500 font-medium text-white shadow-[0_10px_22px_-10px_rgba(6,182,212,0.95)] ring-1 ring-white/15'
                          : 'text-slate-300 hover:bg-white/[0.07] hover:text-white'
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          size={16}
                          className={cx(
                            'shrink-0 transition-colors',
                            isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-200'
                          )}
                        />
                        <span className="truncate">{item.label}</span>
                      </>
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="relative border-t border-white/[0.07] p-3">
        <div className="flex items-center gap-2.5 rounded-lg bg-white/[0.05] px-3 py-2.5 ring-1 ring-white/[0.06]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-aqua-500 text-xs font-semibold text-white">
            {displayName.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-medium text-slate-100">{displayName}</p>
            <p className="truncate text-[10px] text-slate-400">{roleName}</p>
          </div>
          <button
            title="退出登录"
            onClick={async () => {
              await signOut()
              nav('/')
            }}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-rose-300"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 lg:block">{Sidebar}</aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/35" onClick={() => setDrawer(false)} />
          <div className="relative h-full w-64 overflow-hidden shadow-pop animate-fade-in">
            <button
              onClick={() => setDrawer(false)}
              className="absolute right-3 top-4 z-10 rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>
            {Sidebar}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur lg:px-7">
          <button
            onClick={() => setDrawer(true)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <Menu size={18} />
          </button>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-slate-400">
            <span className="hidden sm:inline">{group}</span>
            <ChevronRight size={13} className="hidden sm:inline" />
            <span className="truncate font-medium text-slate-700">{current?.label ?? '工作台'}</span>
          </div>
          <div className="flex-1" />
          <div className="hidden max-w-[46%] items-center truncate text-[11px] text-slate-400 xl:flex" title={APP_SHORT}>
            {APP_SHORT}
          </div>
          <div className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-600 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            云端已连接
          </div>
          <div className="hidden items-center gap-1.5 text-[11px] text-slate-400 md:flex">
            <ShieldCheck size={13} />
            {roleName}
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6 lg:px-7">
          <div className="mx-auto w-full max-w-[1500px] flex-1 animate-fade-in">{children}</div>
          <Footer className="mt-6 shrink-0" />
        </main>
      </div>
    </div>
  )
}
