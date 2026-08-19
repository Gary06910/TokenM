'use strict';

const base = Object.freeze({
  settings: { notificationsEnabled: true },
  desktopCount: 1,
  todayCompletedCount: 0,
  recentTasks: [],
});

const privacyTask = Object.freeze({
  taskId: 'tsk_syntheticPrivacy001',
  desktop: { desktopId: 'dev_syntheticDesktop001', name: '工作台式机' },
  occurredAt: '2026-08-18T08:00:00.000Z',
  privacyMode: true,
  project: null,
  model: null,
  summary: null,
  durationMs: null,
  notificationStatus: 'sent',
});

const fullTask = Object.freeze({
  taskId: 'tsk_syntheticFullTask01',
  desktop: { desktopId: 'dev_syntheticDesktop001', name: '工作台式机' },
  occurredAt: '2026-08-18T08:01:00.000Z',
  privacyMode: false,
  project: 'token-monitor',
  model: 'gpt-5.6',
  summary: 'Synthetic completion summary for UI verification.',
  durationMs: 1234,
  notificationStatus: 'sent',
});

const uiStates = Object.freeze({
  firstRun: { screen: 'onboarding', dashboard: { ...base, desktopCount: 0, quota: { available: 0, reserved: 0, status: 'empty' } } },
  boundNoTask: { screen: 'dashboard', dashboard: { ...base, quota: { available: 8, reserved: 0, status: 'normal' } } },
  taskList: { screen: 'tasks', items: [privacyTask, fullTask], nextCursor: null },
  privacyDetail: { screen: 'task-detail', task: privacyTask, privacyNotice: '该任务使用隐私模式，未上传任务内容。' },
  fullDetail: { screen: 'task-detail', task: fullTask },
  quotaEmpty: { screen: 'quota', quota: { available: 0, reserved: 0, status: 'empty' } },
  quotaLow: { screen: 'quota', quota: { available: 2, reserved: 0, status: 'low' } },
  quotaNormal: { screen: 'quota', quota: { available: 8, reserved: 0, status: 'normal' } },
  backendError: { screen: 'dashboard', cached: { ...base, quota: { available: 2, reserved: 0, status: 'low' } }, error: { code: 'internal_error', retryable: true } },
  pairingActive: { screen: 'pairing', code: '824193', expiresAt: '2026-08-18T08:10:00.000Z', expired: false },
  pairingExpired: { screen: 'pairing', code: '824193', expiresAt: '2026-08-18T08:10:00.000Z', expired: true },
  subscriptionRejected: { screen: 'quota', subscriptionOutcome: 'reject', message: '你没有同意本次通知，不会增加额度。' },
  subscriptionMainSwitchOff: { screen: 'quota', subscriptionOutcome: 'main_switch_off', errorCode: 20004 },
  paginationError: { screen: 'tasks', items: [privacyTask], nextCursor: 'synthetic_cursor', loadMoreError: { code: 'internal_error', retryable: true } },
});

module.exports = { uiStates };
