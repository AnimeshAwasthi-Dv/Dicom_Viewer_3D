export class LRUCache<K, V> {
  private readonly values = new Map<K, { value: V; size: number }>();
  private currentSize = 0;

  constructor(private readonly maxSize: number) {}

  get size(): number {
    return this.values.size;
  }

  get estimatedSize(): number {
    return this.currentSize;
  }

  get(key: K): V | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    this.values.delete(key);
    this.values.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, size = 1): void {
    const previous = this.values.get(key);
    if (previous) this.currentSize -= previous.size;
    this.values.delete(key);
    this.values.set(key, { value, size });
    this.currentSize += size;
    this.evict();
  }

  clear(): void {
    this.values.clear();
    this.currentSize = 0;
  }

  private evict(): void {
    while (this.currentSize > this.maxSize && this.values.size > 0) {
      const first = this.values.keys().next().value as K | undefined;
      if (first === undefined) return;
      const entry = this.values.get(first);
      this.values.delete(first);
      if (entry) this.currentSize -= entry.size;
    }
  }
}

