import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertDispatch } from './desktop-post-signing-contract.mjs';
test('6 manual readonly disabled verification cannot publish completed release evidence', () => {
  const valid = { EVENT_NAME: 'workflow_dispatch', ENABLED: 'true', CANDIDATE: 'a'.repeat(40), EXPECTED_COMMIT: 'a'.repeat(40), ARTIFACT_RUN_ID: '123' };
  assert.doesNotThrow(() => assertDispatch(valid));
  for (const change of [{ EVENT_NAME: 'pull_request' }, { ENABLED: 'false' }, { CANDIDATE: 'b'.repeat(40) }, { ARTIFACT_RUN_ID: '../1' }]) assert.throws(() => assertDispatch({ ...valid, ...change }));
  const yaml = fs.readFileSync(new URL('../../.github/workflows/desktop-signed-evidence.yml', import.meta.url), 'utf8');
  assert.match(yaml, /workflow_dispatch:/); assert.match(yaml, /contents: read/); assert.match(yaml, /actions: read/); assert.match(yaml, /if: always\(\)/); assert.match(yaml, /ZK388 INCOMPLETE/);
  assert.doesNotMatch(yaml, /secrets\.|desktop:release|npm ci|notarytool|codesign|stapler|signtool|keychain|pull_request:/);
});
