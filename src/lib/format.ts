export const money = (v: any): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

export const num = (v: any, digits = 3): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  const p = Math.pow(10, digits)
  return Math.round(n * p) / p
}

export const moneyText = (v: any, digits = 2): string => {
  const n = money(v)
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** 千分位数字，去掉无意义的尾随 0 */
export const numText = (v: any): string => {
  const n = num(v, 3)
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 3 })
}

export const today = (): string => {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const fmtDate = (v: any): string => (v ? String(v).slice(0, 10) : '—')

/**
 * 数值输入防负数：数量、单价、金额、比例、进度等业务字段一律不接受负值。
 * 只放行「空串 / 非负整数 / 非负小数」，其余（负数、负号、科学计数法、非法字符）保留原值不动。
 */
export const sanitizeNumericInput = (raw: string, prev: any): any => {
  if (raw === '') return ''
  return /^\d*\.?\d*$/.test(raw) ? raw : prev
}

/** 提交前把数值收敛到非负，兜住粘贴、程序赋值等绕过输入框的路径 */
export const clampNonNegative = (v: any): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

export const stamp = (): string => {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

export const uid = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

/** 生成业务单号，如 CG20261009001 */
export const makeNo = (prefix: string, seq: number): string => {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${prefix}${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${String(seq).padStart(3, '0')}`
}

export const sum = (arr: any[], key: string): number =>
  money(arr.reduce((acc, it) => acc + (Number(it?.[key]) || 0), 0))

/** 按进度节点/状态推导徽标色 */
export const progressColor = (p: number): string => {
  if (p >= 100) return 'emerald'
  if (p >= 60) return 'brand'
  if (p > 0) return 'amber'
  return 'slate'
}
