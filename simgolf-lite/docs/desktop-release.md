# Desktop release architecture gate

Unsigned `desktop:pack:dir`, `desktop:dist` and desktop smoke keep their existing
targets and output. The separate `desktop:release:check` / `desktop:release`
entrypoints require a 40-character `VITE_COMMIT_SHA`, clean matching HEAD,
CI-managed signing credentials and macOS notarization credentials. Preflight
checks presence only: it does not validate authority or publish secrets.

macOS releases use universal DMG and ZIP targets; Windows uses x64 NSIS.
`forceCodeSigning`, hardened runtime and notarization remain mandatory. The
afterPack gate inspects actual main, helpers, framework, native modules and
libraries, including shipped optional providers. Universal temporary x64/arm64
packages are checked for their respective architecture, then the merged
universal package is checked for both slices before signing. No Intel-only
Steam/native library exemption is granted. An absent optional provider may
continue through the existing offline runtime policy; a shipped incompatible
provider fails this release gate.

The audit reads bounded headers, not executable payloads, and records relative
component paths and CPU slices. Required files, malformed/unsupported headers,
external symlinks, packed native ASAR entries or inventory limits fail closed.
ASAR metadata is bounded to 8 MiB and 20,000 entries; native files must be
unpacked for header inspection. Receipts describe architecture only: they are
not component checksums, signature/notarization verification, runtime arm64
proof, clean-device certification or a ZK-388 completion certificate.

Run `npm run test:desktop:architecture` and existing `npm run test:desktop`.
Do not run release packaging without trusted signing authority. Independently
verify final package checksums, Authenticode, hardened-runtime signature,
Gatekeeper/stapled notarization, actual non-translated Apple-silicon launch,
save compatibility and clean installation. ZK-392 consumes those exact signed
artifacts. Keep the previous signed build and copied saves for rollback.

Direct Electron Builder configuration invokes the same presence/candidate guards
in beforeBuild and beforePack (including when npmRebuild is disabled). Missing
notarization options stop before package extraction; notarize:true alone is not
a certificate. Header validation walks bounded Mach-O commands and file-backed
segment/section/linkedit extents, checks fat subtype/alignment and PE raw sections.
ASAR metadata is path/link confined; every packed file is checked by at most four
magic bytes plus executable metadata, including extensionless files. No complete
archive/native payload is extracted.

Architecture receipts are PRE_SIGNING and bind commit, package version and
source-file hashes. Each component header digest covers only the bytes read
during the header audit; it is not the full component or signed artifact hash.
Signing changes bytes. Final signed artifacts require independent checksums and
a separate signature/notarization certificate. The existing hosted test:desktop
command now includes the architecture controls; unsigned packaging defaults
and dependency lockfile remain unchanged.

Release CLI admits strictly clean HEAD before web build and binds both GITHUB_SHA
and VITE_COMMIT_SHA to that candidate. A conflicting alias fails. After the
successful web build only the tracked artifacts/m35/asset-audit.json may differ,
and its exact bounded JSON hash is carried to later hooks and recorded separately
under the existing ignored desktop-dist/release subtree. Any unrelated tracked or
untracked source change fails. No generated file is restored or blanket ignored.
beforeBuild is a dependency rebuild hook, not the CLI web-build boundary;
beforePack also enforces presence/source guards when dependency rebuild is skipped.
Direct configuration starts clean unless an explicitly bound audit is provided;
that binding is build-source evidence, not signing authority or final artifact proof.

The build binding uses exclusive creation: a stale desktop-dist/release/web-build-source-binding.json stops a second release. Use a fresh isolated release output (preserve prior evidence before cleanup); it is never silently overwritten. Later guards check the supplied audit hash even when source status is clean, including a reverted audit.
