'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCloudBaseRepository } = require('../lib/repository');

function makeFakeCloud() {
  const calls = [];
  const source = {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              calls.push({ op: 'get', collection: name, id });
              if (name === 'missing') {
                const error = new Error('document not found');
                throw error;
              }
              if (name === 'failure') {
                throw { errCode: -1, message: 'some database failure' };
              }
              return { data: { _id: id, ownerId: id } };
            },
            async set(payload) {
              calls.push({ op: 'set', collection: name, id, payload });
            },
            async update(payload) {
              calls.push({ op: 'update', collection: name, id, payload });
            },
            async remove() {
              calls.push({ op: 'remove', collection: name, id });
            }
          };
        },
        where() { throw new Error('query not used in this regression suite'); }
      };
    }
  };

  const db = {
    ...source,
    command: {
      gt(value) { return value; },
      gte(value) { return value; },
      lt(value) { return value; },
      lte(value) { return value; },
      eq(value) { return value; },
      and(value) { return value; },
      or(value) { return value; }
    },
    async runTransaction(callback) {
      return callback(source);
    }
  };

  return { cloud: { database: () => db }, calls };
}

test('CloudBase root set uses data payload and strips _id', async () => {
  const fake = makeFakeCloud();
  const repo = createCloudBaseRepository(fake.cloud);
  await repo.set('desktops', 'abc', { _id: 'abc', ownerId: 'abc', status: 'active' });
  assert.deepEqual(fake.calls.at(-1), {
    op: 'set', collection: 'desktops', id: 'abc',
    payload: { data: { ownerId: 'abc', status: 'active' } }
  });
});

test('CloudBase transaction set uses the same data payload protocol', async () => {
  const fake = makeFakeCloud();
  const repo = createCloudBaseRepository(fake.cloud);
  await repo.transaction((tx) => tx.set('desktops', 'abc', { _id: 'abc', ownerId: 'abc' }));
  assert.deepEqual(fake.calls.at(-1).payload, { data: { ownerId: 'abc' } });
});

test('CloudBase root and transaction update use data payload and strip _id', async () => {
  const fake = makeFakeCloud();
  const repo = createCloudBaseRepository(fake.cloud);
  await repo.update('desktops', 'abc', { _id: 'abc', status: 'active' });
  await repo.transaction((tx) => tx.update('desktops', 'abc', { _id: 'abc', status: 'paused' }));
  assert.deepEqual(fake.calls.filter((call) => call.op === 'update').map((call) => call.payload), [
    { data: { status: 'active' } },
    { data: { status: 'paused' } }
  ]);
});

test('CloudBase repository rejects document id mismatch', async () => {
  const fake = makeFakeCloud();
  const repo = createCloudBaseRepository(fake.cloud);
  await assert.rejects(repo.set('desktops', 'abc', { _id: 'other' }), /document id mismatch/);
});

test('errCode -1 is not treated as missing document', async () => {
  const fake = makeFakeCloud();
  const repo = createCloudBaseRepository(fake.cloud);
  await assert.rejects(repo.get('failure', 'abc'), (error) => error.errCode === -1);
});

test('explicit document-not-found error returns null', async () => {
  const fake = makeFakeCloud();
  const repo = createCloudBaseRepository(fake.cloud);
  assert.equal(await repo.get('missing', 'abc'), null);
});
