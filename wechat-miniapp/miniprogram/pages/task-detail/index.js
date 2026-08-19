'use strict';
/* global Page */

const api = require('../../services/api');
const { normalizeTask, presentError } = require('../../services/presentation');

Page({
  data: { state: 'loading', taskId: '', task: null, error: null },

  onLoad(options) {
    const taskId = typeof options.taskId === 'string' ? options.taskId : '';
    this.setData({ taskId });
    this.loadTask();
  },

  async loadTask() {
    if (!this.data.taskId) {
      this.setData({ state: 'error', error: { message: '任务链接无效。' } });
      return;
    }
    this.setData({ state: 'loading', error: null });
    try {
      const result = await api.getTask(this.data.taskId);
      this.setData({ state: 'ready', task: normalizeTask(result.task || result) });
    } catch (error) {
      this.setData({ state: 'error', error: presentError(error) });
    }
  },
});
