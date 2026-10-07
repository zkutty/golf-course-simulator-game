import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const CPU = new Map([[0x01000007, "x64"], [0x0100000c, "arm64"]]);
const MAX_ENTRIES = 20000;
const MAX_HEADER = 8 * 1024 * 1024;
function check(value, message) { if (!value) throw new Error(message); }

/** Read only bounded native headers, never load/execute the component. */
export function nativeArchitectures(read, size) {
  check(Number.isSafeInteger(size) && size >= 4, "Truncated native component");
  const range = (offset, bytes) => {
    check(Number.isSafeInteger(offset) && offset >= 0 && offset + bytes <= size, "Native header outside file");
    const result = read(offset, bytes);
    check(result.length === bytes, "Truncated native header");
    return result;
  };
  const thin = (offset, length) => {
    const b = range(offset, 32);
    check(length >= 32, "Truncated Mach-O slice");
    const magic = b.readUInt32BE(0);
    check(magic === 0xcffaedfe || magic === 0xfeedfacf, "Unsupported Mach-O slice");
    const get = magic === 0xcffaedfe ? (n) => b.readUInt32LE(n) : (n) => b.readUInt32BE(n);
    const architecture = CPU.get(get(4));
    check(architecture, "Unsupported Mach-O CPU");
    const count = get(16), bytes = get(20);
    check(count <= 65536 && bytes <= MAX_HEADER && bytes <= length - 32, "Invalid Mach-O load commands");
    const commands = range(offset + 32, bytes);
    const u32 = (at) => magic === 0xcffaedfe ? commands.readUInt32LE(at) : commands.readUInt32BE(at);
    const u64 = (at) => Number(magic === 0xcffaedfe ? commands.readBigUInt64LE(at) : commands.readBigUInt64BE(at));
    const extent = (start, span) => check(Number.isSafeInteger(start) && Number.isSafeInteger(span) && start >= 0 && span >= 0 && start + span <= length, "Mach-O physical data extent outside slice");
    let at = 0;
    for (let i = 0; i < count; i++) {
      check(at + 8 <= bytes, "Mach-O command count exceeds size");
      const command = u32(at), size = u32(at + 4);
      check(size >= 8 && size % 8 === 0 && at + size <= bytes, "Invalid Mach-O command size");
      if (command === 0x19) {
        check(size >= 72, "Truncated Mach-O segment command");
        const sections = u32(at + 64);
        check(size === 72 + sections * 80, "Invalid Mach-O section count");
        extent(u64(at + 40), u64(at + 48));
        for (let j = 0; j < sections; j++) {
          const section = at + 72 + j * 80;
          if (![1, 0x0c, 0x12].includes(u32(section + 64) & 0xff)) extent(u32(section + 48), u64(section + 40));
          extent(u32(section + 56), u32(section + 60) * 8);
        }
      } else if ([0x1d, 0x1e, 0x26, 0x29, 0x2b, 0x2e, 0x80000033, 0x80000034, 0x36].includes(command)) {
        check(size === 16, "Invalid Mach-O linkedit command"); extent(u32(at + 8), u32(at + 12));
      } else if (command === 0x2) {
        check(size === 24, "Invalid Mach-O symbol command"); extent(u32(at + 8), u32(at + 12) * 16); extent(u32(at + 16), u32(at + 20));
      } else if (command === 0x22 || command === 0x80000022) {
        check(size === 48, "Invalid Mach-O dyld data command");
        for (let j = 8; j < 48; j += 8) extent(u32(at + j), u32(at + j + 4));
      }
      at += size;
    }
    check(at === bytes, "Mach-O command count/size mismatch");
    return { architecture, subtype: get(8) };
  };
  const magic = range(0, 4).readUInt32BE(0);
  if (magic === 0xcffaedfe || magic === 0xfeedfacf) return [thin(0, size).architecture];
  if ([0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic)) {
    const little = magic === 0xbebafeca || magic === 0xbfbafeca;
    const fat64 = magic === 0xcafebabf || magic === 0xbfbafeca;
    const head = range(0, 8);
    const count = little ? head.readUInt32LE(4) : head.readUInt32BE(4);
    check(count >= 1 && count <= 16, "Invalid fat architecture count");
    const width = fat64 ? 32 : 20;
    const table = range(8, count * width);
    const architectures = [];
    const slices = [];
    for (let i = 0; i < count; i++) {
      const at = i * width;
      const u32 = (n) => little ? table.readUInt32LE(at + n) : table.readUInt32BE(at + n);
      const u64 = (n) => Number(little ? table.readBigUInt64LE(at + n) : table.readBigUInt64BE(at + n));
      const offset = fat64 ? u64(8) : u32(8);
      const length = fat64 ? u64(16) : u32(12);
      const alignment = u32(fat64 ? 24 : 16);
      check(Number.isSafeInteger(length) && length >= 32 && offset >= 8 + table.length && offset + length <= size, "Invalid fat slice range");
      check(alignment <= 52 && offset % (2 ** alignment) === 0 && (!fat64 || u32(28) === 0), "Invalid fat alignment/reserved field");
      check(!slices.some(([start, end]) => offset < end && offset + length > start), "Overlapping fat slices");
      slices.push([offset, offset + length]);
      const { architecture, subtype } = thin(offset, length);
      check(CPU.get(u32(0)) === architecture && u32(4) === subtype && !architectures.includes(architecture), "Fat CPU/subtype mismatch or duplicate");
      architectures.push(architecture);
    }
    return architectures.sort();
  }
  if (magic >>> 16 === 0x4d5a) {
    const dos = range(0, 64);
    const pe = range(dos.readUInt32LE(60), 24);
    check(pe.readUInt32LE(0) === 0x00004550 && pe.readUInt16LE(4) === 0x8664, "Unsupported or malformed PE architecture");
    check(pe.readUInt16LE(6) > 0 && pe.readUInt16LE(6) <= 96 && pe.readUInt16LE(20) >= 112, "Invalid PE header");
    const optional = range(dos.readUInt32LE(60) + 24, pe.readUInt16LE(20));
    check(optional.readUInt16LE(0) === 0x20b, "PE is not x64 PE32+");
    const sections = range(dos.readUInt32LE(60) + 24 + pe.readUInt16LE(20), pe.readUInt16LE(6) * 40);
    for (let i = 0; i < pe.readUInt16LE(6); i++) {
      const bytes = sections.readUInt32LE(i * 40 + 16), offset = sections.readUInt32LE(i * 40 + 20);
      check(bytes === 0 || (offset >= dos.readUInt32LE(60) + 24 + pe.readUInt16LE(20) + sections.length && offset + bytes <= size), "PE raw section outside file");
    }
    return ["x64"];
  }
  throw new Error("Unsupported native format");
}

export function inspectNative(file, includeHeaderDigest = false) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const digest = createHash("sha256");
    const architectures = nativeArchitectures((offset, length) => {
      check(length <= MAX_HEADER, "Header read cap exceeded");
      const b = Buffer.alloc(length);
      const read = fs.readSync(fd, b, 0, length, offset);
      digest.update(`${offset}:${read}:`); digest.update(b.subarray(0, read));
      return b.subarray(0, read);
    }, size);
    return includeHeaderDigest ? { architectures, headerSha256: digest.digest("hex") } : architectures;
  } finally { fs.closeSync(fd); }
}

export function auditNativePackage(root, { platform, requiredArchitectures, requiredPaths }) {
  check(["darwin", "win32"].includes(platform), "Unsupported release platform");
  check(requiredArchitectures.length > 0 && requiredArchitectures.every((a) => ["arm64", "x64"].includes(a)), "Invalid architecture policy");
  check(requiredPaths.length > 0, "Required component inventory missing");
  const base = fs.realpathSync(root);
  const files = new Map();
  const visited = new Set();
  let entries = 0;
  function walk(file) {
    check(++entries <= MAX_ENTRIES, "Package inventory cap exceeded");
    const real = fs.realpathSync(file);
    check(real === base || real.startsWith(base + path.sep), "Component escapes package");
    const stat = fs.statSync(real);
    if (stat.isDirectory()) {
      if (visited.has(real)) return;
      visited.add(real);
      for (const entry of fs.readdirSync(real).sort()) walk(path.join(real, entry));
    } else {
      check(stat.isFile(), "Unsupported package entry");
      const relative = path.relative(base, real).split(path.sep).join("/");
      const fd = fs.openSync(real, "r");
      const prefix = Buffer.alloc(4);
      let prefixBytes;
      try { prefixBytes = fs.readSync(fd, prefix, 0, 4, 0); } finally { fs.closeSync(fd); }
      const magic = prefixBytes === 4 ? prefix.readUInt32BE(0) : 0;
      const nativeMagic = [0xcffaedfe, 0xfeedfacf, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic) || magic >>> 16 === 0x4d5a;
      if (nativeMagic || /\.(node|dylib|dll|exe|so)$/i.test(relative) || relative.includes("/MacOS/") || requiredPaths.includes(relative)) files.set(relative, real);
      if (relative.endsWith(".asar")) {
        // Public ASAR header API only, bounded before it allocates metadata.
        const fd = fs.openSync(real, "r");
        try {
          const h = Buffer.alloc(8);
          check(fs.readSync(fd, h, 0, 8, 0) === 8 && h.readUInt32LE(4) <= MAX_HEADER, "ASAR header cap/truncation");
        } finally { fs.closeSync(fd); }
        const require = createRequire(import.meta.url);
        const builderRequire = createRequire(require.resolve("app-builder-lib"));
        const asar = builderRequire("@electron/asar");
        const { header, headerSize } = asar.getRawHeader(real);
        const archiveSize = fs.statSync(real).size;
        check(Number.isSafeInteger(headerSize) && headerSize <= MAX_HEADER && 8 + headerSize <= archiveSize, "Invalid ASAR header extent");
        const metadata = new Map();
        const links = [];
        const archiveFd = fs.openSync(real, "r");
        try {
          const visit = (node, parent, depth) => {
            check(depth <= 128 && node && typeof node === "object", "Invalid ASAR metadata depth");
            check(node.files && typeof node.files === "object" && !Array.isArray(node.files), "Invalid ASAR directory");
            for (const [part, entry] of Object.entries(node.files)) {
              check(part !== "." && part !== ".." && !/[\\/\0]/.test(part) && part.length > 0, "ASAR path escape");
              const name = parent ? `${parent}/${part}` : part;
              check(metadata.size < MAX_ENTRIES && entry && typeof entry === "object", "ASAR inventory cap/entry invalid");
              metadata.set(name, entry);
              if (entry.files) { visit(entry, name, depth + 1); continue; }
              if (Object.hasOwn(entry, "link")) {
                check(typeof entry.link === "string" && !path.posix.isAbsolute(entry.link) && !/[\\\0]/.test(entry.link) && entry.link.split("/").every((part) => part && part !== "." && part !== ".."), "ASAR link escape");
                links.push(entry.link); continue;
              }
              check(Number.isSafeInteger(entry.size) && entry.size >= 0, "Invalid ASAR file size");
              let nativeMagic = false;
              if (entry.unpacked === true) {
                const unpacked = `${real}.unpacked/${name}`;
                check(fs.existsSync(unpacked) && fs.statSync(unpacked).isFile(), "Unpacked ASAR file missing");
                const unpackedReal = fs.realpathSync(unpacked);
                check(unpackedReal.startsWith(base + path.sep), "Unpacked ASAR path escape");
                check(fs.statSync(unpackedReal).size === entry.size, "Unpacked ASAR size mismatch");
                const prefix = Buffer.alloc(4), fd = fs.openSync(unpackedReal, "r");
                let read;
                try { read = fs.readSync(fd, prefix, 0, Math.min(4, entry.size), 0); } finally { fs.closeSync(fd); }
                const magic = read === 4 ? prefix.readUInt32BE(0) : 0;
                nativeMagic = [0xcffaedfe, 0xfeedfacf, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic) || magic >>> 16 === 0x4d5a;
                if (nativeMagic || /\.(node|dylib|dll|exe|so)$/i.test(name)) files.set(path.relative(base, unpackedReal).split(path.sep).join("/"), unpackedReal);
              } else {
                check(typeof entry.offset === "string" && /^\d+$/.test(entry.offset), "Invalid packed ASAR offset");
                const offset = Number(entry.offset), start = 8 + headerSize + offset;
                check(Number.isSafeInteger(offset) && Number.isSafeInteger(start) && start + entry.size <= archiveSize, "Packed ASAR extent outside archive");
                const prefix = Buffer.alloc(4), bytes = Math.min(4, entry.size);
                check(fs.readSync(archiveFd, prefix, 0, bytes, start) === bytes, "Truncated ASAR prefix");
                const magic = bytes === 4 ? prefix.readUInt32BE(0) : 0;
                nativeMagic = [0xcffaedfe, 0xfeedfacf, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic) || magic >>> 16 === 0x4d5a;
                check(!nativeMagic && entry.executable !== true && !/\.(node|dylib|dll|exe|so)$/i.test(name), "Packed native/executable component cannot be header-audited");
              }
            }
          };
          visit(header, "", 0);
          for (const target of links) {
            const seen = new Set();
            let current = target;
            while (true) {
              check(seen.size < 128 && !seen.has(current) && metadata.has(current), "ASAR link missing/cycle/depth");
              seen.add(current);
              const entry = metadata.get(current);
              if (!Object.hasOwn(entry, "link")) break;
              current = entry.link;
            }
          }
        } finally { fs.closeSync(archiveFd); }
      }
    }
  }
  walk(base);
  for (const name of requiredPaths) {
    check(!path.isAbsolute(name) && !name.split("/").includes(".."), "Invalid required component path");
    check(fs.existsSync(path.join(base, name)), `Missing required component: ${name}`);
    files.set(name, path.join(base, name));
  }
  const components = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, file]) => {
    const { architectures, headerSha256 } = inspectNative(file, true);
    check(requiredArchitectures.every((a) => architectures.includes(a)), `Architecture mismatch: ${name}`);
    return { path: name, architectures, headerSha256, hashScope: "Only native headers read during architecture audit; not complete payload" };
  });
  check(components.length > 0, "Empty native inventory");
  return { schemaVersion: 1, phase: "PRE_SIGNING", platform, requiredArchitectures, components, architectureOnly: true, signaturesVerified: false, notarizationVerified: false, finalSignedArtifactBindingRequired: true };
}
