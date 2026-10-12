import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsUpDown, ArrowDown, ArrowUp, Inbox } from 'lucide-react'
import { EmptyState, Loading, Select, cx } from './ui'

export interface Column {
  key: string
  label: string
  width?: number | string
  align?: 'left' | 'right' | 'center'
  render?: (row: any) => React.ReactNode
  sortValue?: (row: any) => string | number
  className?: string
}

const ALIGN: Record<string, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

export function DataTable({
  columns,
  rows,
  loading,
  emptyTitle = '暂无数据',
  emptyDesc,
  pageSize: initialPageSize = 15,
  onRowClick,
  toolbar,
  summary,
  selectable = false,
  selectedIds,
  onSelectionChange,
  batchBar,
}: {
  columns: Column[]
  rows: any[]
  loading?: boolean
  emptyTitle?: string
  emptyDesc?: string
  pageSize?: number
  onRowClick?: (row: any) => void
  toolbar?: React.ReactNode
  summary?: React.ReactNode
  /** 开启多选：表格最左侧出现复选框列 */
  selectable?: boolean
  /** 已选中的记录 id（受控） */
  selectedIds?: (number | string)[]
  onSelectionChange?: (ids: (number | string)[]) => void
  /** 有选中项时，显示在表格上方的操作条 */
  batchBar?: React.ReactNode
}) {
  const [sortKey, setSortKey] = useState<string>('')
  const [sortAsc, setSortAsc] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const headRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setPage(1)
  }, [rows, pageSize])

  /* -------------------------------- 多选 -------------------------------- */

  const selectedSet = useMemo(
    () => new Set((selectedIds ?? []).map((v) => String(v))),
    [selectedIds]
  )
  /** 可被勾选的范围 = 当前筛选出的全部行（不只当前页） */
  const checkableIds = useMemo(
    () => rows.map((r) => r?.id).filter((v) => v !== null && v !== undefined),
    [rows]
  )
  const checkedCount = useMemo(
    () => checkableIds.filter((id) => selectedSet.has(String(id))).length,
    [checkableIds, selectedSet]
  )
  const allChecked = selectable && checkableIds.length > 0 && checkedCount === checkableIds.length
  const halfChecked = selectable && checkedCount > 0 && !allChecked

  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = halfChecked
  }, [halfChecked])

  const toggleAll = () => {
    onSelectionChange?.(allChecked ? [] : checkableIds)
  }

  const toggleOne = (id: any) => {
    const key = String(id)
    const next = new Set(selectedSet)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    // 只回报仍然存在于当前列表中的 id，避免筛选后出现"选中但看不见"的记录
    onSelectionChange?.(checkableIds.filter((v) => next.has(String(v))))
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const col = columns.find((c) => c.key === sortKey)
    const get = (r: any) =>
      col?.sortValue ? col.sortValue(r) : (r?.[sortKey] ?? '')
    return [...rows].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (typeof va === 'number' && typeof vb === 'number') return sortAsc ? va - vb : vb - va
      return sortAsc
        ? String(va).localeCompare(String(vb), 'zh-CN')
        : String(vb).localeCompare(String(va), 'zh-CN')
    })
  }, [rows, sortKey, sortAsc, columns])

  const total = sorted.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pageCount)
  const slice = useMemo(
    () => sorted.slice((current - 1) * pageSize, current * pageSize),
    [sorted, current, pageSize]
  )

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      {toolbar && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">{toolbar}</div>
      )}
      {selectable && checkedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-brand-100 bg-brand-50/70 px-4 py-2.5">
          {batchBar}
        </div>
      )}
      {loading ? (
        <Loading />
      ) : total === 0 ? (
        <EmptyState title={emptyTitle} desc={emptyDesc} icon={Inbox} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-100">
                  {selectable && (
                    <th className="th w-10 text-center">
                      <input
                        ref={headRef}
                        type="checkbox"
                        checked={allChecked}
                        onChange={toggleAll}
                        title={allChecked ? '取消全选' : '全选当前筛选结果'}
                        className="h-3.5 w-3.5 cursor-pointer accent-brand-500 align-middle"
                      />
                    </th>
                  )}
                  <th className="th w-12 text-center">序号</th>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      style={{ width: c.width, minWidth: typeof c.width === 'number' ? c.width : undefined }}
                      className={cx('th select-none', ALIGN[c.align ?? 'left'])}
                    >
                      <button
                        onClick={() => toggleSort(c.key)}
                        className={cx(
                          'inline-flex items-center gap-1 transition hover:text-slate-800',
                          c.align === 'right' && 'flex-row-reverse'
                        )}
                      >
                        {c.label}
                        {sortKey === c.key ? (
                          sortAsc ? (
                            <ArrowUp size={12} className="text-brand-500" />
                          ) : (
                            <ArrowDown size={12} className="text-brand-500" />
                          )
                        ) : (
                          <ChevronsUpDown size={12} className="text-slate-300" />
                        )}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.map((row, i) => (
                  <tr
                    key={row.id ?? i}
                    onClick={() => onRowClick?.(row)}
                    className={cx(
                      'border-b border-slate-50 transition last:border-0',
                      onRowClick && 'cursor-pointer',
                      selectable && selectedSet.has(String(row.id)) ? 'bg-brand-50/60' : 'hover:bg-brand-50/40'
                    )}
                  >
                    {selectable && (
                      <td className="td text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedSet.has(String(row.id))}
                          disabled={row?.id === null || row?.id === undefined}
                          onChange={() => toggleOne(row.id)}
                          className="h-3.5 w-3.5 cursor-pointer accent-brand-500 align-middle"
                        />
                      </td>
                    )}
                    <td className="td text-center text-xs text-slate-400">
                      {(current - 1) * pageSize + i + 1}
                    </td>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cx('td', ALIGN[c.align ?? 'left'], c.className)}
                      >
                        {c.render ? c.render(row) : renderDefault(row?.[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>
                共 <b className="text-slate-700">{total}</b> 条
              </span>
              {summary}
              <Select
                className="h-8 w-[92px] text-xs"
                value={String(pageSize)}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                {[10, 15, 30, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} 条/页
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <button
                className="btn-ghost h-8 px-2"
                disabled={current <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={15} />
              </button>
              <span className="px-2 text-xs text-slate-500">
                {current} / {pageCount}
              </span>
              <button
                className="btn-ghost h-8 px-2"
                disabled={current >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function renderDefault(v: any): React.ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-slate-300">—</span>
  return String(v)
}
