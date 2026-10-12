/**
 * 账号与登录凭据：密码加盐哈希（scrypt）+ 自签 JWT（HS256）。
 * 全部基于 Node 内置 crypto，无第三方依赖。
 */
import { randomBytes, scryptSync, timingSafeEqual, createHmac, createHash } from 'node:crypto'

/**
 * 签名密钥。
 *
 * 注意：线上环境会**同时运行多个服务实例**（负载均衡轮询）。早期实现把随机会钥
 * 写在文件里，各实例启动时互相覆盖，于是 A 实例签发的 token 到 B 实例直接失效，
 * 表现为「刚登录就提示登录态失效」。这里改为固定派生密钥，保证各实例一致。
 *
 * 如需轮换密钥，启动前设置环境变量 APP_SECRET 即可（所有实例取同一个值）。
 */
const SIGNING_KEY = 'water-supply-pms/meilan-yanfeng-water-network|token-v1'

function loadSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET
  return createHash('sha256').update(SIGNING_KEY).digest('hex')
}

const SECRET = loadSecret()
const TOKEN_DAYS = Number(process.env.TOKEN_DAYS || 7)

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(String(password), salt, 64).toString('hex')
  return { salt, hash }
}

export function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false
  const calc = scryptSync(String(password), salt, 64)
  const known = Buffer.from(hash, 'hex')
  if (calc.length !== known.length) return false
  return timingSafeEqual(calc, known)
}

const b64url = (buf) => Buffer.from(buf).toString('base64url')

export function signToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(
    JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400 })
  )
  const data = `${header}.${body}`
  const sig = createHmac('sha256', SECRET).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const data = `${parts[0]}.${parts[1]}`
  const expect = createHmac('sha256', SECRET).update(data).digest('base64url')
  if (expect !== parts[2]) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

/** 弱密码校验：至少 6 位 */
export function passwordProblem(pw) {
  if (!pw || String(pw).length < 6) return '密码至少 6 位'
  if (String(pw).length > 64) return '密码过长（不超过 64 位）'
  return null
}

export function isPhone(p) {
  return /^1\d{10}$/.test(String(p || ''))
}
