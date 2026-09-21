'use strict';

const shared = require('../shared/notification/codexHookForwarder');

if (require.main === module) shared.runCli();

module.exports = shared;
