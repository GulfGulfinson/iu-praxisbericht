export type Rng = () => number;

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** mulberry32: tiny seeded PRNG so a plan is reproducible from its seed. */
export const createRng = (seed: string): Rng => {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const randInt = (rng: Rng, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

export const pick = <T>(rng: Rng, items: readonly T[]): T => {
  if (items.length === 0) throw new Error('pick() from an empty list');
  return items[Math.floor(rng() * items.length)] as T;
};

export const shuffle = <T>(rng: Rng, items: readonly T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};

/** Weighted sampling without replacement. */
export const weightedSample = <T>(rng: Rng, items: readonly { item: T; weight: number }[], count: number): T[] => {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    const total = pool.reduce((s, p) => s + p.weight, 0);
    let r = rng() * total;
    const idx = pool.findIndex((p) => (r -= p.weight) < 0);
    const [chosen] = pool.splice(idx === -1 ? pool.length - 1 : idx, 1);
    if (chosen) out.push(chosen.item);
  }
  return out;
};
