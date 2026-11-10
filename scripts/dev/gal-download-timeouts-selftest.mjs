import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readTimeoutMs, taskTimeoutMs } from '../tag-scripts/gal-download/timeouts.mjs'

test('timeouts accept hours in config, inherit the remaining script budget and clamp explicit task limits', () => {
  assert.equal(readTimeoutMs(7260000, 1560000, 'scriptTimeoutMs'), 7260000)
  assert.equal(taskTimeoutMs({}, 7250000), 7250000)
  assert.equal(taskTimeoutMs({ runTimeoutMs: 7200000 }, 7250000), 7200000)
  assert.equal(taskTimeoutMs({ runTimeoutMs: 7200000 }, 30000), 30000)
  assert.equal(readTimeoutMs(undefined, 120000, 'requestTimeoutMs'), 120000)
  assert.equal(readTimeoutMs('180000', 120000, 'requestTimeoutMs'), 180000)
  for (const value of [0, -1, 999, 1000.5, NaN, Infinity, 2147483648]) assert.throws(() => readTimeoutMs(value, 120000, 'requestTimeoutMs'), /requestTimeoutMs 必须是/)
})
