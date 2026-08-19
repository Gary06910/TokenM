import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const scanRoots = ['wechat-miniapp', 'docs/wechat-miniapp'];
const excludedDirectories = new Set(['.git', 'node_modules', 'build', 'dist']);
const textExtensions = new Set(['.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.wxml', '.wxss', '.xml', '.yaml', '.yml']);

const patterns = [
  { name: 'device credential', regex: /tm_wx_d1\.dev_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/gu },
  { name: 'WeChat AppID', regex: /["']appid["']\s*:\s*["']wx[0-9a-f]{16}["']/giu },
  { name: 'Cloud credential ID', regex: /\bAKID[A-Za-z0-9]{13,}\b/gu },
  { name: 'private secret assignment', regex: /\b(?:APPSECRET|APP_SECRET|PAIRING_CODE_PEPPER|DEVICE_SECRET_PEPPER|SECRETID|SECRETKEY)\b["']?\s*[:=]\s*["']([^"'\s<>]{12,})["']/giu },
  { name: 'deployed EnvID', regex: /["'](?:cloudBaseEnvId|environmentId)["']\s*:\s*["'](?!synthetic\b)([^"'\s<>]{6,})["']/giu },
  { name: 'deployed Template ID', regex: /["'](?:subscribeTemplateId|templateId)["']\s*:\s*["'](?!synthetic\b)([^"'\s<>]{10,})["']/giu },
];

const allowlistPath = path.resolve(repoRoot, 'wechat-miniapp', 'tests', 'fixtures', 'secret-scan-allowlist.json');
const allowedFindings = new Set();
if (fs.existsSync(allowlistPath)) {
  const parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  for (const entry of parsed.allowed || []) {
    if (typeof entry.file === 'string' && typeof entry.value === 'string') {
      allowedFindings.add(`${entry.file.replaceAll('/', path.sep)}\0${entry.value}`);
    }
  }
}

function walk(directory, files) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) walk(absolutePath, files);
    } else if (textExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(absolutePath);
    }
  }
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function scanText(text, label) {
  const findings = [];
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      if (allowedFindings.has(`${label}\0${match[0]}`)) continue;
      findings.push(`${label}:${lineNumber(text, match.index)}: ${pattern.name}`);
    }
  }
  return findings;
}

if (process.argv.includes('--self-test')) {
  const syntheticCredential = `tm_wx_d1.dev_${'A'.repeat(22)}.${'B'.repeat(43)}`;
  const detected = scanText(`credential=${syntheticCredential}`, '<synthetic-self-test>');
  if (detected.length !== 1 || scanText('{"appid":""}', '<empty>').length !== 0) {
    console.error('FAIL secret scanner self-test');
    process.exitCode = 1;
  } else {
    console.log('PASS secret scanner self-test');
  }
} else {
  const files = [];
  for (const relativeRoot of scanRoots) {
    const absoluteRoot = path.resolve(repoRoot, relativeRoot);
    if (fs.existsSync(absoluteRoot)) walk(absoluteRoot, files);
  }
  const findings = files.flatMap((file) => {
    const label = path.relative(repoRoot, file);
    if (path.resolve(file) === allowlistPath) return [];
    return scanText(fs.readFileSync(file, 'utf8'), label);
  });
  if (findings.length > 0) {
    for (const finding of findings) console.error(`FAIL ${finding}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS secret scan (${files.length} text files)`);
  }
}
