/**
 * 应用元信息。
 *
 * 注意：本系统已改为**自建后端**（见 src/lib/api.ts + server/），
 * 登录、数据与附件均不再依赖任何第三方云服务 SDK。
 * 账号由管理员在「用户管理」里以「手机号 + 密码」创建，用户可自助改密。
 */

export const APP_NAME = '海南省美兰区演丰镇沿海村落供水管网延伸工程管理系统'
export const APP_SHORT = '沿海村落供水管网延伸工程管理系统'
export const APP_REGION = '海南省美兰区演丰镇'
export const APP_SUBTITLE = '工程管理系统'

/** 后端接口根地址：留空表示同源（生产由后端一并托管前端；开发走 vite 代理） */
export const API_BASE: string = (import.meta as any).env?.VITE_API_BASE || ''
