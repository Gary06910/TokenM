'use strict';
/* global Page, getApp, wx */

const api = require('../../services/api');
const { normalizeDashboard, normalizeDesktop, presentError } = require('../../services/presentation');

Page({
  data: {
    state: 'loading',
    dashboard: null,
    desktops: [],
    banner: '',
    error: null,
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 0 });
    const fresh = this.dashboardLoadedAt && Date.now() - this.dashboardLoadedAt < 5000;
    if (!fresh) this.loadDashboard(this.data.dashboard !== null);
  },

  onPullDownRefresh() {
    this.loadDashboard(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadDashboard(keepExisting = false) {
    if (!keepExisting) this.setData({ state: 'loading', error: null });
    try {
      const [dashboardResult, desktopsResult] = await Promise.all([api.bootstrap(), api.listDesktops()]);
      const dashboard = normalizeDashboard(dashboardResult);
      const desktops = Array.isArray(desktopsResult.items)
        ? desktopsResult.items.filter((item) => item.status !== 'revoked').slice(0, 2).map(normalizeDesktop)
        : [];
      getApp().globalData.dashboard = dashboard;
      this.dashboardLoadedAt = Date.now();
      this.setData({ state: 'ready', dashboard, desktops, banner: '', error: null });
    } catch (error) {
      const presented = presentError(error);
      if (keepExisting && this.data.dashboard) {
        this.setData({ banner: `更新失败：${presented.message}` });
      } else {
        this.setData({ state: 'error', error: presented });
      }
    }
  },

  goPairing() { wx.navigateTo({ url: '/pages/pairing/index' }); },
  goDesktops() { wx.navigateTo({ url: '/pages/desktops/index' }); },
  goQuota() { wx.navigateTo({ url: '/pages/quota/index' }); },
  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/index' }); },
  goSettings() { wx.switchTab({ url: '/pages/settings/index' }); },
  goTasks() { wx.switchTab({ url: '/pages/tasks/index' }); },
  openTask(event) {
    wx.navigateTo({ url: `/pages/task-detail/index?taskId=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
});
