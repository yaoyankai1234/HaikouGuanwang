import { HardHat } from 'lucide-react'
import { CrudPage, type FieldDef } from '../components/CrudPage'
import { useData } from '../store/data'
import { TEAM_STATUS } from '../lib/options'
import { progressColor, numText } from '../lib/format'
import { Badge } from '../components/ui'

export const teamFields: FieldDef[] = [
  { key: 'name', label: '团队分组名称', type: 'text', required: true, width: 170, placeholder: '如 一标段施工一组' },
  { key: 'leader', label: '负责人', type: 'text', width: 90 },
  { key: 'phone', label: '联系电话', type: 'text', width: 125 },
  { key: 'section', label: '负责标段', type: 'text', width: 120, placeholder: '如 一标段' },
  { key: 'village', label: '施工村落', type: 'text', width: 120, placeholder: '如 东澳村' },
  {
    key: 'progress',
    label: '总体进度(%)',
    type: 'number',
    default: 0,
    align: 'right',
    width: 130,
    tableRender: (row) => {
      const p = Number(row.progress) || 0
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-cyan-500"
              style={{ width: `${Math.min(100, Math.max(0, p))}%` }}
            />
          </div>
          <span className="num text-xs text-slate-500">{numText(p)}%</span>
        </div>
      )
    },
  },
  { key: 'status', label: '状态', type: 'select', options: TEAM_STATUS, default: '施工中', badge: true, width: 90 },
  { key: 'plan_start', label: '计划开工', type: 'date', width: 110 },
  { key: 'plan_end', label: '计划完工', type: 'date', width: 110 },
  { key: 'remark', label: '备注', type: 'textarea', span: 2, inTable: false },
]

export default function Teams() {
  const data = useData()
  return (
    <CrudPage
      title="团队分组"
      subtitle="按标段 / 村落划分施工团队，出库时按团队与进度节点分配物资"
      icon={HardHat}
      table="teams"
      module="teams"
      fields={teamFields}
      searchKeys={['name', 'leader', 'section', 'village', 'phone']}
      searchPlaceholder="搜索团队 / 负责人 / 村落"
      filters={[
        {
          key: 'name',
          label: '团队分组',
          type: 'combo',
          options: data.teams.map((r) => String(r.name ?? '')).filter(Boolean),
        },
        { key: 'section', label: '负责标段', type: 'combo', options: data.teams.map((r) => String(r.section ?? '')).filter(Boolean) },
        { key: 'village', label: '施工村落', type: 'combo', options: data.teams.map((r) => String(r.village ?? '')).filter(Boolean) },
        { key: 'status', label: '状态', options: TEAM_STATUS },
      ]}
      exportName="团队分组"
      exportSheet="团队分组"
      newLabel="新建团队"
      onChanged={() => void data.refresh()}
      summaryText={(rows) => (
        <span className="flex items-center gap-2 text-xs text-slate-400">
          加权平均进度{' '}
          <Badge tone={progressColor(
            rows.length ? rows.reduce((a, r) => a + (Number(r.progress) || 0), 0) / rows.length : 0
          )}
          >
            {numText(rows.length ? rows.reduce((a, r) => a + (Number(r.progress) || 0), 0) / rows.length : 0)}%
          </Badge>
        </span>
      )}
    />
  )
}
