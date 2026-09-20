'use strict';

(function exposeHomeModulePreferences(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorHomeModulePreferences = api;
})(typeof window !== 'undefined' ? window : null, function createHomeModulePreferencesApi() {
  const DEFAULT_HOME_MODULE_ORDER = 'limits,tool,device,model,cacheHit,trends';

  function optionIds(options) {
    return (options || []).map((option) => String(option?.id || '').trim()).filter(Boolean);
  }

  function normalizeHomeModuleOrder(value, options) {
    const known = optionIds(options);
    const knownSet = new Set(known.map((id) => id.toLowerCase()));
    const raw = Array.isArray(value) ? value : String(value || DEFAULT_HOME_MODULE_ORDER).split(',');
    const seen = new Set();
    const order = [];
    for (const item of raw) {
      const key = String(item || '').trim().toLowerCase();
      const id = known.find((candidate) => candidate.toLowerCase() === key) || '';
      if (!id || !knownSet.has(id.toLowerCase()) || seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
    for (const option of options || []) {
      const id = String(option?.id || '').trim();
      if (seen.has(id)) continue;
      seen.add(id);
      const insertBefore = String(option?.insertBefore || '').trim();
      const insertIndex = insertBefore
        ? order.findIndex((candidate) => candidate.toLowerCase() === insertBefore.toLowerCase())
        : -1;
      if (insertIndex >= 0) order.splice(insertIndex, 0, id);
      else order.push(id);
    }
    return order;
  }

  function normalizeHiddenHomeModules(value, options) {
    const known = optionIds(options);
    const knownSet = new Set(known.map((id) => id.toLowerCase()));
    const raw = Array.isArray(value) ? value : String(value || '').split(',');
    const hidden = [];
    const seen = new Set();
    for (const item of raw) {
      const key = String(item || '').trim().toLowerCase();
      const id = known.find((candidate) => candidate.toLowerCase() === key) || '';
      if (!id || !knownSet.has(id.toLowerCase()) || seen.has(id)) continue;
      seen.add(id);
      hidden.push(id);
    }
    return hidden.length >= known.length ? '' : hidden.join(',');
  }

  function orderedHomeModules(options, value) {
    const byId = new Map((options || []).map((option) => [String(option.id || '').toLowerCase(), option]));
    return normalizeHomeModuleOrder(value, options)
      .map((id) => byId.get(String(id).toLowerCase()))
      .filter(Boolean);
  }

  function moveHomeModuleOrder(value, options, moduleId, direction) {
    const order = normalizeHomeModuleOrder(value, options);
    const from = order.findIndex((id) => id.toLowerCase() === String(moduleId || '').trim().toLowerCase());
    const offset = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    const to = from + offset;
    if (from < 0 || offset === 0 || to < 0 || to >= order.length) return order.join(',');
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    return order.join(',');
  }

  function reorderHomeModuleOrder(value, options, moduleId, targetIndex) {
    const order = normalizeHomeModuleOrder(value, options);
    const from = order.findIndex((id) => id.toLowerCase() === String(moduleId || '').trim().toLowerCase());
    if (from < 0) return order.join(',');
    const to = Math.max(0, Math.min(order.length - 1, Number(targetIndex) || 0));
    if (from === to) return order.join(',');
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    return order.join(',');
  }

  function defaultHomeModulePreferences() {
    return {
      homeModuleOrder: DEFAULT_HOME_MODULE_ORDER,
      hiddenHomeModules: 'tool,device'
    };
  }

  return {
    DEFAULT_HOME_MODULE_ORDER,
    defaultHomeModulePreferences,
    moveHomeModuleOrder,
    normalizeHiddenHomeModules,
    normalizeHomeModuleOrder,
    orderedHomeModules,
    reorderHomeModuleOrder
  };
});
