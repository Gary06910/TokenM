import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const miniappRoot = path.resolve(here, '..');
const repoRoot = path.resolve(miniappRoot, '..');
const failures = [];

const expectedCollections = [
  'users',
  'desktops',
  'pairingSessions',
  'tasks',
  'notificationState',
  'subscriptionGrants',
  'notificationDeliveries',
  'securityEvents',
  'rateLimits',
];

const expectedEnvKeys = [
  'PAIRING_CODE_PEPPER',
  'DEVICE_SECRET_PEPPER',
  'WECHAT_SUBSCRIBE_TEMPLATE_ID',
  'WECHAT_TEMPLATE_KEYWORD_MAPPING',
  'WECHAT_MINIPROGRAM_STATE',
  'TOKEN_M_WECHAT_PUBLIC_ORIGIN',
  'PAIRING_CODE_TTL_SECONDS',
  'PAIRING_RATE_LIMIT_COUNT',
  'PAIRING_RATE_LIMIT_WINDOW_SECONDS',
  'EVENT_RATE_LIMIT_COUNT',
  'EVENT_RATE_LIMIT_WINDOW_SECONDS',
  'STATUS_RATE_LIMIT_COUNT',
  'STATUS_RATE_LIMIT_WINDOW_SECONDS',
  'TASK_RETENTION_DAYS',
  'PAIRING_RETENTION_HOURS',
  'SECURITY_EVENT_RETENTION_DAYS',
];

function fail(message) {
  failures.push(message);
}

function readJson(relativePath) {
  const absolutePath = path.resolve(miniappRoot, relativePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    fail(`${relativePath}: ${error.message}`);
    return null;
  }
}

function isSafeRelativeDirectory(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.endsWith('/')
    && !path.isAbsolute(value)
    && !value.split(/[\\/]/u).includes('..');
}

function validateProjectConfig() {
  const project = readJson('project.config.json');
  if (!project) return;
  if (Object.hasOwn(project, 'appid')) fail('project.config.json must not contain appid');
  if (project.compileType !== 'miniprogram') fail('project.config.json compileType must be miniprogram');
  if (!isSafeRelativeDirectory(project.miniprogramRoot)) fail('miniprogramRoot must be a safe relative directory');
  if (!isSafeRelativeDirectory(project.cloudfunctionRoot)) fail('cloudfunctionRoot must be a safe relative directory');
  if (project.setting?.urlCheck !== true) fail('public urlCheck must be true');

  const privateExample = readJson('project.private.config.example.json');
  if (privateExample && privateExample.appid !== '') fail('private config example appid must be empty');

  const gitignore = fs.readFileSync(path.resolve(repoRoot, '.gitignore'), 'utf8');
  if (!gitignore.split(/\r?\n/u).includes('wechat-miniapp/project.private.config.json')) {
    fail('real WeChat private project config is not ignored');
  }
}

function validateTemplateMapping(mapping, { allowEmpty = false, label = 'template mapping' } = {}) {
  if (!mapping || mapping.version !== 1 || !mapping.fields || typeof mapping.fields !== 'object') {
    fail(`${label}: expected version 1 and fields object`);
    return;
  }
  const allowedSources = new Set(['completionStatus', 'completedAt', 'desktopName']);
  const allowedTypes = new Set(['thing', 'phrase', 'time', 'date', 'character_string', 'number']);
  const keywords = new Set();
  for (const [semanticName, field] of Object.entries(mapping.fields)) {
    if (!field || !allowedSources.has(field.source)) fail(`${label}.${semanticName}: unsupported source`);
    if (!allowedTypes.has(field?.type)) fail(`${label}.${semanticName}: unsupported type`);
    if (!allowEmpty && !/^(thing|phrase|time|date|character_string|number)\d+$/u.test(field?.keyword ?? '')) {
      fail(`${label}.${semanticName}: keyword must be a real template keyword such as thing1`);
    }
    if (field?.keyword) {
      if (keywords.has(field.keyword)) fail(`${label}: duplicate keyword ${field.keyword}`);
      keywords.add(field.keyword);
    }
    if (field?.type === 'thing' && field.maxChars !== 20) fail(`${label}.${semanticName}: thing must cap at 20 chars`);
    if (field?.type === 'phrase' && field.maxChars !== 5) fail(`${label}.${semanticName}: phrase must cap at 5 chars`);
  }
  if (!mapping.fields.completionStatus?.required || !mapping.fields.completedAt?.required) {
    fail(`${label}: completionStatus and completedAt must be required`);
  }
}

function validateTemplates() {
  const runtime = readJson('config/miniprogram-runtime.example.json');
  if (runtime && (runtime.cloudBaseEnvId !== '' || runtime.subscribeTemplateId !== '')) {
    fail('miniprogram runtime example must contain only empty deployment values');
  }

  const env = readJson('config/cloudfunction.env.example.json');
  if (env) {
    const keys = Object.keys(env).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...expectedEnvKeys].sort())) fail('cloud function env template key set drifted');
    for (const [key, value] of Object.entries(env)) {
      if (value !== '') fail(`cloud function env example ${key} must be empty`);
    }
  }

  const mapping = readJson('config/template-keyword-mapping.example.json');
  if (mapping) {
    if (mapping.templateId !== '') fail('template mapping example templateId must be empty');
    validateTemplateMapping(mapping, { allowEmpty: true, label: 'template-keyword-mapping.example.json' });
  }

  const deployment = readJson('config/cloudbase-deployment.example.json');
  if (deployment) {
    if (deployment.environmentId !== '' || deployment.miniprogramState !== '') fail('deployment example platform values must be empty');
    if (deployment.function?.name !== 'tokenm-api') fail('deployment function name must remain tokenm-api');
    if (deployment.httpGateway?.publicOrigin !== '') fail('deployment example origin must be empty');
    if (deployment.httpGateway?.triggerPath !== '/' || deployment.httpGateway?.desktopApiPrefix !== '/v1/desktop') {
      fail('HTTP gateway paths drifted from the frozen contract');
    }
    if (deployment.httpGateway?.httpsOnly !== true) fail('HTTP gateway must be HTTPS-only');
  }
}

function validateDatabase() {
  const collections = readJson('config/database/collections.json');
  const names = collections?.collections?.map((item) => item.name) ?? [];
  if (JSON.stringify(names) !== JSON.stringify(expectedCollections)) fail('database collection list/order drifted');
  for (const item of collections?.collections ?? []) {
    if (item.clientAccess !== 'deny') fail(`${item.name}: clientAccess must be deny`);
  }

  const manifest = readJson('config/database/rules-manifest.json');
  const ruleCollections = manifest?.rules?.map((item) => item.collection) ?? [];
  if (JSON.stringify(ruleCollections) !== JSON.stringify(expectedCollections)) fail('rules manifest must cover every collection exactly once');
  for (const entry of manifest?.rules ?? []) {
    const rule = readJson(`config/database/${entry.file}`);
    if (!rule || rule.read !== false || rule.write !== false || Object.keys(rule).length !== 2) {
      fail(`${entry.collection}: rule must be exact default deny`);
    }
  }

  const indexes = readJson('config/database/indexes.json');
  for (const index of indexes?.indexes ?? []) {
    if (!expectedCollections.includes(index.collection)) fail(`${index.name}: index references unknown collection`);
    if (!Array.isArray(index.fields) || index.fields.length === 0) fail(`${index.collection}.${index.name}: missing fields`);
    for (const field of index.fields ?? []) {
      if (!['asc', 'desc'].includes(field.order)) fail(`${index.collection}.${index.name}: invalid order`);
    }
  }
  for (const collection of expectedCollections.filter((name) => name !== 'notificationState')) {
    if (!(indexes?.indexes ?? []).some((index) => index.collection === collection)) fail(`${collection}: no declared operational index`);
  }
}

function validateFixtures() {
  const invalidProject = readJson('config/fixtures/invalid-public-project.absolute-root.json');
  if (invalidProject && isSafeRelativeDirectory(invalidProject.miniprogramRoot)) {
    fail('invalid absolute-root fixture no longer exercises the guard');
  }
  const invalidRule = readJson('config/fixtures/invalid-rule.client-read.json');
  if (invalidRule && invalidRule.read === false && invalidRule.write === false) {
    fail('invalid client-read fixture no longer exercises the guard');
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { integrated: false, productionEnv: null, productionTemplate: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--integrated') result.integrated = true;
    else if (arg === '--production-env') result.productionEnv = args[++index];
    else if (arg === '--production-template') result.productionTemplate = args[++index];
    else fail(`unknown argument: ${arg}`);
  }
  if (Boolean(result.productionEnv) !== Boolean(result.productionTemplate)) {
    fail('--production-env and --production-template must be supplied together');
  }
  return result;
}

function validateProductionConfig(envPath, templatePath) {
  let env;
  let mapping;
  try {
    env = JSON.parse(fs.readFileSync(path.resolve(envPath), 'utf8'));
    mapping = JSON.parse(fs.readFileSync(path.resolve(templatePath), 'utf8'));
  } catch (error) {
    fail(`production config: ${error.message}`);
    return;
  }
  for (const key of expectedEnvKeys) {
    if (typeof env[key] !== 'string' || env[key].length === 0) fail(`production env ${key} is required`);
  }
  if ((env.PAIRING_CODE_PEPPER ?? '').length < 32 || (env.DEVICE_SECRET_PEPPER ?? '').length < 32) {
    fail('production peppers must each be at least 32 characters');
  }
  if (env.PAIRING_CODE_PEPPER === env.DEVICE_SECRET_PEPPER) fail('pairing and device peppers must be distinct');
  if (!['developer', 'trial', 'formal'].includes(env.WECHAT_MINIPROGRAM_STATE)) fail('invalid WECHAT_MINIPROGRAM_STATE');
  try {
    const origin = new URL(env.TOKEN_M_WECHAT_PUBLIC_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== env.TOKEN_M_WECHAT_PUBLIC_ORIGIN) fail('public origin must be an HTTPS origin without path/query/hash');
    if (['localhost', '127.0.0.1', '::1'].includes(origin.hostname)) fail('production origin cannot be loopback');
  } catch {
    fail('TOKEN_M_WECHAT_PUBLIC_ORIGIN must be a valid HTTPS origin');
  }
  if (env.WECHAT_SUBSCRIBE_TEMPLATE_ID !== mapping.templateId) fail('env template ID and mapping template ID must match');
  let envMapping;
  try {
    envMapping = JSON.parse(env.WECHAT_TEMPLATE_KEYWORD_MAPPING);
  } catch {
    fail('WECHAT_TEMPLATE_KEYWORD_MAPPING must be JSON serialized as one environment value');
  }
  validateTemplateMapping(mapping, { label: 'production template mapping' });
  if (envMapping && JSON.stringify(envMapping) !== JSON.stringify(mapping)) fail('serialized env mapping must exactly match production template mapping file');
  for (const key of expectedEnvKeys.filter((name) => /_(SECONDS|DAYS|HOURS|COUNT)$/u.test(name))) {
    if (!/^\d+$/u.test(env[key] ?? '') || Number(env[key]) <= 0) fail(`${key} must be a positive integer string`);
  }
}

function validateIntegratedPackage() {
  for (const relativePath of [
    'miniprogram/app.js',
    'miniprogram/app.json',
    'miniprogram/config/runtime.js',
    'cloudfunctions/tokenm-api/index.js',
    'cloudfunctions/tokenm-api/package.json',
    'cloudfunctions/tokenm-api/config.json',
  ]) {
    if (!fs.existsSync(path.resolve(miniappRoot, relativePath))) fail(`integrated package missing ${relativePath}`);
  }
  if (fs.existsSync(path.resolve(miniappRoot, 'project.private.config.json'))) {
    fail('integrated package contains machine-local project.private.config.json; exclude it before distribution');
  }
}

const options = parseArgs();
validateProjectConfig();
validateTemplates();
validateDatabase();
validateFixtures();
if (options.productionEnv) validateProductionConfig(options.productionEnv, options.productionTemplate);
if (options.integrated) validateIntegratedPackage();

if (failures.length > 0) {
  for (const message of failures) console.error(`FAIL ${message}`);
  process.exitCode = 1;
} else {
  console.log('PASS platform config, deny rules, placeholders, indexes, and package manifest');
}
