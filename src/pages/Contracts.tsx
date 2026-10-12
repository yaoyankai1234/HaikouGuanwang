import { useMemo } from 'react'
import { FileText, Wallet } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CrudPage, type FieldDef } from '../components/CrudPage'
import { useData } from '../store/data'
import { useAuth } from '../store/auth'
import { CONTRACT_STATUS } from '../lib/options'
import { moneyText } from '../lib/format'
import { FileField, FileLink } from '../components/FileField'
import { Badge } from '../components/ui'

export const contractFields: FieldDef[] = [
  { key: 'contract_no', label: '合同编号', type: 'text', required: true, width: 150, placeholder: '如 HT-2026-001' },
  { key: 'name', label: '合同名称', type: 'text', width: 220, required: true },
  {
    key: 'supplier_id',
    label: '供应商',
    type: 'ref',
    ref: 'suppliers',
    nameKey: 'supplier_name',
    required: true,
    width: 180,
  },
  { key: 'amount', label: '合同金额(元)', type: 'money', required: true, align: 'right', width: 130 },
  { key: 'sign_date', label: '签订日期', type: 'date', width: 110 },
  { key: 'start_date', label: '履约开始', type: 'date', width: 110 },
  { key: 'end_date', label: '履约结束', type: 'date', width: 110 },
  {
    key: 'status',
    label: '合同状态',
    type: 'select',
    options: CONTRACT_STATUS,
    default: '履约中',
    badge: true,
    width: 90,
  },
  {
    key: 'pay_terms',
    label: '付款约定',
    type: 'textarea',
    span: 2,
    placeholder: '如：预付30% / 到货验收40% / 安装完成20% / 质保期满10%',
  },
  {
    key: 'file_path',
    label: '合同附件',
    type: 'text',
    span: 2,
    width: 210,
    exportValue: (row) => row.file_name ?? '',
    tableRender: (row) => <FileLink path={row.file_path} name={row.file_name} />,
    formRender: (form, setValue) => (
      <FileField
        path={form.file_path}
        fileName={form.file_name}
        folder="contracts"
        onChange={(n) => {
          setValue('file_path', n.file_path)
          setValue('file_name', n.file_name)
        }}
      />
    ),
  },
  { key: 'file_name', label: '附件名称', type: 'text', inForm: false, inTable: false },
  { key: 'remark', label: '备注', type: 'textarea', span: 2, inTable: false },
]

export default function Contracts() {
  const data = useData()
  const { canEdit } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()

  // 支持从采购订单 / 入库单点击合同编号或名称跳转过来，并自动筛选出那一条
  const noParam = params.get('no') ?? ''
  const initialFilters = useMemo(
    () => (noParam ? { contract_no: noParam } : undefined),
    [noParam]
  )

  return (
    <CrudPage
      title="合同管理"
      subtitle="采购合同台账，支持上传多份 PDF/Word/图片附件，向下联动付款阶段与发票"
      icon={FileText}
      table="contracts"
      module="contracts"
      fields={contractFields}
      searchKeys={['contract_no', 'name', 'supplier_name', 'pay_terms', 'remark']}
      searchPlaceholder="搜索合同编号 / 名称 / 供应商"
      initialFilters={initialFilters}
      filters={[
        { key: 'contract_no', label: '合同编号', type: 'combo', ref: 'contracts', sourceKey: 'contract_no' },
        { key: 'name', label: '合同名称', type: 'combo', ref: 'contracts', sourceKey: 'name' },
        { key: 'supplier_name', label: '供应商', type: 'combo', ref: 'suppliers', sourceKey: 'name' },
        { key: 'sign_date', label: '签订日期', type: 'dateRange' },
        { key: 'status', label: '合同状态', options: CONTRACT_STATUS },
      ]}
      exportName="合同台账"
      exportSheet="合同台账"
      newLabel="新建合同"
      onChanged={() => void data.refresh()}
      rowActions={(row) =>
        canEdit('payments') ? (
          <button
            title="查看付款进度"
            onClick={() => nav(`/payments?contract=${encodeURIComponent(String(row.contract_no))}`)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-600 transition hover:bg-brand-50"
          >
            <Wallet size={12} /> 付款
          </button>
        ) : null
      }
      summaryText={(rows) => (
        <span className="flex items-center gap-2">
          <Badge tone="brand">履约中 {rows.filter((r) => r.status === '履约中').length} 份</Badge>
          <span className="text-slate-400">
            合同总额 <b className="num text-slate-700">¥ {moneyText(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0))}</b>
          </span>
        </span>
      )}
    />
  )
}
