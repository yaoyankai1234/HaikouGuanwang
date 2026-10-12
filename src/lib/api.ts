/**
 * 自建后端接口客户端：认证 / 数据 / 用户 / 附件。
 * 所有请求走 /api/*，登录凭据为 JWT，存于 localStorage。
 */
import { API_BASE } from '../cloud'

const TOKEN_KEY = 'pms.auth.token'
const COOKIE_KEY = 'pms_token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/** 把令牌同时写入 Cookie：同源直链打开附件、以及网关吞掉 Authorization 时仍然可用 */
function writeCookie(token: string | null) {
  try {
    if (typeof document === 'undefined') return
    const secure = location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = token
      ? `${COOKIE_KEY}=${encodeURIComponent(token)}; path=/; max-age=604800; SameSite=Lax${secure}`
      : `${COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax${secure}`
  } catch {
    /* 忽略 */
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* 忽略隐私模式下的存储异常 */
  }
  writeCookie(token)
}

/**
 * 统一携带令牌：同时用 Authorization 和 X-Pms-Token 两个头。
 * 线上的网关会把 Authorization 头丢掉，只靠它会导致「刚登录就提示登录态失效」。
 */
function authHeaders(): Record<string, string> {
  const token = getToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}`, 'X-Pms-Token': token }
}

export class ApiError extends Error {
  code: string | null
  status: number
  constructor(message: string, code: string | null = null, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/** 会话失效回调：由 auth store 注册，用于自动回到登录页 */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

async function request<T = any>(method: string, path: string, body?: any): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() }
  let payload: string | undefined
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  let res: Response
  try {
    res = await fetch(API_BASE + path, { method, headers, body: payload, credentials: 'same-origin' })
  } catch {
    throw new ApiError('无法连接服务器，请检查网络或后端服务是否已启动', 'network', 0)
  }

  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (res.status === 401) {
    setToken(null)
    onUnauthorized?.()
  }

  if (!res.ok || (json && json.error)) {
    const err = json?.error || {}
    throw new ApiError(err.message || `请求失败（HTTP ${res.status}）`, err.code ?? null, res.status)
  }
  return (json?.data ?? null) as T
}

export interface SessionUser {
  id: number
  phone: string
  name: string | null
  role: string
  status?: string
  must_change_password?: boolean
  created_at?: string
  last_login_at?: string | null
}

export type Perms = Record<string, { view: boolean; edit: boolean }>

export interface SelectOpts {
  order?: string
  asc?: boolean
  limit?: number
  offset?: number
  /** 兼容旧调用：后端始终返回整行，此字段被忽略 */
  select?: string
}

export const api = {
  // ------------------------------------------------------------- 认证
  async login(phone: string, password: string): Promise<{ token: string; user: SessionUser; perms: Perms }> {
    const res = await request<{ token: string; user: SessionUser; perms: Perms }>('POST', '/api/auth/login', {
      phone,
      password,
    })
    setToken(res.token)
    return res
  },
  async logout(): Promise<void> {
    try {
      await request('POST', '/api/auth/logout')
    } catch {
      /* 无论服务端结果如何，本地一律清空 */
    }
    setToken(null)
  },
  me(): Promise<{ user: SessionUser; perms: Perms }> {
    return request('GET', '/api/auth/me')
  },
  changePassword(oldPassword: string, newPassword: string): Promise<null> {
    return request('POST', '/api/auth/change-password', { oldPassword, newPassword })
  },
  updateProfile(payload: { name: string; phone?: string | null }): Promise<SessionUser> {
    return request('POST', '/api/auth/profile', payload)
  },

  // ------------------------------------------------------------- 数据
  selectAll<T = any>(table: string, opts: SelectOpts = {}): Promise<T[]> {
    const { order = 'id', asc = false, limit = 5000, offset = 0 } = opts
    const qs = new URLSearchParams({
      order,
      asc: asc ? '1' : '0',
      limit: String(limit),
      offset: String(offset),
    })
    return request<T[]>('GET', `/api/data/${table}?${qs.toString()}`)
  },
  async countRows(table: string): Promise<number> {
    const r = await request<{ count: number }>('GET', `/api/data/${table}/count`)
    return r?.count ?? 0
  },
  async insertRow(table: string, row: Record<string, any>): Promise<any> {
    const r = await request<any>('POST', `/api/data/${table}`, row)
    return Array.isArray(r) ? r[0] : r
  },
  insertRows(table: string, rows: Record<string, any>[]): Promise<any[]> {
    if (!rows.length) return Promise.resolve([])
    return request<any[]>('POST', `/api/data/${table}`, rows)
  },
  updateRow(table: string, id: number | string, patch: Record<string, any>): Promise<any> {
    return request('PATCH', `/api/data/${table}/${id}`, patch)
  },
  async deleteRow(table: string, id: number | string): Promise<void> {
    await request('DELETE', `/api/data/${table}/${id}`)
  },
  /** 批量删除：返回 {deleted, skipped}，与 /api/users 对齐；调用方按新结构判断成功条数 */
  async deleteRows(table: string, ids: (number | string)[]): Promise<{ deleted: number; skipped: number[] }> {
    const out = { deleted: 0, skipped: [] as number[] }
    if (!ids.length) return out
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const r = await request<{ deleted: number; skipped: number[] }>(
        'DELETE',
        `/api/data/${table}?ids=${chunk.join(',')}`
      )
      out.deleted += r?.deleted ?? 0
      if (r?.skipped?.length) out.skipped.push(...r.skipped)
    }
    return out
  },
  /** 分页读取整表（备份用，突破单次上限） */
  async selectAllPaged<T = any>(
    table: string,
    opts: { pageSize?: number; maxRows?: number } = {}
  ): Promise<T[]> {
    const { pageSize = 1000, maxRows = 200000 } = opts
    const out: T[] = []
    for (let offset = 0; offset < maxRows; offset += pageSize) {
      const batch = await request<T[]>('GET',
        `/api/data/${table}?order=id&asc=1&limit=${pageSize}&offset=${offset}`
      )
      out.push(...(batch ?? []))
      if (!batch || batch.length < pageSize) break
    }
    return out
  },
  /** 清空整表（覆盖导入用），返回删除行数 */
  async deleteAllRows(table: string): Promise<number> {
    const rows = await api.selectAllPaged<{ id: any }>(table)
    const ids = rows.map((r) => r.id).filter((v) => v !== null && v !== undefined)
    if (!ids.length) return 0
    let removed = 0
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      removed += chunk.length
      await request('DELETE', `/api/data/${table}?ids=${chunk.join(',')}`)
    }
    return removed
  },

  // ------------------------------------------------------------- 账号管理（管理员）
  listUsers(): Promise<SessionUser[]> {
    return request<SessionUser[]>('GET', '/api/users')
  },
  createUser(payload: {
    phone: string
    name?: string
    role: string
    password: string
    status?: string
    remark?: string | null
  }): Promise<SessionUser> {
    return request('POST', '/api/users', payload)
  },
  updateUser(
    id: number,
    patch: { phone?: string; name?: string; role?: string; status?: string; remark?: string | null }
  ): Promise<SessionUser> {
    return request('PATCH', `/api/users/${id}`, patch)
  },
  resetPassword(id: number, password: string): Promise<null> {
    return request('POST', `/api/users/${id}/reset-password`, { password })
  },
  async deleteUser(id: number): Promise<void> {
    await request('DELETE', `/api/users/${id}`)
  },
  /** 批量删除账号，返回实际删除数量与被跳过的账号（如自己） */
  async deleteUsers(ids: number[]): Promise<{ deleted: number; skipped: number[] }> {
    if (!ids.length) return { deleted: 0, skipped: [] }
    let deleted = 0
    const skipped: number[] = []
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const r = await request<{ deleted: number; skipped: number[] }>(
        'DELETE',
        `/api/users?ids=${chunk.join(',')}`
      )
      deleted += r?.deleted ?? 0
      if (r?.skipped?.length) skipped.push(...r.skipped)
    }
    return { deleted, skipped }
  },

  // ------------------------------------------------------------- 附件
  async uploadFile(path: string, file: File): Promise<string> {
    const headers: Record<string, string> = { ...authHeaders() }
    let res: Response
    try {
      res = await fetch(`${API_BASE}/api/files?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers,
        body: file,
        credentials: 'same-origin',
      })
    } catch {
      throw new ApiError('附件上传失败：无法连接服务器', 'network', 0)
    }
    const text = await res.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    if (res.status === 401) {
      setToken(null)
      onUnauthorized?.()
    }
    if (!res.ok || json?.error) {
      throw new ApiError(json?.error?.message || `附件上传失败（HTTP ${res.status}）`, json?.error?.code ?? null, res.status)
    }
    return (json?.data?.path ?? path) as string
  },
  /** 以登录态取得附件内容并生成本地可打开的地址 */
  async fileBlobUrl(path: string): Promise<string> {
    const res = await fetch(`${API_BASE}/api/files?path=${encodeURIComponent(path)}`, {
      headers: authHeaders(),
      credentials: 'same-origin',
    })
    if (!res.ok) throw new ApiError('无法打开附件', null, res.status)
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  },
  /** 附件直链（无需 JS 拉取，靠 Cookie 带登录态） */
  fileUrl(path: string, name?: string): string {
    const qs = new URLSearchParams({ path })
    if (name) qs.set('name', name)
    return `${API_BASE}/api/files?${qs.toString()}`
  },
}
