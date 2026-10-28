import React, { useState } from 'react'
import { Boxes, CheckCircle2, Droplets, KeyRound, ShieldCheck, Smartphone, Sprout, Wallet } from 'lucide-react'
import { APP_REGION, APP_SHORT } from '../cloud'
import { useAuth } from '../store/auth'
import { Button, Field, Input } from '../components/ui'
import { Footer } from '../components/Footer'

/**
 * 登录页：手机号 + 密码。
 * 账号由系统管理员在「用户管理」中创建并发给本人；
 * 用户登录后可在「我的账号」中自行修改密码。
 */
export function Login() {
  const { login, loginError, setLoginError } = useAuth()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [phoneErr, setPhoneErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError(null)
    if (!/^1\d{10}$/.test(phone)) {
      setPhoneErr('请输入正确的 11 位手机号')
      return
    }
    setPhoneErr('')
    if (!password) {
      setLoginError('请输入登录密码')
      return
    }
    setBusy(true)
    try {
      await login(phone, password)
    } catch {
      /* 错误已由 auth store 记录 */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-slate-50 px-4 py-10">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-cyan-200/40 blur-3xl" />

      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-pop lg:grid-cols-[1.05fr_1fr]">
        <div className="relative hidden flex-col justify-between bg-gradient-to-br from-brand-600 via-brand-600 to-cyan-500 p-9 text-white lg:flex">
          <div>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <Droplets size={22} />
            </span>
            <h1 className="mt-6 text-[17px] font-semibold leading-snug">{APP_SHORT}</h1>
            <p className="mt-1.5 text-xs text-white/70">{APP_REGION}</p>
            <p className="mt-3 text-sm leading-relaxed text-white/75">
              物资、采购、出入库、合同付款与团队进度一体化管理，数据实时联动，随用随导。
            </p>
          </div>
          <ul className="mt-10 space-y-3 text-sm text-white/85">
            {[
              { icon: Boxes, text: '物资分类 → 采购 → 出入库 → 库存，全链路打通' },
              { icon: Sprout, text: '分团队分组、按进度节点精准出库' },
              { icon: Wallet, text: '合同分阶段付款进度与发票台账联动' },
              { icon: ShieldCheck, text: '手机号 + 密码登录，角色权限分级管理' },
            ].map((f, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <f.icon size={16} className="mt-0.5 shrink-0 text-white/70" />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="p-7 sm:p-9">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-cyan-500 text-white">
              <Droplets size={18} />
            </span>
            <p className="text-sm font-semibold text-slate-900">{APP_SHORT}</p>
          </div>

          <h2 className="text-base font-semibold text-slate-900">账号登录</h2>
          <p className="mt-1 text-xs text-slate-500">使用管理员分配的手机号与密码登录</p>

          {loginError && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
              {loginError}
            </div>
          )}

          <form className="mt-5 space-y-4" onSubmit={submit}>
            <Field label="手机号" required error={phoneErr}>
              <div className="relative">
                <Smartphone size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9"
                  value={phone}
                  inputMode="numeric"
                  maxLength={11}
                  autoComplete="username"
                  placeholder="请输入 11 位手机号"
                  onChange={(e) => {
                    setPhone(e.target.value.replace(/\D/g, ''))
                    setPhoneErr('')
                  }}
                />
              </div>
            </Field>

            <Field label="登录密码" required>
              <div className="relative">
                <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  placeholder="请输入登录密码"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </Field>

            <Button type="submit" variant="primary" className="w-full" loading={busy} icon={CheckCircle2}>
              登录
            </Button>
          </form>

          <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-400">
            还没有账号？请联系系统管理员在「用户管理」中为你创建。
            <br />
            忘记密码请联系管理员重置，重置后登录可自行修改。
          </p>
        </div>
      </div>

      <Footer className="relative mt-7" />
    </div>
  )
}
