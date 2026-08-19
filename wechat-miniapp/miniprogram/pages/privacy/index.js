'use strict';
/* global Page, wx */

const api = require('../../services/api');
const { presentError } = require('../../services/presentation');

Page({
  data: { working: false },

  clearHistory() {
    if (this.data.working) return;
    wx.showModal({
      title: '清除任务记录',
      content: '清除后无法恢复；已绑定电脑不受影响。',
      confirmText: '清除记录',
      confirmColor: '#ef7181',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ working: true });
        try {
          const response = await api.clearTaskHistory();
          wx.showToast({ title: response.cleanupPending ? '记录已隐藏，正在清理' : '任务记录已清除', icon: 'none' });
        } catch (error) {
          wx.showToast({ title: presentError(error).message, icon: 'none' });
        } finally {
          this.setData({ working: false });
        }
      },
    });
  },

  deleteAccount() {
    if (this.data.working) return;
    wx.showModal({
      title: '删除 Token M 账户',
      content: '这会立即解绑所有电脑并删除账户数据。操作开始后无法恢复。',
      confirmText: '删除账户',
      confirmColor: '#ef7181',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ working: true });
        try {
          await api.deleteAccount();
          wx.showToast({ title: '账户删除已开始', icon: 'none' });
          setTimeout(() => wx.reLaunch({ url: '/pages/dashboard/index' }), 800);
        } catch (error) {
          wx.showToast({ title: presentError(error).message, icon: 'none' });
          this.setData({ working: false });
        }
      },
    });
  },
});
