import { Boxes } from 'lucide-react'
import { CrudPage, type FieldDef } from '../components/CrudPage'
import { useData } from '../store/data'
import { categoryImportSpec } from '../lib/importSpecs'

export const categoryFields: FieldDef[] = [
  { key: 'code', label: '分类编码', type: 'text', width: 110, placeholder: '如 CL-01' },
  { key: 'name', label: '物资分类', type: 'text', required: true, width: 190, placeholder: '如 主管道' },
  { key: 'spec_range', label: '规格范围', type: 'text', width: 170, placeholder: '如 DN150-DN400' },
  { key: 'unit', label: '计量单位', type: 'text', width: 90, placeholder: '如 m / t / 只' },
  { key: 'remark', label: '备注说明', type: 'textarea', span: 2, inTable: false },
]

export default function MaterialCategories() {
  const data = useData()
  return (
    <CrudPage
      title="物资分类"
      subtitle="定义工程物资大类与规格范围，是采购订单、出入库明细的联动基础"
      icon={Boxes}
      table="material_categories"
      module="material_categories"
      fields={categoryFields}
      orderBy="id"
      orderAsc
      searchKeys={['code', 'name', 'spec_range', 'unit', 'remark']}
      searchPlaceholder="搜索分类名称 / 编码 / 规格"
      filters={[
        {
          key: 'name',
          label: '物资分类',
          type: 'combo',
          options: data.categories.map((r) => String(r.name ?? '')).filter(Boolean),
        },
        { key: 'unit', label: '计量单位', type: 'combo', options: data.categories.map((r) => String(r.unit ?? '')).filter(Boolean) },
      ]}
      exportName="物资分类"
      exportSheet="物资分类"
      newLabel="新建分类"
      importSpec={categoryImportSpec}
      onChanged={() => void data.refresh()}
    />
  )
}
