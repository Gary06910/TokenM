const DB_NAME = 'token-m';
const DB_VERSION = 1;
const AUTH_STORE = 'auth';
const AUTH_KEY = 'installation';

export function readAndClearPairToken(locationLike, historyLike) {
  const fragment = String(locationLike.hash || '').replace(/^#/, '');
  const token = new URLSearchParams(fragment).get('token');
  if (fragment) {
    historyLike.replaceState(null, '', `${locationLike.pathname}${locationLike.search}`);
  }
  return token || null;
}

export function detectPlatform(userAgent, maxTouchPoints = 0, standaloneMedia = false, navigatorStandalone = false) {
  const ua = String(userAgent || '');
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(maxTouchPoints) > 1);
  return {
    ios,
    android: /Android/.test(ua),
    standalone: Boolean(standaloneMedia || navigatorStandalone),
  };
}

export function notificationDecision({ online, supported, ios, standalone, permission, browserSubscription, serverPushEnabled, subscriptionExpired = false }) {
  if (ios && !standalone) return { code: 'ios-home-screen', label: 'Home Screen installation required', action: 'install-ios' };
  if (!supported) return { code: 'unsupported', label: 'Not supported by this browser', action: 'none' };
  if (!online) return { code: 'offline', label: 'Offline', action: 'none' };
  if (permission === 'denied') return { code: 'denied', label: 'Blocked in browser settings', action: 'none' };
  if (permission !== 'granted') return { code: 'permission-needed', label: 'Not enabled', action: 'enable' };
  if (subscriptionExpired) return { code: 'expired', label: 'Subscription expired', action: 'enable' };
  if (!browserSubscription && serverPushEnabled) return { code: 'expired', label: 'Subscription expired', action: 'enable' };
  if (!browserSubscription) return { code: 'missing', label: 'Not subscribed', action: 'enable' };
  if (!serverPushEnabled) return { code: 'sync-needed', label: 'Subscription needs registration', action: 'enable' };
  return { code: 'enabled', label: 'Enabled', action: 'test' };
}

export function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function isStoredAuth(value) {
  return Boolean(
    value
    && value.key === AUTH_KEY
    && typeof value.tenantId === 'string'
    && typeof value.installationId === 'string'
    && typeof value.credential === 'string'
    && value.credential.startsWith('tm_m1.')
    && value.desktop
    && typeof value.desktop.deviceId === 'string'
    && typeof value.desktop.name === 'string',
  );
}

const pendingPairToken = typeof window === 'undefined'
  ? null
  : readAndClearPairToken(window.location, window.history);

if (typeof document !== 'undefined') {
  void initialize();
}

async function initialize() {
  const ui = collectUi();
  const platform = detectPlatform(
    navigator.userAgent,
    navigator.maxTouchPoints,
    window.matchMedia('(display-mode: standalone)').matches,
    navigator.standalone,
  );
  const state = {
    ui,
    platform,
    auth: null,
    remoteStatus: null,
    registration: null,
    browserSubscription: null,
    installPrompt: null,
    credentialExpired: false,
    subscriptionExpired: false,
  };

  bindEvents(state);
  updateNetworkBanner(ui);
  window.addEventListener('online', () => {
    updateNetworkBanner(ui);
    void refresh(state);
  });
  window.addEventListener('offline', () => {
    updateNetworkBanner(ui);
    renderBound(state);
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPrompt = event;
    renderInstallGuidance(state);
  });
  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    renderInstallGuidance(state);
  });

  try {
    const storedAuth = await readAuth();
    state.auth = isStoredAuth(storedAuth) ? storedAuth : null;
  } catch {
    showOnly(ui, 'unpaired');
    setText(ui.appStatus, 'Token M could not access secure local storage.');
    setMessage(ui.pairError, 'Secure local storage is unavailable. Check browser privacy settings and reload.');
    return;
  }

  if (pendingPairToken) {
    ui.installationName.value = suggestedInstallationName(platform);
    ui.pairCopy.textContent = state.auth
      ? 'This browser is already paired. Continuing will remove its current binding before pairing the new desktop.'
      : 'Confirm the name shown on your desktop, then bind this browser to Token M.';
    showOnly(ui, 'pair');
    return;
  }

  if (!state.auth) {
    showOnly(ui, 'unpaired');
    setText(ui.appStatus, 'This phone is ready to pair.');
    return;
  }

  showOnly(ui, 'bound');
  await refresh(state);
}

function collectUi() {
  const byId = (id) => document.getElementById(id);
  return {
    loadingView: byId('loading-view'), pairView: byId('pair-view'), unpairedView: byId('unpaired-view'), boundView: byId('bound-view'),
    appStatus: byId('app-status'), connectionBanner: byId('connection-banner'), pairForm: byId('pair-form'), pairCopy: byId('pair-copy'),
    pairButton: byId('pair-button'), pairError: byId('pair-error'), installationName: byId('installation-name'), bindingBadge: byId('binding-badge'),
    desktopState: byId('desktop-state'), installationState: byId('installation-state'), notificationState: byId('notification-state'),
    iosHomeScreen: byId('ios-home-screen'), notificationControls: byId('notification-controls'), notificationGuidance: byId('notification-guidance'),
    enableButton: byId('enable-button'), testButton: byId('test-button'), notificationError: byId('notification-error'), installCard: byId('install-card'),
    installGuidance: byId('install-guidance'), installButton: byId('install-button'), unpairButton: byId('unpair-button'), unpairResult: byId('unpair-result'),
    unpairedResult: byId('unpaired-result'),
  };
}

function bindEvents(state) {
  state.ui.pairForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void redeemPairing(state);
  });
  state.ui.enableButton.addEventListener('click', () => void enableNotifications(state));
  state.ui.testButton.addEventListener('click', () => void sendTest(state));
  state.ui.unpairButton.addEventListener('click', () => void unpair(state));
  state.ui.installButton.addEventListener('click', () => void installApp(state));
}

async function redeemPairing(state) {
  const { ui } = state;
  setMessage(ui.pairError, '');
  setBusy(ui.pairButton, true, 'Pairing…');

  try {
    if (!navigator.onLine) throw new ClientError('offline', 'This phone is offline. Reconnect and use a fresh pairing link if this one expires.');
    if (state.auth) await removeCurrentBinding(state);
    const result = await apiRequest('/v1/pairings/redeem', {
      method: 'POST',
      body: { token: pendingPairToken, installationName: normalizedName(ui.installationName.value) },
    });
    state.auth = {
      key: AUTH_KEY,
      tenantId: result.tenantId,
      installationId: result.installation.installationId,
      credential: result.credential,
      desktop: { deviceId: result.desktop.deviceId, name: result.desktop.name },
    };
    await writeAuth(state.auth);
    state.remoteStatus = {
      ok: true,
      desktop: result.desktop,
      installation: { ...result.installation, pushEnabled: false },
      vapidPublicKey: result.vapidPublicKey,
    };
    state.credentialExpired = false;
    state.subscriptionExpired = false;
    showOnly(ui, 'bound');
    setText(ui.appStatus, 'This phone is paired. Notification permission has not been requested yet.');
    await prepareBrowserSubscription(state);
    renderBound(state);
  } catch (error) {
    const message = error.code === 'invalid_pairing'
      ? 'This pairing link is expired, already used, or invalid. Create a new link on your desktop.'
      : safeErrorMessage(error, 'Pairing failed. Try a fresh pairing link.');
    setMessage(ui.pairError, message);
  } finally {
    setBusy(ui.pairButton, false, 'Pair this phone');
  }
}

async function refresh(state) {
  if (!state.auth) return;
  setText(state.ui.bindingBadge, navigator.onLine ? 'Checking' : 'Offline');
  try {
    await prepareBrowserSubscription(state);
    state.remoteStatus = await apiRequest('/v1/mobile/status', { credential: state.auth.credential });
    state.credentialExpired = false;
  } catch (error) {
    if (error.status === 401 || error.status === 403) state.credentialExpired = true;
    if (!error.network && !state.credentialExpired) {
      setMessage(state.ui.notificationError, safeErrorMessage(error, 'Status could not be refreshed.'));
    }
  }
  renderBound(state);
}

async function prepareBrowserSubscription(state) {
  if (!supportsPush()) return;
  try {
    state.registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    state.browserSubscription = await state.registration.pushManager.getSubscription();
  } catch {
    state.registration = null;
    state.browserSubscription = null;
  }
}

async function enableNotifications(state) {
  const { ui } = state;
  setMessage(ui.notificationError, '');
  setBusy(ui.enableButton, true, 'Enabling…');
  try {
    if (!navigator.onLine) throw new ClientError('offline', 'You are offline. Reconnect before enabling notifications.');
    if (!supportsPush()) throw new ClientError('unsupported', 'This browser does not support Web Push. Try a current version of Safari, Chrome, or Edge.');
    if (state.platform.ios && !state.platform.standalone) throw new ClientError('ios_home_screen', 'Add Token M to the Home Screen and reopen it before enabling notifications.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new ClientError('permission_denied', 'Notifications are blocked. Allow them in your browser or system settings.');
    if (!state.registration) await prepareBrowserSubscription(state);
    if (!state.registration) throw new ClientError('service_worker', 'The notification service could not start. Reload and try again.');

    let subscription = await state.registration.pushManager.getSubscription();
    if (!subscription) {
      const key = state.remoteStatus?.vapidPublicKey;
      if (!key) throw new ClientError('missing_key', 'Token M could not load its notification key. Refresh and try again.');
      subscription = await state.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
    const json = subscription.toJSON();
    await apiRequest('/v1/mobile/subscription', {
      method: 'PUT',
      credential: state.auth.credential,
      body: {
        permission: 'granted',
        subscription: {
          endpoint: json.endpoint,
          expirationTime: json.expirationTime ?? null,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        },
      },
    });
    state.browserSubscription = subscription;
    state.remoteStatus.installation.pushEnabled = true;
    state.subscriptionExpired = false;
    setText(ui.appStatus, 'Notifications are enabled.');
  } catch (error) {
    setMessage(ui.notificationError, safeErrorMessage(error, 'Notifications could not be enabled.'));
  } finally {
    setBusy(ui.enableButton, false, 'Enable notifications');
    renderBound(state);
  }
}

async function sendTest(state) {
  const { ui } = state;
  setMessage(ui.notificationError, '');
  setBusy(ui.testButton, true, 'Sending…');
  try {
    await apiRequest('/v1/mobile/test', { method: 'POST', credential: state.auth.credential, body: {} });
    setText(ui.appStatus, 'A test notification was sent to this phone.');
    ui.notificationGuidance.textContent = 'Test sent. It can take a few seconds to arrive.';
  } catch (error) {
    if (error.status === 410 || error.code === 'subscription_expired') {
      if (state.browserSubscription) await state.browserSubscription.unsubscribe().catch(() => false);
      state.browserSubscription = null;
      state.remoteStatus.installation.pushEnabled = false;
      state.subscriptionExpired = true;
      setMessage(ui.notificationError, 'The push subscription expired. Enable notifications again to renew it.');
    } else {
      setMessage(ui.notificationError, safeErrorMessage(error, 'The test notification could not be sent.'));
    }
  } finally {
    setBusy(ui.testButton, false, 'Send test notification');
    renderBound(state);
  }
}

async function unpair(state) {
  const { ui } = state;
  setMessage(ui.unpairResult, '');
  setBusy(ui.unpairButton, true, 'Unpairing…');
  let remoteConfirmed = false;
  try {
    await apiRequest('/v1/mobile', { method: 'DELETE', credential: state.auth.credential });
    remoteConfirmed = true;
  } catch {}

  const localCleared = await removeLocalBinding(state);
  showOnly(ui, 'unpaired');
  setMessage(
    ui.unpairedResult,
    !localCleared
      ? 'Token M could not clear its local credential. Clear this site’s stored data in browser settings before pairing again.'
      : remoteConfirmed
      ? 'This phone was removed locally and from Token M.'
      : 'This phone was removed locally. Remote revocation was not confirmed; remove it from the desktop when online.',
  );
  setText(
    ui.appStatus,
    !localCleared
      ? 'Local credential removal failed.'
      : remoteConfirmed ? 'Phone unpaired.' : 'Phone unpaired locally; remote revocation is unconfirmed.',
  );
  setBusy(ui.unpairButton, false, 'Unpair phone');
}

async function removeCurrentBinding(state) {
  try {
    await apiRequest('/v1/mobile', { method: 'DELETE', credential: state.auth.credential });
  } catch {}
  const localCleared = await removeLocalBinding(state);
  if (!localCleared) throw new ClientError('storage_error', 'The previous local credential could not be cleared. Clear this site’s stored data before pairing again.');
}

async function removeLocalBinding(state) {
  if (!state.browserSubscription && state.registration) {
    state.browserSubscription = await state.registration.pushManager.getSubscription().catch(() => null);
  }
  if (state.browserSubscription) await state.browserSubscription.unsubscribe().catch(() => false);
  let localCleared = true;
  try {
    await deleteAuth();
  } catch {
    localCleared = false;
  }
  state.auth = null;
  state.remoteStatus = null;
  state.browserSubscription = null;
  state.credentialExpired = false;
  state.subscriptionExpired = false;
  return localCleared;
}

function renderBound(state) {
  if (!state.auth) return;
  const { ui, remoteStatus } = state;
  const supported = supportsPush() && Boolean(state.registration || !navigator.onLine);
  const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const decision = notificationDecision({
    online: navigator.onLine,
    supported,
    ios: state.platform.ios,
    standalone: state.platform.standalone,
    permission,
    browserSubscription: Boolean(state.browserSubscription),
    serverPushEnabled: Boolean(remoteStatus?.installation?.pushEnabled),
    subscriptionExpired: state.subscriptionExpired,
  });

  ui.desktopState.textContent = remoteStatus?.desktop?.name || state.auth.desktop?.name || 'Unavailable';
  ui.installationState.textContent = remoteStatus?.installation?.name || 'This phone';
  ui.notificationState.textContent = decision.label;
  ui.bindingBadge.className = 'badge';

  if (state.credentialExpired) {
    ui.bindingBadge.textContent = 'Binding expired';
    ui.bindingBadge.classList.add('error');
    ui.desktopState.textContent = 'Authentication required';
    ui.notificationState.textContent = 'Binding expired';
    ui.notificationControls.hidden = true;
    setMessage(ui.notificationError, 'This phone binding is no longer valid. Unpair it, then scan a fresh desktop pairing code.');
  } else if (!navigator.onLine) {
    ui.bindingBadge.textContent = 'Offline';
    ui.bindingBadge.classList.add('error');
  } else {
    ui.bindingBadge.textContent = 'Paired';
    ui.bindingBadge.classList.add('ok');
  }

  const iosNeedsInstall = decision.code === 'ios-home-screen';
  ui.iosHomeScreen.hidden = !iosNeedsInstall;
  ui.notificationControls.hidden = state.credentialExpired || iosNeedsInstall;
  ui.enableButton.hidden = decision.action !== 'enable';
  ui.testButton.hidden = decision.action !== 'test';

  const guidance = {
    offline: 'Reconnect to check or change notification delivery.',
    unsupported: 'This browser cannot receive Web Push. Try a current version of Safari, Chrome, or Edge.',
    denied: 'Notifications are blocked. Allow Token M in browser or system notification settings, then reload.',
    expired: 'The previous subscription expired. Enable notifications to renew it.',
    missing: 'Enable alerts to know when a Codex task finishes.',
    'permission-needed': 'Permission is requested only after you tap the button below.',
    'sync-needed': 'Register this browser’s existing subscription with Token M.',
    enabled: 'This phone is ready to receive private completion alerts.',
  };
  ui.notificationGuidance.textContent = guidance[decision.code] || 'Notification status is unavailable.';
  renderInstallGuidance(state);
}

function renderInstallGuidance(state) {
  const { ui, platform } = state;
  if (platform.ios) {
    ui.installCard.hidden = true;
    return;
  }
  if (platform.standalone) {
    ui.installCard.hidden = true;
    return;
  }
  ui.installCard.hidden = false;
  ui.installButton.hidden = !state.installPrompt;
  ui.installGuidance.textContent = state.installPrompt
    ? 'Install Token M for quick access and more reliable notifications.'
    : platform.android
      ? 'In Chrome, open the browser menu and choose Install app or Add to Home screen.'
      : 'Use your browser menu to install Token M when installation is available.';
}

async function installApp(state) {
  if (!state.installPrompt) return;
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  renderInstallGuidance(state);
}

function supportsPush() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function showOnly(ui, view) {
  ui.loadingView.hidden = view !== 'loading';
  ui.pairView.hidden = view !== 'pair';
  ui.unpairedView.hidden = view !== 'unpaired';
  ui.boundView.hidden = view !== 'bound';
}

function updateNetworkBanner(ui) {
  ui.connectionBanner.hidden = navigator.onLine;
  ui.connectionBanner.textContent = navigator.onLine ? '' : 'You are offline. Status changes will resume after reconnecting.';
}

function suggestedInstallationName(platform) {
  if (platform.ios) return /iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 ? 'iPad' : 'iPhone';
  if (platform.android) return 'Android phone';
  return 'Mobile device';
}

function normalizedName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  return name.slice(0, 64) || 'Mobile device';
}

async function apiRequest(path, { method = 'GET', credential, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (credential) headers.Authorization = `Bearer ${credential}`;
  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch {
    const error = new ClientError('network_error', 'Token M could not reach the server. Check your connection and try again.');
    error.network = true;
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new ClientError(
      typeof payload.error === 'string' ? payload.error : 'request_failed',
      typeof payload.message === 'string' ? payload.message : `Token M request failed (${response.status}).`,
    );
    error.status = response.status;
    throw error;
  }
  return payload;
}

class ClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ClientError';
    this.code = code;
  }
}

function safeErrorMessage(error, fallback) {
  return error instanceof ClientError ? error.message : fallback;
}

function setText(element, value) {
  element.textContent = value;
}

function setMessage(element, value) {
  element.textContent = value;
  element.hidden = !value;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(AUTH_STORE)) request.result.createObjectStore(AUTH_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
  });
}

async function withStore(mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AUTH_STORE, mode);
    const request = operation(transaction.objectStore(AUTH_STORE));
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

function readAuth() {
  return withStore('readonly', (store) => store.get(AUTH_KEY));
}

function writeAuth(auth) {
  return withStore('readwrite', (store) => store.put(auth));
}

function deleteAuth() {
  return withStore('readwrite', (store) => store.delete(AUTH_KEY));
}
