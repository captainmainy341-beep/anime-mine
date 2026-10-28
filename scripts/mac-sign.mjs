#!/usr/bin/env node
// Sign Anime Mine.app from the inside out.
//
// `codesign --force --deep -s -` is what the old packager ran after editing
// Electron.app. Apple's --deep walks nested code in an order that seals a
// parent before its children, and on a versioned Electron Framework that
// leaves the bundle with "a sealed resource is missing or invalid".
// --deep is for verification, not for signing. This signs each Mach-O and
// each .app/.framework on its own, deepest first, then checks the seal with
// `codesign --verify --deep --strict`.
//
// Ad-hoc is the default (no Apple certificate). Developer ID and notarization
// run only when CODESIGN_IDENTITY / NOTARIZE are set. See docs/mac-packaging.md.

import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPackagingConfig, readStringKey } from './mac-bundle.mjs';

const MACHO_MAGIC = new Set([
  0xfeedface, // MH_MAGIC
  0xcefaedfe, // MH_CIGAM
  0xfeedfacf, // MH_CIGAM_64 byte-swapped
  0xcffaedfe, // MH_MAGIC_64 as stored on disk (CF FA ED FE)
]);
// FAT_MAGIC collides with Java class files (both start with CAFEBABE).
// A fat Mach-O we ship is executable; a .class file is not.
const FAT_MAGIC = new Set([0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]);
const BUNDLE_EXT = new Set(['.app', '.framework']);

export function isMachO(buffer, { executable = false } = {}) {
  if (!buffer || buffer.length < 4) return false;
  const magic = buffer.readUInt32BE(0);
  if (MACHO_MAGIC.has(magic)) return true;
  if (!FAT_MAGIC.has(magic)) return false;
  return executable;
}

function slash(filePath) {
  return filePath.split(path.sep).join('/');
}

// Signing Foo.app/Contents/MacOS/Foo seals Foo.app, so that executable has
// to come after every other nested code item at the same depth.
export function isBundleMainExecutable(filePath) {
  return /\.app\/Contents\/MacOS\/[^/]+$/.test(slash(filePath));
}

export function signingRank(filePath) {
  const depth = slash(filePath).split('/').length;
  return depth * 2 + (isBundleMainExecutable(filePath) ? 0 : 1);
}

export function sortForSigning(filePaths) {
  return [...filePaths].sort((a, b) => signingRank(b) - signingRank(a));
}

export function codesignArgs({ identity, target, mode, entitlements }) {
  const args = ['--sign', identity, '--force'];
  if (mode === 'developer-id') {
    args.push('--timestamp', '--options', 'runtime');
    if (entitlements) args.push('--entitlements', entitlements);
  } else {
    // Ad-hoc signatures cannot be timestamped. Hardened runtime is a
    // Developer ID / notarization requirement and needs the entitlements
    // below; turning it on for a local ad-hoc build breaks V8.
    args.push('--timestamp=none');
  }
  args.push(target);
  if (args.includes('--deep')) throw new Error('Refusing to sign with --deep');
  return args;
}

export function entitlementsFor(target, entitlementsDir) {
  const normalized = slash(target);
  if (normalized.includes('(Plugin).app')) return path.join(entitlementsDir, 'entitlements.mac.plugin.plist');
  if (normalized.includes('(GPU).app')) return path.join(entitlementsDir, 'entitlements.mac.gpu.plist');
  if (normalized.includes('(Renderer).app')) return path.join(entitlementsDir, 'entitlements.mac.renderer.plist');
  return path.join(entitlementsDir, 'entitlements.mac.plist');
}

export function signingMode(identity) {
  const value = (identity || '-').trim() || '-';
  return { identity: value, mode: value === '-' ? 'adhoc' : 'developer-id' };
}

export function formatCommand(cmd, args) {
  const hidden = new Set();
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--password' && args[i + 1]) hidden.add(i + 1);
  }
  const rendered = args.map((arg, index) => (hidden.has(index) ? '***' : arg)).join(' ');
  return `${cmd} ${rendered}`;
}

export function defaultExec(cmd, args) {
  return new Promise((resolve, reject) => {
    execFileCb(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const failure = new Error(`${formatCommand(cmd, args)} failed: ${stderr || err.message}`);
        failure.cause = err;
        reject(failure);
        return;
      }
      resolve(stdout);
    });
  });
}

async function readMagic(filePath, mode) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8);
    await handle.read(buffer, 0, 8, 0);
    return isMachO(buffer, { executable: (mode & 0o111) !== 0 });
  } finally {
    await handle.close();
  }
}

export async function collectSignPaths(contentsPath) {
  const found = [];
  async function walk(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.name === '_CodeSignature' || entry.name.endsWith('.cstemp')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        if (BUNDLE_EXT.has(path.extname(full))) found.push(full);
      } else if (entry.isFile()) {
        const stat = await fs.promises.stat(full);
        if (await readMagic(full, stat.mode)) found.push(full);
      }
    }
  }
  await walk(contentsPath);
  return found;
}

// A symlink whose target lives outside the .app cannot be sealed.
// Electron's own Versions/Current -> A links stay as links.
export async function materializeEscapingSymlinks(root) {
  const rootReal = await fs.promises.realpath(root);
  const replaced = [];
  async function walk(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let targetReal;
        try {
          targetReal = await fs.promises.realpath(full);
        } catch {
          throw new Error(`Dangling symlink in the app bundle: ${full}`);
        }
        const relative = path.relative(rootReal, targetReal);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          const stat = await fs.promises.stat(full);
          await fs.promises.rm(full);
          if (stat.isDirectory()) {
            await fs.promises.cp(targetReal, full, { recursive: true, dereference: true });
          } else {
            await fs.promises.copyFile(targetReal, full);
          }
          replaced.push(full);
        }
      } else if (entry.isDirectory()) {
        await walk(full);
      }
    }
  }
  await walk(root);
  return replaced;
}

export function notarytoolArgs(zipPath, env) {
  const args = ['notarytool', 'submit', zipPath, '--wait'];
  if (env.APPLE_KEYCHAIN_PROFILE) {
    return [...args, '--keychain-profile', env.APPLE_KEYCHAIN_PROFILE];
  }
  const missing = ['APPLE_ID', 'APPLE_TEAM_ID', 'APPLE_APP_SPECIFIC_PASSWORD'].filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(
      `NOTARIZE=1 needs APPLE_KEYCHAIN_PROFILE (preferred; keeps the app-specific password out of the process list), or ${missing.join(', ')}`,
    );
  }
  return [...args, '--apple-id', env.APPLE_ID, '--team-id', env.APPLE_TEAM_ID, '--password', env.APPLE_APP_SPECIFIC_PASSWORD];
}

export function assertNotarizeReady(env, mode) {
  if (env.NOTARIZE !== '1') return false;
  if (mode !== 'developer-id') {
    throw new Error('NOTARIZE=1 requires CODESIGN_IDENTITY set to a Developer ID Application certificate. Ad-hoc signatures cannot be notarized.');
  }
  notarytoolArgs('app.zip', env);
  return true;
}

async function notarize(appPath, env, execFile) {
  const zipPath = path.join(os.tmpdir(), `animemine-notarize-${process.pid}-${Date.now()}.zip`);
  try {
    await execFile('ditto', ['-c', '-k', '--keepParent', appPath, zipPath]);
    await execFile('xcrun', notarytoolArgs(zipPath, env));
    await execFile('xcrun', ['stapler', 'staple', appPath]);
  } finally {
    await fs.promises.rm(zipPath, { force: true }).catch(() => {});
  }
  return true;
}

export function signatureSummary({ mode, notarized }) {
  if (notarized) return 'Developer ID, notarized and stapled';
  if (mode === 'developer-id') return 'Developer ID (not notarized)';
  return 'ad-hoc (not notarized)';
}

export async function signMacApp(appPath, options = {}) {
  const execFile = options.execFile || defaultExec;
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const entitlementsDir = options.entitlementsDir || path.dirname(fileURLToPath(import.meta.url));
  const { identity, mode } = signingMode(env.CODESIGN_IDENTITY);
  const willNotarize = assertNotarizeReady(env, mode);

  await materializeEscapingSymlinks(appPath);
  if (platform === 'darwin') {
    // Resource forks and Finder info are "detritus" that invalidates a seal.
    await execFile('xattr', ['-cr', appPath]);
  }

  const contentsPath = path.join(appPath, 'Contents');
  const inner = await collectSignPaths(contentsPath);
  const targets = sortForSigning([...inner, appPath]);
  for (const target of targets) {
    const entitlements = mode === 'developer-id' ? entitlementsFor(target, entitlementsDir) : undefined;
    await execFile('codesign', codesignArgs({ identity, target, mode, entitlements }));
  }
  await execFile('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);

  const notarized = willNotarize ? await notarize(appPath, env, execFile) : false;
  return { identity, mode, notarized, targets };
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

async function main() {
  const appPath = process.argv[2];
  if (!appPath) throw new Error('Usage: node scripts/mac-sign.mjs <App.app>');
  const config = loadPackagingConfig(process.cwd());
  const result = await signMacApp(appPath);
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  const xml = await fs.promises.readFile(plistPath, 'utf8');
  const version = readStringKey(xml, 'CFBundleShortVersionString');
  const build = readStringKey(xml, 'CFBundleVersion');
  const bundleId = readStringKey(xml, 'CFBundleIdentifier');
  if (version !== config.version || build !== config.version) {
    throw new Error(`Bundle version is ${version} / ${build}, expected ${config.version} from package.json`);
  }
  if (bundleId !== config.bundleId) {
    throw new Error(`CFBundleIdentifier is ${bundleId}, expected ${config.bundleId}`);
  }
  console.error(`CFBundleIdentifier: ${bundleId}`);
  console.error(`CFBundleShortVersionString: ${version}`);
  console.error(`CFBundleVersion: ${build}`);
  console.error(`Signature: ${signatureSummary(result)}`);
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
