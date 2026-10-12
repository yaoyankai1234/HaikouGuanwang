import { Milestone } from 'lucide-react'
import { CrudPage, type FieldDef } from '../components/CrudPage'
import { useData } from '../store/data'
import { STAGE_STATUS } from '../lib/options'
import { numText } from '../lib/format'

export const stageFields: FieldDef[] = [
  {
    key: 'team_id',
    label: '所属团队分组',
    type: 'ref',
    ref: 'teams',
    nameKey: 'team_name',
    required: true,
    width: 160,
  },
  {
    key: 'name',
    label: '进度节点名称',
    type: 'text',
    required: true,
    width: 170,
    placeholder: '如 主管道敷设',
    hint: '例：主管道敷设 / 村内管网敷设 / 接户安装 / 水表安装 / 试压冲洗',
  },
  { key: 'seq', label: '节点序号', type: 'number', default: 1, align: 'right', width: 90 },
  {
    key: 'progress',
    label: '节点进度(%)',
    type: 'number',
    default: 0,
    align: 'right',
    width: 120,
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
  {
    key: 'status',
    label: '节点状态',
    type: 'select',
    options: STAGE_STATUS,
    default: '未开始',
    badge: true,
    width: 90,
  },
  { key: 'start_date', label: '计划开始', type: 'date', width: 110 },
  { key: 'end_date', label: '计划完成', type: 'date', width: 110 },
  { key: 'remark', label: '备注', type: 'textarea', span: 2, inTable: false },
]

export default function TeamStages() {
  const data = useData()
  return (
    <CrudPage
      title="进度节点"
      subtitle="每个团队分组的施工阶段与完成度，出库单可按节点对应领用物资"
      icon={Milestone}
      table="team_stages"
      module="team_stages"
      fields={stageFields}
      orderBy="team_id"
      orderAsc
      searchKeys={['name', 'team_name', 'remark']}
      searchPlaceholder="搜索节点 / 团队"
      filters={[
        { key: 'team_name', label: '团队分组', type: 'combo', ref: 'teams', sourceKey: 'name' },
        {
          key: 'name',
          label: '进度节点',
          type: 'combo',
          options: data.stages.map((r) => String(r.name ?? '')).filter(Boolean),
        },
        { key: 'status', label: '节点状态', options: STAGE_STATUS },
        { key: 'start_date', label: '计划开始', type: 'dateRange' },
      ]}
      exportName="进度节点"
      exportSheet="进度节点"
      newLabel="新建进度节点"
      onChanged={() => void data.refresh()}
    />
  )
}
