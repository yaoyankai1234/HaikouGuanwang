import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Users2 } from 'lucide-react'
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  PageHeader,
  Textarea,
  cx,
  useUI,
} from '../components/ui'
import { MODULES } from '../lib/options'
import { api } from '../lib/api'
import { deleteRow, deleteRows, errText, insertRow, insertRows, selectAll, updateRow, type Row } from '../lib/db'
import { useAuth, type ModulePerm, type RoleRow } from '../store/auth'

const TONES = ['brand', 'cyan', 'violet', 'emerald', 'amber', 'rose', 'sky', 'slate'] as const

const roleTone = (code: string, index: number) =>
  code === 'admin' ? 'rose' : TONES[index % TONES.length]

interface Draft {
  [module: string]: ModulePerm
}

export default function Roles() {
  const { roles, permOf, reloadRoles, isAdmin } = useAuth()
  const { toast, confirm } = useUI()

  const [members, setMembers] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [permTarget, setPermTarget] = useState<RoleRow | null>(null)
  const [draft, setDraft] = useState<Draft>({})

  const [infoTarget, setInfoTarget] = useState<RoleRow | null>(null)
  const [infoForm, setInfoForm] = useState<{ code: string; name: string; description: string }>({
    code: '',
    name: '',
    description: '',
  })
  const [creating, setCreating] = useState(false)
  const [selRoles, setSelRoles] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const us = await api.listUsers()
      setMembers(
        us.map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          phone: u.phone,
          created_at: u.created_at,
        }))
      )
    } catch {
      setMembers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const countOf = useCallback(
    (code: string) => members.filter((m) => m.role === code).length,
    [members]
  )

  const editableCount = useCallback(
    (code: string) => MODULES.filter((m) => permOf(code, m.key).edit).length,
    [permOf]
  )

  const openPerm = (role: RoleRow) => {
    const d: Draft = {}
    MODULES.forEach((m) => {
      d[m.key] = permOf(role.code, m.key)
    })
    setPermTarget(role)
    setDraft(d)
  }

  const savePerm = async () => {
    if (!permTarget) return
    if (permTarget.code === 'admin') {
      setPermTarget(null)
      return
    }
    setBusy(true)
    try {
      const all = await selectAll<Row>('role_permissions', { order: 'id', asc: true })
      const mine = all.filter((r) => r.role_code === permTarget.code)
      await deleteRows('role_permissions', mine.map((r) => r.id))
      await insertRows(
        'role_permissions',
        MODULES.map((m) => ({
          role_code: permTarget.code,
          module: m.key,
          can_view: !!draft[m.key]?.view,
          can_edit: !!draft[m.key]?.edit,
        }))
      )
      await reloadRoles()
      toast(`「${permTarget.name}」的权限已更新`, 'success')
      setPermTarget(null)
    } catch (e: any) {
      toast(errText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const openCreate = () => {
    setInfoTarget(null)
    setInfoForm({ code: '', name: '', description: '' })
    setCreating(true)
  }

  const openInfo = (role: RoleRow) => {
    setCreating(false)
    setInfoTarget(role)
    setInfoForm({
      code: role.code,
      name: role.name,
      description: role.description ?? '',
    })
  }

  const submitInfo = async () => {
    const code = infoForm.code.trim()
    const name = infoForm.name.trim()
    if (!name) return toast('请填写角色名称', 'error')
    setBusy(true)
    try {
      if (creating) {
        if (!/^[a-z][a-z0-9_]{1,30}$/.test(code)) {
          toast('角色标识需为小写字母开头，仅含小写字母、数字与下划线', 'error')
          setBusy(false)
          return
        }
        if (roles.some((r) => r.code === code)) {
          toast('该角色标识已存在', 'error')
          setBusy(false)
          return
        }
        const created = await insertRow('roles', {
          code,
          name,
          description: infoForm.description.trim() || null,
          is_system: false,
          sort: 100,
        })
        // 新角色默认「可查看全部、不可编辑」，再由管理员按需放开
        await insertRows(
          'role_permissions',
          MODULES.map((m) => ({
            role_code: code,
            module: m.key,
            can_view: true,
            can_edit: false,
          }))
        )
        await reloadRoles()
        toast(`已新增角色「${name}」`, 'success')
        const full: RoleRow = { ...created, code, name }
        setCreating(false)
        openPerm(full)
      } else if (infoTarget) {
        await updateRow('roles', infoTarget.id!, {
          name,
          description: infoForm.description.trim() || null,
        })
        await reloadRoles()
        toast('角色信息已更新', 'success')
        setInfoTarget(null)
      }
    } catch (e: any) {
      toast(errText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeRole = async (role: RoleRow) => {
    if (role.is_system) return toast('内置角色不可删除', 'error')
    const used = countOf(role.code)
    const ok = await confirm({
      title: `确认删除角色「${role.name}」？`,
      desc:
        used > 0
          ? `当前仍有 ${used} 个账号使用该角色，删除后这些账号将失去所有权限，需要重新分配角色。`
          : '该角色的权限配置会一并删除，且不可恢复。',
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      const all = await selectAll<Row>('role_permissions', { order: 'id', asc: true })
      const mine = all.filter((r) => r.role_code === role.code)
      await deleteRows('role_permissions', mine.map((r) => r.id))
      await deleteRow('roles', role.id!)
      await reloadRoles()
      toast('角色已删除', 'success')
    } catch (e: any) {
      toast(errText(e), 'error')
    }
  }

  /** 批量删除角色：内置角色不可删，自动跳过 */
  const removeRoles = async () => {
    const targets = roles.filter((r) => selRoles.includes(r.code) && !r.is_system)
    if (!targets.length) {
      toast('内置角色不可删除，请至少选择一个自定义角色', 'error')
      return
    }
    const usedTotal = targets.reduce((a, r) => a + countOf(r.code), 0)
    const ok = await confirm({
      title: `确认删除选中的 ${targets.length} 个角色？`,
      desc:
        `「${targets.map((r) => r.name).join('、')}」的权限配置会一并删除，且不可恢复。` +
        (usedTotal ? `当前仍有 ${usedTotal} 个账号在使用这些角色，删除后需要重新分配角色。` : ''),
      confirmText: `删除 ${targets.length} 个`,
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const codes = targets.map((r) => r.code)
      const all = await selectAll<Row>('role_permissions', { order: 'id', asc: true })
      const mine = all.filter((r) => codes.includes(String(r.role_code)))
      await deleteRows('role_permissions', mine.map((r) => r.id))
      await deleteRows('roles', targets.map((r) => r.id!))
      await reloadRoles()
      setSelRoles([])
      toast(`已删除 ${targets.length} 个角色`, 'success')
    } catch (e: any) {
      toast(errText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const groups = useMemo(() => {
    const g: { title: string; items: typeof MODULES }[] = []
    MODULES.forEach((m) => {
      const hit = g.find((x) => x.title === m.group)
      if (hit) hit.items.push(m)
      else g.push({ title: m.group, items: [m] })
    })
    return g
  }, [])

  const setOne = (key: string, patch: Partial<ModulePerm>) =>
    setDraft((p) => ({ ...p, [key]: { ...p[key], ...patch } }))

  const bulk = (mode: 'all' | 'view' | 'none') =>
    setDraft(() => {
      const d: Draft = {}
      MODULES.forEach((m) => {
        if (mode === 'all') d[m.key] = { view: true, edit: true }
        else if (mode === 'view') d[m.key] = { view: true, edit: false }
        else d[m.key] = { view: false, edit: false }
      })
      return d
    })

  return (
    <div>
      <PageHeader
        title="角色与权限"
        subtitle="每个功能模块都可以单独授权「可查看 / 可编辑」，也可以新增自定义角色"
        icon={ShieldCheck}
        actions={
          <>
            <Button icon={RefreshCw} onClick={() => void Promise.all([load(), reloadRoles()])}>
              刷新
            </Button>
            {isAdmin && (
              <Button variant="primary" icon={Plus} onClick={openCreate}>
                新增角色
              </Button>
            )}
          </>
        }
      />

      {!isAdmin && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          只有「系统管理员」可以修改角色与权限；你可以查看当前各角色的权限配置。
        </div>
      )}

      {isAdmin && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
          <span className="text-xs text-slate-500">
            勾选卡片左侧复选框可批量删除自定义角色，已选{' '}
            <b className="text-brand-600">{selRoles.length}</b> 个
          </span>
          <Button
            onClick={() =>
              setSelRoles(
                roles.filter((r) => !r.is_system).length &&
                  roles.filter((r) => !r.is_system).every((r) => selRoles.includes(r.code))
                  ? []
                  : roles.filter((r) => !r.is_system).map((r) => r.code)
              )
            }
          >
            {roles.filter((r) => !r.is_system).length &&
            roles.filter((r) => !r.is_system).every((r) => selRoles.includes(r.code))
              ? '取消全选'
              : '全选自定义角色'}
          </Button>
          <Button
            variant="danger"
            icon={Trash2}
            loading={busy}
            disabled={!selRoles.length}
            onClick={() => void removeRoles()}
          >
            批量删除{selRoles.length ? `（${selRoles.length}）` : ''}
          </Button>
          <span className="text-[11px] text-slate-400">内置角色不可删除</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {roles.map((role, i) => (
          <div
            key={role.code}
            className={cx(
              'card flex flex-col p-4 transition',
              selRoles.includes(role.code) && 'ring-2 ring-brand-300'
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                {isAdmin && (
                  <input
                    type="checkbox"
                    disabled={role.is_system}
                    checked={selRoles.includes(role.code)}
                    onChange={() =>
                      setSelRoles((prev) =>
                        prev.includes(role.code) ? prev.filter((c) => c !== role.code) : [...prev, role.code]
                      )
                    }
                    title={role.is_system ? '内置角色不可删除' : '选中后可批量删除'}
                    className="mt-1 h-3.5 w-3.5 shrink-0 accent-brand-500 disabled:cursor-not-allowed disabled:opacity-30"
                  />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={roleTone(role.code, i)}>{role.name}</Badge>
                    <span className="font-mono text-[10px] text-slate-400">{role.code}</span>
                    {role.is_system ? (
                      <span className="text-[10px] text-slate-400">内置</span>
                    ) : (
                      <span className="text-[10px] text-brand-500">自定义</span>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-[32px] text-xs leading-relaxed text-slate-500">
                    {role.description || '暂无说明'}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5">
                <Users2 size={11} /> {countOf(role.code)} 人
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5">
                <KeyRound size={11} /> 可编辑 {editableCount(role.code)}/{MODULES.length} 模块
              </span>
            </div>

            <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
              <Button icon={KeyRound} onClick={() => openPerm(role)}>
                编辑权限
              </Button>
              {isAdmin && (
                <button
                  title="编辑角色信息"
                  onClick={() => openInfo(role)}
                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-brand-50 hover:text-brand-600"
                >
                  <Pencil size={14} />
                </button>
              )}
              {isAdmin && !role.is_system && (
                <button
                  title="删除角色"
                  onClick={() => void removeRole(role)}
                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {!loading && roles.length === 0 && (
          <div className="card p-6 text-sm text-slate-500">尚未读取到角色定义，请检查云端连接后刷新。</div>
        )}
      </div>

      {/* 权限矩阵 */}
      <Modal
        open={!!permTarget}
        onClose={() => setPermTarget(null)}
        title={`「${permTarget?.name ?? ''}」的功能权限`}
        subtitle={
          permTarget?.code === 'admin'
            ? '系统管理员始终拥有全部权限，无需配置'
            : '「可查看」决定是否能在导航中看到该模块；「可编辑」决定是否允许新增、修改与删除'
        }
        width="max-w-3xl"
        footer={
          <>
            <Button onClick={() => setPermTarget(null)}>取消</Button>
            <Button variant="primary" loading={busy} disabled={permTarget?.code === 'admin'} onClick={() => void savePerm()}>
              保存权限
            </Button>
          </>
        }
      >
        {permTarget?.code === 'admin' ? (
          <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-xs leading-relaxed text-brand-700">
            系统管理员拥有全部功能模块的查看与编辑权限，且权限受数据库策略保护，不可被削减。
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Button onClick={() => bulk('all')}>全部可编辑</Button>
              <Button onClick={() => bulk('view')}>仅可查看</Button>
              <Button onClick={() => bulk('none')}>全部关闭</Button>
              <span className="text-[11px] text-slate-400">快捷设置后仍可逐项微调</span>
            </div>

            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.title} className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] font-semibold tracking-wide text-slate-500">
                    {g.title}
                  </div>
                  <div className="divide-y divide-slate-50">
                    {g.items.map((m) => {
                      const cur = draft[m.key] ?? { view: false, edit: false }
                      return (
                        <div key={m.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <span className="text-sm text-slate-700">{m.label}</span>
                          <div className="flex items-center gap-4">
                            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-brand-600"
                                checked={cur.view}
                                onChange={(e) =>
                                  setOne(m.key, {
                                    view: e.target.checked,
                                    edit: e.target.checked ? cur.edit : false,
                                  })
                                }
                              />
                              可查看
                            </label>
                            <label
                              className={cx(
                                'inline-flex cursor-pointer items-center gap-1.5 text-xs',
                                cur.view ? 'text-slate-600' : 'cursor-not-allowed text-slate-300'
                              )}
                            >
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-emerald-600"
                                checked={cur.edit}
                                disabled={!cur.view}
                                onChange={(e) => setOne(m.key, { edit: e.target.checked, view: true })}
                              />
                              可编辑
                            </label>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>

      {/* 角色信息 */}
      <Modal
        open={creating || !!infoTarget}
        onClose={() => {
          setCreating(false)
          setInfoTarget(null)
        }}
        title={creating ? '新增角色' : `编辑角色 · ${infoTarget?.name ?? ''}`}
        subtitle={creating ? '新增后默认「可查看全部模块」，再按需放开编辑权限' : '角色标识（code）创建后不可修改'}
        width="max-w-lg"
        footer={
          <>
            <Button
              onClick={() => {
                setCreating(false)
                setInfoTarget(null)
              }}
            >
              取消
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void submitInfo()}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="角色标识" required hint="小写字母开头，仅含小写字母、数字与下划线，如 site_supervisor">
            <Input
              value={infoForm.code}
              disabled={!creating}
              placeholder="site_supervisor"
              onChange={(e) => setInfoForm((p) => ({ ...p, code: e.target.value.trim() }))}
            />
          </Field>
          <Field label="角色名称" required>
            <Input
              value={infoForm.name}
              placeholder="如：现场监理"
              onChange={(e) => setInfoForm((p) => ({ ...p, name: e.target.value }))}
            />
          </Field>
          <Field label="角色说明">
            <Textarea
              value={infoForm.description}
              placeholder="说明该角色的职责范围，便于其他成员理解"
              onChange={(e) => setInfoForm((p) => ({ ...p, description: e.target.value }))}
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
