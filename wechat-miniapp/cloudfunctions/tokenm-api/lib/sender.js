'use strict';

const { AppError } = require('./errors');
const { CONTROL_RE } = require('./security');

const TYPE_LIMITS = {
  thing: 20,
  phrase: 5,
  name: 10,
  character_string: 32,
  number: 32,
  date: 10,
  time: 20
};

function cleanTemplateValue(value, type) {
  let text = String(value ?? '');
  if (CONTROL_RE.test(text)) throw new AppError('provider_rejected');
  text = text.trim();
  if (!text) text = type === 'phrase' ? '已完成' : '任务完成';
  const limit = TYPE_LIMITS[type];
  if (!limit) throw new AppError('configuration_required');
  return [...text].slice(0, limit).join('');
}

function sourceValues({ task, desktop }) {
  const date = new Date(task.occurredAt);
  return {
    completion: task.privacyMode ? 'Codex 任务已完成' : (task.summary || task.project || 'Codex 任务已完成'),
    completedAt: Number.isNaN(date.getTime()) ? '' : date.toISOString().replace('T', ' ').slice(0, 19),
    desktopName: desktop.name,
    status: '已完成',
    project: task.privacyMode ? '隐私任务' : (task.project || '未命名项目'),
    model: task.privacyMode ? '未上传' : (task.model || '未提供')
  };
}

function buildTemplateData(config, context) {
  const values = sourceValues(context);
  const data = {};
  for (const [source, descriptor] of Object.entries(config.templateKeywords)) {
    data[descriptor.key] = { value: cleanTemplateValue(values[source], descriptor.type) };
  }
  return data;
}

function createWechatSender(cloud, config) {
  return {
    async send({ openid, task, desktop }) {
      return cloud.openapi.subscribeMessage.send({
        touser: openid,
        templateId: config.templateId,
        page: `/pages/task-detail/index?taskId=${encodeURIComponent(task._id)}`,
        data: buildTemplateData(config, { task, desktop }),
        miniprogramState: config.miniprogramState,
        lang: config.lang
      });
    }
  };
}

function classifyProviderResult(result) {
  const rawCode = result?.errcode ?? result?.errCode;
  if (typeof rawCode !== 'number') return { status: 'unknown', errcode: null, errmsgCode: 'malformed_response' };
  if (rawCode === 0) return { status: 'sent', errcode: 0, errmsgCode: null };
  const code = Number.isSafeInteger(rawCode) ? rawCode : null;
  return { status: 'failed', errcode: code, errmsgCode: code === null ? 'provider_rejected' : `wechat_${code}` };
}

module.exports = { buildTemplateData, classifyProviderResult, createWechatSender };
