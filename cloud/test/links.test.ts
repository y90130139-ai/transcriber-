import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractLinks, platformOf } from '../src/lib/links'

test('styled-card reference links accept Instagram, TikTok and X/Twitter videos', () => {
  const links = extractLinks([
    'Instagram: https://www.instagram.com/reel/ABC123/?igsh=share-token',
    'TikTok: https://www.tiktok.com/@creator/video/1234567890',
    'X: https://x.com/creator/status/9876543210',
    'Twitter: https://twitter.com/creator/status/1122334455',
  ].join('\n'))

  assert.deepEqual(links, [
    'https://instagram.com/reel/ABC123',
    'https://tiktok.com/@creator/video/1234567890',
    'https://x.com/creator/status/9876543210',
    'https://twitter.com/creator/status/1122334455',
  ])
  assert.deepEqual(links.map(platformOf), ['instagram', 'tiktok', 'x', 'x'])
})
