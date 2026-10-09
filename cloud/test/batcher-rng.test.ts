// Deterministic randomness — the guarantee behind "retry renders the same video".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  VariationRng,
  deriveVariationSeed,
  permutation,
  selectFromPool,
  splitmix64,
  stableHash,
} from '../src/lib/batcher/rng'

test('splitmix64 is deterministic and mixes every input', () => {
  assert.equal(splitmix64(0n), splitmix64(0n))
  assert.notEqual(splitmix64(1n), splitmix64(2n))
  assert.notEqual(splitmix64(1n), 1n)
})

test('variation seeds are deterministic and unique per index', () => {
  const seed = 927198217n
  const first = Array.from({ length: 50 }, (_, i) => deriveVariationSeed(seed, i))
  const second = Array.from({ length: 50 }, (_, i) => deriveVariationSeed(seed, i))
  assert.deepEqual(first, second)
  assert.equal(new Set(first.map(String)).size, 50)
  assert.notEqual(String(deriveVariationSeed(1n, 5)), String(deriveVariationSeed(2n, 5)))
})

test('uniform samples stay in range and reproduce exactly', () => {
  const first = new VariationRng(999n, 7)
  const second = new VariationRng(999n, 7)
  for (let i = 0; i < 200; i += 1) {
    const a = first.uniform(-5, 5)
    const b = second.uniform(-5, 5)
    assert.equal(a, b)
    assert.ok(a >= -5 && a <= 5)
  }
})

test('different variation indexes produce different value streams', () => {
  const first = new VariationRng(123n, 0)
  const second = new VariationRng(123n, 1)
  const a = Array.from({ length: 8 }, () => first.uniform(0, 1))
  const b = Array.from({ length: 8 }, () => second.uniform(0, 1))
  assert.notDeepEqual(a, b)
})

test('uniformInt includes both ends', () => {
  const rng = new VariationRng(5n, 0)
  const seen = new Set<number>()
  for (let i = 0; i < 500; i += 1) seen.add(rng.uniformInt(0, 3))
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3])
})

test('stable hash is stable and distinguishes strings', () => {
  assert.equal(stableHash('hello'), stableHash('hello'))
  assert.notEqual(stableHash('a'), stableHash('b'))
})

test('pool permutation uses every item before repeating', () => {
  const picks = Array.from({ length: 5 }, (_, i) => selectFromPool(new VariationRng(1n, i), 1n, 'pool', 5, i, true))
  assert.deepEqual([...picks].sort((a, b) => (a ?? 0) - (b ?? 0)), [0, 1, 2, 3, 4])
  // Round two reshuffles but still covers the whole pool.
  const round2 = Array.from({ length: 5 }, (_, i) => selectFromPool(new VariationRng(1n, i + 5), 1n, 'pool', 5, i + 5, true))
  assert.deepEqual([...round2].sort((a, b) => (a ?? 0) - (b ?? 0)), [0, 1, 2, 3, 4])
})

test('permutations are stable per seed and differ between seeds', () => {
  assert.deepEqual(permutation(1n, 'pool', 8, 0), permutation(1n, 'pool', 8, 0))
  assert.notDeepEqual(permutation(1n, 'pool', 8, 0), permutation(2n, 'pool', 8, 0))
})
