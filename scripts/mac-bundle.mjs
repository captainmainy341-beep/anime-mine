#!/usr/bin/env node
// Patch a copied Electron.app before it is signed.
//
// Electron's own Info.plist ships CFBundleShortVersionString and
// CFBundleVersion set to the Electron runtime (for example 44.7.0).
// package-mac.sh used to rename the app and set the bundle id, then
// leave those version keys alone, so the installed app reported Electron's
// version. This module writes the app version from package.json and
// rewrites leftover com.github.Electron* bundle ids.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_NAME = 'Anime Mine';
export const BUNDLE_ID = 'ai.animemine.app';

const ELECTRON_ID_PREFIXES = ['com.github.Electron', 'com.github.electron'];

export function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function unescapeXml(value) {
  return String(value).replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
}

export function assertXmlPlist(xml, filePath = 'Info.plist') {
  if (typeof xml !== 'string' || xml.startsWith('bplist') || xml.charCodeAt(0) === 0) {
    throw new Error(`${filePath} is a binary plist. Convert it with plutil -convert xml1, then re-run packaging.`);
  }
  if (!xml.includes('<plist')) {
    throw new Error(`${filePath} is not an XML property list`);
  }
}

export function readStringKey(xml, key) {
  const pattern = new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>([\\s\\S]*?)</string>`);
  const match = xml.match(pattern);
  return match ? unescapeXml(match[1]) : null;
}

export function setStringKey(xml, key, value) {
  if (!/^[A-Za-z0-9]+$/.test(key)) throw new Error(`Unsupported plist key: ${key}`);
  assertXmlPlist(xml, key);
  const safe = escapeXml(value);
  const pattern = new RegExp(`(<key>\\s*${key}\\s*</key>\\s*<string>)[\\s\\S]*?(</string>)`);
  if (pattern.test(xml)) {
    return xml.replace(pattern, (_match, open, close) => `${open}${safe}${close}`);
  }
  const at = xml.lastIndexOf('</dict>');
  if (at < 0) throw new Error(`Info.plist has no dict to update for ${key}`);
  const inserted = `\t<key>${key}</key>\n\t<string>${safe}</string>\n`;
  return `${xml.slice(0, at)}${inserted}${xml.slice(at)}`;
}

// com.github.Electron.helper.GPU -> ai.animemine.app.helper.GPU
// Ids that are already ours, or that belong to another vendor, stay put.
export function rewriteElectronBundleId(current, appId = BUNDLE_ID) {
  if (!current) return current;
  for (const prefix of ELECTRON_ID_PREFIXES) {
    if (current === prefix || current.startsWith(`${prefix}.`)) {
      return appId + current.slice(prefix.length);
    }
  }
  return current;
}

export function loadPackagingConfig(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version || '')) {
    throw new Error(`package.json version "${pkg.version}" must be numeric x.y.z so CFBundleVersion stays valid`);
  }
  return { name: APP_NAME, bundleId: BUNDLE_ID, version: pkg.version };
}

export function productionPackageNames(lock) {
  const root = lock.packages?.[''];
  if (!root) throw new Error('package-lock.json has no root package');
  const queue = [
    ...Object.keys(root.dependencies || {}),
    ...Object.keys(root.optionalDependencies || {}),
  ];
  const seen = new Set();
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const entry = lock.packages[`node_modules/${name}`];
    if (!entry) throw new Error(`package-lock.json is missing node_modules/${name}`);
    for (const dep of Object.keys(entry.dependencies || {})) queue.push(dep);
    for (const dep of Object.keys(entry.optionalDependencies || {})) queue.push(dep);
  }
  return [...seen].sort();
}

async function listInfoPlists(appPath) {
  const found = [];
  async function walk(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name === 'Info.plist') found.push(full);
    }
  }
  await walk(appPath);
  return found;
}

function patchOnePlist(xml, { name, bundleId, version, main }) {
  let next = xml;
  next = setStringKey(next, 'CFBundleShortVersionString', version);
  next = setStringKey(next, 'CFBundleVersion', version);
  if (main) {
    next = setStringKey(next, 'CFBundleName', name);
    next = setStringKey(next, 'CFBundleDisplayName', name);
    next = setStringKey(next, 'CFBundleExecutable', name);
    next = setStringKey(next, 'CFBundleIdentifier', bundleId);
    return next;
  }
  // Helper and framework executables keep their original filenames.
  // Electron looks helpers up as "Electron Helper.app", so only the id
  // and the version strings change here.
  const currentId = readStringKey(next, 'CFBundleIdentifier');
  const rewritten = rewriteElectronBundleId(currentId, bundleId);
  if (currentId && rewritten !== currentId) {
    next = setStringKey(next, 'CFBundleIdentifier', rewritten);
  }
  return next;
}

export async function applyBundleMetadata(appPath, config) {
  const mainPlist = path.join(appPath, 'Contents', 'Info.plist');
  const plists = await listInfoPlists(appPath);
  if (!plists.includes(mainPlist)) {
    throw new Error(`Missing ${mainPlist}. package-mac.sh should start from Electron.app.`);
  }
  for (const plistPath of plists) {
    const xml = await fs.promises.readFile(plistPath, 'utf8');
    assertXmlPlist(xml, plistPath);
    const next = patchOnePlist(xml, { ...config, main: plistPath === mainPlist });
    await fs.promises.writeFile(plistPath, next);
  }
  const executable = readStringKey(await fs.promises.readFile(mainPlist, 'utf8'), 'CFBundleExecutable');
  const binary = path.join(appPath, 'Contents', 'MacOS', executable);
  try {
    await fs.promises.access(binary);
  } catch {
    throw new Error(`CFBundleExecutable is ${executable}, but ${binary} does not exist. Rename the Electron binary before applying metadata.`);
  }
  return { mainPlist, executable, plists };
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  const root = process.cwd();
  if (command === 'list-prod-modules') {
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    process.stdout.write(`${productionPackageNames(lock).join('\n')}\n`);
    return;
  }
  if (command === 'apply') {
    if (!arg) throw new Error('Usage: node scripts/mac-bundle.mjs apply <App.app>');
    const config = loadPackagingConfig(root);
    await applyBundleMetadata(arg, config);
    console.error(`Info.plist ${config.bundleId} ${config.version}`);
    return;
  }
  throw new Error('Usage: node scripts/mac-bundle.mjs <apply <App.app>|list-prod-modules>');
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
