import { randomUUID } from "node:crypto";

const collections = {
  users: new Map(),
  authIdentities: new Map(),
  emailAuthChallenges: new Map(),
  emailAuthCooldowns: new Map(),
  products: new Map(),
  orders: new Map(),
  customInquiries: new Map(),
  contacts: new Map(),
  uploadGrants: new Map(),
  uploadQuotas: new Map(),
  studioSettings: new Map(),
};

const clone = (value) => (value == null ? value : structuredClone(value));

const getCollection = (name) => {
  const collection = collections[name];
  if (!collection) throw new TypeError(`Unknown in-memory collection: ${name}`);
  return collection;
};

export const memoryStore = {
  all(name) {
    return [...getCollection(name).values()].map(clone);
  },

  get(name, id) {
    return clone(getCollection(name).get(String(id)));
  },

  find(name, predicate) {
    return this.all(name).filter(predicate);
  },

  findOne(name, predicate) {
    return this.all(name).find(predicate);
  },

  count(name, predicate = () => true) {
    return this.all(name).filter(predicate).length;
  },

  create(name, input, requestedId) {
    const collection = getCollection(name);
    const id = String(requestedId || input.id || randomUUID());
    const now = new Date();
    const record = {
      ...clone(input),
      id,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now,
    };
    collection.set(id, record);
    return clone(record);
  },

  update(name, id, changes) {
    const collection = getCollection(name);
    const existing = collection.get(String(id));
    if (!existing) return undefined;
    const record = { ...existing, ...clone(changes), id: existing.id, updatedAt: new Date() };
    collection.set(String(id), record);
    return clone(record);
  },

  remove(name, id) {
    return getCollection(name).delete(String(id));
  },
};

export const resetMemoryStore = () => {
  Object.values(collections).forEach((collection) => collection.clear());
};
