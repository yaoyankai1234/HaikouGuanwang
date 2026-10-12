/**
 * 自建后端（零依赖）：认证 + 通用数据接口 + 附件存储 + 前端静态托管。
 * 启动：node server/index.mjs    （默认端口 8787，可用 PORT 覆盖）
 *
 * 与旧版的最大区别：登录不再依赖任何第三方平台账号体系，
 * 账号由管理员在本系统「用户管理」中创建（手机号 + 密码），用户可自助改密。
 */
import http from 'node:http'
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join, normalize, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReadStream } from 'node:fs'
import { db, TABLE_MODULE, PUBLIC_READ_TABLES, VIEW_TABLES, DATA_DIR, UPLOAD_DIR, seedBase, importSeedDump, syncMaterialBase, ensureMaterialNameUnique, applyConstraints, reconcileDocTotals, constraintStatus, friendlyDbError, rowToJson, validatePayload } from './db.mjs'
import { hashPassword, verifyPassword, signToken, verifyToken, passwordProblem, isPhone } from './auth.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
/** 前端产物目录：优先 webui（随源码部署），兼容旧的 dist */
const DIST_DIR = (() => {
  const candidates = [join(__dirname, '..', 'webui'), join(__dirname, '..', 'dist')]
  return candidates.find((p) => existsSync(join(p, 'index.html'))) || candidates[0]
})()
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'
/** 构建标记：/api/version 返回它，用于确认线上跑的是哪一版后端 */
const BUILD_TAG = 'pms-2026-10-10-bugfix-01'

seedBase()
importSeedDump()
/** 物资分类 + 物资台账基础主数据补齐（只补不覆盖，幂等） */
syncMaterialBase()
/** 物资台账商品名称唯一（库内已有重名时只告警，不擅自改数据） */
ensureMaterialNameUnique()
/** 数据库 CHECK + 触发器兜底（BUG-R01/R02）；不影响现有数据 */
applyConstraints()
/** 单据头总额与明细一致性校准（BUG-R03） */
reconcileDocTotals()

// ---------------------------------------------------------------- 初始管理员
function ensureAdmin() {
  const n = db.prepare('SELECT count(*) AS n FROM app_users').get().n
  if (n > 0) return
  const phone = process.env.ADMIN_PHONE || '13800000000'
  const password = process.env.ADMIN_PASSWORD || 'admin123'
  const { salt, hash } = hashPassword(password)
  db.prepare(
    `INSERT INTO app_users (phone, password_salt, password_hash, name, role, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(phone, salt, hash, '系统管理员', 'admin', '启用', 'system', new Date().toISOString())
  console.log('\n==================================================')
  console.log(' 已创建初始管理员账号（首次启动）')
  console.log(`   手机号：${phone}`)
  console.log(`   密码：  ${password}`)
  console.log(' 请登录后立即在「我的账号」修改密码，并在「用户管理」添加其他成员。')
  console.log('==================================================\n')
}
ensureAdmin()

// ---------------------------------------------------------------- 工具函数
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8',
}
const mimeOf = (p) => MIME[extname(p).toLowerCase()] || 'application/octet-stream'

function sendJSON(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}
const ok = (res, data = null) => sendJSON(res, 200, { data, error: null })
const fail = (res, status, message, code = null) => sendJSON(res, status, { data: null, error: { message, code } })

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}
async function readJSON(req) {
  const buf = await readBody(req)
  if (!buf.length) return {}
  try {
    return JSON.parse(buf.toString('utf8'))
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

// ---------------------------------------------------------------- 账号 / 权限
function getUserById(id) {
  return db.prepare('SELECT * FROM app_users WHERE id = ?').get(id)
}
function publicUser(u) {
  return {
    id: u.id, phone: u.phone, name: u.name, role: u.role, status: u.status,
    must_change_password: !!u.must_change_password, created_at: u.created_at, last_login_at: u.last_login_at,
  }
}
function permMapOf(role) {
  if (role === 'admin') {
    const all = db.prepare('SELECT DISTINCT module FROM role_permissions').all()
    const m = {}
    all.forEach((r) => (m[r.module] = { view: true, edit: true }))
    return m
  }
  const rows = db.prepare('SELECT module, can_view, can_edit FROM role_permissions WHERE role_code = ?').all(role)
  const m = {}
  rows.forEach((r) => (m[r.module] = { view: !!r.can_view, edit: !!r.can_edit }))
  return m
}
function canView(user, module) {
  if (user.role === 'admin') return true
  const p = permMapOf(user.role)[module]
  return !!(p && p.view)
}
function canEdit(user, module) {
  if (user.role === 'admin') return true
  const p = permMapOf(user.role)[module]
  return !!(p && p.edit)
}

function authenticate(req, url) {
  for (const token of tokenCandidates(req, url)) {
    const payload = verifyToken(token)
    if (!payload) continue
    const u = getUserById(payload.uid)
    if (u && u.status === '启用') return u
  }
  return null
}

/**
 * 收集请求里所有可能的会话令牌，按可信度排序。
 *
 * 关键坑：线上网关（CloudStudio/EO）会给每个请求**注入它自己的 Authorization 头**，
 * 把客户端带的令牌整个覆盖掉，所以服务端始终拿到一个验不过的外来令牌 ——
 * 表现为本地一切正常、线上「刚登录就提示登录态失效」。
 * 因此这里把自定义头 / query / Cookie 排在 Authorization 之前，逐个校验。
 */
function tokenCandidates(req, url) {
  const h = req.headers || {}
  const out = []

  const custom = String(h['x-pms-token'] || h['x-auth-token'] || '').trim()
  if (custom) out.push(custom)

  const qs = (url?.searchParams?.get('token') || '').trim()
  if (qs) out.push(qs)

  const m = /(?:^|;\s*)pms_token=([^;]*)/.exec(String(h['cookie'] || ''))
  if (m) {
    try {
      out.push(decodeURIComponent(m[1]).trim())
    } catch {
      out.push(m[1].trim())
    }
  }

  const raw = String(h['authorization'] || '')
  const bearer = /^bearer\s+/i.test(raw) ? raw.replace(/^bearer\s+/i, '').trim() : ''
  if (bearer) out.push(bearer)

  return out.filter(Boolean)
}

// ---------------------------------------------------------------- 数据表列
const colCache = new Map()
function columnsOf(table) {
  if (colCache.has(table)) return colCache.get(table)
  let cols = []
  try {
    cols = db.prepare(`PRAGMA table_info("${table}")`).all().map((r) => r.name)
    if (!cols.length) {
      cols = db.prepare(`PRAGMA table_info("${table}")`).all().map((r) => r.name)
    }
  } catch {
    cols = []
  }
  colCache.set(table, cols)
  return cols
}
/**
 * node:sqlite 只接受 null / number / bigint / string / Buffer，
 * 布尔（例如角色权限里的 can_view / can_edit 勾选）会直接抛
 * 「Provided value cannot be bound to SQLite parameter N」，这里统一归一化。
 */
function toSqlValue(v) {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' || typeof v === 'bigint') return v
  if (Buffer.isBuffer(v)) return v
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

function pickColumns(table, payload) {
  const cols = new Set(columnsOf(table))
  const out = {}
  for (const [k, v] of Object.entries(payload || {})) {
    if (k === 'id') continue
    if (cols.has(k)) out[k] = toSqlValue(v)
  }
  return out
}

/**
 * 计算某物资当前可用库存 = 入库合计 - 已出库合计 - 损耗合计。
 * excludeOutboundId：PATCH 单条明细时，排除自身避免重复计入。
 * BUG-R02 兜底：让应用层就能拒掉超额出库，数据库触发器作为最后一道保险。
 */
function currentStockOf(materialId, excludeOutboundId = null) {
  if (!Number.isFinite(Number(materialId))) return Infinity
  const inQty = Number(db.prepare('SELECT COALESCE(SUM(qty),0) AS s FROM inbound_items WHERE material_id = ?').get(materialId).s)
  const outWhere = excludeOutboundId
    ? 'material_id = ? AND id <> ?'
    : 'material_id = ?'
  const outArgs = excludeOutboundId ? [materialId, excludeOutboundId] : [materialId]
  const outQty = Number(db.prepare(`SELECT COALESCE(SUM(qty),0) AS s FROM outbound_items WHERE ${outWhere}`).get(...outArgs).s)
  const defQty = Number(db.prepare('SELECT COALESCE(SUM(qty),0) AS s FROM defects WHERE material_id = ?').get(materialId).s)
  return inQty - outQty - defQty
}

function resolveTable(table) {
  if (!table || !/^[a-z_][a-z0-9_]*$/.test(table)) return null
  if (!TABLE_MODULE[table]) return null
  return table
}

// ---------------------------------------------------------------- 路由处理
async function handleAuth(req, res, url) {
  const p = url.pathname

  if (p === '/api/auth/login' && req.method === 'POST') {
    const body = await readJSON(req)
    const phone = String(body.phone || '').trim()
    const password = String(body.password || '')
    if (!isPhone(phone)) return fail(res, 400, '请输入正确的 11 位手机号')
    const u = db.prepare('SELECT * FROM app_users WHERE phone = ?').get(phone)
    if (!u || !verifyPassword(password, u.password_salt, u.password_hash)) {
      return fail(res, 401, '手机号或密码不正确')
    }
    if (u.status !== '启用') return fail(res, 403, '该账号已被停用，请联系管理员')
    db.prepare('UPDATE app_users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), u.id)
    const token = signToken({ uid: u.id, role: u.role, phone: u.phone })
    return ok(res, { token, user: publicUser(u), perms: permMapOf(u.role) })
  }

  // 以下均需要登录
  const me = authenticate(req, url)
  if (!me) return fail(res, 401, '登录状态已失效，请重新登录', 'unauthenticated')

  if (p === '/api/auth/me' && req.method === 'GET') {
    return ok(res, { user: publicUser(me), perms: permMapOf(me.role) })
  }

  if (p === '/api/auth/logout' && req.method === 'POST') {
    return ok(res, null)
  }

  if (p === '/api/auth/profile' && req.method === 'POST') {
    const body = await readJSON(req)
    const name = String(body.name || '').trim()
    if (!name) return fail(res, 400, '请填写姓名')
    const phone = String(body.phone || '').trim() || null
    db.prepare('UPDATE app_users SET name = ?, phone = ?, updated_at = ? WHERE id = ?').run(
      name, phone, new Date().toISOString(), me.id
    )
    return ok(res, publicUser(getUserById(me.id)))
  }

  if (p === '/api/auth/change-password' && req.method === 'POST') {
    const body = await readJSON(req)
    const oldPwd = String(body.oldPassword || '')
    const newPwd = String(body.newPassword || '')
    const prob = passwordProblem(newPwd)
    if (prob) return fail(res, 400, prob)
    // 管理员重置后首次改密，可不校验旧密码
    if (!me.must_change_password && !verifyPassword(oldPwd, me.password_salt, me.password_hash)) {
      return fail(res, 400, '当前密码不正确')
    }
    const { salt, hash } = hashPassword(newPwd)
    db.prepare(
      'UPDATE app_users SET password_salt = ?, password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?'
    ).run(salt, hash, new Date().toISOString(), me.id)
    return ok(res, null)
  }

  return fail(res, 404, '接口不存在')
}

async function handleUsers(req, res, url) {
  const me = authenticate(req, url)
  if (!me) return fail(res, 401, '登录状态已失效，请重新登录', 'unauthenticated')
  if (me.role !== 'admin') return fail(res, 403, '仅系统管理员可管理账号')

  const parts = url.pathname.split('/').filter(Boolean) // api users [id] [action]
  const id = parts[2] ? Number(parts[2]) : null
  const action = parts[3]

  if (!id && req.method === 'GET') {
    const rows = db.prepare('SELECT * FROM app_users ORDER BY created_at ASC').all()
    return ok(res, rows.map(publicUser))
  }

  if (!id && req.method === 'POST') {
    const b = await readJSON(req)
    const phone = String(b.phone || '').trim()
    if (!isPhone(phone)) return fail(res, 400, '请输入正确的 11 位手机号')
    const exists = db.prepare('SELECT id FROM app_users WHERE phone = ?').get(phone)
    if (exists) return fail(res, 400, '该手机号已存在')
    const pwd = String(b.password || '')
    const prob = passwordProblem(pwd)
    if (prob) return fail(res, 400, prob)
    const { salt, hash } = hashPassword(pwd)
    const role = String(b.role || 'viewer')
    const status = String(b.status || '启用')
    const name = String(b.name || '').trim() || `用户${phone.slice(-4)}`
    const info = db
      .prepare(
        `INSERT INTO app_users (phone, password_salt, password_hash, name, role, status, must_change_password, remark, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(phone, salt, hash, name, role, status, 1, b.remark ?? null, String(me.id), new Date().toISOString())
    return ok(res, publicUser(getUserById(Number(info.lastInsertRowid))))
  }

  if (id && action === 'reset-password' && req.method === 'POST') {
    const b = await readJSON(req)
    const pwd = String(b.password || '')
    const prob = passwordProblem(pwd)
    if (prob) return fail(res, 400, prob)
    const target = getUserById(id)
    if (!target) return fail(res, 404, '账号不存在')
    const { salt, hash } = hashPassword(pwd)
    db.prepare(
      'UPDATE app_users SET password_salt = ?, password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?'
    ).run(salt, hash, new Date().toISOString(), id)
    return ok(res, null)
  }

  if (id && req.method === 'PATCH') {
    const b = await readJSON(req)
    const target = getUserById(id)
    if (!target) return fail(res, 404, '账号不存在')
    const fields = []
    const values = []
    if (b.name !== undefined) { fields.push('name = ?'); values.push(String(b.name).trim()) }
    if (b.phone !== undefined) {
      const phone = String(b.phone).trim()
      if (!isPhone(phone)) return fail(res, 400, '请输入正确的 11 位手机号')
      fields.push('phone = ?'); values.push(phone)
    }
    if (b.role !== undefined) {
      if (target.id === me.id && String(b.role) !== 'admin') return fail(res, 400, '不能取消自己的管理员角色')
      fields.push('role = ?'); values.push(String(b.role))
    }
    if (b.status !== undefined) {
      if (target.id === me.id && String(b.status) !== '启用') return fail(res, 400, '不能停用自己的账号')
      fields.push('status = ?'); values.push(String(b.status))
    }
    if (b.remark !== undefined) { fields.push('remark = ?'); values.push(b.remark) }
    if (!fields.length) return ok(res, publicUser(target))
    fields.push('updated_at = ?'); values.push(new Date().toISOString())
    values.push(id)
    db.prepare(`UPDATE app_users SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return ok(res, publicUser(getUserById(id)))
  }

  if (!id && req.method === 'DELETE') {
    const idsParam = url.searchParams.get('ids') || ''
    const ids = idsParam
      .split(',')
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0)
    if (!ids.length) return fail(res, 400, '缺少要删除的账号 id')
    const del = db.prepare('DELETE FROM app_users WHERE id = ?')
    let deleted = 0
    const skipped = []
    for (const i of ids) {
      if (i === me.id) {
        skipped.push(i) // 不允许删除自己
        continue
      }
      deleted += del.run(i).changes
    }
    return ok(res, { deleted, skipped })
  }

  if (id && req.method === 'DELETE') {
    if (id === me.id) return fail(res, 400, '不能删除自己的账号')
    db.prepare('DELETE FROM app_users WHERE id = ?').run(id)
    return ok(res, null)
  }

  return fail(res, 404, '接口不存在')
}

async function handleData(req, res, url) {
  const me = authenticate(req, url)
  if (!me) return fail(res, 401, '登录状态已失效，请重新登录', 'unauthenticated')

  const parts = url.pathname.split('/').filter(Boolean) // api data <table> [id|count]
  const table = resolveTable(parts[2])
  if (!table) return fail(res, 404, `不支持的资源：${parts[2] || ''}`)
  const module = TABLE_MODULE[table]
  const readonlyView = VIEW_TABLES.has(table)
  const q = url.searchParams

  const needEdit = req.method !== 'GET'
  if (needEdit) {
    if (readonlyView) return fail(res, 400, '该数据为只读视图，不支持写入')
    if (!canEdit(me, module)) return fail(res, 403, '当前角色没有该模块的修改权限')
  } else if (PUBLIC_READ_TABLES.has(table)) {
    /* 角色与权限矩阵对所有登录用户开放读取 */
  } else if (!canView(me, module)) {
    return fail(res, 403, '当前角色没有该模块的查看权限')
  }

  const key = parts[3]

  if (req.method === 'GET' && key === 'count') {
    const r = db.prepare(`SELECT count(*) AS n FROM "${table}"`).get()
    return ok(res, { count: Number(r.n) })
  }

  if (req.method === 'GET') {
    const order = q.get('order') || 'id'
    const asc = q.get('asc') === '1'
    const limit = Math.min(Number(q.get('limit') || 5000), 200000)
    const offset = Number(q.get('offset') || 0)
    const cols = columnsOf(table)
    const orderCol = cols.includes(order) ? order : cols.includes('id') ? 'id' : cols[0]
    const rows = db
      .prepare(`SELECT * FROM "${table}" ORDER BY "${orderCol}" ${asc ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`)
      .all(limit, offset)
    return ok(res, rows.map(rowToJson))
  }

  if (req.method === 'POST') {
    const body = await readJSON(req)
    const list = Array.isArray(body) ? body : [body]
    const cols = columnsOf(table)
    const created = []
    const ins = (payload) => {
      const v = validatePayload(table, payload)
      if (!v.ok) throw new Error(v.message)
      const row = pickColumns(table, payload)
      if (cols.includes('created_at') && !row.created_at) row.created_at = new Date().toISOString()
      const keys = Object.keys(row)
      if (!keys.length) throw new Error('没有可写入的字段')
      // 应用层兜底：出库明细超额拦截（数据库触发器作最后兜底）
      if (table === 'outbound_items' && row.material_id != null && Number.isFinite(Number(row.qty))) {
        const stock = currentStockOf(Number(row.material_id))
        if (Number(row.qty) > stock) {
          throw new Error(`OUTBOUND_STOCK_EXCEEDED:物资${row.material_id} 当前可用 ${stock}，本次出库 ${row.qty}`)
        }
      }
      const sql = `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`
      const info = db.prepare(sql).run(...keys.map((k) => row[k]))
      return db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(Number(info.lastInsertRowid))
    }
    try {
      for (const item of list) created.push(rowToJson(ins(item)))
    } catch (e) {
      const friendly = friendlyDbError(table, e)
      if (friendly) return fail(res, 400, friendly)
      const msg = e?.message || ''
      if (msg.includes('OUTBOUND_STOCK_EXCEEDED')) {
        return fail(res, 400, msg.split(':').slice(1).join(':') || '出库数量超出可用库存')
      }
      if (/CHECK constraint failed/.test(msg)) {
        return fail(res, 400, `数据值不合法：${msg.split('CHECK constraint failed:')[1]?.trim() || msg}`)
      }
      throw e
    }
    return ok(res, Array.isArray(body) ? created : created[0])
  }

  const id = Number(key)
  if (req.method === 'PATCH' && key) {
    const body = await readJSON(req)
    const v = validatePayload(table, body)
    if (!v.ok) return fail(res, 400, v.message)
    const row = pickColumns(table, body)
    const keys = Object.keys(row)
    if (!keys.length) return ok(res, rowToJson(db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id)))
    // 应用层兜底：出库明细 PATCH 时超额拦截
    if (table === 'outbound_items' && row.material_id != null && Number.isFinite(Number(row.qty))) {
      const stock = currentStockOf(Number(row.material_id), id)
      if (Number(row.qty) > stock) {
        return fail(res, 400, `出库数量超出可用库存：当前可用 ${stock}，本次提交 ${row.qty}`)
      }
    }
    try {
      db.prepare(`UPDATE "${table}" SET ${keys.map((k) => `"${k}" = ?`).join(', ')} WHERE id = ?`).run(
        ...keys.map((k) => row[k]), id
      )
    } catch (e) {
      const friendly = friendlyDbError(table, e)
      if (friendly) return fail(res, 400, friendly)
      const msg = e?.message || ''
      if (msg.includes('OUTBOUND_STOCK_EXCEEDED')) {
        return fail(res, 400, msg.split(':').slice(1).join(':') || '出库数量超出可用库存')
      }
      if (/CHECK constraint failed/.test(msg)) {
        return fail(res, 400, `数据值不合法：${msg.split('CHECK constraint failed:')[1]?.trim() || msg}`)
      }
      throw e
    }
    const after = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id)
    if (!after) return fail(res, 404, '记录不存在')
    return ok(res, rowToJson(after))
  }

  if (req.method === 'DELETE') {
    const idsParam = q.get('ids')
    if (idsParam) {
      const ids = idsParam.split(',').map((s) => Number(s)).filter((n) => Number.isFinite(n))
      if (!ids.length) return ok(res, { deleted: 0, skipped: [] })
      const del = db.prepare(`DELETE FROM "${table}" WHERE id = ?`)
      let deleted = 0
      const skipped = []
      for (const i of ids) {
        try {
          const r = del.run(i)
          deleted += r.changes
          if (!r.changes) skipped.push(i)
        } catch (e) {
          skipped.push(i)
        }
      }
      return ok(res, { deleted, skipped })
    }
    if (!key) return fail(res, 400, '缺少记录 id')
    const info = db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id)
    if (!info.changes) return fail(res, 404, '记录不存在或已被删除')
    return ok(res, { deleted: 1, skipped: [] })
  }

  return fail(res, 405, '方法不被支持')
}

async function handleFiles(req, res, url) {
  const me = authenticate(req, url)
  if (!me) return fail(res, 401, '登录状态已失效，请重新登录', 'unauthenticated')

  const rel = decodeURIComponent(url.searchParams.get('path') || '')
  const safe = normalize(rel).replace(/^([.]{2}[/\\])+/, '').replace(/^[/\\]+/, '')
  if (!safe || safe.includes('..')) return fail(res, 400, '非法的文件路径')
  const abs = join(UPLOAD_DIR, safe)
  if (!abs.startsWith(UPLOAD_DIR)) return fail(res, 400, '非法的文件路径')

  if (req.method === 'POST') {
    const buf = await readBody(req)
    if (!buf.length) return fail(res, 400, '上传内容为空')
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, buf)
    return ok(res, { path: safe, size: buf.length })
  }

  if (req.method === 'GET') {
    if (!existsSync(abs)) return fail(res, 404, '文件不存在')
    const name = url.searchParams.get('name') || safe.split('/').pop()
    res.writeHead(200, {
      'Content-Type': mimeOf(safe),
      'Access-Control-Allow-Origin': '*',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    })
    createReadStream(abs).pipe(res)
    return
  }

  if (req.method === 'DELETE') {
    try {
      const { unlink } = await import('node:fs/promises')
      await unlink(abs)
    } catch {
      /* 忽略 */
    }
    return ok(res, null)
  }

  return fail(res, 405, '方法不被支持')
}

// ---------------------------------------------------------------- 静态资源
async function serveStatic(req, res, url) {
  if (!existsSync(DIST_DIR)) {
    return fail(res, 404, '前端尚未构建（缺少 dist 目录）。开发时请用 vite dev，生产请先 npm run build')
  }
  let rel = decodeURIComponent(url.pathname)
  if (rel === '/' || rel === '') rel = '/index.html'
  let abs = join(DIST_DIR, normalize(rel).replace(/^(\.\.[/\\])+/, ''))
  if (!abs.startsWith(DIST_DIR)) abs = join(DIST_DIR, 'index.html')
  try {
    const st = await stat(abs)
    if (st.isDirectory()) abs = join(abs, 'index.html')
  } catch {
    abs = join(DIST_DIR, 'index.html') // SPA 回退
  }
  const body = await readFile(abs)
  res.writeHead(200, { 'Content-Type': mimeOf(abs), 'Access-Control-Allow-Origin': '*' })
  res.end(body)
}

// ---------------------------------------------------------------- 主入口
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const p = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Max-Age': '86400',
    })
    return res.end()
  }

  try {
    if (p.startsWith('/api/auth')) return await handleAuth(req, res, url)
    if (p.startsWith('/api/users')) return await handleUsers(req, res, url)
    if (p.startsWith('/api/data')) return await handleData(req, res, url)
    if (p.startsWith('/api/files')) return await handleFiles(req, res, url)
    if (p === '/api/health') {
      // 健康检查顺带返回两张基础主数据表的行数，便于确认「物资分类 / 物资台账」是否已就绪
      let dbStat = null
      try {
        dbStat = {
          material_categories: Number(db.prepare('SELECT count(*) AS n FROM material_categories').get().n),
          materials: Number(db.prepare('SELECT count(*) AS n FROM materials').get().n),
          // 商品名称唯一索引是否生效（存在重名数据时为 false，需人工处理后重启）
          materials_name_unique: constraintStatus.materialsNameUnique,
          materials_duplicate_names: constraintStatus.materialsDuplicateNames,
          // 数据库 CHECK 约束与出库触发器是否已装上（BUG-R01/R02 兜底）
          constraints_applied: constraintStatus.applied,
          constraints_at: constraintStatus.appliedAt,
          constraints_check_count: constraintStatus.checkCount,
          constraints_trigger_count: constraintStatus.triggerCount,
          constraints_failed: constraintStatus.failedConstraints,
        }
      } catch {
        dbStat = null
      }
      return ok(res, { status: 'up', time: new Date().toISOString(), db: dbStat })
    }
    if (p === '/api/version') return ok(res, { name: 'water-supply-pms', version: BUILD_TAG, node: process.version })
    if (p.startsWith('/api/')) return fail(res, 404, '接口不存在')
    return await serveStatic(req, res, url)
  } catch (e) {
    console.error('[server]', e)
    return fail(res, 500, e?.message || '服务器内部错误')
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[pms] 服务已启动： http://${HOST}:${PORT}`)
  console.log(`[pms] 前端目录： ${DIST_DIR}`)
  console.log(`[pms] 数据文件： ${join(DATA_DIR, 'pms.db')}`)
})
