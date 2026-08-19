'use strict';
/* global Page, wx */

const api = require('../../services/api');
const { normalizeDesktop, presentError } = require('../../services/presentation');

Page({
  data: { state: 'loading', active: [], revoked: [], showRevoked: false, error: null, banner: '' },

  onShow() { this.loadDesktops(this.data.active.length > 0); },

  async loadDesktops(keepExisting = false) {
    if (!keepExisting) this.setData({ state: 'loading', error: null });
    try {
      const result = await api.listDesktops();
      const desktops = (result.items || []).map(normalizeDesktop);
      this.setData({
        state: 'ready',
        active: desktops.filter((item) => item.status === 'active'),
        revoked: desktops.filter((item) => item.status === 'revoked'),
        banner: '',
      });
    } catch (error) {
      const presented = presentError(error);
      if (keepExisting && this.data.active.length) this.setData({ banner: `更新失败：${presented.message}` });
      else this.setData({ state: 'error', error: presented });
    }
  },

  goPairing() { wx.navigateTo({ url: '/pages/pairing/index' }); },
  toggleRevoked() { this.setData({ showRevoked: !this.data.showRevoked }); },

  rename(event) {
    const desktopId = event.currentTarget.dataset.id;
    const current = this.data.active.find((item) => item.desktopId === desktopId);
    if (!current) return;
    wx.showModal({
      title: '重命名电脑',
      content: current.name,
      editable: true,
      placeholderText: '输入电脑名称',
      confirmText: '保存',
      success: async (result) => {
        if (!result.confirm) return;
        const name = String(result.content || '').trim();
        if (!name || name.length > 80) {
          wx.showToast({ title: '请输入 1–80 个字符', icon: 'none' });
          return;
        }
        try {
          await api.renameDesktop(desktopId, name);
          await this.loadDesktops(true);
          wx.showToast({ title: '名称已更新', icon: 'success' });
        } catch (error) {
          wx.showToast({ title: presentError(error).message, icon: 'none' });
        }
      },
    });
  },

  unbind(event) {
    const desktopId = event.currentTarget.dataset.id;
    const current = this.data.active.find((item) => item.desktopId === desktopId);
    if (!current) return;
    wx.showModal({
      title: '解绑这台电脑',
      content: `解绑“${current.name}”后，它将立即无法上报新任务；已有任务记录会保留。`,
      confirmText: '解绑电脑',
      confirmColor: '#ef7181',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          await api.unbindDesktop(desktopId);
          await this.loadDesktops(true);
          wx.showToast({ title: '电脑已解绑', icon: 'success' });
        } catch (error) {
          wx.showToast({ title: presentError(error).message, icon: 'none' });
        }
      },
    });
  },
});
