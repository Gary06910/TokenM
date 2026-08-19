'use strict';
/* global Page, wx */

const runtime = require('../../config/runtime');

Page({
  data: { version: runtime.appVersion, contactText: runtime.contactText },
  copyContact() {
    if (this.data.contactText) wx.setClipboardData({ data: this.data.contactText });
  },
});
