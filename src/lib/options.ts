export const SUPPLIER_COOPERATION = ['已合作', '未合作', '储备入库']

export const SUPPLIER_MAIN_TYPES = [
  '管材管件',
  '水泥建材',
  '砂石料',
  '水表计量',
  '阀门设备',
  '混凝土',
  '路面材料',
  '辅助材料',
  '综合供应',
]

export const SUPPLIER_RATINGS = ['A 级', 'B 级', 'C 级', '未评级']

export const ORDER_STATUS = ['待审核', '已下单', '部分到货', '已完成', '已取消']
export const IN_STATUS = ['待验收', '已入库', '部分入库']
export const OUT_STATUS = ['待复核', '已出库']
export const WAREHOUSES = ['项目部主仓', '施工现场临时仓', '村内中转仓']

export const CONTRACT_STATUS = ['待签订', '履约中', '已完成', '已终止']
export const INVOICE_TYPES = ['增值税专用发票', '增值税普通发票', '电子发票']
export const INVOICE_STATUS = ['已开票', '已认证', '已入账', '已冲红']
export const PAY_STATUS = ['未付款', '部分付款', '已付款', '已逾期']
export const PAY_METHODS = ['银行转账', '承兑汇票', '现金', '供应链金融']
export const PAY_STAGES = ['预付款', '到货款', '安装款', '验收款', '质保金']

export const TEAM_STATUS = ['未开工', '施工中', '已完工', '暂停']
export const STAGE_STATUS = ['未开始', '进行中', '已完成']
export const STAGE_PRESETS = ['主管道敷设', '村内管网敷设', '接户安装', '水表安装', '试压冲洗', '路面恢复']

export const DEFECT_TYPES = ['损耗', '不合格']
export const DEFECT_SOURCES = ['入库验收', '现场施工', '仓储盘点', '运输环节']
export const DEFECT_DISPOSALS = ['退货', '换货', '报废', '让步接收', '补货']
export const DEFECT_STATUS = ['待处理', '处理中', '已闭环']

/* ------------------------ 非工程采购（日常费用） ------------------------ */

/** 非工程项目类的费用/采购类别：房租、办公用品、加油票等 */
export const MISC_CATEGORIES = [
  '房租费',
  '办公用品',
  '加油费',
  '差旅费',
  '水电费',
  '通讯费',
  '招待费',
  '物业费',
  '车辆维修',
  '其他',
]

export const MISC_PAY_METHODS = ['微信支付', '支付宝', '银行转账', '对公转账', '现金', '加油卡', '其他']

export const MISC_STATUS = ['待报销', '已报销', '已付款']

export interface RoleDef {
  value: string
  label: string
  desc: string
}

/** 内置角色：首次运行时写入数据库，之后一切以数据库中的角色与权限为准 */
export const ROLES: RoleDef[] = [
  { value: 'admin', label: '系统管理员', desc: '全部模块可读写，含用户与角色管理' },
  { value: 'procurement', label: '采购员', desc: '供应商、物资、采购订单、合同发票与付款' },
  { value: 'warehouse', label: '仓管员', desc: '入库、出库、库存、损耗与不合格品' },
  { value: 'team', label: '施工队', desc: '查看全局，提交领用出库与现场损耗' },
  { value: 'viewer', label: '只读查看', desc: '仅可浏览与导出，不可修改任何数据' },
]

export const roleLabel = (v?: string | null): string =>
  ROLES.find((r) => r.value === v)?.label ?? v ?? '只读查看'

/* ------------------------------ 功能模块清单 ------------------------------ */

export interface ModuleDef {
  key: string
  label: string
  group: string
}

/** 可以被授权的功能模块（与数据库 role_permissions.module 一一对应） */
export const MODULES: ModuleDef[] = [
  { key: 'dashboard', label: '工作台', group: '总览' },
  { key: 'material_categories', label: '物资分类', group: '物资管理' },
  { key: 'materials', label: '物资台账', group: '物资管理' },
  { key: 'inventory', label: '库存总览', group: '物资管理' },
  { key: 'purchase_orders', label: '采购订单', group: '采购与仓储' },
  { key: 'inbound', label: '物资入库', group: '采购与仓储' },
  { key: 'outbound', label: '物资出库', group: '采购与仓储' },
  { key: 'defects', label: '损耗与不合格', group: '采购与仓储' },
  { key: 'suppliers', label: '供应商档案', group: '供应商' },
  { key: 'contracts', label: '合同管理', group: '合同与财务' },
  { key: 'invoices', label: '发票管理', group: '合同与财务' },
  { key: 'payments', label: '付款进度', group: '合同与财务' },
  { key: 'teams', label: '团队分组', group: '团队与进度' },
  { key: 'team_stages', label: '进度节点', group: '团队与进度' },
  { key: 'misc_purchases', label: '非工程采购', group: '日常费用' },
  { key: 'users', label: '用户与角色', group: '系统' },
  { key: 'backup', label: '数据备份', group: '系统' },
]

export const MODULE_KEYS = MODULES.map((m) => m.key)

export const moduleLabel = (key: string): string => MODULES.find((m) => m.key === key)?.label ?? key

/** 模块 → 允许写入的角色（仅在权限表尚未加载时作为兜底） */
export const MODULE_ROLES: Record<string, string[]> = {
  suppliers: ['admin', 'procurement'],
  material_categories: ['admin', 'procurement', 'warehouse'],
  materials: ['admin', 'procurement', 'warehouse'],
  inventory: ['admin', 'procurement', 'warehouse'],
  purchase_orders: ['admin', 'procurement'],
  inbound: ['admin', 'procurement', 'warehouse'],
  outbound: ['admin', 'warehouse', 'team'],
  defects: ['admin', 'procurement', 'warehouse', 'team'],
  contracts: ['admin', 'procurement'],
  invoices: ['admin', 'procurement'],
  payments: ['admin', 'procurement'],
  teams: ['admin', 'procurement', 'warehouse'],
  team_stages: ['admin', 'procurement', 'warehouse'],
  misc_purchases: ['admin', 'procurement'],
  dashboard: ['admin', 'procurement', 'warehouse', 'team'],
  users: ['admin'],
  backup: ['admin'],
}

/** 状态 → 徽标色 */
export const STATUS_TONE: Record<string, string> = {
  已合作: 'emerald',
  未合作: 'slate',
  储备入库: 'amber',
  待审核: 'amber',
  已下单: 'brand',
  部分到货: 'sky',
  已完成: 'emerald',
  已取消: 'slate',
  待验收: 'amber',
  已入库: 'emerald',
  部分入库: 'sky',
  待复核: 'amber',
  已出库: 'emerald',
  待签订: 'slate',
  履约中: 'brand',
  已终止: 'rose',
  已开票: 'brand',
  已认证: 'sky',
  已入账: 'emerald',
  已冲红: 'rose',
  未付款: 'slate',
  部分付款: 'amber',
  已付款: 'emerald',
  已逾期: 'rose',
  未开工: 'slate',
  施工中: 'brand',
  已完工: 'emerald',
  暂停: 'amber',
  未开始: 'slate',
  进行中: 'brand',
  待处理: 'amber',
  处理中: 'sky',
  已闭环: 'emerald',
  损耗: 'amber',
  不合格: 'rose',
  待报销: 'amber',
  已报销: 'emerald',
}
