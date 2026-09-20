'use strict';

// Token M owns this small settings island. Keeping it outside upstream's
// renderer state machine lets the collector, provider panels, and new upstream
// settings continue to evolve independently. The section itself is registered
// by upstream app.js; this file only owns Token M notification state and IPC.
(function installTokenMNotificationSettings() {
  const api = window.tokenMNotifications;
  if (!api) return;

  const translate = window.TokenMonitorI18n?.translate;
  const text = (key, params) => translate
    ? translate(document.documentElement.lang || 'en', key, params)
    : key;

  const byId = (id) => document.getElementById(id);
  const els = {
    root: byId('tokenMNotificationSettings'),
    summary: byId('tokenMNotificationSummary'),
    pairing: byId('tokenMNotificationPairingFields'),
    bound: byId('tokenMNotificationBoundFields'),
    apiUrl: byId('tokenMNotificationApiUrl'),
    code: byId('tokenMNotificationPairingCode'),
    pair: byId('tokenMNotificationPairButton'),
    state: byId('tokenMNotificationState'),
    detail: byId('tokenMNotificationStatusDetail'),
    lastSeen: byId('tokenMNotificationLastSeen'),
    enabled: byId('tokenMNotificationEnabled'),
    privacy: Array.from(document.querySelectorAll('input[name="tokenMNotificationPrivacy"]')),
    clearUndelivered: byId('tokenMClearUndelivered'),
    clearOutbox: byId('tokenMClearOutbox'),
    outboxError: byId('tokenMOutboxError'),
    unpair: byId('tokenMNotificationUnpairButton'),
    hookStatus: byId('tokenMNotificationHookStatus'),
    enableHook: byId('tokenMNotificationEnableHookButton'),
    disableHook: byId('tokenMNotificationDisableHookButton'),
    trust: byId('tokenMNotificationTrustNote'),
    action: byId('tokenMNotificationActionStatus')
  };
  if (!els.root) return;

  let settings = {};
  let status = {};
  let busy = false;

  const stateLabel = (value) => text(`settings.notifications.android.state.${value}`);

  function formatLastSeen(value) {
    if (!value) return text('settings.notifications.android.notSeen');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return text('settings.notifications.android.notSeen');
    return text('settings.notifications.android.lastSeen', {
      value: date.toLocaleString('zh-CN')
    });
  }

  function setAction(message = '', error = false) {
    if (!els.action) return;
    els.action.textContent = message;
    els.action.classList.toggle('error', error);
  }

  function errorMessage(error) {
    const code = String(error?.code || '').trim().toLowerCase();
    if (['invalid_code', 'invalid_pairing_code', 'pairing_code_invalid'].includes(code)) {
      return text('settings.notifications.android.invalidCode');
    }
    if (['unauthorized', 'forbidden', 'credential_invalid', 'credential_expired'].includes(code)) {
      return text('settings.notifications.android.credentialInvalid');
    }
    if (['network', 'network_error', 'timeout', 'connection_failed'].includes(code)) {
      return text('settings.notifications.android.connectionFailed');
    }
    return text('settings.notifications.actionFailed');
  }

  function render() {
    const android = status?.android || {};
    const bindingState = ['unbound', 'pairing', 'bound', 'invalid'].includes(android.bindingState)
      ? android.bindingState
      : (android.configured ? 'bound' : 'unbound');
    const hasBinding = android.configured === true || Boolean(android.desktop?.desktopId);
    const showPairing = !hasBinding || bindingState === 'pairing' || bindingState === 'invalid';
    els.pairing?.classList.toggle('hidden', !showPairing);
    els.bound?.classList.toggle('hidden', !hasBinding);
    if (els.apiUrl && !els.apiUrl.value) els.apiUrl.value = android.baseUrl || settings.tokenMAndroidApiUrl || '';
    if (els.summary) els.summary.textContent = text('settings.notifications.android.summary', {
      state: stateLabel(bindingState)
    });
    if (els.state) {
      els.state.textContent = stateLabel(bindingState);
      els.state.classList.toggle('success', bindingState === 'bound');
      els.state.classList.toggle('error', bindingState === 'invalid');
    }
    if (els.detail && hasBinding) {
      const name = android.desktop?.name || settings.tokenMAndroidDesktopName || 'Desktop';
      const pending = Number(android.outbox?.pending || 0);
      els.detail.textContent = text('settings.notifications.android.connectedAs', {
        name,
        pending: pending.toLocaleString('zh-CN')
      });
      if (els.lastSeen) els.lastSeen.textContent = formatLastSeen(android.desktop?.lastSeenAt);
    }
    const queue = android.outbox || {};
    const undelivered = (queue.blocked || 0) + (queue.failed || 0);
    if (els.detail && hasBinding && undelivered) els.detail.textContent += text('settings.notifications.android.undelivered', { count: undelivered });
    for (const [button, visible] of [[els.clearUndelivered, undelivered > 0], [els.clearOutbox, queue.total > 0]]) {
      if (button) { button.classList.toggle('hidden', !visible); button.disabled = busy; }
    }
    if (els.outboxError) {
      const code = queue.lastError;
      const reason = code === 'outbox_full' ? 'full' : queue.blocked ? 'credential' : code === 'retry_exhausted' ? 'exhausted' : code === 'expired' ? 'expired' : queue.failed ? 'rejected' : code ? 'network' : '';
      els.outboxError.textContent = reason ? text(`settings.notifications.android.queue.${reason}`) : '';
    }
    if (els.enabled) els.enabled.checked = android.enabled === true;
    for (const input of els.privacy) input.checked = input.value === (android.privacyMode === false ? 'full' : 'privacy');
    const hookEnabled = status?.hook?.enabled === true;
    if (els.hookStatus) els.hookStatus.textContent = hookEnabled
      ? text('settings.notifications.hookEnabled')
      : text('settings.notifications.hookDisabled');
    els.enableHook?.classList.toggle('hidden', hookEnabled);
    els.disableHook?.classList.toggle('hidden', !hookEnabled);
    if (els.enableHook) els.enableHook.disabled = android.configured !== true || bindingState !== 'bound' || busy;
    if (els.disableHook) els.disableHook.disabled = busy;
    if (els.pair) els.pair.disabled = busy || bindingState === 'pairing';
    if (els.enabled) els.enabled.disabled = busy || android.configured !== true || bindingState !== 'bound';
    if (els.unpair) els.unpair.disabled = busy || !hasBinding;
    els.trust?.classList.toggle('hidden', !hookEnabled || status?.hook?.needsTrust !== true);
  }

  async function withBusy(action) {
    if (busy) return;
    busy = true;
    render();
    try {
      status = await action();
      setAction('');
    } catch (error) {
      setAction(errorMessage(error), true);
      try { status = await api.getStatus(); } catch (_) {}
    } finally {
      busy = false;
      render();
    }
  }

  els.pair?.addEventListener('click', () => {
    const code = els.code?.value.trim() || '';
    const baseUrl = els.apiUrl?.value.trim() || '';
    if (!/^\d{6}$/.test(code)) {
      setAction(text('settings.notifications.android.invalidCode'), true);
      return;
    }
    void withBusy(async () => {
      const next = await api.pairAndroid({ baseUrl, code });
      if (els.code) els.code.value = '';
      return next;
    });
  });

  els.enabled?.addEventListener('change', () => {
    const value = els.enabled.checked;
    void withBusy(() => api.setAndroidEnabled(value));
  });

  for (const input of els.privacy) {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      void withBusy(() => api.setAndroidPrivacyMode(input.value !== 'full'));
    });
  }

  els.clearUndelivered?.addEventListener('click', () => {
    if (window.confirm(text('settings.notifications.android.clearConfirm'))) void withBusy(() => api.clearUndelivered());
  });
  els.clearOutbox?.addEventListener('click', () => {
    if (window.confirm(text('settings.notifications.android.clearConfirm'))) void withBusy(() => api.clearOutbox());
  });

  els.unpair?.addEventListener('click', () => {
    if (!window.confirm(text('settings.notifications.android.unpairConfirm'))) return;
    void withBusy(() => api.unpairAndroid());
  });

  els.enableHook?.addEventListener('click', () => void withBusy(() => api.enableCodexHook()));
  els.disableHook?.addEventListener('click', () => void withBusy(() => api.disableCodexHook()));

  api.onStatus?.((next) => {
    status = next || {};
    render();
  });
  window.tokenMonitor?.onSettingsPush?.((next) => {
    settings = next || {};
    render();
  });

  void Promise.all([
    window.tokenMonitor?.getSettings?.().then((next) => { settings = next || {}; }),
    api.getStatus().then((next) => { status = next || {}; })
  ]).catch((error) => setAction(errorMessage(error), true)).finally(render);
})();
