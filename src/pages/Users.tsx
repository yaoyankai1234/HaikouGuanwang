import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, UserPlus, Users as UsersIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, type SessionUser } from '../lib/api'
import { useAuth } from '../store/auth'
import { ROLES, roleLabel, MODULES } from '../lib/options'
import { Badge, Button, Field, Input, Modal, PageHeader, Select, cx, useUI } from '../components/ui'

const TONES = ['brand', 'cyan', 'violet', 'emerald', 'amber', 'rose', 'sky', 'slate'] as const

const STATUSES = ['启用', '停用']

/** 生成一个易读的初始密码 */
function suggestPassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  let s = ''
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)]
  for (let i = 0; i < 4; i++) s += digits[Math.floor(Math.random() * digits.length)]
  return s
}

export default function Users() {
  const { isAdmin, roles, permOf, user } = useAuth()
  const { toast, confirm } = useUI()
  const nav = useNavigate()

  const [rows, setRows] = useState<SessionUser[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [deleting, setDeleting] = useState(false)
  const headRef = useRef<HTMLInputElement | null>(null)

  const [editing, setEditing] = useState<SessionUser | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', role: 'viewer', status: '启用', password: '' })
  const [busy, setBusy] = useState(false)

  const [pwdTarget, setPwdTarget] = useState<SessionUser | null>(null)
  const [newPwd, setNewPwd] = useState('')

  const list = useMemo(
    () =>
      roles.length
        ? roles.map((r) => ({ value: r.code, label: r.name, desc: r.description ?? '' }))
        : ROLES.map((r) => ({ value: r.value, label: r.label, desc: r.desc })),
    [roles]
  )
  const labelOf = (code: string) => list.find((r) => r.value === code)?.label ?? roleLabel(code)
  const toneOf = (code: string) => {
    if (code === 'admin') return 'rose'
    const i = list.findIndex((r) => r.value === code)
    return TONES[(i < 0 ? 0 : i) % TONES.length]
  }

  const load = async () => {
    setLoading(true)
    try {
      setRows(await api.listUsers())
    } catch (e: any) {
      toast(e?.message || '加载账号失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = rows.filter((r) => {
    const k = keyword.trim().toLowerCase()
    if (!k) return true
    return [r.name, r.phone, labelOf(r.role)].some((v) => String(v ?? '').toLowerCase().includes(k))
  })

  const selectedRows = useMemo(() => {
    const s = new Set(selected.map(String))
    return filtered.filter((r) => s.has(String(r.id)))
  }, [filtered, selected])

  const allChecked = isAdmin && filtered.length > 0 && selectedRows.length === filtered.length
  const halfChecked = isAdmin && selectedRows.length > 0 && !allChecked
  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = halfChecked
  }, [halfChecked])

  const toggleAll = () =>
    setSelected(allChecked ? [] : filtered.map((r) => r.id))

  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))

  const openCreate = () => {
    setForm({ name: '', phone: '', role: list.find((r) => r.value === 'viewer')?.value ?? 'viewer', status: '启用', password: suggestPassword() })
    setCreating(true)
  }

  const openEdit = (row: SessionUser) => {
    setForm({ name: row.name ?? '', phone: row.phone ?? '', role: row.role, status: row.status ?? '启用', password: '' })
    setEditing(row)
  }

  const submit = async () => {
    if (!/^1\d{10}$/.test(form.phone)) {
      toast('请输入正确的 11 位手机号', 'error')
      return
    }
    if (!form.name.trim()) {
      toast('请填写姓名', 'error')
      return
    }
    setBusy(true)
    try {
      if (creating) {
        if (form.password.length < 6) {
          toast('初始密码至少 6 位', 'error')
          return
        }
        await api.createUser({
          phone: form.phone,
          name: form.name.trim(),
          role: form.role,
          password: form.password,
          status: form.status,
        })
        toast('账号已创建，请把手机号和初始密码告知本人', 'success')
        setCreating(false)
      } else if (editing) {
        await api.updateUser(editing.id, {
          phone: form.phone,
          name: form.name.trim(),
          role: form.role,
          status: form.status,
        })
        toast('账号已更新', 'success')
        setEditing(null)
      }
      await load()
    } catch (e: any) {
      toast(e?.message || '保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const doReset = async () => {
    if (!pwdTarget) return
    if (newPwd.length < 6) {
      toast('密码至少 6 位', 'error')
      return
    }
    setBusy(true)
    try {
      await api.resetPassword(pwdTarget.id, newPwd)
      toast('密码已重置，请告知本人（首次登录后需自行修改）', 'success')
      setPwdTarget(null)
      setNewPwd('')
    } catch (e: any) {
      toast(e?.message || '重置失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async (row: SessionUser) => {
    const ok = await confirm({
      title: `删除账号「${row.name || row.phone}」？`,
      desc: '删除后该手机号将无法登录，且不可恢复。',
      confirmText: '删除',
    })
    if (!ok) return
    try {
      await api.deleteUser(row.id)
      toast('账号已删除', 'success')
      await load()
    } catch (e: any) {
      toast(e?.message || '删除失败', 'error')
    }
  }

  /** 批量删除账号：自动跳过当前登录账号，避免把自己锁在门外 */
  const doDeleteMany = async () => {
    if (!isAdmin) return
    const selfId = user?.id
    const targets = selectedRows.filter((r) => r.id !== selfId)
    const skippedSelf = selectedRows.length - targets.length
    if (!targets.length) {
      toast('选中的账号中包含当前登录账号，无法删除自己', 'error')
      return
    }
    const adminCount = targets.filter((r) => r.role === 'admin').length
    const ok = await confirm({
      title: `确认删除选中的 ${targets.length} 个账号？`,
      desc:
        `删除后这些手机号将无法登录，且不可恢复。` +
        (adminCount ? `其中包含 ${adminCount} 个管理员账号，请确认无误。` : '') +
        (skippedSelf ? `（已自动跳过当前登录账号）` : ''),
      confirmText: `删除 ${targets.length} 个`,
      danger: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      const res = await api.deleteUsers(targets.map((r) => r.id))
      const autoSkipped = res.skipped.length
      toast(
        `已删除 ${res.deleted} 个账号${autoSkipped ? `，跳过 ${autoSkipped} 个` : ''}`,
        res.deleted ? 'success' : 'error'
      )
      setSelected([])
      await load()
    } catch (e: any) {
      toast(e?.message || '批量删除失败', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const toggleStatus = async (row: SessionUser) => {
    const next = row.status === '启用' ? '停用' : '启用'
    try {
      await api.updateUser(row.id, { status: next })
      toast(next === '启用' ? '账号已启用' : '账号已停用', 'success')
      await load()
    } catch (e: any) {
      toast(e?.message || '操作失败', 'error')
    }
  }

  return (
    <div>
      <PageHeader
        title="用户管理"
        subtitle="用手机号 + 密码为成员开通账号；角色决定其可见模块与可编辑范围"
        icon={UsersIcon}
        actions={
          <div className="flex items-center gap-2">
            <Button icon={RefreshCw} onClick={() => void load()}>
              刷新
            </Button>
            <Button variant="primary" icon={Plus} onClick={openCreate} disabled={!isAdmin}>
              新增账号
            </Button>
          </div>
        }
      />

      {!isAdmin && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          当前账号不是系统管理员，仅可查看账号列表，不能新增或修改。
        </div>
      )}

      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {list.map((r) => (
              <Badge key={r.value} tone={toneOf(r.value)}>
                {r.label} {rows.filter((x) => x.role === r.value).length}
              </Badge>
            ))}
          </div>
          <div className="w-56">
            <Input
              value={keyword}
              placeholder="搜索姓名 / 手机号"
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        </div>

        {isAdmin && selectedRows.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-brand-100 bg-brand-50/70 px-3 py-2.5">
            <span className="text-xs text-slate-600">
              已选 <b className="text-brand-600">{selectedRows.length}</b> 个账号
            </span>
            <Button variant="danger" icon={Trash2} loading={deleting} onClick={() => void doDeleteMany()}>
              批量删除
            </Button>
            <Button variant="text" onClick={() => setSelected([])} disabled={deleting}>
              取消选择
            </Button>
            <span className="text-[11px] text-slate-400">勾选作用于当前搜索出来的全部账号</span>
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                {isAdmin && (
                  <th className="th w-10 text-center">
                    <input
                      ref={headRef}
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      title={allChecked ? '取消全选' : '全选'}
                      className="h-3.5 w-3.5 cursor-pointer align-middle accent-brand-500"
                    />
                  </th>
                )}
                <th className="th">姓名</th>
                <th className="th">手机号</th>
                <th className="th">角色</th>
                <th className="th">状态</th>
                <th className="th">最近登录</th>
                <th className="th text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="td text-slate-400" colSpan={isAdmin ? 7 : 6}>
                    加载中…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td className="td text-slate-400" colSpan={isAdmin ? 7 : 6}>
                    暂无账号
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    className={
                      'border-b border-slate-50 last:border-0' +
                      (selected.includes(r.id) ? ' bg-brand-50/60' : '')
                    }
                  >
                    {isAdmin && (
                      <td className="td text-center">
                        <input
                          type="checkbox"
                          checked={selected.includes(r.id)}
                          onChange={() => toggleOne(r.id)}
                          className="h-3.5 w-3.5 cursor-pointer align-middle accent-brand-500"
                        />
                      </td>
                    )}
                    <td className="td font-medium text-slate-700">
                      {r.name || '—'}
                      {r.must_change_password ? (
                        <span className="ml-2 text-[10px] text-amber-600">待本人改密</span>
                      ) : null}
                    </td>
                    <td className="td font-mono text-xs text-slate-600">{r.phone}</td>
                    <td className="td">
                      <Badge tone={toneOf(r.role)}>{labelOf(r.role)}</Badge>
                    </td>
                    <td className="td">
                      <Badge tone={r.status === '启用' ? 'emerald' : 'slate'}>{r.status ?? '启用'}</Badge>
                    </td>
                    <td className="td text-xs text-slate-500">
                      {r.last_login_at ? new Date(r.last_login_at).toLocaleString('zh-CN', { hour12: false }) : '—'}
                    </td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-1">
                        <IconBtn title="编辑" disabled={!isAdmin} onClick={() => openEdit(r)}>
                          <Pencil size={14} />
                        </IconBtn>
                        <IconBtn title="重置密码" disabled={!isAdmin} onClick={() => { setPwdTarget(r); setNewPwd(suggestPassword()) }}>
                          <KeyRound size={14} />
                        </IconBtn>
                        <IconBtn
                          title={r.status === '启用' ? '停用' : '启用'}
                          disabled={!isAdmin}
                          onClick={() => void toggleStatus(r)}
                        >
                          <RefreshCw size={14} />
                        </IconBtn>
                        <IconBtn title="删除" danger disabled={!isAdmin} onClick={() => void doDelete(r)}>
                          <Trash2 size={14} />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-800">角色权限概览</h3>
          <Button variant="primary" icon={ShieldCheck} onClick={() => nav('/roles')}>
            配置角色与权限
          </Button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th whitespace-nowrap text-left">功能模块</th>
                {list.map((r) => (
                  <th key={r.value} className="th whitespace-nowrap text-center">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m.key} className="border-b border-slate-50 last:border-0">
                  <td className="td whitespace-nowrap text-slate-600">{m.label}</td>
                  {list.map((r) => {
                    const p = permOf(r.value, m.key)
                    return (
                      <td key={r.value} className="td text-center">
                        {p.edit ? (
                          <span className="font-medium text-emerald-600">可编辑</span>
                        ) : p.view ? (
                          <span className="text-slate-500">只读</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
          说明：账号由管理员创建，登录方式为「手机号 + 密码」。管理员重置密码后，本人首次登录需自行修改。
          权限不仅在界面上收敛，写入动作在服务端同样按模块校验。
        </p>
      </div>

      <Modal
        open={creating || !!editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        title={creating ? '新增账号' : '编辑账号'}
        subtitle={creating ? '填写手机号与初始密码，把凭据告知本人' : '修改姓名、手机号、角色或状态'}
        width="max-w-lg"
        footer={
          <>
            <Button
              onClick={() => {
                setCreating(false)
                setEditing(null)
              }}
            >
              取消
            </Button>
            <Button variant="primary" loading={busy} icon={creating ? UserPlus : undefined} onClick={() => void submit()}>
              {creating ? '创建账号' : '保存'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="姓名 / 昵称" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="请输入姓名" />
          </Field>
          <Field label="手机号（登录账号）" required>
            <Input
              value={form.phone}
              inputMode="numeric"
              maxLength={11}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })}
              placeholder="11 位手机号"
            />
          </Field>
          <Field label="角色" required>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {list.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                  {r.desc ? ` —— ${r.desc}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="状态">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          {creating && (
            <Field label="初始密码" required hint="至少 6 位；可点右侧按钮重新生成" >
              <div className="flex gap-2">
                <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="初始密码" />
                <Button type="button" className="shrink-0" onClick={() => setForm({ ...form, password: suggestPassword() })}>
                  生成
                </Button>
              </div>
            </Field>
          )}
        </div>
      </Modal>

      <Modal
        open={!!pwdTarget}
        onClose={() => {
          setPwdTarget(null)
          setNewPwd('')
        }}
        title={`重置「${pwdTarget?.name || pwdTarget?.phone || ''}」的密码`}
        subtitle="重置后本人首次登录需要修改密码"
        width="max-w-md"
        footer={
          <>
            <Button onClick={() => setPwdTarget(null)}>取消</Button>
            <Button variant="primary" loading={busy} onClick={() => void doReset()}>
              确认重置
            </Button>
          </>
        }
      >
        <Field label="新密码" required hint="至少 6 位">
          <div className="flex gap-2">
            <Input value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
            <Button type="button" className="shrink-0" onClick={() => setNewPwd(suggestPassword())}>
              生成
            </Button>
          </div>
        </Field>
      </Modal>
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
  danger,
}: {
  children: ReactNode
  onClick: () => void
  title: string
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'rounded-md p-1.5 transition disabled:cursor-not-allowed disabled:opacity-30',
        danger ? 'text-slate-400 hover:bg-rose-50 hover:text-rose-500' : 'text-slate-400 hover:bg-slate-100 hover:text-brand-600'
      )}
    >
      {children}
    </button>
  )
}
