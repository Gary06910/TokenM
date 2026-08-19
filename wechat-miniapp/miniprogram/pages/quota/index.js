'use strict';
/* global Page, wx */

const api = require('../../services/api');
const { normalizeDashboard, presentError, quotaView } = require('../../services/presentation');

Page({
  data: {
    state: 'loading', quota: quotaView({ available: 0 }), grantIntent: null,
    grantPreparing: false, requesting: false, blocked: false, mainSwitchOff: false,
    message: '', messageTone: '', error: null,
  },

  onLoad() {
    this.loadPage();
    this.readSubscriptionSetting();
  },

  async loadPage() {
    this.setData({ state: 'loading', error: null });
    try {
      const result = await api.getDashboard();
      const dashboard = normalizeDashboard(result);
      this.setData({ state: 'ready', quota: dashboard.quota });
      await this.prepareGrant();
    } catch (error) {
      this.setData({ state: 'error', error: presentError(error) });
    }
  },

  async prepareGrant() {
    if (this.data.grantPreparing || this.data.blocked) return;
    this.setData({ grantPreparing: true, grantIntent: null });
    try {
      const result = await api.prepareSubscriptionGrant();
      if (!result.grantIntentId || !result.templateId) throw { code: 'configuration_required', retryable: false };
      this.setData({ grantIntent: { id: result.grantIntentId, templateId: result.templateId, expiresAt: result.expiresAt }, grantPreparing: false });
    } catch (error) {
      const shown = presentError(error, '暂时无法准备通知授权，请刷新页面。');
      this.setData({ grantPreparing: false, message: shown.message, messageTone: 'danger' });
    }
  },

  readSubscriptionSetting() {
    wx.getSetting({
      withSubscriptions: true,
      success: (result) => {
        const subscriptions = result.subscriptionsSetting;
        this.setData({ mainSwitchOff: Boolean(subscriptions && subscriptions.mainSwitch === false) });
      },
    });
  },

  requestGrant() {
    const intent = this.data.grantIntent;
    if (!intent || this.data.requesting || this.data.blocked) return;
    if (new Date(intent.expiresAt).getTime() <= Date.now()) {
      this.setData({ message: '授权准备已过期，正在刷新。', messageTone: 'warning', grantIntent: null });
      this.prepareGrant();
      return;
    }

    this.setData({ requesting: true, message: '', messageTone: '' });
    wx.requestSubscribeMessage({
      tmplIds: [intent.templateId],
      success: async (result) => {
        const outcome = result[intent.templateId];
        if (outcome === 'accept') {
          try {
            await api.recordSubscriptionOutcome(intent.id, 'accept');
            const available = this.data.quota.available + 1;
            this.setData({ quota: quotaView({ available }), requesting: false, grantIntent: null, message: '已补充 1 次通知', messageTone: 'success' });
            this.prepareGrant();
          } catch (_) {
            this.setData({ requesting: false, grantIntent: null, message: '微信授权已完成，但额度同步失败。请刷新页面；不要重复点击。', messageTone: 'danger', blocked: true });
          }
          return;
        }
        if (outcome === 'reject') {
          await this.recordNonAccept(intent.id, 'reject', '你没有同意本次通知，不会增加额度。', 'warning', false);
          return;
        }
        if (outcome === 'ban') {
          await this.recordNonAccept(intent.id, 'ban', '当前小程序暂时无法申请订阅消息', 'danger', true);
          return;
        }
        await this.recordNonAccept(intent.id, 'filter', '通知模板配置有误', 'danger', true);
      },
      fail: (error) => this.handlePlatformFailure(error),
    });
  },

  async recordNonAccept(intentId, outcome, message, tone, blocked) {
    try { await api.recordSubscriptionOutcome(intentId, outcome); } catch (_) {}
    this.setData({ requesting: false, grantIntent: null, message, messageTone: tone, blocked });
    if (!blocked) this.prepareGrant();
  },

  handlePlatformFailure(error) {
    const errCode = Number(error && error.errCode);
    if (errCode === 20004) {
      this.setData({ requesting: false, grantIntent: null, mainSwitchOff: true, message: '微信的订阅消息总开关已关闭', messageTone: 'warning' });
      return;
    }
    if (errCode === 20005) {
      this.setData({ requesting: false, grantIntent: null, blocked: true, message: '当前小程序暂时无法申请订阅消息', messageTone: 'danger' });
      return;
    }
    if ([20001, 20002, 20003].includes(errCode) || /template/i.test(String(error && error.errMsg))) {
      this.setData({ requesting: false, grantIntent: null, blocked: true, message: '通知模板配置有误', messageTone: 'danger' });
      return;
    }
    this.setData({ requesting: false, message: '未完成授权，请检查网络后重试', messageTone: 'warning' });
  },

  openSettings() {
    wx.openSetting({ success: () => { this.readSubscriptionSetting(); if (!this.data.blocked) this.prepareGrant(); } });
  },
});
