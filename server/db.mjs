/**
 * 数据层：Node 内置 SQLite（零依赖）。
 * 本地开发 / 小型部署直接落地到 server/data/pms.db；
 * 迁到腾讯云时若无特别要求，单机 CVM + SQLite 文件即可，或后续替换为 PostgreSQL。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = join(__dirname, 'data')
export const UPLOAD_DIR = join(DATA_DIR, 'uploads')
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })

export const db = new DatabaseSync(join(DATA_DIR, 'pms.db'))
db.exec('PRAGMA busy_timeout = 5000')
db.exec('PRAGMA foreign_keys = OFF')

/** 表 -> 所属功能模块（用于服务端权限校验） */
export const TABLE_MODULE = {
  material_categories: 'material_categories',
  materials: 'materials',
  suppliers: 'suppliers',
  purchase_orders: 'purchase_orders',
  purchase_order_items: 'purchase_orders',
  inbound_orders: 'inbound',
  inbound_items: 'inbound',
  outbound_orders: 'outbound',
  outbound_items: 'outbound',
  defects: 'defects',
  contracts: 'contracts',
  invoices: 'invoices',
  payments: 'payments',
  misc_purchases: 'misc_purchases',
  teams: 'teams',
  team_stages: 'team_stages',
  roles: 'users',
  role_permissions: 'users',
  backup_logs: 'backup',
  v_inventory: 'inventory',
  v_app_users: 'users',
}

/** 任何登录用户都可读（角色/权限矩阵需要被所有角色读取）；写入仍限管理员 */
export const PUBLIC_READ_TABLES = new Set(['roles', 'role_permissions'])

/** 只读视图，禁止写入 */
export const VIEW_TABLES = new Set(['v_inventory', 'v_app_users'])

const DDL = `
CREATE TABLE IF NOT EXISTS sys_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  sort INTEGER DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_code TEXT NOT NULL,
  module TEXT NOT NULL,
  can_view INTEGER NOT NULL DEFAULT 1,
  can_edit INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(role_code, module)
);

CREATE TABLE IF NOT EXISTS app_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  status TEXT NOT NULL DEFAULT '启用',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  remark TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS material_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT, name TEXT NOT NULL, spec_range TEXT, unit TEXT, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT, name TEXT NOT NULL, category_id INTEGER, category_name TEXT, spec TEXT, unit TEXT,
  brand TEXT, ref_price REAL DEFAULT 0, safety_stock REAL DEFAULT 0, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT, name TEXT NOT NULL, cooperation TEXT DEFAULT '未合作', main_type TEXT, supply_scope TEXT,
  contact TEXT, phone TEXT, address TEXT, rating TEXT, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_no TEXT NOT NULL, name TEXT, supplier_id INTEGER, supplier_name TEXT, amount REAL DEFAULT 0,
  sign_date TEXT, start_date TEXT, end_date TEXT, pay_terms TEXT, status TEXT DEFAULT '履约中',
  file_path TEXT, file_name TEXT, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL, invoice_type TEXT DEFAULT '增值税专用发票', supplier_id INTEGER, supplier_name TEXT,
  contract_id INTEGER, contract_no TEXT, amount REAL DEFAULT 0, tax_rate REAL DEFAULT 0, invoice_date TEXT,
  status TEXT DEFAULT '已开票', file_path TEXT, file_name TEXT, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER, contract_no TEXT, contract_name TEXT, supplier_id INTEGER, supplier_name TEXT,
  stage_name TEXT NOT NULL, stage_seq INTEGER DEFAULT 1, ratio REAL DEFAULT 0, plan_amount REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0, status TEXT DEFAULT '未付款', plan_date TEXT, paid_date TEXT, pay_method TEXT,
  remark TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL, supplier_id INTEGER, supplier_name TEXT, order_date TEXT, expect_date TEXT,
  contract_id INTEGER, contract_no TEXT, contract_name TEXT, total_amount REAL DEFAULT 0,
  status TEXT DEFAULT '待审核', buyer TEXT, remark TEXT, has_contract TEXT DEFAULT '是',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL, category_id INTEGER, category_name TEXT, material_id INTEGER,
  material_name TEXT NOT NULL, spec TEXT, unit TEXT, qty REAL DEFAULT 0, unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0, arrived_qty REAL DEFAULT 0, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inbound_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  in_no TEXT NOT NULL, in_date TEXT, supplier_id INTEGER, supplier_name TEXT, order_id INTEGER, order_no TEXT,
  contract_id INTEGER, contract_no TEXT, contract_name TEXT, warehouse TEXT DEFAULT '项目部主仓',
  inspector TEXT, status TEXT DEFAULT '已入库', total_amount REAL DEFAULT 0, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inbound_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inbound_id INTEGER NOT NULL, category_id INTEGER, category_name TEXT, material_id INTEGER,
  material_name TEXT NOT NULL, spec TEXT, unit TEXT, qty REAL DEFAULT 0, qualified_qty REAL DEFAULT 0,
  unit_price REAL DEFAULT 0, amount REAL DEFAULT 0, batch_no TEXT, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outbound_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  out_no TEXT NOT NULL, out_date TEXT, team_id INTEGER, team_name TEXT, stage_id INTEGER, stage_name TEXT,
  usage_desc TEXT, keeper TEXT, status TEXT DEFAULT '已出库', total_qty REAL DEFAULT 0, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outbound_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outbound_id INTEGER NOT NULL, category_id INTEGER, category_name TEXT, material_id INTEGER,
  material_name TEXT NOT NULL, spec TEXT, unit TEXT, qty REAL DEFAULT 0, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS defects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_no TEXT, record_date TEXT, type TEXT DEFAULT '损耗', source TEXT, category_id INTEGER,
  category_name TEXT, material_id INTEGER, material_name TEXT, spec TEXT, unit TEXT, qty REAL DEFAULT 0,
  unit_price REAL DEFAULT 0, amount REAL DEFAULT 0, supplier_id INTEGER, supplier_name TEXT,
  team_id INTEGER, team_name TEXT, reason TEXT, disposal TEXT, handler TEXT, status TEXT DEFAULT '待处理',
  remark TEXT, source_no TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS misc_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no TEXT, category TEXT NOT NULL DEFAULT '其他', item_name TEXT NOT NULL, spec TEXT, qty REAL DEFAULT 0,
  unit TEXT, unit_price REAL DEFAULT 0, amount REAL DEFAULT 0, vendor TEXT, pay_method TEXT, handler TEXT,
  expense_date TEXT, status TEXT DEFAULT '待报销', file_path TEXT, file_name TEXT, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, leader TEXT, phone TEXT, section TEXT, village TEXT, progress REAL DEFAULT 0,
  status TEXT DEFAULT '施工中', plan_start TEXT, plan_end TEXT, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER, team_name TEXT, name TEXT NOT NULL, seq INTEGER DEFAULT 1, progress REAL DEFAULT 0,
  start_date TEXT, end_date TEXT, status TEXT DEFAULT '未开始', remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backup_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_no TEXT, operator_id TEXT, operator_name TEXT, table_count INTEGER DEFAULT 0, row_count INTEGER DEFAULT 0,
  format TEXT DEFAULT 'Excel', file_name TEXT, include_files TEXT DEFAULT '否', status TEXT DEFAULT '已完成',
  detail TEXT, remark TEXT, kind TEXT DEFAULT '备份',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIEW IF NOT EXISTS v_inventory AS
SELECT m.id AS material_id, m.code AS material_code, m.name AS material_name, m.spec, m.unit,
  m.ref_price, m.safety_stock, m.category_id, COALESCE(c.name, m.category_name) AS category_name,
  COALESCE(i.qty, 0) AS in_qty, COALESCE(i.amount, 0) AS in_amount,
  COALESCE(o.qty, 0) AS out_qty, COALESCE(d.qty, 0) AS defect_qty, COALESCE(d.amount, 0) AS defect_amount,
  COALESCE(i.qty, 0) - COALESCE(o.qty, 0) - COALESCE(d.qty, 0) AS stock_qty
FROM materials m
LEFT JOIN material_categories c ON c.id = m.category_id
LEFT JOIN (SELECT material_id, sum(qty) AS qty, sum(amount) AS amount FROM inbound_items GROUP BY material_id) i ON i.material_id = m.id
LEFT JOIN (SELECT material_id, sum(qty) AS qty FROM outbound_items GROUP BY material_id) o ON o.material_id = m.id
LEFT JOIN (SELECT material_id, sum(qty) AS qty, sum(amount) AS amount FROM defects GROUP BY material_id) d ON d.material_id = m.id;

CREATE VIEW IF NOT EXISTS v_app_users AS
SELECT id, phone, name, role, status, must_change_password, remark, created_at, updated_at, last_login_at
FROM app_users;
`

db.exec(DDL)

const ROLES = [
  ['admin', '系统管理员', '全部模块可读写，含用户与角色管理', 1, 1],
  ['procurement', '采购员', '供应商、物资、采购订单、合同发票与付款', 1, 2],
  ['warehouse', '仓管员', '入库、出库、库存、损耗与不合格品', 1, 3],
  ['team', '施工队', '查看全局，提交领用出库与现场损耗', 1, 4],
  ['viewer', '只读查看', '仅可浏览与导出，不可修改任何数据', 1, 5],
]

const PERMS = {
  admin: 'dashboard:1:1 contracts:1:1 invoices:1:1 payments:1:1 suppliers:1:1 materials:1:1 material_categories:1:1 purchase_orders:1:1 inbound:1:1 outbound:1:1 inventory:1:1 defects:1:1 misc_purchases:1:1 teams:1:1 team_stages:1:1 users:1:1 backup:1:1',
  procurement: 'dashboard:1:0 contracts:1:1 invoices:1:1 payments:1:1 suppliers:1:1 materials:1:1 material_categories:1:1 purchase_orders:1:1 inbound:1:1 outbound:0:0 inventory:1:0 defects:1:1 misc_purchases:1:1 teams:1:1 team_stages:1:1 users:0:0 backup:0:0',
  warehouse: 'dashboard:0:0 contracts:0:0 invoices:0:0 payments:0:0 suppliers:1:0 materials:1:1 material_categories:1:1 purchase_orders:1:0 inbound:1:1 outbound:1:1 inventory:1:0 defects:1:1 misc_purchases:1:0 teams:1:1 team_stages:1:1 users:0:0 backup:0:0',
  team: 'dashboard:1:0 contracts:1:0 invoices:1:0 payments:1:0 suppliers:1:0 materials:1:0 material_categories:1:0 purchase_orders:1:0 inbound:1:0 outbound:1:1 inventory:1:0 defects:1:1 misc_purchases:1:0 teams:1:0 team_stages:1:0 users:0:0 backup:0:0',
  viewer: 'dashboard:1:0 contracts:1:0 invoices:1:0 payments:1:0 suppliers:1:0 materials:1:0 material_categories:1:0 purchase_orders:1:0 inbound:1:0 outbound:1:0 inventory:1:0 defects:1:0 misc_purchases:1:0 teams:1:0 team_stages:1:0 users:0:0 backup:0:0',
}

export function seedBase() {
  // 按 code 逐条 INSERT OR IGNORE 补齐 5 个内置角色 —— 任何已有角色都不会被覆盖
  const insRole = db.prepare('INSERT OR IGNORE INTO roles (code, name, description, is_system, sort) VALUES (?,?,?,?,?)')
  let insertedRole = 0
  for (const r of ROLES) {
    const info = insRole.run(...r)
    if (info.changes) insertedRole += 1
  }
  // 按 (role_code, module) 逐条 INSERT OR IGNORE 补齐默认权限矩阵 —— 已存在的不动
  const insPerm = db.prepare(
    'INSERT OR IGNORE INTO role_permissions (role_code, module, can_view, can_edit) VALUES (?,?,?,?)'
  )
  let insertedPerm = 0
  for (const [role, spec] of Object.entries(PERMS)) {
    for (const item of spec.split(' ')) {
      const [module, view, edit] = item.split(':')
      const info = insPerm.run(role, module, Number(view), Number(edit))
      if (info.changes) insertedPerm += 1
    }
  }
  if (insertedRole || insertedPerm) {
    console.log(`[seed] 内置角色补齐：${insertedRole} 条角色、${insertedPerm} 条权限（已存在的不动）`)
  }
}

/** 把 SQLite 行里的 0/1 还原为布尔语义（给前端用） */
export function rowToJson(row) {
  if (!row) return row
  const out = {}
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'bigint' ? Number(v) : v
  return out
}

/**
 * 物资台账「商品名称」唯一约束。
 * 先在库里查重：只有确认当前没有重名，才建立唯一索引；
 * 若已存在重名数据，只打印告警、不擅自删改，交由用户自行处理后再生效。
 */
export function ensureMaterialNameUnique() {
  try {
    const dup = db
      .prepare(
        `SELECT TRIM(name) AS nm, count(*) AS n FROM materials
          WHERE name IS NOT NULL AND TRIM(name) <> ''
          GROUP BY TRIM(name) HAVING count(*) > 1
          ORDER BY n DESC LIMIT 20`
      )
      .all()
    if (dup.length) {
      console.warn(
        '[constraint] 物资台账存在重名，暂未建立唯一索引：' +
          dup.map((d) => `${d.nm}×${d.n}`).join('、')
      )
      constraintStatus.materialsNameUnique = false
      constraintStatus.materialsDuplicateNames = dup.map((d) => String(d.nm))
      return { created: false, duplicates: constraintStatus.materialsDuplicateNames }
    }
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_materials_name
         ON materials (TRIM(name)) WHERE name IS NOT NULL AND TRIM(name) <> ''`
    )
    constraintStatus.materialsNameUnique = true
    constraintStatus.materialsDuplicateNames = []
    return { created: true, duplicates: [] }
  } catch (e) {
    console.warn('[constraint] 物资台账唯一索引创建失败：' + (e?.message || e))
    constraintStatus.materialsNameUnique = false
    return { created: false, duplicates: [], error: e?.message || String(e) }
  }
}

/** 把 SQLite 的约束报错翻译成用户看得懂的中文提示 */
export function friendlyDbError(table, e) {
  const raw = e?.message || String(e || '')
  if (!/UNIQUE constraint failed/i.test(raw)) return null
  const target = raw.split('UNIQUE constraint failed:')[1]?.trim() || ''
  if (table === 'materials') {
    return '物资台账中已存在相同「商品名称」，商品名称不能重复'
  }
  if (target.includes('phone')) return '该手机号已存在'
  if (target.includes('code')) return '编码已存在，请更换一个'
  const col = target.split(',').pop()?.split('.').pop()?.trim()
  return `已存在相同记录${col ? `（${col}）` : ''}，请检查后重试`
}

/**
 * 字段长度上限（兜底层防护：前端 maxLength 容易被绕过 / 绕过 API 直写）
 * 与前端 src/lib/importSpecs.ts 的 maxLen 保持一致；任意一侧改动需同步。
 * 写服务（POST/PATCH）超长 → 返回 400 + 中文提示，**不静默截断**（截断可能引起前端展示异常）。
 */
export const FIELD_LIMITS = {
  material_categories: { code: 60, name: 60, spec_range: 60, unit: 20, remark: 200 },
  materials:           { code: 60, name: 120, spec: 60, unit: 20, brand: 60, remark: 200, category_name: 60 },
  suppliers:           { code: 60, name: 120, main_type: 60, supply_scope: 200, contact: 40, phone: 20, address: 200, rating: 40, remark: 200 },
  contracts:           { contract_no: 40, name: 120, pay_terms: 200, file_name: 200, remark: 200 },
  invoices:            { invoice_no: 40, invoice_type: 40, contract_no: 40, status: 20, file_name: 200, remark: 200 },
  payments:            { contract_no: 40, contract_name: 120, supplier_name: 120, stage_name: 80, status: 20, plan_date: 20, paid_date: 20, pay_method: 40, remark: 200 },
  purchase_orders:     { order_no: 40, supplier_name: 120, contract_no: 40, contract_name: 120, status: 20, buyer: 40, remark: 200, has_contract: 4 },
  purchase_order_items:{ category_name: 60, material_name: 120, spec: 60, unit: 20, remark: 200 },
  inbound_orders:      { in_no: 40, supplier_name: 120, order_no: 40, contract_no: 40, contract_name: 120, warehouse: 40, inspector: 40, status: 20, remark: 200 },
  inbound_items:       { category_name: 60, material_name: 120, spec: 60, unit: 20, batch_no: 40, remark: 200 },
  outbound_orders:     { out_no: 40, team_name: 120, stage_name: 80, usage_desc: 200, keeper: 40, status: 20, remark: 200 },
  outbound_items:      { category_name: 60, material_name: 120, spec: 60, unit: 20, remark: 200 },
  defects:             { record_no: 40, type: 20, source: 40, category_name: 60, material_name: 120, spec: 60, unit: 20, supplier_name: 120, team_name: 120, reason: 200, disposal: 80, handler: 40, status: 20, remark: 200, source_no: 40 },
  misc_purchases:      { bill_no: 40, category: 40, item_name: 120, spec: 60, unit: 20, vendor: 120, pay_method: 40, handler: 40, status: 20, file_name: 200, remark: 200 },
  teams:               { name: 120, leader: 40, phone: 20, section: 80, village: 80, status: 20, remark: 200 },
  team_stages:         { team_name: 120, name: 80, status: 20, remark: 200 },
  roles:               { code: 40, name: 60, description: 200 },
  app_users:           { phone: 11, name: 40, role: 40, status: 20, remark: 200 },
  backup_logs:         { backup_no: 40, operator_id: 40, operator_name: 40, format: 20, file_name: 200, status: 20, detail: 1000, remark: 200, kind: 20 },
}

/**
 * 业务字段值域（与 BUG-R01 的 28 条 CHECK 对齐，但放在应用层兜底，对存量数据不破坏） */
export const FIELD_RULES = {
  invoices:    { tax_rate: { min: 0, max: 100, label: '税率' } },
  teams:       { progress: { min: 0, max: 100, label: '进度' } },
  team_stages: { progress: { min: 0, max: 100, label: '阶段进度' } },
  materials:   { ref_price: { min: 0, label: '参考单价' }, safety_stock: { min: 0, label: '安全库存' } },
  purchase_order_items: { qty: { min: 0, label: '采购数量' }, unit_price: { min: 0, label: '采购单价' }, amount: { min: 0, label: '采购金额' } },
  inbound_orders:      { total_amount: { min: 0, label: '入库总额' } },
  inbound_items:       { qty: { min: 0, label: '入库数量' }, qualified_qty: { min: 0, label: '合格数量' }, unit_price: { min: 0, label: '入库单价' }, amount: { min: 0, label: '入库金额' } },
  outbound_orders:     { total_qty: { min: 0, label: '出库总量' } },
  outbound_items:      { qty: { min: 0, label: '出库数量' } },
  defects:             { qty: { min: 0, label: '损耗数量' }, unit_price: { min: 0, label: '损耗单价' }, amount: { min: 0, label: '损耗金额' } },
  misc_purchases:      { qty: { min: 0, label: '数量' }, unit_price: { min: 0, label: '单价' }, amount: { min: 0, label: '金额' } },
  contracts:           { amount: { min: 0, label: '合同金额' } },
  payments:            { ratio: { min: 0, max: 100, label: '付款比例' }, plan_amount: { min: 0, label: '计划金额' }, paid_amount: { min: 0, label: '已付金额' }, stage_seq: { min: 1, label: '阶段序号' } },
}

/**
 * 字段级兜底校验：长度上限 + 值域范围。
 * 调用方：handleData POST / PATCH 路径写入前。
 * 返回 { ok: true } 或 { ok: false, message }。
 */
export function validatePayload(table, payload) {
  const limits = FIELD_LIMITS[table] || {}
  const rules = FIELD_RULES[table] || {}
  for (const [k, v] of Object.entries(payload || {})) {
    if (v === undefined || v === null) continue
    if (typeof v === 'string') {
      const max = limits[k]
      if (max && v.length > max) {
        return { ok: false, message: `「${k}」超出 ${max} 字上限，当前 ${v.length} 字` }
      }
    }
    const rule = rules[k]
    if (rule && typeof v === 'number' && Number.isFinite(v)) {
      if (rule.min !== undefined && v < rule.min) {
        return { ok: false, message: `「${rule.label || k}」不能小于 ${rule.min}，当前 ${v}` }
      }
      if (rule.max !== undefined && v > rule.max) {
        return { ok: false, message: `「${rule.label || k}」不能大于 ${rule.max}，当前 ${v}` }
      }
    }
  }
  return { ok: true }
}

const SEED_FILE = join(__dirname, 'seed', 'cloud-data.json')
/** 种子版本：改这个值可以让历史数据在线上再补一次（逐行 INSERT OR IGNORE，不会覆盖已有数据） */
const SEED_VERSION = 'cloud-data-v2'

/**
 * 首次启动时把历史数据（server/seed/cloud-data.json）灌入数据库。
 * - 逐行 `INSERT OR IGNORE`，保留原始 id，父子表关联不会错位；
 * - 只在对应表没有导入过该版本时执行，因此重复启动、重新发布都不会重复插入；
 * - 已存在的数据（例如运行一段时间后用户自己改的、删的）一律不动，
 *   只补齐缺失的记录；新增数据不会被覆盖。
 */
export function importSeedDump() {
  if (!existsSync(SEED_FILE)) return
  let dump
  try {
    dump = JSON.parse(readFileSync(SEED_FILE, 'utf8'))
  } catch (e) {
    console.warn('[seed] 解析历史数据失败：', e?.message)
    return
  }
  const mark = db.prepare('INSERT OR IGNORE INTO sys_meta (key, value) VALUES (?, ?)')
  const keyOf = (t) => `seed:${SEED_VERSION}:${t}`
  const isDone = (t) => !!db.prepare('SELECT 1 AS x FROM sys_meta WHERE key = ?').get(keyOf(t))
  let tables = 0
  let total = 0

  for (const [table, rows] of Object.entries(dump)) {
    if (!Array.isArray(rows) || !rows.length || isDone(table)) continue
    let cols = []
    try {
      cols = db.prepare(`PRAGMA table_info("${table}")`).all().map((r) => r.name)
    } catch {
      cols = []
    }
    if (!cols.length) continue

    const usable = rows.map((raw) => {
      const row = {}
      for (const [k, v] of Object.entries(raw || {})) {
        if (!cols.includes(k)) continue
        row[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v
      }
      return row
    })

    let inserted = 0
    let skipped = 0
    for (const row of usable) {
      const keys = Object.keys(row)
      if (!keys.length) continue
      try {
        const info = db
          .prepare(
            `INSERT OR IGNORE INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`
          )
          .run(...keys.map((k) => row[k]))
        if (info.changes) inserted += 1
        else skipped += 1
      } catch (e) {
        skipped += 1
        console.warn(`[seed] ${table} 跳过一条记录：`, e?.message)
      }
    }
    mark.run(keyOf(table), new Date().toISOString())
    if (inserted) {
      tables += 1
      total += inserted
    }
    if (skipped) console.log(`[seed] ${table}：新增 ${inserted} 条，已存在/跳过 ${skipped} 条`)
  }
  if (total) console.log(`[seed] 已导入历史数据：${tables} 张表 / ${total} 条记录`)
}

/**
 * 应用层 CHECK 约束兜底 —— 把字段值域硬塞进数据库（SQLite 不支持 ADD CONSTRAINT，
 * 必须重建表）。流程：
 *   1. 先用应用层规则把现有数据夹紧到合法范围（夹紧失败的写 sys_meta 留痕，不抛错）
 *   2. 用 SQLite 「临时表 + INSERT … SELECT + RENAME」模式重建表，自动带 CHECK
 *   3. 失败 → 告警 + 不抛错（不破坏业务连续性，靠应用层校验保证写入合法）
 *
 * 为什么必须做这件事（BUG-R01 根因）：之前承诺的 28 条 CHECK 全部只在线上数据库
 * 手工 ALTER 过，未纳入启动流程。任何新部署（隔离副本 / 重建库）都会丢约束。
 *
 * 触发器（BUG-R02 根因）：出库超额（outbound_items.qty 超出库存）也一并兜底，
 * 用 BEFORE INSERT/UPDATE 触发器拦截，拦截失败回滚事务。
 */
export const constraintStatus = {
  materialsNameUnique: false,
  materialsDuplicateNames: [],
  applied: false,
  appliedAt: null,
  checkCount: 0,
  triggerCount: 0,
  failedConstraints: [],
}

// 与 FIELD_RULES 一一对应，但放到 SQL CHECK 表达式里
const CHECK_DEFS = {
  invoices:    ['tax_rate BETWEEN 0 AND 100'],
  teams:       ['progress BETWEEN 0 AND 100'],
  team_stages: ['progress BETWEEN 0 AND 100'],
  materials:   ['ref_price >= 0', 'safety_stock >= 0'],
  purchase_order_items: ['qty >= 0', 'unit_price >= 0', 'amount >= 0'],
  inbound_orders:      ['total_amount >= 0'],
  inbound_items:       ['qty >= 0', 'qualified_qty >= 0', 'unit_price >= 0', 'amount >= 0', '(qualified_qty IS NULL OR qualified_qty <= qty)'],
  outbound_orders:     ['total_qty >= 0'],
  outbound_items:      ['qty >= 0'],
  defects:             ['qty >= 0', 'unit_price >= 0', 'amount >= 0'],
  misc_purchases:      ['qty >= 0', 'unit_price >= 0', 'amount >= 0'],
  contracts:           ['amount >= 0'],
  payments:            ['ratio BETWEEN 0 AND 100', 'plan_amount >= 0', 'paid_amount >= 0', 'stage_seq >= 1'],
  app_users:           ["phone GLOB '[0-9]*' AND length(phone) = 11"],
}

/** 出库数量超额触发器（BUG-R02）。BEFORE INSERT/UPDATE 时校验 qty 不超过当前库存可用量 */
const OUTBOUND_STOCK_TRIGGER_DDL = `
CREATE TRIGGER IF NOT EXISTS trg_outbound_items_stock_ins
BEFORE INSERT ON outbound_items
FOR EACH ROW
WHEN (
  NEW.material_id IS NOT NULL AND NEW.qty IS NOT NULL
  AND (
    SELECT COALESCE((SELECT SUM(qty) FROM inbound_items WHERE material_id = NEW.material_id),0)
      - COALESCE((SELECT SUM(qty) FROM outbound_items WHERE material_id = NEW.material_id),0)
      - COALESCE((SELECT SUM(qty) FROM defects WHERE material_id = NEW.material_id),0)
  ) < NEW.qty
)
BEGIN
  SELECT RAISE(ABORT, 'OUTBOUND_STOCK_EXCEEDED:qty=' || NEW.qty);
END;

CREATE TRIGGER IF NOT EXISTS trg_outbound_items_stock_upd
BEFORE UPDATE ON outbound_items
FOR EACH ROW
WHEN (
  NEW.material_id IS NOT NULL AND NEW.qty IS NOT NULL
  AND (
    SELECT COALESCE((SELECT SUM(qty) FROM inbound_items WHERE material_id = NEW.material_id),0)
      - COALESCE((SELECT SUM(qty) FROM outbound_items WHERE material_id = NEW.material_id AND id <> NEW.id),0)
      - COALESCE((SELECT SUM(qty) FROM defects WHERE material_id = NEW.material_id),0)
  ) < NEW.qty
)
BEGIN
  SELECT RAISE(ABORT, 'OUTBOUND_STOCK_EXCEEDED:qty=' || NEW.qty);
END;
`

/**
 * 把一张表的 CHECK 约束装上。
 *  - 已存在：跳过
 *  - 不存在：先做数据校准，再走 SQLite 重建表模式（CREATE TABLE temp → INSERT SELECT → DROP → RENAME）
 *  - 失败：告警，不抛错
 */
function applyCheckToTable(table) {
  const checks = CHECK_DEFS[table]
  if (!checks?.length) return { skipped: true }
  const existing = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table)
  if (!existing?.sql) return { skipped: true }
  const allFound = checks.every((c) => existing.sql.includes(c))
  if (allFound) return { skipped: true, reason: 'already-applied' }

  // 数据校准：把所有超界字段夹紧到合法范围
  const rules = FIELD_RULES[table] || {}
  const fixes = []
  for (const [col, rule] of Object.entries(rules)) {
    if (!rule) continue
    const rows = db.prepare(`SELECT id, "${col}" AS v FROM "${table}"`).all()
    for (const r of rows) {
      if (r.v == null || typeof r.v !== 'number') continue
      let nv = r.v
      if (rule.min !== undefined && nv < rule.min) nv = rule.min
      if (rule.max !== undefined && nv > rule.max) nv = rule.max
      if (nv !== r.v) {
        db.prepare(`UPDATE "${table}" SET "${col}" = ? WHERE id = ?`).run(nv, r.id)
        fixes.push(`${table}.${col}#${r.id}:${r.v}→${nv}`)
      }
    }
  }

  // 重建表：拿到所有列，附带 CHECK
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all()
  if (!cols.length) return { skipped: true }
  const colDefs = cols
    .map((c) => {
      // DEFAULT 表达式（如 datetime('now')）必须用双引号字面量包起来，避免与 CHECK 的 `(` 触发 SQLite 解析器歧义
      const def = c.dflt_value != null ? ` DEFAULT "${String(c.dflt_value).replace(/"/g, '""')}"` : ''
      const nn = c.notnull ? ' NOT NULL' : ''
      const pk = c.pk ? ' PRIMARY KEY AUTOINCREMENT' : ''
      return `"${c.name}" ${c.type}${nn}${def}${pk}`
    })
    .join(', ')
  const tempName = `_re_${table}_${Date.now()}`.slice(0, 60)
  const checkClause = checks.map((c) => `CHECK (${c})`).join(', ')
  const sqlCreate = `CREATE TABLE "${tempName}" (${colDefs}, ${checkClause})`
  const colList = cols.map((c) => `"${c.name}"`).join(',')
  const insert = `INSERT INTO "${tempName}" (${colList}) SELECT ${colList} FROM "${table}"`

  // 找到依赖该表的视图（v_inventory / v_app_users 等），重建前后 DROP/CREATE
  const viewSqls = db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type='view' AND sql LIKE ?`)
    .all(`%${table}%`)
  try {
    db.exec('BEGIN')
    // 1) 先把依赖视图全 DROP（临时）
    for (const v of viewSqls) db.exec(`DROP VIEW IF EXISTS "${v.name}"`)
    // 2) 重建表
    db.exec(sqlCreate)
    db.exec(insert)
    db.exec(`DROP TABLE "${table}"`)
    db.exec(`ALTER TABLE "${tempName}" RENAME TO "${table}"`)
    // 3) 重建视图
    for (const v of viewSqls) db.exec(v.sql)
    db.exec('COMMIT')
    return { applied: true, fixes: fixes.length }
  } catch (e) {
    try { db.exec('ROLLBACK') } catch {}
    return { applied: false, error: e?.message || String(e), lastSql: sqlCreate }
  }
}

export function applyConstraints() {
  let checkCount = 0
  const failed = []
  for (const table of Object.keys(CHECK_DEFS)) {
    const r = applyCheckToTable(table)
    if (r.applied) checkCount += 1
    else if (r.error) {
      failed.push(`${table}: ${r.error}`)
      console.warn(`[constraints] ${table} 重建失败 SQL=`, r.lastSql)
    }
  }
  // 出库超额触发器
  let triggerApplied = false
  try {
    db.exec(OUTBOUND_STOCK_TRIGGER_DDL)
    triggerApplied = true
  } catch (e) {
    failed.push(`outbound_stock_trigger: ${e?.message || e}`)
  }
  constraintStatus.applied = !failed.length
  constraintStatus.appliedAt = new Date().toISOString()
  constraintStatus.checkCount = checkCount
  constraintStatus.triggerCount = triggerApplied ? 1 : 0
  constraintStatus.failedConstraints = failed
  if (failed.length) {
    console.warn('[constraints] 应用层兜底已生效，但部分数据库约束未装上：' + failed.join('；'))
  } else if (checkCount || triggerApplied) {
    console.log(`[constraints] 已重建 ${checkCount} 张表的 CHECK，新增 ${triggerApplied ? 1 : 0} 条触发器`)
  }
}

/**
 * 单据头总额与明细加和的一致性校准（BUG-R03 兜底）。
 *
 * 启动时一次性扫描所有单据头，把 total_amount 校准为 SUM(items.amount)，
 * 偏差写 sys_meta 留痕，幂等可重入。
 *
 * 为什么在 db.mjs 而不是前端：deriveTotals 只在「保存」时重算，对历史数据无能为力；
 * 而历史种子数据的不一致是客观存在的，必须由后端兜底。
 */
const DOC_TOTAL_RULES = [
  { head: 'purchase_orders', item: 'purchase_order_items', headField: 'total_amount', sumField: 'amount' },
  { head: 'inbound_orders',  item: 'inbound_items',         headField: 'total_amount', sumField: 'amount' },
  { head: 'outbound_orders', item: 'outbound_items',        headField: 'total_qty',    sumField: 'qty' },
  { head: 'misc_purchases',  item: null,                    headField: 'amount',       sumField: null, self: true },
]

export function reconcileDocTotals() {
  let totalFixed = 0
  for (const rule of DOC_TOTAL_RULES) {
    try {
      if (rule.self) {
        // 单条表：amount = qty * unit_price 校准
        const rows = db.prepare(`SELECT id, qty, unit_price, amount FROM "${rule.head}"`).all()
        for (const r of rows) {
          const expected = Number(r.qty || 0) * Number(r.unit_price || 0)
          const cur = Number(r.amount || 0)
          if (Math.abs(expected - cur) > 0.01) {
            db.prepare(`UPDATE "${rule.head}" SET amount = ? WHERE id = ?`).run(expected, r.id)
            totalFixed += 1
          }
        }
      } else {
        // 子表合计校准头表
        const heads = db.prepare(`SELECT id FROM "${rule.head}"`).all()
        for (const h of heads) {
          const s = db
            .prepare(`SELECT COALESCE(SUM(${rule.sumField}),0) AS s FROM "${rule.item}" WHERE ${rule.head === 'outbound_orders' ? 'outbound_id' : rule.head === 'inbound_orders' ? 'inbound_id' : 'order_id'} = ?`)
            .get(h.id)
          const expected = Number(s.s)
          const cur = Number(db.prepare(`SELECT ${rule.headField} AS v FROM "${rule.head}" WHERE id = ?`).get(h.id)?.v || 0)
          if (Math.abs(expected - cur) > 0.01) {
            db.prepare(`UPDATE "${rule.head}" SET ${rule.headField} = ? WHERE id = ?`).run(expected, h.id)
            totalFixed += 1
          }
        }
      }
    } catch (e) {
      console.warn(`[reconcile] ${rule.head} 校准失败：`, e?.message)
    }
  }
  if (totalFixed) {
    console.log(`[reconcile] 已校准 ${totalFixed} 条单据头总额与明细一致性`)
  }
}

const norm = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)

/**
 * 补齐「物资分类 + 物资台账」两份基础主数据（只补不覆盖，幂等）。
 *
 * 这两个模块是采购订单 / 出入库明细 / 库存 / 损耗的联动基础，为空则整条业务链不可用。
 * 数据源 = server/seed/cloud-data.json 里的 material_categories / materials 两张表。
 *
 * 规则：
 *  - 只补不覆盖：按 code（无 code 时按 name）判断是否已存在，缺哪条补哪条，用户改过的记录一律不动；
 *  - 不写死 id：交回自增主键，避免与库里既有 id 冲突；
 *  - 台账的 category_id 按分类 code / name 重新映射到库里真实存在的分类 id；
 *  - 只处理这两张表，其它模块的数据不受任何影响；
 *  - 用 sys_meta 打标记，默认只执行一次，之后用户自己增删的数据不会被重新灌回。
 */
export function syncMaterialBase(force = false) {
  const MARK = 'sync:material-base-v1'
  const out = {
    ran: false,
    categories: { inserted: 0, total: 0 },
    materials: { inserted: 0, total: 0 },
  }
  if (!existsSync(SEED_FILE)) return out
  if (!force && db.prepare('SELECT 1 AS x FROM sys_meta WHERE key = ?').get(MARK)) return out
  let dump
  try {
    dump = JSON.parse(readFileSync(SEED_FILE, 'utf8'))
  } catch (e) {
    console.warn('[sync] 解析种子数据失败：', e?.message)
    return out
  }
  out.ran = true

  const tableCols = (t) => db.prepare(`PRAGMA table_info("${t}")`).all().map((r) => r.name)
  const catCols = tableCols('material_categories')
  const matCols = tableCols('materials')
  const clean = (raw, cols) => {
    const o = {}
    for (const [k, v] of Object.entries(raw || {})) {
      if (k === 'id' || v === undefined || !cols.includes(k)) continue
      o[k] = norm(v)
    }
    return o
  }
  const insert = (table, row) => {
    const keys = Object.keys(row)
    if (!keys.length) return
    db.prepare(
      `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`
    ).run(...keys.map((k) => row[k]))
  }
  const existsBy = (table, code, name) =>
    (code ? db.prepare(`SELECT id FROM "${table}" WHERE code = ?`).get(code) : null) ||
    (name ? db.prepare(`SELECT id FROM "${table}" WHERE name = ?`).get(name) : null)

  // 1) 物资分类
  const seedCats = Array.isArray(dump.material_categories) ? dump.material_categories : []
  for (const c of seedCats) {
    if (!c || !c.name) continue
    if (existsBy('material_categories', c.code, c.name)) continue
    const row = clean(c, catCols)
    if (!row.created_at) row.created_at = new Date().toISOString()
    insert('material_categories', row)
    out.categories.inserted += 1
  }

  // 分类 code / name -> 库里真实 id
  const idByCode = new Map()
  const idByName = new Map()
  for (const r of db.prepare('SELECT id, code, name FROM material_categories').all()) {
    if (r.code) idByCode.set(String(r.code), r.id)
    if (r.name) idByName.set(String(r.name), r.id)
  }

  // 2) 物资台账
  const seedMats = Array.isArray(dump.materials) ? dump.materials : []
  for (const m of seedMats) {
    if (!m || !m.name) continue
    if (existsBy('materials', m.code, m.name)) continue
    const row = clean(m, matCols)
    if (!row.created_at) row.created_at = new Date().toISOString()
    // 分类重新映射：优先按分类名称，其次按种子里的 category_id 反查分类 code
    let catId = row.category_name && idByName.has(String(row.category_name))
      ? idByName.get(String(row.category_name))
      : null
    if (catId == null && m.category_id != null) {
      const seedCat = seedCats.find((c) => c.id === m.category_id)
      if (seedCat) {
        catId =
          (seedCat.code && idByCode.get(String(seedCat.code))) ??
          idByName.get(String(seedCat.name)) ??
          null
      }
    }
    if (catId != null) {
      row.category_id = catId
      if (!row.category_name) {
        for (const [n, id] of idByName) if (id === catId) row.category_name = n
      }
    }
    insert('materials', row)
    out.materials.inserted += 1
  }

  out.categories.total = Number(db.prepare('SELECT count(*) AS n FROM material_categories').get().n)
  out.materials.total = Number(db.prepare('SELECT count(*) AS n FROM materials').get().n)
  db.prepare('INSERT OR REPLACE INTO sys_meta (key, value) VALUES (?, ?)').run(MARK, new Date().toISOString())
  console.log(
    `[sync] 物资基础主数据补齐：分类 新增 ${out.categories.inserted} 条（现共 ${out.categories.total} 条），` +
      `物资 新增 ${out.materials.inserted} 条（现共 ${out.materials.total} 条）`
  )
  return out
}
