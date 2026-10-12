import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { selectAll, type Row } from '../lib/db'

export interface Lookups {
  suppliers: Row[]
  categories: Row[]
  materials: Row[]
  teams: Row[]
  stages: Row[]
  contracts: Row[]
  orders: Row[]
}

const EMPTY: Lookups = {
  suppliers: [],
  categories: [],
  materials: [],
  teams: [],
  stages: [],
  contracts: [],
  orders: [],
}

export interface DataValue extends Lookups {
  loading: boolean
  refresh: () => Promise<void>
  supplierById: (id: any) => Row | undefined
  categoryById: (id: any) => Row | undefined
  materialById: (id: any) => Row | undefined
  teamById: (id: any) => Row | undefined
  stageById: (id: any) => Row | undefined
  contractById: (id: any) => Row | undefined
  label: (rows: Row[], id: any, key?: string) => string
}

const Ctx = createContext<DataValue>({
  ...EMPTY,
  loading: false,
  refresh: async () => {},
  supplierById: () => undefined,
  categoryById: () => undefined,
  materialById: () => undefined,
  teamById: () => undefined,
  stageById: () => undefined,
  contractById: () => undefined,
  label: () => '',
})

export const useData = () => useContext(Ctx)

/** 单表加载失败时返回空数组，避免一张表没权限就拖垮全部基础数据 */
async function safeAll(table: string, opts?: { order?: string; asc?: boolean }): Promise<Row[]> {
  try {
    return await selectAll(table, opts)
  } catch {
    return []
  }
}

export function DataProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [data, setData] = useState<Lookups>(EMPTY)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      // 逐表独立加载：某个模块没有查看权限时，不应影响其它模块的基础数据
      const [suppliers, categories, materials, teams, stages, contracts, orders] = await Promise.all([
        safeAll('suppliers'),
        safeAll('material_categories', { order: 'id', asc: true }),
        safeAll('materials', { order: 'id', asc: true }),
        safeAll('teams', { order: 'id', asc: true }),
        safeAll('team_stages', { order: 'seq', asc: true }),
        safeAll('contracts'),
        safeAll('purchase_orders'),
      ])
      setData({ suppliers, categories, materials, teams, stages, contracts, orders })
    } catch {
      setData(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<DataValue>(() => {
    const index = (rows: Row[]) => {
      const m = new Map<string, Row>()
      rows.forEach((r) => m.set(String(r.id), r))
      return m
    }
    const sIdx = index(data.suppliers)
    const cIdx = index(data.categories)
    const mIdx = index(data.materials)
    const tIdx = index(data.teams)
    const gIdx = index(data.stages)
    const kIdx = index(data.contracts)
    return {
      ...data,
      loading,
      refresh,
      supplierById: (id) => sIdx.get(String(id)),
      categoryById: (id) => cIdx.get(String(id)),
      materialById: (id) => mIdx.get(String(id)),
      teamById: (id) => tIdx.get(String(id)),
      stageById: (id) => gIdx.get(String(id)),
      contractById: (id) => kIdx.get(String(id)),
      label: (rows, id, key = 'name') => String(rows.find((r) => String(r.id) === String(id))?.[key] ?? ''),
    }
  }, [data, loading, refresh])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
