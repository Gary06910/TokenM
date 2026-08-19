'use strict';
/* global Component, wx */

Component({
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: false },
    actionText: { type: String, value: '' },
  },
  methods: {
    goBack() {
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/dashboard/index' }) });
    },
    onAction() {
      this.triggerEvent('action');
    },
  },
});
