'use strict';
/* global Component, wx */

Component({
  data: {
    selected: 0,
    items: [
      { page: '/pages/dashboard/index', text: '首页', icon: '/assets/home.svg' },
      { page: '/pages/tasks/index', text: '任务', icon: '/assets/tasks.svg' },
      { page: '/pages/settings/index', text: '设置', icon: '/assets/settings.svg' },
    ],
  },
  methods: {
    switchTab(event) {
      const { index, page } = event.currentTarget.dataset;
      if (index === this.data.selected) return;
      wx.switchTab({ url: page });
    },
  },
});
