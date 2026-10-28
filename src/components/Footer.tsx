import React from 'react'
import { cx } from './ui'

/**
 * 网站底部版权与备案信息。
 * 备案号链接跳转工信部 ICP 备案查询系统。
 */
export function Footer({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        'flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[11px] leading-relaxed text-slate-400',
        className
      )}
    >
      <span>© 2026 成都拓焱科技有限公司</span>
      <span className="text-slate-300">·</span>
      <a
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noreferrer noopener"
        className="transition-colors hover:text-slate-600"
      >
        蜀ICP备2026065903号
      </a>
    </div>
  )
}
