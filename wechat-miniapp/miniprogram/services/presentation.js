'use strict';

const NOTIFICATION_LABELS = Object.freeze({
  sent: '微信提醒已发送',
  skipped_no_quota: '未发送 · 通知额度为 0',
  skipped_disabled: '未发送 · 任务通知已关闭',
  failed: '发送失败 · 未消耗额度',
  unknown: '发送结果待确认 · 额度暂时保留',
  pending: '正在处理',
});

const ERROR_LABELS = Object.freeze({
  configuration_required: '小程序尚未完成服务配置，请联系部署者。',
  unauthenticated: '登录状态已失效，请重新进入小程序。',
  rate_limited: '操作过于频繁，请稍后重试。',
  pairing_invalid: '配对码无效或已过期，请在小程序刷新后重试。',
  task_not_found: '任务不存在或已被清除。',
  grant_intent_expired: '本次授权准备已过期，请刷新后重试。',
  grant_intent_used: '本次授权结果已记录，请刷新额度。',
  cleanup_pending: '清理已开始，剩余数据将在后台继续删除。',
});

function safeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function dateValue(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDateTime(value) {
  const date = dateValue(value);
  if (!date) return '时间未知';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRelativeTime(value, now = Date.now()) {
  const date = dateValue(value);
  if (!date) return '时间未知';
  const delta = Math.max(0, now - date.getTime());
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return formatDateTime(value);
}

function quotaView(quota) {
  const available = Number.isSafeInteger(quota && quota.available) && quota.available >= 0 ? quota.available : 0;
  if (available === 0) {
    return { available, status: 'empty', label: '已耗尽', notice: '任务仍会保存，但不会发送微信提醒', tone: 'danger' };
  }
  if (available <= 3) {
    return { available, status: 'low', label: '即将用完', notice: '额度即将用完', tone: 'warning' };
  }
  return { available, status: 'normal', label: '正常', notice: '通知额度充足', tone: 'info' };
}

function normalizeDesktop(raw) {
  const desktop = raw && typeof raw === 'object' ? raw : {};
  return {
    desktopId: safeString(desktop.desktopId),
    name: safeString(desktop.name, '未命名电脑'),
    status: desktop.status === 'revoked' ? 'revoked' : 'active',
    statusLabel: desktop.status === 'revoked' ? '已解绑' : '已连接',
    createdAt: desktop.createdAt || null,
    lastSeenAt: desktop.lastSeenAt || null,
    lastEventAt: desktop.lastEventAt || null,
    lastSeenLabel: desktop.lastSeenAt ? `最后在线 ${formatRelativeTime(desktop.lastSeenAt)}` : '尚未在线',
    lastEventLabel: desktop.lastEventAt ? `最后上报 ${formatRelativeTime(desktop.lastEventAt)}` : '尚未上报任务',
  };
}

function normalizeTask(raw) {
  const task = raw && typeof raw === 'object' ? raw : {};
  const privacyMode = task.privacyMode !== false;
  const desktop = normalizeDesktop(task.desktop);
  return {
    taskId: safeString(task.taskId),
    desktop: { desktopId: desktop.desktopId, name: desktop.name },
    occurredAt: task.occurredAt || null,
    occurredAtLabel: formatDateTime(task.occurredAt),
    relativeTime: formatRelativeTime(task.occurredAt),
    privacyMode,
    title: privacyMode ? '隐私任务' : safeString(task.project, 'Codex 任务'),
    project: privacyMode ? null : safeString(task.project) || null,
    model: privacyMode ? null : safeString(task.model) || null,
    summary: privacyMode ? null : safeString(task.summary) || null,
    durationMs: privacyMode ? null : (Number.isSafeInteger(task.durationMs) && task.durationMs >= 0 ? task.durationMs : null),
    durationLabel: !privacyMode && Number.isSafeInteger(task.durationMs) && task.durationMs >= 0
      ? `${Math.max(1, Math.round(task.durationMs / 1000))} 秒`
      : null,
    notificationStatus: safeString(task.notificationStatus, 'pending'),
    notificationLabel: NOTIFICATION_LABELS[task.notificationStatus] || '通知状态未知',
  };
}

function normalizeDashboard(raw) {
  const dto = raw && typeof raw === 'object' ? raw : {};
  return {
    settings: { notificationsEnabled: dto.settings ? dto.settings.notificationsEnabled !== false : true },
    quota: quotaView(dto.quota),
    desktopCount: Number.isSafeInteger(dto.desktopCount) ? Math.max(0, dto.desktopCount) : 0,
    todayCompletedCount: Number.isSafeInteger(dto.todayCompletedCount) ? Math.max(0, dto.todayCompletedCount) : 0,
    recentTasks: Array.isArray(dto.recentTasks) ? dto.recentTasks.slice(0, 5).map(normalizeTask) : [],
  };
}

function presentError(error, fallback = '服务暂时不可用，请稍后重试。') {
  const code = error && typeof error.code === 'string' ? error.code : 'network_error';
  return { code, message: ERROR_LABELS[code] || fallback, retryable: error ? error.retryable !== false : true };
}

module.exports = {
  ERROR_LABELS,
  NOTIFICATION_LABELS,
  formatDateTime,
  formatRelativeTime,
  normalizeDashboard,
  normalizeDesktop,
  normalizeTask,
  presentError,
  quotaView,
};
