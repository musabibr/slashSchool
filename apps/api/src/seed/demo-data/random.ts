/**
 * Deterministic randomness for the demo dataset: the same `today` always produces the same rows
 * (and the same ids), so a demo reset keeps every URL working. Never use Math.random in the seed.
 */

/** 32-bit FNV-1a hash of a string, used to derive independent seeds from labels. */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: tiny, fast and good enough for demo data. */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
  }

  /** Uniform 32-bit unsigned integer. */
  uint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.uint32() / 4294967296;
  }

  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error('Rng.pick on an empty list');
    return items[Math.floor(this.next() * items.length)];
  }

  /** Picks by weight: `[[value, weight], …]`. */
  weighted<T>(options: ReadonlyArray<readonly [T, number]>): T {
    const total = options.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.next() * total;
    for (const [value, weight] of options) {
      roll -= weight;
      if (roll < 0) return value;
    }
    return options[options.length - 1][0];
  }

  /** A shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** `count` distinct items in random order. */
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, Math.max(0, Math.min(count, items.length)));
  }

  /** An independent generator for one part of the dataset, so parts don't shift each other. */
  fork(label: string): Rng {
    return new Rng((hashString(label) ^ this.uint32()) >>> 0);
  }
}

/** Deterministic RFC 4122 version-4 UUIDs. */
export class IdFactory {
  private readonly rng: Rng;

  constructor(seed: string) {
    this.rng = new Rng(seed);
  }

  next(): string {
    const hex = Array.from({ length: 4 }, () => this.rng.uint32().toString(16).padStart(8, '0')).join('');
    const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
}
