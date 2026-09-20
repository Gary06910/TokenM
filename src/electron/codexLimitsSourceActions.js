'use strict';

function createCodexLimitsSourceActions({ getSettings, save, presentation, refresh, reconfigure }) {
  return async function changeSource(override) {
    const settings = getSettings();
    const previous = settings.codexHomeOverride || '';
    settings.codexHomeOverride = override;
    const selected = presentation.resolve();
    if (override && selected.status !== 'OK') {
      settings.codexHomeOverride = previous;
      presentation.resolve();
      return { ok: false, error: 'INVALID' };
    }
    try { save(); }
    catch (_) {
      settings.codexHomeOverride = previous;
      presentation.resolve();
      return { ok: false, error: 'ERROR' };
    }
    presentation.clear('codex');
    reconfigure();
    // Dispatch immediately; never hold the UI response behind a network probe.
    void Promise.resolve(refresh()).catch(() => {});
    return { ok: true, ...presentation.snapshot() };
  };
}

module.exports = { createCodexLimitsSourceActions };
