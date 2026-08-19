'use strict';

const NOW = '2026-08-18T08:00:00.000Z';

const desktop = Object.freeze({
  desktopId: 'dev_mockdesktop0000000001',
  name: '工作台式机',
  status: 'active',
  createdAt: '2026-08-12T08:00:00.000Z',
  lastSeenAt: NOW,
  lastEventAt: NOW,
});

const privacyTask = Object.freeze({
  taskId: 'tsk_mockprivacy00000000001',
  desktop: { desktopId: desktop.desktopId, name: desktop.name },
  occurredAt: NOW,
  privacyMode: true,
  project: 'SHOULD_NOT_RENDER',
  model: 'SHOULD_NOT_RENDER',
  summary: 'SHOULD_NOT_RENDER',
  durationMs: 9000,
  notificationStatus: 'sent',
});

const fullTask = Object.freeze({
  taskId: 'tsk_mockfull000000000000001',
  desktop: { desktopId: desktop.desktopId, name: desktop.name },
  occurredAt: '2026-08-18T07:42:00.000Z',
  privacyMode: false,
  project: 'token-monitor',
  model: 'gpt-5.6-sol',
  summary: '完成了微信小程序界面，并通过了状态演示检查。',
  durationMs: 72000,
  notificationStatus: 'sent',
});

function dashboard(available, tasks = [privacyTask, fullTask]) {
  return {
    ok: true,
    settings: { notificationsEnabled: true },
    quota: { available, reserved: 0, status: available === 0 ? 'empty' : available <= 3 ? 'low' : 'normal' },
    desktopCount: 1,
    todayCompletedCount: tasks.length,
    recentTasks: tasks,
    requestId: 'req_mockfixture0001',
  };
}

module.exports = Object.freeze({
  firstRun: { bootstrap: { ...dashboard(8, []), desktopCount: 0, todayCompletedCount: 0 }, desktops: [], tasks: [] },
  boundNoTask: { bootstrap: dashboard(8, []), desktops: [desktop], tasks: [] },
  taskList: { bootstrap: dashboard(8), desktops: [desktop], tasks: [privacyTask, fullTask] },
  privacyTask: { bootstrap: dashboard(8, [privacyTask]), desktops: [desktop], tasks: [privacyTask] },
  fullTask: { bootstrap: dashboard(8, [fullTask]), desktops: [desktop], tasks: [fullTask] },
  quota0: { bootstrap: dashboard(0), desktops: [desktop], tasks: [privacyTask] },
  quota2: { bootstrap: dashboard(2), desktops: [desktop], tasks: [privacyTask] },
  quota8: { bootstrap: dashboard(8), desktops: [desktop], tasks: [privacyTask] },
  pairActive: { bootstrap: dashboard(8, []), desktops: [], tasks: [], pairing: { code: '824193', expiresAt: '2099-08-18T08:10:00.000Z', ttlSeconds: 600 } },
  pairExpired: { bootstrap: dashboard(8, []), desktops: [], tasks: [], pairing: { code: '824193', expiresAt: '2020-08-18T08:10:00.000Z', ttlSeconds: 0 } },
  subscriptionRejected: { bootstrap: dashboard(2), desktops: [desktop], tasks: [], subscriptionResult: 'reject' },
  mainSwitchOff: { bootstrap: dashboard(2), desktops: [desktop], tasks: [], subscriptionError: 20004 },
  backendError: { error: { code: 'internal_error', message: 'synthetic fixture', retryable: true } },
  paginationError: { bootstrap: dashboard(8), desktops: [desktop], tasks: [privacyTask, fullTask], paginationError: true },
});
