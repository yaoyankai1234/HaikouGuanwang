import React, { useRef, useState } from 'react'
import { Download, FileText, Loader2, Paperclip, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../store/auth'
import { useUI } from './ui'
import { uid } from '../lib/format'

const MAX_MB = 20
const MAX_FILES = 10

export interface Attachment {
  path: string
  name: string
}

function safeName(name: string): string {
  return name
    .replace(/[\\/]/g, '_')
    .replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
    .slice(-80)
}

/**
 * 解析附件字段。历史上该字段存单个路径字符串，
 * 现在支持多个附件，统一以 JSON 数组形式存储，读取时向下兼容。
 */
export function parseAttachments(filePath?: string | null, fileName?: string | null): Attachment[] {
  const raw = (filePath ?? '').trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        return arr
          .map((a: any) =>
            typeof a === 'string'
              ? { path: a, name: a.split('/').pop() ?? '附件' }
              : { path: String(a?.path ?? ''), name: String(a?.name || a?.path || '附件') }
          )
          .filter((a) => a.path)
      }
    } catch {
      /* 非 JSON，走下面的兼容分支 */
    }
  }
  if (raw.includes('|')) {
    const paths = raw.split('|').filter(Boolean)
    const names = (fileName ?? '').split('|')
    return paths.map((p, i) => ({ path: p, name: names[i] || p.split('/').pop() || '附件' }))
  }
  return [{ path: raw, name: (fileName ?? '').trim() || raw.split('/').pop() || '附件' }]
}

/** 把附件列表写回字段（file_path 存 JSON，file_name 存可读名称便于导出与检索） */
export function serializeAttachments(list: Attachment[]): {
  file_path: string | null
  file_name: string | null
} {
  if (!list.length) return { file_path: null, file_name: null }
  return {
    file_path: JSON.stringify(list),
    file_name: list.map((a) => a.name).join('、'),
  }
}

async function signedUrl(path: string): Promise<string> {
  return api.fileBlobUrl(path)
}

/** 表格中展示附件（支持多个）并在新窗口打开 */
export function FileLink({ path, name }: { path?: string | null; name?: string | null }) {
  const { toast } = useUI()
  const [busy, setBusy] = useState<string | null>(null)
  const list = parseAttachments(path, name)
  if (!list.length) return <span className="text-slate-300">—</span>

  const open = async (p: string) => {
    setBusy(p)
    try {
      window.open(await signedUrl(p), '_blank', 'noopener')
    } catch (e: any) {
      toast(e?.message || '打开附件失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {list.map((a, i) => (
        <button
          key={a.path}
          onClick={() => void open(a.path)}
          disabled={busy === a.path}
          title={a.name || a.path}
          className="inline-flex max-w-[150px] items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs text-brand-700 transition hover:bg-brand-100"
        >
          {busy === a.path ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Download size={12} className="shrink-0" />
          )}
          <span className="truncate">
            {list.length > 1 ? `${i + 1}. ` : ''}
            {a.name || a.path.split('/').pop()}
          </span>
        </button>
      ))}
    </div>
  )
}

/** 合同 / 发票附件上传（支持多文件）与下载（云端对象存储，登录用户可读） */
export function FileField({
  path,
  fileName,
  folder,
  onChange,
  readonly,
}: {
  path?: string | null
  fileName?: string | null
  folder: string
  onChange: (next: { file_path: string | null; file_name: string | null }) => void
  readonly?: boolean
}) {
  const { user } = useAuth()
  const { toast } = useUI()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const list = parseAttachments(path, fileName)

  const commit = (next: Attachment[]) => onChange(serializeAttachments(next))

  const pick = () => inputRef.current?.click()

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return
    if (!user?.id) {
      toast('请先登录后再上传附件', 'error')
      return
    }
    const room = MAX_FILES - list.length
    if (room <= 0) {
      toast(`最多上传 ${MAX_FILES} 个附件`, 'error')
      return
    }
    const queue = files.slice(0, room)
    if (files.length > room) toast(`本次仅上传前 ${room} 个，最多 ${MAX_FILES} 个附件`, 'info')

    const oversize = queue.filter((f) => f.size > MAX_MB * 1024 * 1024)
    if (oversize.length) {
      toast(`${oversize.map((f) => f.name).join('、')} 超过 ${MAX_MB}MB，已跳过`, 'error')
    }
    const valid = queue.filter((f) => f.size <= MAX_MB * 1024 * 1024)
    if (!valid.length) return

    setBusy(true)
    const added: Attachment[] = []
    try {
      for (const file of valid) {
        const objectPath = `${folder}/${uid()}-${safeName(file.name)}`
        const saved = await api.uploadFile(objectPath, file)
        added.push({ path: saved, name: file.name })
      }
      commit([...list, ...added])
      toast(added.length > 1 ? `已上传 ${added.length} 个附件` : '附件已上传', 'success')
    } catch (e: any) {
      // 已成功的部分仍然保留，避免重复上传
      if (added.length) commit([...list, ...added])
      toast(e?.message || '附件上传失败', 'error')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const download = async (p: string) => {
    setBusy(true)
    try {
      window.open(await signedUrl(p), '_blank', 'noopener')
    } catch (e: any) {
      toast(e?.message || '打开附件失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeAt = (idx: number) => commit(list.filter((_, i) => i !== idx))

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
    if (readonly) return
    void uploadFiles(Array.from(e.dataTransfer.files ?? []))
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
        onChange={(e) => void uploadFiles(Array.from(e.target.files ?? []))}
      />

      {list.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {list.map((a, i) => (
            <div
              key={a.path}
              className="group flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white text-[11px] font-semibold text-slate-400 ring-1 ring-slate-200">
                {i + 1}
              </span>
              <FileText size={14} className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate text-xs text-slate-600" title={a.name}>
                {a.name}
              </span>
              <button
                type="button"
                onClick={() => void download(a.path)}
                disabled={busy}
                title="查看/下载"
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-white hover:text-brand-600"
              >
                <Download size={14} />
              </button>
              {!readonly && (
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  title="移除该附件"
                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!readonly && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={pick}
          className={
            'flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs transition ' +
            (drag
              ? 'border-brand-400 bg-brand-50 text-brand-600'
              : 'border-slate-300 bg-white text-slate-500 hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-600')
          }
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
          <span>{busy ? '上传中…' : list.length ? '继续添加附件' : '点击或拖拽文件到此处上传'}</span>
          <span className="text-[11px] text-slate-400">可多选</span>
        </div>
      )}

      <p className="mt-1 text-xs text-slate-400">
        支持 PDF / Word / Excel / 图片，单个文件不超过 {MAX_MB}MB，最多 {MAX_FILES} 个
        {list.length > 0 && <span className="ml-1 text-slate-500">（已有 {list.length} 个）</span>}
      </p>
    </div>
  )
}
