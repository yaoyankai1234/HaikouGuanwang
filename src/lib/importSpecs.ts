/**
 * 物资分类 / 物资台账 的批量导入规范。
 * 与页面解耦成纯模块，便于独立验证解析、查重与分类引用解析逻辑。
 */
import type { Row } from './db'
import type { ImportSpec } from './importRows'

/* ------------------------------- 物资分类 ------------------------------- */

/** 分类编码、分类名称均不可重复 */
export function categoryImportSpec(existing: Row[]): ImportSpec {
  return {
    title: '物资分类',
    table: 'material_categories',
    existing,
    columns: [
      {
        key: 'code',
        label: '分类编码',
        example: 'CL-14',
        hint: '建议填写，便于在采购、出入库中快速定位；不可与已有编码重复',
      },
      {
        key: 'name',
        label: '物资分类',
        required: true,
        maxLen: 60,
        example: '阀门井',
        hint: '分类名称，不可与已有分类重名',
      },
      {
        key: 'spec_range',
        label: '规格范围',
        maxLen: 60,
        example: 'DN150-DN400',
        hint: '该分类覆盖的规格区间',
      },
      { key: 'unit', label: '计量单位', maxLen: 20, example: 'm', hint: '统一计量单位，如 m / t / 只' },
      { key: 'remark', label: '备注说明', maxLen: 200, example: '球墨铸铁材质', hint: '选填' },
    ],
    unique: [
      { label: '分类编码', fields: ['code'] },
      { label: '物资分类名称', fields: ['name'] },
    ],
    toPayload: (r) => ({
      code: r.code || null,
      name: r.name,
      spec_range: r.spec_range || null,
      unit: r.unit || null,
      remark: r.remark || null,
    }),
    notes: [
      '第一行表头请勿修改或删除，数据从第二行开始逐行填写。',
      '分类编码、分类名称都不可与系统中已有数据重复，重复的行会被标记为「重复」列在预览里。',
      '同一个文件内出现相同编码或相同名称时，只保留靠前的一条，其余标记为「重复」。',
      '物资台账里的「物资分类」需要与这里填写的名称或编码保持一致。',
    ],
  }
}

/* ------------------------------- 物资台账 ------------------------------- */

/** 按分类名称或分类编码在现有分类中定位；两者都不命中时返回 undefined */
export function pickCategory(value: any, cats: Row[]): Row | undefined {
  const s = String(value ?? '').trim().toLowerCase()
  if (!s) return undefined
  return (
    cats.find((c) => String(c.name ?? '').trim().toLowerCase() === s) ??
    cats.find((c) => String(c.code ?? '').trim().toLowerCase() === s)
  )
}

/**
 * 物资台账导入：
 *  - 物资编码、以及「商品名称 + 规格型号」组合均不可重复
 *  - 「物资分类」列写分类名称或编码均可，导入时解析成系统里的分类 id 并落库
 */
export function materialImportSpec(existing: Row[], cats: Row[]): ImportSpec {
  const findCat = (v: any) => pickCategory(v, cats)
  return {
    title: '物资台账',
    table: 'materials',
    existing,
    columns: [
      { key: 'code', label: '物资编码', example: 'WZ-24', hint: '建议填写，不可与已有编码重复' },
      {
        key: 'name',
        label: '商品名称',
        required: true,
        maxLen: 120,
        example: 'DN300 球墨铸铁管(K9)',
        hint: '全库唯一，不可与已有物资重名；同名不同规格请把规格写进名称里',
      },
      {
        key: 'category_name',
        label: '物资分类',
        required: true,
        maxLen: 60,
        example: '主管道',
        hint: '填写「物资分类」中的分类名称或分类编码，必须已存在',
      },
      { key: 'spec', label: '规格型号', maxLen: 60, example: 'K9 DN300', hint: '同名物资用规格区分' },
      { key: 'unit', label: '单位', maxLen: 20, example: 'm' },
      { key: 'brand', label: '品牌/厂家', maxLen: 60, example: '新兴铸管' },
      {
        key: 'ref_price',
        label: '参考单价(元)',
        type: 'number',
        example: '286.5',
        hint: '不小于 0；留空按 0 处理',
      },
      { key: 'safety_stock', label: '安全库存', type: 'number', example: '80', hint: '不小于 0；留空按 0 处理' },
      { key: 'remark', label: '备注', maxLen: 200, example: '' },
    ],
    unique: [
      { label: '物资编码', fields: ['code'] },
      { label: '商品名称', fields: ['name'] },
    ],
    check: (r, errors) => {
      const raw = String(r.category_name ?? '').trim()
      if (!raw) return // 必填缺失已在上一步提示，避免重复报错
      if (!findCat(raw)) {
        errors.push(`物资分类「${raw}」在系统中不存在，请先在「物资分类」中创建或改为已有分类`)
      }
    },
    toPayload: (r) => {
      const cat = findCat(r.category_name)
      return {
        code: r.code || null,
        name: r.name,
        category_id: cat ? cat.id : null,
        category_name: cat ? cat.name : null,
        spec: r.spec || null,
        unit: r.unit || null,
        brand: r.brand || null,
        ref_price: Number(r.ref_price) || 0,
        safety_stock: Number(r.safety_stock) || 0,
        remark: r.remark || null,
      }
    },
    notes: [
      '第一行表头请勿修改或删除，数据从第二行开始逐行填写。',
      '建议先导入「物资分类」，再导入物资台账，否则分类找不到会被判为异常。',
      '「物资分类」列填分类名称或分类编码都可以，导入时会自动转换成系统里的分类并建立关联。',
      '物资编码不可重复；「商品名称」全库唯一，与已有物资重名的行会被单独筛出来。',
      '参考单价与安全库存必须是不小于 0 的数字，留空按 0 处理。',
    ],
  }
}
