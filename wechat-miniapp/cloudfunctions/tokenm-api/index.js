'use strict';

const cloud = require('wx-server-sdk');
const { createApplication, gatewayResponse, isHttpEvent } = require('./lib/app');
const { loadConfig } = require('./lib/config');
const { errorEnvelope } = require('./lib/errors');
const { createLogger } = require('./lib/logger');
const { createCloudBaseRepository } = require('./lib/repository');
const { requestId } = require('./lib/security');
const { createWechatSender } = require('./lib/sender');
const { createService } = require('./lib/service');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

let productionApp;

function getProductionApp() {
  if (productionApp) return productionApp;
  const config = loadConfig(process.env);
  const logger = createLogger(console);
  const repo = createCloudBaseRepository(cloud);
  const sender = createWechatSender(cloud, config);
  productionApp = createApplication({ service: createService({ repo, sender, config, logger }), logger });
  return productionApp;
}

exports.main = async (event) => {
  try {
    if (isHttpEvent(event)) return getProductionApp().invokeHttp(event);
    const context = cloud.getWXContext();
    return getProductionApp().invokeMini(event, { openid: context.OPENID, appId: context.APPID });
  } catch (error) {
    const reqId = /^req_[A-Za-z0-9_-]{16,43}$/u.test(event?.requestId || '') ? event.requestId : requestId();
    const envelope = errorEnvelope(error, reqId);
    return isHttpEvent(event) ? gatewayResponse(error.httpStatus || 503, envelope) : envelope;
  }
};
