import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, setUnauthorizedHandler } from '../lib/api'
import { MODULE_ROLES, roleLabel } from '../lib/options'
import { selectAll } from '../lib/db'

export interface Profile {
  id: number
  name: string | null
  role: string
  phone: string | null
  created_at?: string
  must_change_password?: boolean
}

export interface SessionUser {
  id: number
  phone?: string | null
  name?: string | null
}

/** 角色定义（存于后端 roles 表，可由管理员编辑 / 新增） */
export interface RoleRow {
  id?: number
  code: string
  name: string
  description?: string | null
  is_system?: boolean
  sort?: number
}

export interface ModulePerm {
  view: boolean
  edit: boolean
}

interface AuthValue {
  ready: boolean
  user: SessionUser | null
  profile: Profile | null
  role: string
  roleName: string
  isAdmin: boolean
  /** 管理员重置密码后，用户需在登录后修改密码 */
  mustChangePassword: boolean
  /** 角色定义列表（含自定义角色） */
  roles: RoleRow[]
  /** 当前角色的模块权限 */
  perms: Record<string, ModulePerm>
  /** 某个角色在某模块上的权限（用于角色配置界面） */
  permOf: (roleCode: string, module: string) => ModulePerm
  canView: (module: string) => boolean
  canEdit: (module: string) => boolean
  displayName: string
  loginError: string | null
  clearLoginError: () => void
  setLoginError: (v: string | null) => void
  login: (phone: string, password: string) => Promise<void>
  reload: () => Promise<void>
  reloadRoles: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthValue>({
  ready: false,
  user: null,
  profile: null,
  role: 'viewer',
  roleName: '只读查看',
  isAdmin: false,
  mustChangePassword: false,
  roles: [],
  perms: {},
  permOf: () => ({ view: true, edit: false }),
  canView: () => true,
  canEdit: () => false,
  displayName: '',
  loginError: null,
  clearLoginError: () => {},
  setLoginError: () => {},
  login: async () => {},
  reload: async () => {},
  reloadRoles: async () => {},
  signOut: async () => {},
})

export const useAuth = () => useContext(Ctx)

/** 权限表未加载（或尚未建立）时的兜底视图权限：默认可查看 */
const FALLBACK_VIEW = true

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [permMap, setPermMap] = useState<Record<string, Record<string, ModulePerm>>>({})
  const [permLoaded, setPermLoaded] = useState(false)

  const loadProfile = useCallback(async () => {
    try {
      const res = await api.me()
      const u = res?.user
      if (!u) {
        setUser(null)
        setProfile(null)
        return
      }
      setUser({ id: u.id, phone: u.phone ?? null, name: u.name ?? null })
      setProfile({
        id: u.id,
        name: u.name ?? null,
        role: u.role,
        phone: u.phone ?? null,
        created_at: u.created_at,
        must_change_password: !!u.must_change_password,
      })
    } catch {
      setUser(null)
      setProfile(null)
    }
  }, [])

  /** 拉取角色定义与角色权限矩阵 */
  const reloadRoles = useCallback(async () => {
    try {
      const [rs, ps] = await Promise.all([
        selectAll<RoleRow>('roles', { order: 'sort', asc: true }),
        selectAll<{ role_code: string; module: string; can_view: boolean; can_edit: boolean }>(
          'role_permissions',
          { order: 'id', asc: true }
        ),
      ])
      const map: Record<string, Record<string, ModulePerm>> = {}
      ps.forEach((p) => {
        if (!map[p.role_code]) map[p.role_code] = {}
        map[p.role_code][p.module] = { view: !!p.can_view, edit: !!p.can_edit }
      })
      setRoles(rs)
      setPermMap(map)
      setPermLoaded(true)
    } catch {
      /* 表尚未就绪时保持兜底逻辑 */
    }
  }, [])

  useEffect(() => {
    let alive = true
    // 会话失效（任一请求返回 401）时自动回到登录页
    setUnauthorizedHandler(() => {
      setUser(null)
      setProfile(null)
    })
    ;(async () => {
      await loadProfile()
      await reloadRoles()
      if (alive) setReady(true)
    })()
    return () => {
      alive = false
      setUnauthorizedHandler(null)
    }
  }, [loadProfile, reloadRoles])

  const login = useCallback(
    async (phone: string, password: string) => {
      setLoginError(null)
      try {
        await api.login(phone, password)
        await loadProfile()
        await reloadRoles()
      } catch (e: any) {
        setLoginError(e?.message || '登录失败，请重试')
        throw e
      }
    },
    [loadProfile, reloadRoles]
  )

  const signOut = useCallback(async () => {
    await api.logout()
    setUser(null)
    setProfile(null)
  }, [])

  const role = profile?.role ?? 'viewer'
  const isAdmin = role === 'admin'

  const displayName =
    profile?.name?.trim() ||
    user?.name?.trim() ||
    (user?.phone ? `用户${String(user.phone).slice(-4)}` : '未命名用户')

  const perms = permMap[role] ?? {}

  const permOf = useCallback(
    (roleCode: string, module: string): ModulePerm => {
      if (roleCode === 'admin') return { view: true, edit: true }
      const p = permMap[roleCode]?.[module]
      if (p) return p
      if (!permLoaded) {
        return { view: FALLBACK_VIEW, edit: (MODULE_ROLES[module] ?? []).includes(roleCode) }
      }
      return { view: false, edit: false }
    },
    [permMap, permLoaded]
  )

  const roleName = useMemo(() => {
    const hit = roles.find((r) => r.code === role)
    return hit?.name ?? roleLabel(role)
  }, [roles, role])

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      user,
      profile,
      role,
      roleName,
      isAdmin,
      mustChangePassword: !!profile?.must_change_password,
      roles,
      perms,
      permOf,
      canView: (module: string) => (isAdmin ? true : permOf(role, module).view),
      canEdit: (module: string) => (isAdmin ? true : permOf(role, module).edit),
      displayName,
      loginError,
      clearLoginError: () => setLoginError(null),
      setLoginError,
      login,
      reload: loadProfile,
      reloadRoles,
      signOut,
    }),
    [
      ready,
      user,
      profile,
      role,
      roleName,
      isAdmin,
      roles,
      perms,
      permOf,
      displayName,
      loginError,
      login,
      loadProfile,
      reloadRoles,
      signOut,
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
