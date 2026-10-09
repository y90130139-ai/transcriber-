/**
 * Deterministic randomness — the heart of "same batch, same output".
 *
 * Every batch has a master seed. Variation i derives its own seed from
 * (batch_seed, i) with SplitMix64 — byte-identical to the desktop engine's
 * derivation, so seeds mean the same thing in both products. Sampling then
 * runs on xoshiro256** seeded from that variation seed: render order, worker
 * count and retries never change a resolved value.
 *
 * There is deliberately no Math.random() anywhere in the batch path.
 */

const MASK64 = 0xffffffffffffffffn
const GOLDEN = 0x9e3779b97f4a7c15n

function rotl(x: bigint, k: bigint): bigint {
  return ((x << k) | (x >> (64n - k))) & MASK64
}

export function splitmix64(seed: bigint): bigint {
  let z = (seed + GOLDEN) & MASK64
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64
  return z ^ (z >> 31n)
}

export function deriveVariationSeed(batchSeed: bigint, variationIndex: number): bigint {
  const mixed = splitmix64((batchSeed ^ (BigInt(variationIndex) * GOLDEN)) & MASK64)
  return splitmix64(mixed)
}

/** New master seed for a batch. Math.random is fine here — seeds are inputs, not decisions. */
export function generateBatchSeed(): number {
  const hi = Math.floor(Math.random() * 0x40000000)
  const lo = Math.floor(Math.random() * 0x100000000)
  return hi * 0x100000000 + lo
}

export function stableHash(input: string): bigint {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i) & 0xff)
    hash = (hash * 0x100000001b3n) & MASK64
    // Non-ASCII characters contribute their upper byte too, so different
    // Unicode strings keep different hashes.
    const high = input.charCodeAt(i) >> 8
    if (high) {
      hash ^= BigInt(high)
      hash = (hash * 0x100000001b3n) & MASK64
    }
  }
  return hash
}

export class VariationRng {
  readonly variationSeed: bigint
  private s0: bigint
  private s1: bigint
  private s2: bigint
  private s3: bigint

  constructor(batchSeed: bigint, variationIndex: number) {
    this.variationSeed = deriveVariationSeed(batchSeed, variationIndex)
    let seed = this.variationSeed
    this.s0 = splitmix64(seed)
    seed = splitmix64(seed)
    this.s1 = splitmix64(seed)
    seed = splitmix64(seed)
    this.s2 = splitmix64(seed)
    seed = splitmix64(seed)
    this.s3 = splitmix64(seed)
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0n) this.s3 = 1n
  }

  private nextU64(): bigint {
    const result = (rotl((this.s1 * 5n) & MASK64, 7n) * 9n) & MASK64
    const t = (this.s1 << 17n) & MASK64
    this.s2 ^= this.s0
    this.s3 ^= this.s1
    this.s1 ^= this.s2
    this.s0 ^= this.s3
    this.s2 ^= t
    this.s3 = rotl(this.s3, 45n)
    return result
  }

  /** Uniform in [min, max). Inclusive-ish at the top due to double rounding; never outside. */
  uniform(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return min
    const unit = Number(this.nextU64() >> 11n) / 9007199254740992 // 2^53
    return min + (max - min) * unit
  }

  uniformInt(min: number, max: number): number {
    if (min >= max) return min
    const span = max - min + 1
    return min + Number(this.nextU64() % BigInt(span))
  }

  bool(): boolean {
    return (this.nextU64() & 1n) === 0n
  }
}

/**
 * Deterministic permutation of a pool for "avoid repeats": every item is used
 * once before any repeats, and the order is stable across restarts.
 */
export function permutation(batchSeed: bigint, poolKey: string, len: number, round: number): number[] {
  const indices = Array.from({ length: len }, (_, i) => i)
  if (len <= 1) return indices
  const seed =
    stableHash(poolKey) ^
    ((stableHash(`${poolKey}\u001f${batchSeed.toString()}`) + BigInt(round) * 0x9e3779b97f4a7c15n) & MASK64)
  const rng = new VariationRng(seed, 0)
  for (let i = len - 1; i > 0; i -= 1) {
    const j = rng.uniformInt(0, i)
    const tmp = indices[i]
    indices[i] = indices[j]
    indices[j] = tmp
  }
  return indices
}

export function selectFromPool(
  rng: VariationRng,
  batchSeed: bigint,
  poolKey: string,
  poolLen: number,
  variationIndex: number,
  avoidRepeats: boolean,
): number | null {
  if (poolLen === 0) return null
  if (avoidRepeats) {
    const round = Math.floor(variationIndex / poolLen)
    const perm = permutation(batchSeed, poolKey, poolLen, round)
    return perm[variationIndex % poolLen]
  }
  return rng.uniformInt(0, poolLen - 1)
}
