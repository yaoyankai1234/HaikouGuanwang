import React from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { AuthProvider, useAuth } from './store/auth'
import { DataProvider } from './store/data'
import { Button, EmptyState, Loading, UIProvider } from './components/ui'
import { Layout, NAV } from './components/Layout'
import { Login } from './pages/Login'
import Dashboard from './pages/Dashboard'
import MaterialCategories from './pages/MaterialCategories'
import Materials from './pages/Materials'
import Inventory from './pages/Inventory'
import Suppliers from './pages/Suppliers'
import PurchaseOrders from './pages/PurchaseOrders'
import Inbound from './pages/Inbound'
import Outbound from './pages/Outbound'
import Defects from './pages/Defects'
import Contracts from './pages/Contracts'
import Invoices from './pages/Invoices'
import Payments from './pages/Payments'
import MiscPurchases from './pages/MiscPurchases'
import Teams from './pages/Teams'
import TeamStages from './pages/TeamStages'
import Users from './pages/Users'
import Roles from './pages/Roles'
import Backup from './pages/Backup'
import Profile from './pages/Profile'

/** 模块级访问守卫：当前角色没有查看权限时给出明确提示，而不是空白页 */
function Guard({ module, children }: { module: string; children: React.ReactNode }) {
  const { canView } = useAuth()
  const nav = useNavigate()
  if (canView(module)) return <>{children}</>

  const first = NAV.flatMap((g) => g.items).find((i) => canView(i.module))
  return (
    <div className="card">
      <EmptyState
        icon={ShieldOff}
        title="当前角色没有该功能的访问权限"
        desc="请联系系统管理员在「角色与权限」中为你的角色开通对应模块。"
        action={
          first ? (
            <Button variant="primary" onClick={() => nav(first.to)}>
              前往{first.label}
            </Button>
          ) : null
        }
      />
    </div>
  )
}

function Shell() {
  const { ready, user } = useAuth()

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading label="正在连接云端数据…" />
      </div>
    )
  }

  if (!user) return <Login />

  return (
    <DataProvider enabled>
      <Layout>
        <Routes>
          <Route path="/" element={<Guard module="dashboard"><Dashboard /></Guard>} />
          <Route path="/categories" element={<Guard module="material_categories"><MaterialCategories /></Guard>} />
          <Route path="/materials" element={<Guard module="materials"><Materials /></Guard>} />
          <Route path="/inventory" element={<Guard module="inventory"><Inventory /></Guard>} />
          <Route path="/suppliers" element={<Guard module="suppliers"><Suppliers /></Guard>} />
          <Route path="/orders" element={<Guard module="purchase_orders"><PurchaseOrders /></Guard>} />
          <Route path="/inbound" element={<Guard module="inbound"><Inbound /></Guard>} />
          <Route path="/outbound" element={<Guard module="outbound"><Outbound /></Guard>} />
          <Route path="/defects" element={<Guard module="defects"><Defects /></Guard>} />
          <Route path="/contracts" element={<Guard module="contracts"><Contracts /></Guard>} />
          <Route path="/invoices" element={<Guard module="invoices"><Invoices /></Guard>} />
          <Route path="/payments" element={<Guard module="payments"><Payments /></Guard>} />
          <Route path="/misc" element={<Guard module="misc_purchases"><MiscPurchases /></Guard>} />
          <Route path="/teams" element={<Guard module="teams"><Teams /></Guard>} />
          <Route path="/stages" element={<Guard module="team_stages"><TeamStages /></Guard>} />
          <Route path="/roles" element={<Guard module="users"><Roles /></Guard>} />
          <Route path="/users" element={<Guard module="users"><Users /></Guard>} />
          <Route path="/backup" element={<Guard module="backup"><Backup /></Guard>} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </DataProvider>
  )
}

export default function App() {
  return (
    <UIProvider>
      <AuthProvider>
        <HashRouter>
          <Shell />
        </HashRouter>
      </AuthProvider>
    </UIProvider>
  )
}
