'use strict';
/* global Page, wx */

const api = require('../../services/api');
const { normalizeTask, presentError } = require('../../services/presentation');

Page({
  data: {
    state: 'loading',
    items: [],
    nextCursor: null,
    loadingMore: false,
    paginationError: '',
    banner: '',
    error: null,
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 1 });
    this.loadFirst(this.data.state === 'ready');
  },

  onPullDownRefresh() {
    this.loadFirst(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() { this.loadMore(); },

  async loadFirst(keepExisting = false) {
    if (!keepExisting) this.setData({ state: 'loading', error: null });
    try {
      const result = await api.listTasks(null, 20);
      this.setData({
        state: 'ready',
        items: Array.isArray(result.items) ? result.items.map(normalizeTask) : [],
        nextCursor: result.nextCursor || null,
        paginationError: '',
        banner: '',
      });
    } catch (error) {
      const presented = presentError(error);
      if (keepExisting && this.data.items.length) this.setData({ banner: `更新失败：${presented.message}` });
      else this.setData({ state: 'error', error: presented });
    }
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) return;
    this.setData({ loadingMore: true, paginationError: '' });
    try {
      const result = await api.listTasks(this.data.nextCursor, 20);
      this.setData({
        items: this.data.items.concat((result.items || []).map(normalizeTask)),
        nextCursor: result.nextCursor || null,
        loadingMore: false,
      });
    } catch (error) {
      this.setData({ loadingMore: false, paginationError: presentError(error, '加载更多失败，请重试。').message });
    }
  },

  openTask(event) {
    wx.navigateTo({ url: `/pages/task-detail/index?taskId=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
});
