import { useState } from 'react'
import { KeyRound, LogOut, Save, ShieldCheck, UserCircle2 } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../store/auth'
import { errText } from '../lib/db'
import { MODULES } from '../lib/options'
import { Badge, Button, Field, Input, Modal, PageHeader, cx, useUI } from '../components/ui'

export default function Profile() {
  const { profile, user, role, roleName, roles, displayName, permOf, mustChangePassword, reload, signOut } = useAuth()
  const { toast, confirm } = useUI()

  const [name, setName] = useState(profile?.name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [saving, setSaving] = useState(false)

  const [pwdOpen, setPwdOpen] = useState(mustChangePassword)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [pwdBusy, setPwdBusy] = useState(false)
  const [pwdErr, setPwdErr] = useState('')

  const roleDef = roles.find((r) => r.code === role)
  const myPerms = MODULES.filter((m) => permOf(role, m.key).view)
  const editable = MODULES.filter((m) => permOf(role, m.key).edit)

  const save = async () => {
    if (!profile) return
    if (!name.trim()) {
      toast('请填写姓名 / 昵称', 'error')
      return
    }
    setSaving(true)
    try {
      await api.updateProfile({ name: name.trim(), phone: phone.trim() || null })
      await reload()
      toast('资料已保存', 'success')
    } catch (e: any) {
      toast(errText(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const changePwd = async () => {
    setPwdErr('')
    if (newPwd.length < 6) {
      setPwdErr('新密码至少 6 位')
      return
    }
    if (!mustChangePassword && !oldPwd) {
      setPwdErr('请输入当前密码')
      return
    }
    setPwdBusy(true)
    try {
      await api.changePassword(oldPwd, newPwd)
      setPwdOpen(false)
      setOldPwd('')
      setNewPwd('')
      await reload()
      toast('密码已更新', 'success')
    } catch (e: any) {
      setPwdErr(e?.message || '密码修改失败')
    } finally {
      setPwdBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="我的账号"
        subtitle="账号资料、角色权限与登录安全"
        icon={UserCircle2}
        actions={
          <Button
            icon={LogOut}
            variant="danger"
            onClick={async () => {
              const ok = await confirm({ title: '确认退出登录？', desc: '退出后需重新验证身份才能进入系统。', confirmText: '退出' })
              if (ok) await signOut()
            }}
          >
            退出登录
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-1">
          <div className="flex flex-col items-center gap-3 bg-gradient-to-br from-brand-600 to-cyan-500 px-6 py-8 text-white">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-2xl font-semibold backdrop-blur">
              {displayName.slice(0, 1)}
            </span>
            <div className="text-center">
              <p className="text-base font-semibold">{displayName}</p>
              <p className="mt-1 text-xs text-white/75">{user?.phone || '手机号密码账号'}</p>
            </div>
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">{roleName}</span>
          </div>
          <div className="space-y-3 p-5 text-sm">
            <Row label="账号 ID" value={<span className="font-mono text-xs text-slate-500">{user?.id ?? '—'}</span>} />
            <Row label="角色标识" value={<span className="font-mono text-xs text-slate-500">{role}</span>} />
            <Row
              label="角色说明"
              value={
                <span className="text-xs text-slate-500">
                  {roleDef?.description ?? '由管理员在「角色与权限」中配置'}
                </span>
              }
            />
          </div>
        </div>

        <div className="card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-800">基本资料</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">姓名会展示在系统右上角与操作记录中</p>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="姓名 / 昵称" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入姓名" />
            </Field>
            <Field label="联系电话">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="选填" />
            </Field>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={Save} loading={saving} onClick={() => void save()}>
              保存资料
            </Button>
            <Button icon={KeyRound} onClick={() => setPwdOpen(true)}>
              修改密码
            </Button>
          </div>

          <div className="mt-7 border-t border-slate-100 pt-5">
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-brand-600" />
              <h4 className="text-sm font-semibold text-slate-800">当前角色的功能权限</h4>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {MODULES.map((m) => {
                const p = permOf(role, m.key)
                return (
                  <span
                    key={m.key}
                    className={cx(
                      'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ring-1 ring-inset',
                      p.edit
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                        : p.view
                          ? 'bg-slate-50 text-slate-500 ring-slate-200'
                          : 'bg-white text-slate-300 ring-slate-100 line-through'
                    )}
                    title={p.edit ? '可查看并编辑' : p.view ? '仅可查看' : '无权限'}
                  >
                    {m.label}
                  </span>
                )
              })}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
              共可见 {myPerms.length} 个模块，其中可编辑 {editable.length} 个。如需调整，请联系系统管理员在
              「角色与权限」中修改；权限同时由服务端强制校验，只读范围无法通过任何方式写入数据。
            </p>
          </div>
        </div>
      </div>

      <Modal
        open={pwdOpen}
        onClose={() => setPwdOpen(false)}
        title="修改登录密码"
        subtitle="输入当前密码后设置新密码；管理员重置后首次登录可直接设置新密码"
        width="max-w-md"
        footer={
          <>
            <Button onClick={() => setPwdOpen(false)}>取消</Button>
            <Button variant="primary" loading={pwdBusy} onClick={() => void changePwd()}>
              确认修改
            </Button>
          </>
        }
      >
        {pwdErr && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{pwdErr}</div>
        )}
        {mustChangePassword && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            你的密码已被管理员重置，请设置新密码（本次无需填写当前密码）。
          </div>
        )}
        <div className="space-y-4">
          {!mustChangePassword && (
            <Field label="当前密码" required>
              <Input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} />
            </Field>
          )}
          <Field label="新密码" required hint="至少 6 位，建议包含字母与数字">
            <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-50 pb-2.5 last:border-0">
      <span className="shrink-0 text-xs text-slate-400">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}
