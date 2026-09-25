/** 曲线域：曲线卡/字段组卡/曲线列表面板。 */
export default {
  card: {
    visibleTitle: '参与量程与保存状态',
    hideTitle: '临时隐藏曲线',
    restoreTitle: '恢复曲线绘制',
    removeTitle: '移除曲线',
    color: '色彩',
    scale: '倍率',
    offset: '基线',
    reset: '归零',
  },
  groupCard: {
    allVisibleTitle: '显示或隐藏整组曲线',
    collapse: '收起字段组',
    expand: '展开字段组',
    removeTitle: '移除整组',
    scale: '组倍率',
    offset: '组基线',
    reset: '归零',
  },
  list: {
    emptyHint: '从左侧字段面板添加曲线，图表会立即同步。',
  },
  store: {
    fieldNotInSchema: '字段不在 type-schema: {key}',
    bodyFetchFailed: '曲线 body 拉取失败: {type}',
  },
}
