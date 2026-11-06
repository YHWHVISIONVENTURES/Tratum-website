const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const verify = require('../src/middleware/requestSignerVerify');
function run(change = {}) {
  const timestamp = String(Date.now());
  const key = 'test-only-key';
  const body = { amount: '100' };
  const signature = crypto.createHmac('sha256', key).update(`${timestamp}.${key}.${JSON.stringify(body)}`).digest('hex');
  const req = { method: 'POST', institution: { id: 1 }, body, headers: { 'x-api-key': key, 'x-timestamp': timestamp, 'x-signature': signature }, ...change };
  let status, error, passed = false;
  verify(req, { status(s) { status = s; return this; }, json(v) { error = v.error; } }, () => { passed = true; });
  return { status, error, passed };
}
test('accepts authenticated signed request', () => assert.equal(run().passed, true));
test('rejects body tampering', () => assert.equal(run({ body: { amount: '999' } }).error, 'INVALID_SIGNATURE'));
test('requires authenticated institution', () => assert.equal(run({ institution: null }).status, 401));
test('rejects nonnumeric timestamps', () => assert.equal(run({ headers: { 'x-api-key': 'key', 'x-timestamp': 'NaN', 'x-signature': 'a'.repeat(64) } }).error, 'TIMESTAMP_REJECTED'));
test('rejects expired timestamps', () => assert.equal(run({ headers: { 'x-api-key': 'key', 'x-timestamp': String(Date.now() - 600000), 'x-signature': 'a'.repeat(64) } }).error, 'TIMESTAMP_REJECTED'));
