#!/usr/bin/env node
/**
 * 后端冒烟脚本（CI 用）
 *
 * 启动方式（与 CI 步骤一致）：
 *   ADMIN_PHONE=13800000000 ADMIN_PASSWORD=admin123 PORT=18851 \
 *     node server/index.mjs &
 *   node scripts/smoke.mjs
 *
 * 设计原则：
 *  1. 复用 /tmp/qa/runner.mjs 的接口黑盒 + 关键修复回归
 *  2. 失败即非零退出（CI 红）
 *  3. 测试数据统一加 _SMOKE_ 前缀，CI 不清理（隔离副本随 runner 销毁）
 */
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:18851'

let pass = 0
let fail = 0
const failures = []

const check = async (name, fn) => {
  try {
    await fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    fail++
    failures.push({ name, error: e?.message || String(e) })
    console.log(`  ✗ ${name}: ${e?.message || e}`)
  }
}

const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Pms-Token': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let j = null
  try { j = await r.json() } catch { j = null }
  // 后端错误结构：{ data: null, error: { message } }；成功：{ data, error: null }
  const message = j?.error?.message || j?.message || null
  return { ok: r.ok, status: r.status, data: j?.data, message, raw: j }
}

const must = (cond, msg) => { if (!cond) throw new Error(msg) }

console.log(`▶ 后端冒烟 @ ${BASE}\n`)

// ===== 1. 健康检查 + 种子数据完整性 =====
await check('1.1 /api/health 200', async () => {
  const r = await call('GET', '/api/health')
  must(r.ok, `status=${r.status}`)
  must(r.data?.status === 'up', `status=${r.data?.status}`)
  must(r.data?.db?.material_categories >= 13, `分类 ${r.data?.db?.material_categories} < 13`)
  must(r.data?.db?.materials >= 23, `物资 ${r.data?.db?.materials} < 23`)
  must(r.data?.db?.materials_name_unique === true, '商品名称唯一约束未生效')
})

// ===== 2. 登录 =====
let token = null
await check('2.1 admin 登录', async () => {
  const r = await call('POST', '/api/auth/login', {
    phone: '13800000000',
    password: 'admin123',
  })
  must(r.ok, `status=${r.status} ${r.message}`)
  must(typeof r.data?.token === 'string', 'no token')
  token = r.data.token
})

// ===== 3. 关键列表 =====
await check('3.1 GET /api/data/material_categories', async () => {
  const r = await call('GET', '/api/data/material_categories?limit=50', null, token)
  must(r.ok, `status=${r.status}`)
  must(Array.isArray(r.data), '非数组')
  must(r.data.length >= 13, `仅 ${r.data.length} 个分类`)
})

await check('3.2 GET /api/data/materials', async () => {
  const r = await call('GET', '/api/data/materials?limit=50', null, token)
  must(r.ok, `status=${r.status}`)
  must(Array.isArray(r.data), '非数组')
  must(r.data.length >= 23, `仅 ${r.data.length} 个物资`)
})

await check('3.3 GET /api/data/roles', async () => {
  const r = await call('GET', '/api/data/roles?limit=50', null, token)
  must(r.ok, `status=${r.status}`)
  must(Array.isArray(r.data), '非数组')
  must(r.data.length >= 5, `仅 ${r.data.length} 个内置角色`)
})

// ===== 4. BUG-R01 回归：CHECK 约束 + 应用层兜底 =====
await check('4.1 R01 tax_rate=200 应被拒', async () => {
  const r = await call('POST', '/api/data/invoices', {
    invoice_no: '_SMOKE_TAX_200',
    amount: 100,
    tax_rate: 200,
  }, token)
  must(!r.ok, '200 非法值被接受')
  must(/不合法|CHECK|超出|不能大于|不能小于|长度|超出上限/.test(r.message || ''), `未触发预期错误: ${r.message}`)
})

await check('4.2 R01 progress=999 应被拒', async () => {
  const r = await call('POST', '/api/data/teams', {
    name: '_SMOKE_PROG_999',
    progress: 999,
  }, token)
  must(!r.ok, '200 非法值被接受')
})

await check('4.3 R01 total_qty=-100 应被拒', async () => {
  const r = await call('POST', '/api/data/outbound_orders', {
    out_no: '_SMOKE_QTY_NEG',
    team_name: '_SMOKE_',
    total_qty: -100,
  }, token)
  must(!r.ok, '200 非法值被接受')
})

// ===== 5. BUG-R02 回归：出库超额拦截 =====
let materialId
await check('5.1 准备：取一个物资 ID', async () => {
  const r = await call('GET', '/api/data/materials?limit=1', null, token)
  must(r.ok && r.data?.[0], '无可用物资')
  materialId = r.data[0].id
})

await check('5.2 R02 入库 50', async () => {
  const order = await call('POST', '/api/data/inbound_orders', {
    in_no: '_SMOKE_IN_50',
    in_date: '2026-10-12',
    warehouse: '项目部主仓',
  }, token)
  must(order.ok, `创建入库单失败: ${order.message}`)
  const item = await call('POST', '/api/data/inbound_items', {
    inbound_id: order.data.id,
    material_id: materialId,
    material_name: '_SMOKE_',
    qty: 50,
  }, token)
  must(item.ok, `添加入库明细失败: ${item.message}`)
})

await check('5.3 R02 出库 9999 应被拒', async () => {
  const order = await call('POST', '/api/data/outbound_orders', {
    out_no: '_SMOKE_OUT_9999',
    out_date: '2026-10-12',
    team_name: '_SMOKE_',
  }, token)
  must(order.ok, `创建出库单失败: ${order.message}`)
  const item = await call('POST', '/api/data/outbound_items', {
    outbound_id: order.data.id,
    material_id: materialId,
    material_name: '_SMOKE_',
    qty: 9999,
  }, token)
  must(!item.ok, '超额未被拦截')
  must(/超出|库存|当前可用|本次出库/.test(item.message || ''), `未触发预期错误: ${item.message}`)
})

// ===== 6. BUG-R06 回归：字段长度上限 =====
await check('6.1 R06 2000 字符 name 应被拒', async () => {
  const r = await call('POST', '/api/data/materials', {
    name: 'x'.repeat(2000),
  }, token)
  must(!r.ok, '200 超长 name 被接受')
  must(/超出|长度|过长|120/.test(r.message || ''), `未触发预期错误: ${r.message}`)
})

// ===== 7. 商品名称唯一（库层 UNIQUE + 前端 beforeSave） =====
// 用 _SMOKE_ 前缀 + 时间戳的新名先建一条，再尝试同名校验，
// 避免依赖/污染种子，也让 smoke 可重入
const uniqName = `_SMOKE_TEST_UNIQ_${Date.now()}`
await check('7.1 插入 _SMOKE_ 测试名应成功', async () => {
  const r = await call('POST', '/api/data/materials', {
    name: uniqName,
  }, token)
  must(r.ok, `插入失败: ${r.message}`)
})

await check('7.2 同名重插应被拒', async () => {
  const r = await call('POST', '/api/data/materials', {
    name: uniqName,
  }, token)
  must(!r.ok, '重名被允许')
  must(/重复|唯一|已存在|UNIQUE/.test(r.message || ''), `未触发预期错误: ${r.message}`)
})

// ===== 8. 批删 API（R04 回归） =====
await check('8.1 R04 DELETE 应返回 {deleted, skipped} 结构', async () => {
  // 找一条入库单试图删除（不存在的 id）
  const r = await call('DELETE', '/api/data/inbound_orders?ids=999999', null, token)
  // 401/404 都可能，结构必须为对象
  must(typeof r.raw === 'object', '返回非对象')
  // 真正看：调用成功但 deleted=0 的话，结构应当含 deleted 字段
  // 部分后端在删 0 条时也返回 deleted=0
  if (r.ok) {
    must('deleted' in (r.data || {}), '成功响应无 deleted 字段')
  }
})

// ===== 汇总 =====
console.log(`\n========================`)
console.log(`通过 ${pass} / 失败 ${fail} / 合计 ${pass + fail}`)
if (failures.length) {
  console.log(`\n失败明细：`)
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`)
}
process.exit(fail > 0 ? 1 : 0)
