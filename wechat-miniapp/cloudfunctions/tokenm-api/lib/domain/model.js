'use strict';

function asDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function iso(value) {
  return asDate(value).toISOString();
}

function quotaDto(state) {
  const available = state.available;
  return {
    available,
    reserved: state.reserved,
    status: available === 0 ? 'empty' : available <= 3 ? 'low' : 'normal'
  };
}

function desktopDto(desktop) {
  return {
    desktopId: desktop._id,
    name: desktop.name,
    status: desktop.status,
    createdAt: iso(desktop.createdAt),
    lastSeenAt: desktop.lastSeenAt ? iso(desktop.lastSeenAt) : null,
    lastEventAt: desktop.lastEventAt ? iso(desktop.lastEventAt) : null
  };
}

function taskSummaryDto(task, desktop) {
  return {
    taskId: task._id,
    desktop: { desktopId: task.desktopId, name: desktop?.name || '已解绑电脑' },
    occurredAt: iso(task.occurredAt),
    privacyMode: task.privacyMode,
    project: task.privacyMode ? null : task.project,
    notificationStatus: task.notificationStatus
  };
}

function taskDto(task, desktop) {
  return {
    taskId: task._id,
    desktop: { desktopId: task.desktopId, name: desktop?.name || '已解绑电脑' },
    occurredAt: iso(task.occurredAt),
    privacyMode: task.privacyMode,
    project: task.privacyMode ? null : task.project,
    model: task.privacyMode ? null : task.model,
    summary: task.privacyMode ? null : task.summary,
    durationMs: task.privacyMode ? null : task.durationMs,
    notificationStatus: task.notificationStatus
  };
}

function makeNotificationState(ownerId, initialQuota, now) {
  return {
    _id: ownerId,
    ownerId,
    available: initialQuota,
    reserved: 0,
    grantedTotal: initialQuota,
    consumedTotal: 0,
    releasedTotal: 0,
    version: 1,
    lastGrantAt: null,
    lastConsumedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function validateState(state) {
  for (const key of ['available', 'reserved', 'grantedTotal', 'consumedTotal', 'releasedTotal', 'version']) {
    if (!Number.isSafeInteger(state[key]) || state[key] < 0) throw new Error(`invalid notification state: ${key}`);
  }
  if (state.grantedTotal !== state.available + state.reserved + state.consumedTotal) throw new Error('invalid notification state ledger');
}

module.exports = { asDate, desktopDto, iso, makeNotificationState, quotaDto, taskDto, taskSummaryDto, validateState };
