'use strict';
/* global App, wx */

const runtime = require('./config/runtime');

App({
  globalData: {
    runtime,
    dashboard: null,
  },

  onLaunch() {
    if (!wx.cloud || !runtime.cloudBaseEnvId) return;
    wx.cloud.init({
      env: runtime.cloudBaseEnvId || undefined,
      traceUser: true,
    });
  },
});
