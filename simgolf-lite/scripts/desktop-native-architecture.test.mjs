import test from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nativeArchitectures, auditNativePackage } from "./desktop-native-architecture.mjs";
import { writeGeneratedAuditBinding, releaseChildEnvironment, assertReleaseCandidate, bindGeneratedAudit, releasePreflight } from "./desktop-release.mjs";
import config from "../desktop-release.config.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("app-builder-lib"));
const pickle = builderRequire("chromium-pickle-js");

function thin(cpu = 0x0100000c) {
  const b = Buffer.alloc(32);
  b.writeUInt32BE(0xcffaedfe); b.writeUInt32LE(cpu, 4);
  return b;
}
function fat() {
  const b = Buffer.alloc(112);
  b.writeUInt32BE(0xcafebabe); b.writeUInt32BE(2, 4);
  for (const [i, cpu] of [0x01000007, 0x0100000c].entries()) {
    const at = 8 + i * 20; b.writeUInt32BE(cpu, at);
    b.writeUInt32BE(48 + i * 32, at + 8); b.writeUInt32BE(32, at + 12);
    thin(cpu).copy(b, 48 + i * 32);
  }
  return b;
}
const parse = (b) => nativeArchitectures((offset, size) => b.subarray(offset, offset + size), b.length);
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coursecraft-native-"));
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("real header parser accepts arm64 and universal, rejects Intel-only policy", () => {
  assert.deepEqual(parse(thin()), ["arm64"]);
  assert.deepEqual(parse(fat()), ["arm64", "x64"]);
  fixture((root) => {
    fs.writeFileSync(path.join(root, "main"), thin(0x01000007));
    assert.throws(() => auditNativePackage(root, { platform: "darwin", requiredArchitectures: ["arm64"], requiredPaths: ["main"] }), /Architecture mismatch/);
  });
});

test("malformed, truncated, unsupported and overlapping slices fail closed", () => {
  assert.throws(() => parse(Buffer.alloc(3)), /Truncated/);
  assert.throws(() => parse(thin(7)), /Unsupported/);
  const bad = fat(); bad.writeUInt32BE(48, 36);
  assert.throws(() => parse(bad), /Overlapping/);
  const mismatch = fat(); mismatch.writeUInt32BE(0x01000007, 28);
  assert.throws(() => parse(mismatch), /mismatch|duplicate/);
  assert.throws(() => parse(fat().subarray(0, 90)), /range|outside/);
});

test("PE actual header fields require x64 PE32+", () => {
  const b = Buffer.alloc(256); b.write("MZ"); b.writeUInt32LE(64, 60);
  b.writeUInt32LE(0x4550, 64); b.writeUInt16LE(0x8664, 68); b.writeUInt16LE(1, 70);
  b.writeUInt16LE(112, 84); b.writeUInt16LE(0x20b, 88);
  assert.deepEqual(parse(b), ["x64"]);
  b.writeUInt16LE(0x14c, 68); assert.throws(() => parse(b), /Unsupported/);
});

test("required helper missing fails and optional shipped native library cannot evade audit", () => fixture((root) => {
  fs.writeFileSync(path.join(root, "main"), fat());
  const policy = { platform: "darwin", requiredArchitectures: ["arm64", "x64"], requiredPaths: ["main", "helper"] };
  assert.throws(() => auditNativePackage(root, policy), /Missing required/);
  fs.writeFileSync(path.join(root, "helper"), fat());
  assert.equal(auditNativePackage(root, policy).components.length, 2);
  fs.writeFileSync(path.join(root, "steam.node"), thin(0x01000007));
  assert.throws(() => auditNativePackage(root, policy), /steam.node/);
}));

test("package symlink escaping its root fails without reading native contents", () => fixture((root) => {
  fs.symlinkSync(os.tmpdir(), path.join(root, "outside"));
  assert.throws(() => auditNativePackage(root, { platform: "darwin", requiredArchitectures: ["arm64"], requiredPaths: ["main"] }), /escapes/);
}));

test("release preflight requires credential names without claiming authority", () => {
  const env = { VITE_COMMIT_SHA: "a".repeat(40), CSC_LINK: "fixture", CSC_KEY_PASSWORD: "fixture", APPLE_ID: "fixture", APPLE_APP_SPECIFIC_PASSWORD: "fixture", APPLE_TEAM_ID: "fixture" };
  assert.equal(releasePreflight("darwin", env).signingAuthorityVerified, false);
  assert.throws(() => releasePreflight("darwin", { ...env, APPLE_TEAM_ID: "" }), /notarization/);
  assert.throws(() => releasePreflight("win32", { VITE_COMMIT_SHA: env.VITE_COMMIT_SHA }), /signing/);
  assert.throws(() => releasePreflight("darwin", { ...env, CSC_IDENTITY_AUTO_DISCOVERY: "false" }), /signing/);
  assert.throws(() => releasePreflight("linux", env), /requires macOS or Windows/);
});

test("release config retains source-map exclusion and smoke default separation", () => {
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.mac.notarize, true);
  assert.deepEqual(config.mac.target.map((v) => v.arch), [["universal"], ["universal"]]);
  assert.deepEqual(config.win.target[0].arch, ["x64"]);
  assert.ok(config.files.includes("!node_modules/pixi.js/**/*.map"));
  assert.equal(config.directories.output, "desktop-release-dist");
});

function extentMacho(cpu = 0x0100000c) {
  const b = Buffer.alloc(104); b.writeUInt32BE(0xcffaedfe); b.writeUInt32LE(cpu, 4);
  b.writeUInt32LE(2, 12); b.writeUInt32LE(1, 16); b.writeUInt32LE(72, 20);
  b.writeUInt32LE(0x19, 32); b.writeUInt32LE(72, 36); b.writeBigUInt64LE(104n, 72);
  return b;
}
const parseAdverse = (b) => nativeArchitectures((o, n) => b.subarray(o, o+n), b.length);
function adverseFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-adverse-"));
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function archive(file, header, data = Buffer.alloc(0)) {
  const h = pickle.createEmpty(); h.writeString(JSON.stringify(header));
  const size = pickle.createEmpty(); size.writeUInt32(h.toBuffer().length);
  fs.writeFileSync(file, Buffer.concat([size.toBuffer(), h.toBuffer(), data]));
}
const policy = { platform: "darwin", requiredArchitectures: ["arm64"], requiredPaths: ["main"] };
test("Mach-O command structure and physical segment extents reject truncation", () => {
  const b = extentMacho(); b.writeBigUInt64LE(105n, 72); assert.throws(() => parseAdverse(b));
  const bad = extentMacho(); bad.writeUInt32LE(0, 20); assert.throws(() => parseAdverse(bad));
});
test("PE raw section cannot extend beyond physical EOF", () => {
  const b = Buffer.alloc(256); b.write("MZ"); b.writeUInt32LE(64,60); b.writeUInt32LE(0x4550,64);
  b.writeUInt16LE(0x8664,68); b.writeUInt16LE(1,70); b.writeUInt16LE(112,84); b.writeUInt16LE(0x20b,88);
  b.writeUInt32LE(32,216); b.writeUInt32LE(250,220); assert.throws(() => parseAdverse(b));
});
test("fat slice alignment and outer-inner subtype mismatch reject", () => {
  const b = Buffer.alloc(132); b.writeUInt32BE(0xcafebabe); b.writeUInt32BE(1,4);
  b.writeUInt32BE(0x0100000c,8); b.writeUInt32BE(1,12); b.writeUInt32BE(28,16); b.writeUInt32BE(104,20); b.writeUInt32BE(4,24);
  extentMacho().copy(b,28); assert.throws(() => parseAdverse(b));
});
test("extensionless packed native magic and executable metadata fail", () => adverseFixture((root) => {
  fs.writeFileSync(path.join(root,"main"),extentMacho());
  archive(path.join(root,"app.asar"),{files:{normal:{size:0,offset:"0"},alias:{link:"normal"}}});
  assert.equal(auditNativePackage(root,policy).components.length,1);
  archive(path.join(root,"app.asar"),{files:{hidden:{size:104,offset:"0"}}},extentMacho());
  assert.throws(() => auditNativePackage(root,policy));
  archive(path.join(root,"app.asar"),{files:{script:{size:0,offset:"0",executable:true}}});
  assert.throws(() => auditNativePackage(root,policy));
}));
test("ASAR traversal and link escape reject", () => adverseFixture((root) => {
  fs.writeFileSync(path.join(root,"main"),extentMacho());
  archive(path.join(root,"app.asar"),{files:{"../escape":{size:0,offset:"0"}}});
  assert.throws(() => auditNativePackage(root,policy));
  archive(path.join(root,"app.asar"),{files:{alias:{link:"../escape"}}});
  assert.throws(() => auditNativePackage(root,policy));
}));
test("direct configuration hook rejects missing notarization before build", async () => {
  assert.equal(typeof config.beforeBuild,"function");
  const previous={...process.env};
  try {
    for(const n of ['APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID','APPLE_API_KEY','APPLE_API_KEY_ID','APPLE_API_ISSUER','APPLE_KEYCHAIN','APPLE_KEYCHAIN_PROFILE']) delete process.env[n];
    process.env.VITE_COMMIT_SHA='a'.repeat(40); process.env.CSC_LINK='fixture'; process.env.CSC_KEY_PASSWORD='fixture'; delete process.env.CSC_IDENTITY_AUTO_DISCOVERY;
    await assert.rejects(()=>config.beforeBuild({platform:{nodeName:'darwin'}}),/notarization/);
  } finally { for(const n of Object.keys(process.env)) if(!(n in previous)) delete process.env[n]; Object.assign(process.env,previous); }
});


test("commit aliases are absent/equal or fail closed, child environment is exact", () => {
  const sha = 'a'.repeat(40);
  const env = { VITE_COMMIT_SHA: sha, CSC_LINK: 'fixture', CSC_KEY_PASSWORD: 'fixture', APPLE_ID: 'fixture', APPLE_APP_SPECIFIC_PASSWORD: 'fixture', APPLE_TEAM_ID: 'fixture' };
  assert.equal(releasePreflight('darwin', env).candidateCommit, sha);
  assert.equal(releasePreflight('darwin', { ...env, GITHUB_SHA: sha }).candidateCommit, sha);
  assert.throws(() => releasePreflight('darwin', { ...env, GITHUB_SHA: 'b'.repeat(40) }), /Conflicting/);
  assert.throws(() => releaseChildEnvironment({ ...env, GITHUB_SHA: 'b'.repeat(40) }, sha), /Conflicting/);
  const child = releaseChildEnvironment(env, sha);
  assert.equal(child.GITHUB_SHA, sha); assert.equal(child.VITE_COMMIT_SHA, sha);
  assert.equal(env.GITHUB_SHA, undefined);
});

test("real Git source phases allow only exact generated audit and ignored release output", () => fixture((root) => {
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  const app = path.join(root, 'app'); fs.mkdirSync(path.join(app, 'artifacts/m35'), { recursive: true });
  fs.writeFileSync(path.join(app, '.gitignore'), 'desktop-dist/\n');
  fs.writeFileSync(path.join(app, 'artifacts/m35/asset-audit.json'), '{"before":true}');
  fs.writeFileSync(path.join(app, 'source.js'), 'original'); fs.writeFileSync(path.join(root, 'outside.js'), 'original');
  git('add', '.'); git('commit', '-m', 'fixture'); const sha = git('rev-parse', 'HEAD');
  assertReleaseCandidate(app, sha);
  fs.mkdirSync(path.join(app, 'desktop-dist/release'), { recursive: true });
  fs.writeFileSync(path.join(app, 'desktop-dist/release/package'), 'owned output'); assertReleaseCandidate(app, sha);
  fs.writeFileSync(path.join(app, 'artifacts/m35/asset-audit.json'), '{"generated":true}');
  assert.throws(() => assertReleaseCandidate(app, sha), /cleanliness/);
  const binding = bindGeneratedAudit(app); assertReleaseCandidate(app, sha, binding.sha256);
  writeGeneratedAuditBinding(app, sha, binding);
  const receiptPath = path.join(app, 'desktop-dist/release/web-build-source-binding.json');
  const receiptBytes = fs.readFileSync(receiptPath);
  assert.throws(() => writeGeneratedAuditBinding(app, sha, binding), /EEXIST/);
  assert.deepEqual(fs.readFileSync(receiptPath), receiptBytes);
  fs.writeFileSync(path.join(app, 'artifacts/m35/asset-audit.json'), '{"before":true}');
  assert.throws(() => assertReleaseCandidate(app, sha, binding.sha256), /binding/);
  fs.writeFileSync(path.join(app, 'artifacts/m35/asset-audit.json'), '{"generated":true}');
  assert.throws(() => assertReleaseCandidate(app, sha, '0'.repeat(64)), /binding/);
  fs.writeFileSync(path.join(app, 'source.js'), 'mutated'); assert.throws(() => assertReleaseCandidate(app, sha, binding.sha256), /cleanliness/);
  fs.writeFileSync(path.join(app, 'source.js'), 'original'); fs.writeFileSync(path.join(root, 'outside.js'), 'mutated');
  assert.throws(() => assertReleaseCandidate(app, sha, binding.sha256), /cleanliness/);
  fs.writeFileSync(path.join(root, 'outside.js'), 'original'); fs.writeFileSync(path.join(app, 'unrelated.txt'), 'untracked');
  assert.throws(() => assertReleaseCandidate(app, sha, binding.sha256), /cleanliness/);
  fs.rmSync(path.join(app, 'unrelated.txt')); git('add', 'app/artifacts/m35/asset-audit.json');
  assert.throws(() => assertReleaseCandidate(app, sha, binding.sha256), /cleanliness/);
}));
