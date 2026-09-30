import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../middleware/rate-limit.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test('rateLimit blocks after max requests', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 2, keyPrefix: 'test' });
  const req = { ip: '1.2.3.4' };
  let nextCount = 0;
  const next = () => { nextCount += 1; };

  limiter(req, mockRes(), next);
  limiter(req, mockRes(), next);
  assert.equal(nextCount, 2);

  const blockedRes = mockRes();
  limiter(req, blockedRes, next);
  assert.equal(blockedRes.statusCode, 429);
  assert.equal(nextCount, 2);
});
