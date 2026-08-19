'use strict';

class MockWeChatSender {
  constructor(results = []) {
    this.calls = [];
    this.results = [...results];
  }

  enqueue(result) {
    this.results.push(result);
  }

  async send(message) {
    this.calls.push(structuredClone(message));
    return this.results.shift() || { kind: 'success', errcode: 0 };
  }
}

module.exports = { MockWeChatSender };
