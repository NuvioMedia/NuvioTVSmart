// Bounded LRU cache backed by a Map: Map iteration order is access order.
export class BoundedCache extends Map {
  constructor(maxEntries) {
    super();
    this.maxEntries = Math.max(1, Number(maxEntries) || 1);
  }

  get(key) {
    const value = super.get(key);
    if (value !== undefined) {
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }

  set(key, value) {
    super.delete(key);
    super.set(key, value);
    while (this.size > this.maxEntries) {
      super.delete(this.keys().next().value);
    }
    return this;
  }
}
