import { test } from 'node:test';
import assert from 'node:assert/strict';
import { log, redact } from '../src/lib/log.js';

const fakeUrl = ['postgresql://app', 'not-a-real-password@db.example.invalid/neondb?sslmode=require'].join(':');
const fakeJwt = ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJ0ZXN0LXVzZXIifQ', 'c2lnbmF0dXJlLW5vdC1yZWFs'].join('.');

test('LOG-1 connection strings, JWTs, bearer tokens and AWS keys are masked', () => {
  const out = redact(`failed ${fakeUrl} with Bearer ${fakeJwt} key AKIA${'A'.repeat(16)}`);
  assert.doesNotMatch(out, /not-a-real-password/);
  assert.doesNotMatch(out, /eyJzdWIi/);
  assert.match(out, /postgres:\/\/<redacted>/);
  assert.doesNotMatch(out, /AKIA[A-Z]{16}/);
});

test('LOG-2 log() writes the redacted JSON line', () => {
  const lines = []; const orig = console.error; console.error = (l) => lines.push(l);
  try { log('error', 'DB_FAILED', { message: `connect ${fakeUrl} failed` }); } finally { console.error = orig; }
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.event, 'DB_FAILED');
  assert.doesNotMatch(lines[0], /not-a-real-password/);
});

test('LOG-3 ordinary fields are unchanged', () => {
  assert.equal(redact('{"event":"ACCESS_DENIED","userId":"4959181f-2f99-4889-9c36-03d3dc0f5001"}'), '{"event":"ACCESS_DENIED","userId":"4959181f-2f99-4889-9c36-03d3dc0f5001"}');
});
