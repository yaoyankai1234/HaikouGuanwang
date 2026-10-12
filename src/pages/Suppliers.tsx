import { Building2 } from 'lucide-react'
import { CrudPage, type FieldDef } from '../components/CrudPage'
import { useData } from '../store/data'
import { SUPPLIER_COOPERATION, SUPPLIER_MAIN_TYPES, SUPPLIER_RATINGS } from '../lib/options'

export const supplierFields: FieldDef[] = [
  { key: 'code', label: '供应商编码', type: 'text', width: 110, placeholder: '如 GYS-001' },
  { key: 'name', label: '供应商名称', type: 'text', required: true, width: 230 },
  {
    key: 'cooperation',
    label: '合作状态',
    type: 'select',
    options: SUPPLIER_COOPERATION,
    default: '未合作',
    badge: true,
    width: 110,
  },
  {
    key: 'main_type',
    label: '主营类型',
    type: 'select',
    options: SUPPLIER_MAIN_TYPES,
    required: true,
    width: 120,
  },
  {
    key: 'supply_scope',
    label: '供货品类范围',
    type: 'text',
    width: 220,
    placeholder: '如 DN150-DN400 球墨铸铁管、管件',
  },
  { key: 'rating', label: '履约评级', type: 'select', options: SUPPLIER_RATINGS, default: '未评级', width: 100 },
  { key: 'contact', label: '联系人', type: 'text', width: 100 },
  { key: 'phone', label: '联系电话', type: 'text', width: 130 },
  { key: 'address', label: '地址', type: 'text', span: 2, inTable: false },
  { key: 'remark', label: '备注', type: 'textarea', span: 2, inTable: false },
]

export default function Suppliers() {
  const data = useData()
  const suppliers = data.suppliers
  return (
    <CrudPage
      title="供应商档案"
      subtitle="已合作 / 未合作 / 储备入库供应商统一管理，按主营类型归类"
      icon={Building2}
      table="suppliers"
      module="suppliers"
      fields={supplierFields}
      searchKeys={['code', 'name', 'main_type', 'supply_scope', 'contact', 'phone']}
      searchPlaceholder="搜索供应商名称 / 主营类型 / 联系人"
      filters={[
        {
          key: 'name',
          label: '供应商名称',
          type: 'combo',
          options: suppliers.map((r) => String(r.name ?? '')).filter(Boolean),
        },
        { key: 'main_type', label: '主营类型', options: SUPPLIER_MAIN_TYPES },
        { key: 'cooperation', label: '合作状态', options: SUPPLIER_COOPERATION },
        { key: 'rating', label: '履约评级', options: SUPPLIER_RATINGS },
      ]}
      exportName="供应商档案"
      exportSheet="供应商档案"
      newLabel="新建供应商"
      onChanged={() => void data.refresh()}
      summaryText={(rows) => (
        <span className="text-xs text-slate-400">
          已合作 {rows.filter((r) => r.cooperation === '已合作').length} 家 · 供应商库{' '}
          {rows.filter((r) => r.cooperation === '储备入库').length} 家 · 未合作{' '}
          {rows.filter((r) => r.cooperation === '未合作').length} 家
        </span>
      )}
    />
  )
}
