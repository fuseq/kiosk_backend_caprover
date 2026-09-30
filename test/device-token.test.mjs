import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDeviceToken,
  hashDeviceToken,
  verifyDeviceToken,
  extractDeviceToken,
} from '../utils/device-token.js';

test('generateDeviceToken returns base64url string', () => {
  const token = generateDeviceToken();
  assert.equal(typeof token, 'string');
  assert.ok(token.length >= 40);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

test('verifyDeviceToken accepts valid token only', () => {
  const token = generateDeviceToken();
  const hash = hashDeviceToken(token);
  assert.equal(verifyDeviceToken(token, hash), true);
  assert.equal(verifyDeviceToken('wrong-token', hash), false);
  assert.equal(verifyDeviceToken(token, hashDeviceToken(generateDeviceToken())), false);
});

test('extractDeviceToken prefers Authorization header', () => {
  const req = {
    headers: { authorization: 'Device abc.def-ghi' },
    body: { deviceToken: 'body-token' },
  };
  assert.equal(extractDeviceToken(req), 'abc.def-ghi');
});

test('extractDeviceToken falls back to body', () => {
  const req = { headers: {}, body: { deviceToken: 'body-token' } };
  assert.equal(extractDeviceToken(req), 'body-token');
});
