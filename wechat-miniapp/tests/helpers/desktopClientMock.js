'use strict';

class DesktopClientMock {
  constructor(harness) {
    this.harness = harness;
    this.credential = null;
    this.desktopId = null;
  }

  async pair(code, deviceName = 'Contract Test Desktop') {
    const response = await this.harness.desktopRequest({
      method: 'POST',
      path: '/v1/desktop/pair',
      headers: { 'content-type': 'application/json' },
      body: { schemaVersion: 1, code, deviceName },
    });
    if (response.statusCode === 201) {
      this.credential = response.body.credential;
      this.desktopId = response.body.desktop.desktopId;
    }
    return response;
  }

  async status(credential = this.credential) {
    return this.harness.desktopRequest({
      method: 'GET',
      path: '/v1/desktop/status',
      headers: { authorization: `Bearer ${credential}` },
    });
  }

  async sendEvent(body, credential = this.credential) {
    return this.harness.desktopRequest({
      method: 'POST',
      path: '/v1/desktop/events',
      headers: {
        authorization: `Bearer ${credential}`,
        'content-type': 'application/json',
      },
      body,
    });
  }
}

module.exports = { DesktopClientMock };
