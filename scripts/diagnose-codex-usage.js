'use strict';

// Read-only, content-safe diagnostics for Codex usage ingestion. This reports
// paths, counts, event names, usage field names, and aggregate usage only. It
// never prints prompts, responses, tool payloads, source code, or credentials.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const { collectUsageOnce } = require('../src/shared/collector');

function filesUnder(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) files.push(fullPath);
    }
  }
  return files.sort();
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function usageKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).filter((key) => /token|usage|cache|input|output|reasoning|total/i.test(key)).sort();
}

async function inspectFiles(files) {
  const stats = {
    filesRead: 0,
    lines: 0,
    parsed: 0,
    invalid: 0,
    usageRecognized: 0,
    usageIgnored: 0,
    sessionsWithUsage: new Set(),
    eventTypes: new Map(),
    payloadTypes: new Map(),
    usageShapes: new Set()
  };

  for (const file of files) {
    let fileHasUsage = false;
    const input = fs.createReadStream(file, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      stats.lines += 1;
      let event;
      try {
        event = JSON.parse(line);
        stats.parsed += 1;
      } catch {
        stats.invalid += 1;
        continue;
      }
      increment(stats.eventTypes, String(event?.type || '(missing)'));
      if (event?.payload?.type) increment(stats.payloadTypes, String(event.payload.type));
      if (event?.type !== 'event_msg' || event?.payload?.type !== 'token_count') continue;
      const info = event.payload.info;
      const total = info?.total_token_usage;
      const last = info?.last_token_usage;
      if (!total && !last) {
        stats.usageIgnored += 1;
        continue;
      }
      stats.usageRecognized += 1;
      fileHasUsage = true;
      stats.usageShapes.add(JSON.stringify({
        event: 'event_msg/token_count',
        info: usageKeys(info),
        total_token_usage: usageKeys(total),
        last_token_usage: usageKeys(last)
      }));
    }
    stats.filesRead += 1;
    if (fileHasUsage) stats.sessionsWithUsage.add(file);
  }
  return stats;
}

function printCounts(label, map) {
  console.log(`${label}:`);
  for (const [name, count] of [...map.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${name}: ${count}`);
  }
}

async function main() {
  const profileHome = os.homedir();
  const codexHome = String(process.env.CODEX_HOME || '').trim() || path.join(profileHome, '.codex');
  const roots = {
    sessions: path.join(codexHome, 'sessions'),
    archived_sessions: path.join(codexHome, 'archived_sessions')
  };
  const liveFiles = filesUnder(roots.sessions);
  const archivedFiles = filesUnder(roots.archived_sessions);
  const allFiles = [...liveFiles, ...archivedFiles];

  console.log('Codex collector diagnostics');
  console.log(`profile home: ${profileHome}`);
  console.log(`inherited HOME matches profile: ${path.resolve(process.env.HOME || profileHome) === path.resolve(profileHome)}`);
  console.log('session roots:');
  for (const [name, root] of Object.entries(roots)) {
    console.log(`  ${name}: exists=${fs.existsSync(root)} path=${root}`);
  }
  console.log('files discovered:');
  console.log(`  sessions: ${liveFiles.length}`);
  console.log(`  archived: ${archivedFiles.length}`);
  console.log(`  nested sessions: ${liveFiles.filter((file) => path.dirname(file) !== roots.sessions).length}`);

  const inspected = await inspectFiles(allFiles);
  console.log(`files read: ${inspected.filesRead}`);
  console.log('JSON lines:');
  console.log(`  total: ${inspected.lines}`);
  console.log(`  parsed: ${inspected.parsed}`);
  console.log(`  invalid: ${inspected.invalid}`);
  console.log(`usage events recognized: ${inspected.usageRecognized}`);
  console.log(`usage events ignored: ${inspected.usageIgnored}`);
  console.log(`sessions with usage: ${inspected.sessionsWithUsage.size}`);
  printCounts('top-level event types', inspected.eventTypes);
  printCounts('payload event types', inspected.payloadTypes);
  console.log('usage schemas:');
  for (const shape of [...inspected.usageShapes].sort()) console.log(`  ${shape}`);

  const usage = await collectUsageOnce({
    clients: 'codex',
    allTimeSince: '1970-01-01',
    commandTimeoutMs: 120_000,
    deviceId: 'diagnostic',
    homeDir: profileHome,
    historyEnabled: false,
    projectsEnabled: false,
    wslScanEnabled: false
  });
  console.log('collector aggregate:');
  console.log(`  today tokens: ${usage.today.totalTokens}`);
  console.log(`  month tokens: ${usage.month.totalTokens}`);
  console.log(`  all-time tokens: ${usage.allTime.totalTokens}`);
  console.log(`  sessions with extracted usage: ${Object.keys(usage.allTime.sessions || {}).length}`);
  console.log(`  estimated API-equivalent cost positive: ${usage.allTime.costUsd > 0}`);
  console.log(`  source status: ${usage.clientStatus?.codex || 'unknown'}`);
}

main().catch((error) => {
  console.error(`Codex diagnostics failed: ${error.message}`);
  process.exitCode = 1;
});
