'use strict';
/* global Page, wx */

const api = require('../../services/api');
const { normalizeDashboard, presentError } = require('../../services/presentation');

Page({
  data: { state: 'loading', notificationsEnabled: true, updating: false, banner: '', error: null },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 2 });
    if (this.loadedAt && Date.now() - this.loadedAt < 5000) return;
    this.loadSettings(this.data.state === 'ready');
  },

  async loadSettings(keepExisting = false) {
    if (!keepExisting) this.setData({ state: 'loading', error: null });
    try {
      const result = normalizeDashboard(await api.getDashboard());
      this.setData({ state: 'ready', notificationsEnabled: result.settings.notificationsEnabled, banner: '' });
      this.loadedAt = Date.now();
    } catch (error) {
      const shown = presentError(error);
      if (keepExisting) this.setData({ banner: `更新失败：${shown.message}` });
      else this.setData({ state: 'error', error: shown });
    }
  },

  async toggleNotifications(event) {
    if (this.data.updating) return;
    const next = Boolean(event.detail.value);
    const previous = this.data.notificationsEnabled;
    this.setData({ notificationsEnabled: next, updating: true });
    try {
      await api.updateSettings(next);
      this.setData({ updating: false });
      wx.showToast({ title: next ? '任务通知已开启' : '任务通知已关闭', icon: 'none' });
    } catch (error) {
      this.setData({ notificationsEnabled: previous, updating: false });
      wx.showToast({ title: presentError(error).message, icon: 'none' });
    }
  },

  goDesktops() { wx.navigateTo({ url: '/pages/desktops/index' }); },
  goQuota() { wx.navigateTo({ url: '/pages/quota/index' }); },
  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/index' }); },
  goAbout() { wx.navigateTo({ url: '/pages/about/index' }); },
});
