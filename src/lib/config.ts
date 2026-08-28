import type { FilterDef, FilterSettings, Settings } from './types';

/** Detail-page fields surfaced on each result card, in display order. */
export const DISPLAY_FIELDS = [
  '都市計画',
  '地目',
  '接道状況',
  '用途地域',
  '建ぺい率',
  '容積率',
  '現況',
  'セットバック',
  '上水道',
  '下水道',
  '都市ガス',
  '電気',
  '地勢',
  '土地権利'
] as const;

/** Defaults mirror the prototype: 市街化調整区域 / 畑 / 接道3m以下 are excluded. */
export const FILTER_DEFS: FilterDef[] = [
  {
    id: 'toshikeikaku',
    label: '都市計画',
    detailKey: '都市計画',
    type: 'exclude_text',
    defaultEnabled: true,
    defaultValues: ['市街化調整区域'],
    hints: ['市街化調整区域', '市街化区域', '非線引区域', '準都市計画区域']
  },
  {
    id: 'chimoku',
    label: '地目',
    detailKey: '地目',
    type: 'exclude_text',
    defaultEnabled: true,
    defaultValues: ['畑'],
    hints: ['畑', '田', '山林', '雑種地', '宅地', '原野', '牧場']
  },
  {
    id: 'setsudo',
    label: '接道幅（最小）',
    detailKey: '接道状況',
    type: 'min_road_width',
    defaultEnabled: true,
    defaultMinWidth: 3.0,
    unit: 'm',
    help: '接道の幅員がこの値以下の物件を除外します'
  },
  {
    id: 'yotochiiki',
    label: '用途地域',
    detailKey: '用途地域',
    type: 'exclude_text',
    defaultEnabled: false,
    defaultValues: [],
    hints: [
      '無指定',
      '１種低専',
      '２種低専',
      '１種中高',
      '２種中高',
      '１種住居',
      '２種住居',
      '準住居',
      '近商',
      '商業',
      '準工業',
      '工業',
      '工業専用'
    ]
  },
  {
    id: 'genkyou',
    label: '現況',
    detailKey: '現況',
    type: 'exclude_text',
    defaultEnabled: false,
    defaultValues: [],
    hints: ['更地', '建物あり', '古家あり']
  },
  {
    id: 'setback',
    label: 'セットバック',
    detailKey: 'セットバック',
    type: 'exclude_text',
    defaultEnabled: false,
    defaultValues: ['あり'],
    hints: ['あり', 'なし']
  },
  {
    id: 'chisei',
    label: '地勢',
    detailKey: '地勢',
    type: 'exclude_text',
    defaultEnabled: false,
    defaultValues: [],
    hints: ['平坦', '高台', '傾斜地', '低地']
  },
  {
    id: 'tochiken',
    label: '土地権利',
    detailKey: '土地権利',
    type: 'exclude_text',
    defaultEnabled: false,
    defaultValues: [],
    hints: ['所有権', '借地権', '地上権']
  },
  {
    id: 'torihiki',
    label: '取引態様',
    detailKey: '取引態様',
    type: 'exclude_text',
    defaultEnabled: false,
    defaultValues: [],
    hints: ['売主', '代理', '一般媒介', '専任媒介', '専属専任']
  },
  {
    id: 'suido',
    label: '上水道',
    detailKey: '上水道',
    type: 'require_contains',
    defaultEnabled: false,
    defaultRequired: 'あり'
  },
  {
    id: 'gesui',
    label: '下水道',
    detailKey: '下水道',
    type: 'require_contains',
    defaultEnabled: false,
    defaultRequired: 'あり'
  },
  {
    id: 'gas',
    label: '都市ガス',
    detailKey: '都市ガス',
    type: 'require_contains',
    defaultEnabled: false,
    defaultRequired: 'あり'
  },
  {
    id: 'denki',
    label: '電気',
    detailKey: '電気',
    type: 'require_contains',
    defaultEnabled: false,
    defaultRequired: 'あり'
  },
  {
    id: 'kenpeito',
    label: '建ぺい率',
    detailKey: '建ぺい率',
    type: 'numeric_range',
    unit: '%',
    defaultEnabled: false,
    defaultMin: null,
    defaultMax: null
  },
  {
    id: 'yosekiritsu',
    label: '容積率',
    detailKey: '容積率',
    type: 'numeric_range',
    unit: '%',
    defaultEnabled: false,
    defaultMin: null,
    defaultMax: null
  },
  {
    id: 'menseki',
    label: '土地面積',
    detailKey: '土地面積',
    type: 'numeric_range',
    unit: 'm²',
    defaultEnabled: false,
    defaultMin: null,
    defaultMax: null
  },
  {
    id: 'kakaku',
    label: '価格',
    detailKey: '価格',
    type: 'numeric_range',
    unit: '万円',
    defaultEnabled: false,
    defaultMin: null,
    defaultMax: null
  }
];

/** Section grouping for the settings UI. */
export const SECTIONS: { title: string; ids: string[] }[] = [
  {
    title: '用途・規制',
    ids: ['toshikeikaku', 'chimoku', 'yotochiiki', 'genkyou', 'setback', 'chisei']
  },
  { title: '接道', ids: ['setsudo'] },
  { title: '権利・取引', ids: ['tochiken', 'torihiki'] },
  { title: 'インフラ', ids: ['suido', 'gesui', 'gas', 'denki'] },
  { title: '数値範囲', ids: ['kenpeito', 'yosekiritsu', 'menseki', 'kakaku'] }
];

export const COUNT_PRESETS = [30, 50, 100, 200] as const;

export const DEFAULT_TARGET_COUNT = 30;
export const DEFAULT_REQUEST_DELAY_MS = 400;
export const MAX_TARGET_COUNT = 500;

export function getFilterDef(id: string): FilterDef | undefined {
  return FILTER_DEFS.find(d => d.id === id);
}

export function getDefaultFilters(): FilterSettings {
  const filters: FilterSettings = {};
  for (const def of FILTER_DEFS) {
    switch (def.type) {
      case 'exclude_text':
        filters[def.id] = { enabled: def.defaultEnabled, values: [...def.defaultValues] };
        break;
      case 'min_road_width':
        filters[def.id] = { enabled: def.defaultEnabled, minWidth: def.defaultMinWidth };
        break;
      case 'require_contains':
        filters[def.id] = { enabled: def.defaultEnabled, required: def.defaultRequired };
        break;
      case 'numeric_range':
        filters[def.id] = { enabled: def.defaultEnabled, min: def.defaultMin, max: def.defaultMax };
        break;
    }
  }
  return filters;
}

export function getDefaultSettings(): Settings {
  return {
    targetCount: DEFAULT_TARGET_COUNT,
    requestDelayMs: DEFAULT_REQUEST_DELAY_MS,
    keepExcluded: true,
    filters: getDefaultFilters()
  };
}
