import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Select, cx } from './ui'
import { filterOptions, type FilterDef } from '../lib/fields'
import type { DataValue } from '../store/data'

/**
 * 筛选条：统一渲染「下拉 / 可输入下拉 / 单日 / 日期区间」四类筛选条件。
 * 可输入下拉（combo）适合供应商、单号、合同编号这类长文本——既能直接输入关键字，
 * 也能从下拉里挑一条精确记录，输入与选择共用同一个输入框。
 */
export function FilterBar({
  filters,
  values,
  onChange,
  data,
}: {
  filters: FilterDef[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  data: DataValue
}) {
  if (!filters.length) return null
  return (
    <>
      {filters.map((f) => {
        const v = values[f.key] ?? ''
        if (f.type === 'dateRange') {
          return <DateRangeFilter key={f.key} label={f.label} value={v} onChange={(nv) => onChange(f.key, nv)} />
        }
        if (f.type === 'date') {
          return <SingleDateFilter key={f.key} label={f.label} value={v} onChange={(nv) => onChange(f.key, nv)} />
        }
        const opts = filterOptions(f, data)
        if (f.type === 'combo') {
          return (
            <ComboFilter
              key={f.key}
              value={v}
              options={opts}
              placeholder={`${f.label}（可输入筛选）`}
              onChange={(nv) => onChange(f.key, nv)}
            />
          )
        }
        return (
          <Select
            key={f.key}
            className="w-full sm:w-40"
            value={v}
            onChange={(e) => onChange(f.key, e.target.value)}
          >
            <option value="">{f.label}（全部）</option>
            {opts.map((o) => (
              <option key={`${o.value}|${o.label}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )
      })}
    </>
  )
}

/** 判断是否处于「有筛选条件」状态，用于显示重置按钮 */
export function hasActiveFilters(values: Record<string, string>, keyword?: string): boolean {
  return !!keyword?.trim() || Object.values(values).some((v) => (v ?? '').trim() !== '')
}

/** 单行数据是否命中全部筛选条件 */
export function matchFilters(row: any, filters: FilterDef[], values: Record<string, string>): boolean {
  for (const f of filters) {
    const v = (values[f.key] ?? '').trim()
    if (!v) continue
    const raw = row?.[f.key]
    if (f.type === 'dateRange') {
      const [from, to] = v.split('~')
      const d = String(raw ?? '').slice(0, 10)
      if (!d) return false
      if (from && d < from) return false
      if (to && d > to) return false
      continue
    }
    if (f.type === 'date') {
      if (String(raw ?? '').slice(0, 10) !== v) return false
      continue
    }
    const s = String(raw ?? '')
    if (f.type === 'combo') {
      if (!s.toLowerCase().includes(v.toLowerCase())) return false
    } else if (s !== v) {
      return false
    }
  }
  return true
}

/* ------------------------------- 可输入下拉 ------------------------------- */

function ComboFilter({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(value)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setText(value)
  }, [value])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const list = useMemo(() => {
    const kw = text.trim().toLowerCase()
    if (!kw) return options
    return options.filter(
      (o) => o.label.toLowerCase().includes(kw) || o.value.toLowerCase().includes(kw)
    )
  }, [options, text])

  return (
    <div ref={box} className="relative w-full sm:w-60">
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-400" />
      <input
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        className="input pl-9 pr-8"
      />
      {text ? (
        <button
          onClick={() => {
            setText('')
            onChange('')
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100"
        >
          <X size={13} />
        </button>
      ) : null}
      {open && list.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-pop">
          {list.slice(0, 80).map((o) => (
            <button
              key={`${o.value}|${o.label}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(o.value)
                setText(o.value)
                setOpen(false)
              }}
              className={cx(
                'block w-full truncate px-3 py-1.5 text-left text-xs transition hover:bg-brand-50',
                o.value === value ? 'font-medium text-brand-700' : 'text-slate-600'
              )}
              title={o.label}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* -------------------------------- 日期区间 -------------------------------- */

function DateRangeFilter({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const [from, to] = (value ?? '').split('~')
  const emit = (a: string, b: string) => onChange(a || b ? `${a}~${b}` : '')
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
      <span className="shrink-0 pl-1 text-[11px] text-slate-400">{label}</span>
      <input
        type="date"
        value={from ?? ''}
        onChange={(e) => emit(e.target.value, to ?? '')}
        className="h-7 w-[122px] rounded border-0 bg-transparent text-xs text-slate-700 outline-none"
      />
      <span className="text-[11px] text-slate-300">~</span>
      <input
        type="date"
        value={to ?? ''}
        onChange={(e) => emit(from ?? '', e.target.value)}
        className="h-7 w-[122px] rounded border-0 bg-transparent text-xs text-slate-700 outline-none"
      />
      {value ? (
        <button
          onClick={() => onChange('')}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100"
          title="清除日期区间"
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  )
}

/* --------------------------------- 单日 --------------------------------- */

function SingleDateFilter({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
      <span className="shrink-0 pl-1 text-[11px] text-slate-400">{label}</span>
      <input
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-[128px] rounded border-0 bg-transparent text-xs text-slate-700 outline-none"
      />
      {value ? (
        <button onClick={() => onChange('')} className="rounded p-0.5 text-slate-400 hover:bg-slate-100" title="清除">
          <X size={12} />
        </button>
      ) : null}
    </div>
  )
}
