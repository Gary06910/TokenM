'use strict';
/* global Page, wx */

const api = require('../../services/api');
const { presentError } = require('../../services/presentation');

Page({
  data: {
    state: 'loading', code: '', displayCode: '', expiresAt: '', countdown: '10:00', expired: false,
    error: null, initialDesktopIds: null, paired: false,
  },

  async onLoad() {
    try {
      const desktopResult = await api.listDesktops();
      this.setData({ initialDesktopIds: (desktopResult.items || []).map((item) => item.desktopId) });
    } catch (_) {}
    await this.createCode();
  },

  onShow() { if (this.data.code && !this.data.expired) this.startTimers(); },
  onHide() { this.stopTimers(); },
  onUnload() { this.stopTimers(); },

  async createCode() {
    this.stopTimers();
    this.setData({ state: 'loading', error: null, paired: false });
    try {
      const result = await api.createPairingCode();
      const code = String(result.code || '');
      this.setData({ state: 'ready', code, displayCode: `${code.slice(0, 3)} ${code.slice(3)}`, expiresAt: result.expiresAt, expired: false });
      this.updateCountdown();
      this.startTimers();
    } catch (error) {
      this.setData({ state: 'error', error: presentError(error) });
    }
  },

  startTimers() {
    this.stopTimers();
    this.countdownTimer = setInterval(() => this.updateCountdown(), 1000);
    this.pollTimer = setInterval(() => this.pollPairing(), 5000);
  },

  stopTimers() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.countdownTimer = null;
    this.pollTimer = null;
  },

  updateCountdown() {
    const remaining = Math.max(0, new Date(this.data.expiresAt).getTime() - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    const minutesPart = String(Math.floor(seconds / 60)).padStart(2, '0');
    const secondsPart = String(seconds % 60).padStart(2, '0');
    const expired = remaining <= 0;
    this.setData({ countdown: `${minutesPart}:${secondsPart}`, expired });
    if (expired) this.stopTimers();
  },

  async pollPairing() {
    if (this.data.expired || this.data.paired) return;
    try {
      const result = await api.listDesktops();
      if (!Array.isArray(this.data.initialDesktopIds)) {
        this.setData({ initialDesktopIds: (result.items || []).map((item) => item.desktopId) });
        return;
      }
      const newDesktop = (result.items || []).find((item) => item.status === 'active' && !this.data.initialDesktopIds.includes(item.desktopId));
      if (!newDesktop) return;
      this.stopTimers();
      this.setData({ paired: true });
      wx.showToast({ title: '电脑绑定成功', icon: 'success' });
    } catch (_) {}
  },

  copyCode() {
    if (this.data.expired) return;
    wx.setClipboardData({ data: this.data.code });
  },

  refreshCode() {
    wx.showModal({
      title: '刷新配对码',
      content: '生成新配对码后，当前配对码会立即失效。',
      confirmText: '刷新',
      success: (result) => { if (result.confirm) this.createCode(); },
    });
  },

  goDesktops() { wx.redirectTo({ url: '/pages/desktops/index' }); },
});
