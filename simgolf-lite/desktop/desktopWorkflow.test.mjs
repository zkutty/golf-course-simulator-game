import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/desktop-smoke.yml", import.meta.url), "utf8")
  .replace(/\r\n?/g, "\n");

test("manual desktop smoke binds native evidence to the exact GitHub commit on both required runners", () => {
  assert.match(workflow, /COMMIT_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /ZK682_EXPECTED_COMMIT: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /os: macos-14\n\s+platform: darwin\n\s+architecture: arm64/);
  assert.match(workflow, /os: windows-2022\n\s+platform: win32\n\s+architecture: x64/);
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'\n\s+run: npm run desktop:package:persistence/);
});

test("manual evidence is uploaded without renaming and pull requests retain the unsigned smoke package", () => {
  assert.match(workflow, /if: github\.event_name == 'pull_request'[\s\S]+name: coursecraft-\$\{\{ matrix\.os \}\}-unsigned[\s\S]+retention-days: 7/);
  assert.match(workflow, /name: coursecraft-\$\{\{ matrix\.platform \}\}-\$\{\{ matrix\.architecture \}\}-unsigned-\$\{\{ github\.sha \}\}[\s\S]+retention-days: 30/);
  assert.match(workflow, /name: zk682-native-evidence-\$\{\{ matrix\.platform \}\}-\$\{\{ matrix\.architecture \}\}-\$\{\{ github\.sha \}\}[\s\S]+path: simgolf-lite\/artifacts\/zk682\/raw\n[\s\S]+retention-days: 90/);
});
