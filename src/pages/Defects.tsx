import { useMemo } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { CrudPage, type FieldDef } from '../components/CrudPage'
import { useData } from '../store/data'
import { DEFECT_DISPOSALS, DEFECT_SOURCES, DEFECT_STATUS, DEFECT_TYPES } from '../lib/options'
import { money, moneyText } from '../lib/format'
import { Badge } from '../components/ui'

function autoNo(): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `SH${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${String(d.getTime()).slice(-4)}`
}

/** 基础字段定义（不含需要路由跳转的来源单号列） */
export const defectFields: FieldDef[] = [
  { key: 'record_no', label: '记录单号', type: 'text', width: 145, placeholder: '留空自动生成' },
  { key: 'record_date', label: '发生日期', type: 'date', required: true, width: 108 },
  {
    key: 'type',
    label: '类型',
    type: 'select',
    options: DEFECT_TYPES,
    required: true,
    default: '损耗',
    badge: true,
    width: 78,
  },
  { key: 'source', label: '发现环节', type: 'select', options: DEFECT_SOURCES, default: '现场施工', width: 100 },
  { key: 'source_no', label: '来源单号', type: 'text', inForm: false, width: 152 },
  {
    key: 'material_id',
    label: '商品名称',
    type: 'ref',
    ref: 'materials',
    nameKey: 'material_name',
    required: true,
    width: 185,
    onRefPick: (m, form, ctx) => {
      const cat = ctx.categories.find((c) => String(c.id) === String(m.category_id))
      return {
        category_id: m.category_id ?? null,
        category_name: cat?.name ?? m.category_name ?? null,
        spec: m.spec ?? '',
        unit: m.unit ?? '',
        unit_price: Number(form.unit_price) || Number(m.ref_price) || 0,
      }
    },
  },
  { key: 'category_id', label: '物资分类', type: 'ref', ref: 'categories', nameKey: 'category_name', width: 115 },
  { key: 'spec', label: '规格型号', type: 'text', width: 115 },
  { key: 'unit', label: '单位', type: 'text', width: 66 },
  { key: 'qty', label: '数量', type: 'number', required: true, default: 0, align: 'right', width: 88 },
  { key: 'unit_price', label: '单价(元)', type: 'money', align: 'right', width: 98 },
  {
    key: 'amount',
    label: '损失金额(元)',
    type: 'money',
    align: 'right',
    width: 118,
    tableRender: (row) => <span className="num font-medium text-rose-600">{moneyText(row.amount)}</span>,
  },
  {
    key: 'supplier_id',
    label: '责任供应商',
    type: 'ref',
    ref: 'suppliers',
    nameKey: 'supplier_name',
    width: 155,
  },
  { key: 'team_id', label: '责任团队', type: 'ref', ref: 'teams', nameKey: 'team_name', width: 125 },
  { key: 'reason', label: '原因分析', type: 'textarea', span: 2, inTable: false },
  { key: 'disposal', label: '处理方式', type: 'select', options: DEFECT_DISPOSALS, default: '待定', width: 100 },
  { key: 'handler', label: '处理人', type: 'text', width: 88 },
  {
    key: 'status',
    label: '处理状态',
    type: 'select',
    options: DEFECT_STATUS,
    default: '待处理',
    badge: true,
    width: 88,
  },
  { key: 'remark', label: '备注', type: 'textarea', span: 2, inTable: false },
]

export default function Defects() {
  const data = useData()
  const nav = useNavigate()

  const fields = useMemo<FieldDef[]>(
    () =>
      defectFields.map((f) =>
        f.key !== 'source_no'
          ? f
          : {
              ...f,
              tableRender: (row) => {
                const no = String(row.source_no ?? '')
                if (!no) return <span className="text-slate-300">—</span>
                const isInbound = /^RK/i.test(no)
                return (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      nav(
                        isInbound
                          ? `/inbound?inno=${encodeURIComponent(no)}`
                          : `/orders?no=${encodeURIComponent(no)}`
                      )
                    }}
                    className="truncate text-left font-medium text-brand-600 hover:text-brand-700 hover:underline"
                    title="查看来源单据"
                  >
                    {no}
                  </button>
                )
              },
            }
      ),
    [nav]
  )

  return (
    <CrudPage
      title="损耗与不合格"
      subtitle="记录现场损耗与验收不合格物资，入库验收不合格会自动登记并可回溯到入库单"
      icon={TriangleAlert}
      table="defects"
      module="defects"
      fields={fields}
      orderBy="id"
      searchKeys={[
        'record_no',
        'material_name',
        'category_name',
        'source_no',
        'reason',
        'supplier_name',
        'team_name',
        'handler',
      ]}
      searchPlaceholder="搜索单号 / 物资 / 来源单号 / 责任方"
      filters={[
        { key: 'type', label: '类型', options: DEFECT_TYPES },
        { key: 'status', label: '状态', options: DEFECT_STATUS },
        { key: 'source', label: '发现环节', options: DEFECT_SOURCES },
        { key: 'material_name', label: '商品名称', type: 'combo', ref: 'materials', sourceKey: 'name' },
        { key: 'category_name', label: '物资分类', type: 'combo', ref: 'categories', sourceKey: 'name' },
        { key: 'supplier_name', label: '责任供应商', type: 'combo', ref: 'suppliers', sourceKey: 'name' },
        { key: 'team_name', label: '责任团队', type: 'combo', ref: 'teams', sourceKey: 'name' },
        { key: 'record_date', label: '发生日期', type: 'dateRange' },
      ]}
      exportName="损耗与不合格台账"
      exportSheet="损耗与不合格"
      newLabel="登记损耗/不合格"
      beforeSave={(form) => ({
        ...form,
        record_no: form.record_no || autoNo(),
        amount: money((Number(form.qty) || 0) * (Number(form.unit_price) || 0)),
      })}
      onChanged={() => void data.refresh()}
      summaryText={(rows) => (
        <span className="flex items-center gap-2">
          <Badge tone="amber">损耗 {rows.filter((r) => r.type === '损耗').length} 条</Badge>
          <Badge tone="rose">不合格 {rows.filter((r) => r.type === '不合格').length} 条</Badge>
          <span className="text-slate-400">
            损失合计 <b className="num text-rose-600">¥ {moneyText(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0))}</b>
          </span>
        </span>
      )}
    />
  )
}
