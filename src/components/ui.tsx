import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Search,
  X,
  XCircle,
} from 'lucide-react'

export const cx = (...parts: any[]) => parts.filter(Boolean).join(' ')

/* ---------------------------------- Badge --------------------------------- */

const TONES: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-600 ring-slate-200/70',
  brand: 'bg-brand-50 text-brand-700 ring-brand-100',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  rose: 'bg-rose-50 text-rose-700 ring-rose-100',
  sky: 'bg-sky-50 text-sky-700 ring-sky-100',
  cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-100',
  violet: 'bg-violet-50 text-violet-700 ring-violet-100',
}

export function Badge({
  children,
  tone = 'slate',
  className,
}: {
  children: React.ReactNode
  tone?: string
  className?: string
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
        TONES[tone] ?? TONES.slate,
        className
      )}
    >
      {children}
    </span>
  )
}

/* --------------------------------- Button --------------------------------- */

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'text'

export function Button({
  variant = 'ghost',
  loading,
  icon: Icon,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant
  loading?: boolean
  icon?: React.ComponentType<{ size?: number | string; className?: string }>
}) {
  const map: Record<BtnVariant, string> = {
    primary: 'btn-primary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
    text: 'btn text-slate-500 hover:bg-slate-100 hover:text-slate-700',
  }
  return (
    <button {...rest} disabled={rest.disabled || loading} className={cx(map[variant], className)}>
      {loading ? <Loader2 size={15} className="animate-spin" /> : Icon ? <Icon size={15} /> : null}
      {children}
    </button>
  )
}

/* --------------------------------- Inputs --------------------------------- */

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx('input', className)} />
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx('input cursor-pointer pr-8', className)}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx('input h-auto min-h-[76px] py-2 leading-relaxed', className)} />
}

export function Field({
  label,
  required,
  hint,
  error,
  className,
  children,
}: {
  label?: string
  required?: boolean
  hint?: string
  error?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      {label && (
        <label className="label">
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = '搜索…',
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cx('relative', className)}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input pl-9 pr-8"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

/* ---------------------------------- Modal --------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-2xl',
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="fixed inset-0 bg-slate-900/35 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div
        className={cx(
          'relative z-10 my-auto w-full rounded-xl2 bg-white shadow-pop animate-fade-in-up',
          width
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-slate-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[calc(100vh-16rem)] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------- Feedback -------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-brand-500', className)} size={20} />
}

export function Loading({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
      <Loader2 size={18} className="animate-spin text-brand-500" />
      {label}
    </div>
  )
}

export function EmptyState({
  title = '暂无数据',
  desc,
  action,
  icon: Icon = Info,
}: {
  title?: string
  desc?: string
  action?: React.ReactNode
  icon?: React.ComponentType<{ size?: number | string; className?: string }>
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon size={22} />
      </div>
      <div>
        <p className="text-sm font-medium text-slate-600">{title}</p>
        {desc && <p className="mt-1 text-xs text-slate-400">{desc}</p>}
      </div>
      {action}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
  icon: Icon,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  icon?: React.ComponentType<{ size?: number | string; className?: string }>
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        {Icon && (
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-cyan-500 text-white shadow-sm">
            <Icon size={19} />
          </span>
        )}
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/* --------------------------- Toast + Confirm host -------------------------- */

type ToastKind = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

interface ConfirmOpts {
  title: string
  desc?: string
  confirmText?: string
  danger?: boolean
}

interface UIContextValue {
  toast: (text: string, kind?: ToastKind) => void
  confirm: (opts: ConfirmOpts) => Promise<boolean>
}

const UICtx = createContext<UIContextValue>({
  toast: () => {},
  confirm: async () => false,
})

export const useUI = () => useContext(UICtx)

const TOAST_STYLE: Record<ToastKind, { cls: string; Icon: any }> = {
  success: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
  error: { cls: 'border-rose-200 bg-rose-50 text-rose-700', Icon: XCircle },
  info: { cls: 'border-slate-200 bg-white text-slate-700', Icon: Info },
}

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [ask, setAsk] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)

  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, kind, text }])
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3600)
  }, [])

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        setAsk({ ...opts, resolve })
      }),
    []
  )

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm])

  return (
    <UICtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-80 flex-col gap-2">
        {toasts.map((t) => {
          const { cls, Icon } = TOAST_STYLE[t.kind]
          return (
            <div
              key={t.id}
              className={cx(
                'pointer-events-auto flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm shadow-card animate-fade-in-up',
                cls
              )}
            >
              <Icon size={16} className="mt-0.5 shrink-0" />
              <span className="leading-snug">{t.text}</span>
            </div>
          )
        })}
      </div>

      <Modal
        open={!!ask}
        onClose={() => {
          ask?.resolve(false)
          setAsk(null)
        }}
        title={ask?.title ?? ''}
        width="max-w-md"
        footer={
          <>
            <Button
              onClick={() => {
                ask?.resolve(false)
                setAsk(null)
              }}
            >
              取消
            </Button>
            <Button
              variant={ask?.danger ? 'danger' : 'primary'}
              onClick={() => {
                ask?.resolve(true)
                setAsk(null)
              }}
            >
              {ask?.confirmText ?? '确定'}
            </Button>
          </>
        }
      >
        <div className="flex gap-3">
          <span
            className={cx(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
              ask?.danger ? 'bg-rose-50 text-rose-500' : 'bg-amber-50 text-amber-500'
            )}
          >
            <AlertTriangle size={18} />
          </span>
          <p className="pt-1.5 text-sm leading-relaxed text-slate-600">
            {ask?.desc ?? '该操作不可撤销，请确认。'}
          </p>
        </div>
      </Modal>
    </UICtx.Provider>
  )
}
