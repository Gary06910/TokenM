'use strict';

function isMissingDocument(error) {
  const text =
    `${error?.errCode || ''} ${error?.code || ''} ${error?.message || ''} ${error?.errMsg || ''}`
      .toLowerCase();

  return (
    text.includes('document not exist') ||
    text.includes('document_not_exist') ||
    text.includes('document not found') ||
    text.includes('does not exist')
  );
}

function buildCloudWhere(command, spec = {}) {
  const clauses = [];
  for (const [key, value] of Object.entries(spec.where || {})) clauses.push({ [key]: value });
  for (const [key, value] of Object.entries(spec.gt || {})) clauses.push({ [key]: command.gt(value) });
  for (const [key, value] of Object.entries(spec.gte || {})) clauses.push({ [key]: command.gte(value) });
  for (const [key, value] of Object.entries(spec.lt || {})) clauses.push({ [key]: command.lt(value) });
  for (const [key, value] of Object.entries(spec.lte || {})) clauses.push({ [key]: command.lte(value) });
  if (spec.before) {
    const { dateField, idField, date, id } = spec.before;
    clauses.push(command.or([
      { [dateField]: command.lt(date) },
      command.and([{ [dateField]: command.eq(date) }, { [idField]: command.lt(id) }])
    ]));
  }
  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return command.and(clauses);
}

function cloudQuery(collection, command, spec) {
  let query = collection.where(buildCloudWhere(command, spec));
  for (const [field, direction] of spec.orderBy || []) query = query.orderBy(field, direction);
  if (spec.limit) query = query.limit(spec.limit);
  return query;
}

function createCloudBaseRepository(cloud) {
  const db = cloud.database();
  const command = db.command;

  function adapter(source) {
    return {
      async get(collection, id) {
        try {
          const result = await source
            .collection(collection)
            .doc(id)
            .get();

          return result?.data || null;
        } catch (error) {
          if (isMissingDocument(error)) return null;
          throw error;
        }
      },

      async set(collection, id, data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new TypeError('document data must be an object');
        }

        if (data._id !== undefined && data._id !== id) {
          throw new Error('document id mismatch');
        }

        const { _id, ...document } = data;

        await source
          .collection(collection)
          .doc(id)
          .set({
            data: document
          });
      },

      async update(collection, id, data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new TypeError('document data must be an object');
        }

        if (data._id !== undefined && data._id !== id) {
          throw new Error('document id mismatch');
        }

        const { _id, ...document } = data;

        await source
          .collection(collection)
          .doc(id)
          .update({
            data: document
          });
      },

      async delete(collection, id) {
        try {
          await source.collection(collection).doc(id).remove();
        } catch (error) {
          if (!isMissingDocument(error)) throw error;
        }
      },

      async query(collection, spec = {}) {
        const result = await cloudQuery(
          source.collection(collection),
          command,
          spec
        ).get();

        return result?.data || [];
      },

      async count(collection, spec = {}) {
        const result = await cloudQuery(
          source.collection(collection),
          command,
          {
            ...spec,
            limit: undefined,
            orderBy: []
          }
        ).count();

        return result?.total || 0;
      }
    };
  }

  const root = adapter(db);

  return {
    ...root,

    async transaction(callback) {
      return db.runTransaction(async (transaction) => {
        const tx = adapter(transaction);
        return callback(tx);
      });
    }
  };
}

function compare(left, right) {
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  return a < b ? -1 : a > b ? 1 : 0;
}

function memoryMatches(doc, spec) {
  for (const [key, value] of Object.entries(spec.where || {})) if (compare(doc[key], value) !== 0) return false;
  for (const [key, value] of Object.entries(spec.gt || {})) if (compare(doc[key], value) <= 0) return false;
  for (const [key, value] of Object.entries(spec.gte || {})) if (compare(doc[key], value) < 0) return false;
  for (const [key, value] of Object.entries(spec.lt || {})) if (compare(doc[key], value) >= 0) return false;
  for (const [key, value] of Object.entries(spec.lte || {})) if (compare(doc[key], value) > 0) return false;
  if (spec.before) {
    const { dateField, idField, date, id } = spec.before;
    const dateComparison = compare(doc[dateField], date);
    if (!(dateComparison < 0 || (dateComparison === 0 && compare(doc[idField], id) < 0))) return false;
  }
  return true;
}

function clone(value) {
  return structuredClone(value);
}

function createMemoryRepository(seed = {}) {
  let state = {};
  for (const [collection, documents] of Object.entries(seed)) {
    state[collection] = new Map();
    for (const document of documents) state[collection].set(document._id, clone(document));
  }
  let lane = Promise.resolve();

  function mapFor(target, collection) {
    if (!target[collection]) target[collection] = new Map();
    return target[collection];
  }

  function adapter(target) {
    return {
      async get(collection, id) {
        const value = mapFor(target, collection).get(id);
        return value ? clone(value) : null;
      },
      async set(collection, id, data) {
        mapFor(target, collection).set(id, clone({ ...data, _id: id }));
      },
      async update(collection, id, data) {
        const current = mapFor(target, collection).get(id);
        if (!current) throw new Error(`missing document ${collection}/${id}`);
        mapFor(target, collection).set(id, clone({ ...current, ...data, _id: id }));
      },
      async delete(collection, id) {
        mapFor(target, collection).delete(id);
      },
      async query(collection, spec = {}) {
        let documents = [...mapFor(target, collection).values()].filter((doc) => memoryMatches(doc, spec));
        const order = spec.orderBy || [];
        documents.sort((left, right) => {
          for (const [field, direction] of order) {
            const result = compare(left[field], right[field]);
            if (result !== 0) return direction === 'desc' ? -result : result;
          }
          return 0;
        });
        if (spec.limit) documents = documents.slice(0, spec.limit);
        return clone(documents);
      },
      async count(collection, spec = {}) {
        return [...mapFor(target, collection).values()].filter((doc) => memoryMatches(doc, spec)).length;
      }
    };
  }

  return {
    get(collection, id) {
      return adapter(state).get(collection, id);
    },
    set(collection, id, data) {
      return adapter(state).set(collection, id, data);
    },
    update(collection, id, data) {
      return adapter(state).update(collection, id, data);
    },
    delete(collection, id) {
      return adapter(state).delete(collection, id);
    },
    query(collection, spec) {
      return adapter(state).query(collection, spec);
    },
    count(collection, spec) {
      return adapter(state).count(collection, spec);
    },
    transaction(callback) {
      const run = lane.then(async () => {
        const draft = {};
        for (const [collection, documents] of Object.entries(state)) {
          draft[collection] = new Map([...documents.entries()].map(([id, doc]) => [id, clone(doc)]));
        }
        const result = await callback(adapter(draft));
        state = draft;
        return result;
      });
      lane = run.catch(() => {});
      return run;
    },
    async snapshot(collection) {
      await lane;
      return [...mapFor(state, collection).values()].map(clone);
    }
  };
}

module.exports = { createCloudBaseRepository, createMemoryRepository };
