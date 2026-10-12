/**
 * 极简 ZIP 打包器 —— 无第三方依赖，仅用 store（原样存储）方式。
 *
 * 为什么需要它：浏览器的「选择文件夹」写入（File System Access API）
 * 只在安全上下文（https / localhost）可用；当系统以 http://IP:端口
 * 方式访问时该能力被浏览器禁用。此时把整份备份（数据 + 附件 + 清单）
 * 打成一个 zip 一次性下载，是最稳、最省事的替代方案。
 */

/* -------------------------------- CRC32 -------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/* ------------------------------ 小端写入器 ------------------------------ */

class ByteBuf {
  private a: Uint8Array
  private n = 0

  constructor(cap = 256) {
    this.a = new Uint8Array(cap)
  }

  private grow(k: number) {
    if (this.n + k <= this.a.length) return
    let cap = this.a.length * 2
    while (cap < this.n + k) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.a.subarray(0, this.n))
    this.a = next
  }

  u16(v: number) {
    this.grow(2)
    this.a[this.n++] = v & 0xff
    this.a[this.n++] = (v >>> 8) & 0xff
  }

  u32(v: number) {
    this.grow(4)
    this.a[this.n++] = v & 0xff
    this.a[this.n++] = (v >>> 8) & 0xff
    this.a[this.n++] = (v >>> 16) & 0xff
    this.a[this.n++] = (v >>> 24) & 0xff
  }

  bytes(b: Uint8Array) {
    this.grow(b.length)
    this.a.set(b, this.n)
    this.n += b.length
  }

  /** 取出已写入的内容（长度精确的独立 buffer，可直接喂给 Blob） */
  take(): ArrayBuffer {
    const out = new ArrayBuffer(this.n)
    new Uint8Array(out).set(this.a.subarray(0, this.n))
    return out
  }
}

/* -------------------------------- 打包 -------------------------------- */

export interface ZipEntry {
  /** 包内路径，用 / 分隔，例如 `数据/物资台账_materials.xlsx` */
  path: string
  blob: Blob
}

export type ZipProgress = (done: number, total: number, label: string) => void

/** 单个 zip 上限（超过 4G 需要 ZIP64，这里直接给出明确提示） */
const MAX_TOTAL = 3.5 * 1024 * 1024 * 1024

/**
 * 把若干文件打成单个 zip。
 * 目录结构由文件路径隐式表达（`a/b/c.txt` 会自动出现 a/b 目录），
 * Windows 资源管理器、macOS 归档工具、7-Zip 均能正确解压。
 */
export async function buildZip(entries: ZipEntry[], onProgress?: ZipProgress): Promise<Blob> {
  const enc = new TextEncoder()
  const d = new Date()
  // MS-DOS 时间/日期格式：秒只有 2 秒精度
  const dosTime =
    ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f)
  const dosDate =
    (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f)

  const parts: BlobPart[] = []
  let offset = 0
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = []

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]
    const name = enc.encode(String(e.path).replace(/^\/+/, ''))
    const buf = await e.blob.arrayBuffer()
    const data = new Uint8Array(buf)
    if (offset + data.length > MAX_TOTAL) {
      throw new Error('备份体积超过 3.5GB，无法打包成单个 ZIP，请改选「下载到默认目录」或减少附件后再试')
    }
    const crc = crc32(data)
    const start = offset

    const lh = new ByteBuf(30 + name.length)
    lh.u32(0x04034b50) // 本地文件头签名
    lh.u16(20) // 解压所需版本
    lh.u16(0x0800) // 通用标志位：文件名使用 UTF-8
    lh.u16(0) // 压缩方式：store
    lh.u16(dosTime)
    lh.u16(dosDate)
    lh.u32(crc)
    lh.u32(data.length) // 压缩后大小
    lh.u32(data.length) // 原始大小
    lh.u16(name.length)
    lh.u16(0) // 扩展字段长度
    lh.bytes(name)

    const head = lh.take()
    parts.push(head)
    parts.push(buf)
    offset += head.byteLength + data.length

    central.push({ name, crc, size: data.length, offset: start })
    onProgress?.(i + 1, entries.length, e.path)
  }

  // 中央目录
  const cdStart = offset
  const cd = new ByteBuf(46 * Math.max(1, central.length))
  central.forEach((c) => {
    cd.u32(0x02014b50) // 中央目录签名
    cd.u16(20) // 创建版本
    cd.u16(20) // 解压所需版本
    cd.u16(0x0800)
    cd.u16(0)
    cd.u16(dosTime)
    cd.u16(dosDate)
    cd.u32(c.crc)
    cd.u32(c.size)
    cd.u32(c.size)
    cd.u16(c.name.length)
    cd.u16(0) // 扩展字段
    cd.u16(0) // 注释
    cd.u16(0) // 起始磁盘号
    cd.u16(0) // 内部属性
    cd.u32(0) // 外部属性
    cd.u32(c.offset)
    cd.bytes(c.name)
  })
  const cdBytes = cd.take()
  parts.push(cdBytes)

  // 中央目录结束记录
  const eocd = new ByteBuf(22)
  eocd.u32(0x06054b50)
  eocd.u16(0)
  eocd.u16(0)
  eocd.u16(central.length)
  eocd.u16(central.length)
  eocd.u32(cdBytes.byteLength)
  eocd.u32(cdStart)
  eocd.u16(0)
  parts.push(eocd.take())

  return new Blob(parts, { type: 'application/zip' })
}
