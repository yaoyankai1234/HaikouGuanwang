import { Receipt } from 'lucide-react'
import { CrudPage, type FieldDef } from '../components/CrudPage'
import { useData } from '../store/data'
import { INVOICE_STATUS, INVOICE_TYPES } from '../lib/options'
import { moneyText } from '../lib/format'
import { FileField, FileLink } from '../components/FileField'
import { Badge } from '../components/ui'

export const invoiceFields: FieldDef[] = [
  { key: 'invoice_no', label: '发票号码', type: 'text', required: true, width: 160 },
  {
    key: 'invoice_type',
    label: '发票类型',
    type: 'select',
    options: INVOICE_TYPES,
    default: '增值税专用发票',
    width: 130,
  },
  {
    key: 'supplier_id',
    label: '供应商',
    type: 'ref',
    ref: 'suppliers',
    nameKey: 'supplier_name',
    required: true,
    width: 180,
  },
  {
    key: 'contract_id',
    label: '关联合同',
    type: 'ref',
    ref: 'contracts',
    nameKey: 'contract_no',
    width: 150,
    onRefPick: (c) => ({
      supplier_id: c.supplier_id ?? null,
      supplier_name: c.supplier_name ?? null,
    }),
  },
  { key: 'amount', label: '价税合计(元)', type: 'money', required: true, align: 'right', width: 125 },
  { key: 'tax_rate', label: '税率(%)', type: 'number', default: 13, align: 'right', width: 90 },
  { key: 'invoice_date', label: '开票日期', type: 'date', width: 110 },
  {
    key: 'status',
    label: '发票状态',
    type: 'select',
    options: INVOICE_STATUS,
    default: '已开票',
    badge: true,
    width: 90,
  },
  {
    key: 'file_path',
    label: '发票附件',
    type: 'text',
    span: 2,
    width: 210,
    exportValue: (row) => row.file_name ?? '',
    tableRender: (row) => <FileLink path={row.file_path} name={row.file_name} />,
    formRender: (form, setValue) => (
      <FileField
        path={form.file_path}
        fileName={form.file_name}
        folder="invoices"
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

export default function Invoices() {
  const data = useData()
  return (
    <CrudPage
      title="发票管理"
      subtitle="进项发票台账，按供应商与合同归集，支持多张发票影像附件留存"
      icon={Receipt}
      table="invoices"
      module="invoices"
      fields={invoiceFields}
      searchKeys={['invoice_no', 'supplier_name', 'contract_no', 'invoice_type', 'remark']}
      searchPlaceholder="搜索发票号 / 供应商 / 合同编号"
      filters={[
        { key: 'invoice_no', label: '发票号码', type: 'combo', options: [] },
        { key: 'supplier_name', label: '供应商', type: 'combo', ref: 'suppliers', sourceKey: 'name' },
        { key: 'contract_no', label: '关联合同', type: 'combo', ref: 'contracts', sourceKey: 'contract_no' },
        { key: 'invoice_date', label: '开票日期', type: 'dateRange' },
        { key: 'invoice_type', label: '发票类型', options: INVOICE_TYPES },
        { key: 'status', label: '状态', options: INVOICE_STATUS },
      ]}
      exportName="发票台账"
      exportSheet="发票台账"
      newLabel="登记发票"
      onChanged={() => void data.refresh()}
      summaryText={(rows) => (
        <span className="flex items-center gap-2">
          <Badge tone="emerald">已入账 {rows.filter((r) => r.status === '已入账').length} 张</Badge>
          <span className="text-slate-400">
            价税合计 <b className="num text-slate-700">¥ {moneyText(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0))}</b>
          </span>
        </span>
      )}
    />
  )
}
