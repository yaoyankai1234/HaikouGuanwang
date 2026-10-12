import { Package, Pencil } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { CrudPage, type FieldDef } from '../components/CrudPage'
import { useData } from '../store/data'
import { useAuth } from '../store/auth'
import { Badge } from '../components/ui'
import { materialImportSpec } from '../lib/importSpecs'

export const materialFields: FieldDef[] = [
  { key: 'code', label: '物资编码', type: 'text', width: 105, placeholder: '如 WZ-01' },
  {
    key: 'name',
    label: '商品名称',
    type: 'text',
    required: true,
    width: 210,
    placeholder: '如 DN200 球墨铸铁管(K9)',
    hint: '商品名称全库唯一，不可与已有物资重复',
  },
  {
    key: 'category_id',
    label: '物资分类',
    type: 'ref',
    ref: 'categories',
    nameKey: 'category_name',
    required: true,
    width: 130,
  },
  { key: 'spec', label: '规格型号', type: 'text', width: 140 },
  { key: 'unit', label: '单位', type: 'text', width: 70 },
  { key: 'brand', label: '品牌/厂家', type: 'text', width: 130 },
  { key: 'ref_price', label: '参考单价(元)', type: 'money', align: 'right', width: 115 },
  { key: 'safety_stock', label: '安全库存', type: 'number', align: 'right', width: 100 },
  { key: 'remark', label: '备注', type: 'textarea', span: 2, inTable: false },
]

export default function Materials() {
  const data = useData()
  const { canEdit } = useAuth()
  const nav = useNavigate()

  return (
    <CrudPage
      title="物资台账"
      subtitle="全部工程物资主数据：分类 + 商品名称 + 规格单位 + 参考单价与安全库存"
      icon={Package}
      table="materials"
      module="materials"
      fields={materialFields}
      orderBy="category_id"
      orderAsc
      searchKeys={['code', 'name', 'category_name', 'spec', 'brand']}
      searchPlaceholder="搜索商品名称 / 编码 / 规格 / 品牌"
      filters={[
        {
          key: 'name',
          label: '商品名称',
          type: 'combo',
          options: data.materials.map((r) => String(r.name ?? '')).filter(Boolean),
        },
        {
          key: 'code',
          label: '物资编码',
          type: 'combo',
          options: data.materials.map((r) => String(r.code ?? '')).filter(Boolean),
        },
        { key: 'category_name', label: '物资分类', type: 'combo', ref: 'categories', sourceKey: 'name' },
      ]}
      exportName="物资台账"
      exportSheet="物资台账"
      newLabel="新建物资"
      importSpec={(rows) => materialImportSpec(rows, data.categories)}
      beforeSave={(form, _isNew, rows, editingId) => {
        const name = String(form.name ?? '').trim()
        const dup = rows.find(
          (m) =>
            String(m.name ?? '').trim().toLowerCase() === name.toLowerCase() &&
            String(m.id) !== String(editingId ?? '')
        )
        if (dup) {
          throw new Error(
            `商品名称「${name}」已存在（物资编码 ${dup.code || '未填'}），商品名称不能重复`
          )
        }
        return { ...form, name }
      }}
      onChanged={() => void data.refresh()}
      rowActions={(row, h) =>
        canEdit('inventory') ? (
          <button
            title="查看库存"
            onClick={() => nav(`/inventory?material=${row.id}`)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-600 transition hover:bg-brand-50"
          >
            <Pencil size={12} /> 库存
          </button>
        ) : null
      }
      summaryText={(rows) => {
        const cats = new Set(rows.map((r) => r.category_name).filter(Boolean))
        return (
          <span className="flex items-center gap-2">
            <Badge tone="cyan">覆盖 {cats.size} 个分类</Badge>
          </span>
        )
      }}
    />
  )
}
