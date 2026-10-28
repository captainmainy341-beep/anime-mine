import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  APP_NAME,
  BUNDLE_ID,
  applyBundleMetadata,
  assertXmlPlist,
  loadPackagingConfig,
  productionPackageNames,
  readStringKey,
  rewriteElectronBundleId,
  setStringKey,
} from '../scripts/mac-bundle.mjs';
import {
  codesignArgs,
  collectSignPaths,
  formatCommand,
  isMachO,
  materializeEscapingSymlinks,
  notarytoolArgs,
  signMacApp,
  signatureSummary,
  sortForSigning,
} from '../scripts/mac-sign.mjs';

const ELECTRON_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDisplayName</key>
	<string>Electron</string>
	<key>CFBundleExecutable</key>
	<string>Electron</string>
	<key>CFBundleIconFile</key>
	<string>electron.icns</string>
	<key>CFBundleIdentifier</key>
	<string>com.github.Electron</string>
	<key>CFBundleName</key>
	<string>Electron</string>
	<key>CFBundleShortVersionString</key>
	<string>44.7.0</string>
	<key>CFBundleVersion</key>
	<string>44.7.0</string>
</dict>
</plist>
`;

function helperPlist(id) {
  return ELECTRON_PLIST
    .replace('<string>Electron</string>\n\t<key>CFBundleIconFile</key>', `<string>Electron Helper</string>\n\t<key>CFBundleIconFile</key>`)
    .replace('<string>com.github.Electron</string>', `<string>${id}</string>`)
    .replace('<string>Electron</string>\n\t<key>CFBundleShortVersionString</key>', '<string>Electron Helper</string>\n\t<key>CFBundleShortVersionString</key>');
}

function writeMachO(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(0xcffaedfe, 0);
  fs.writeFileSync(file, buffer);
  fs.chmodSync(file, 0o755);
}

test('plist version and bundle id replace Electron defaults', () => {
  let xml = setStringKey(ELECTRON_PLIST, 'CFBundleShortVersionString', '0.1.0');
  xml = setStringKey(xml, 'CFBundleVersion', '0.1.0');
  xml = setStringKey(xml, 'CFBundleIdentifier', BUNDLE_ID);
  xml = setStringKey(xml, 'CFBundleName', APP_NAME);
  xml = setStringKey(xml, 'CFBundleExecutable', APP_NAME);
  assert.equal(readStringKey(xml, 'CFBundleShortVersionString'), '0.1.0');
  assert.equal(readStringKey(xml, 'CFBundleVersion'), '0.1.0');
  assert.equal(readStringKey(xml, 'CFBundleIdentifier'), BUNDLE_ID);
  assert.equal(readStringKey(xml, 'CFBundleExecutable'), APP_NAME);
  assert.equal(readStringKey(xml, 'CFBundleIconFile'), 'electron.icns');
  assert.equal(xml.match(/CFBundleShortVersionString/g).length, 1);
});

test('a missing plist key is inserted once', () => {
  const bare = ELECTRON_PLIST.replace(/\t<key>CFBundleDisplayName<\/key>\n\t<string>Electron<\/string>\n/, '');
  const xml = setStringKey(bare, 'CFBundleDisplayName', 'Anime Mine');
  assert.equal(readStringKey(xml, 'CFBundleDisplayName'), 'Anime Mine');
  assert.equal(xml.match(/CFBundleDisplayName/g).length, 1);
});

test('binary plists are refused', () => {
  assert.throws(() => assertXmlPlist('bplist00....', 'Info.plist'), /binary plist/);
});

test('Electron helper bundle ids keep their suffix', () => {
  assert.equal(rewriteElectronBundleId('com.github.Electron'), BUNDLE_ID);
  assert.equal(rewriteElectronBundleId('com.github.Electron.helper'), `${BUNDLE_ID}.helper`);
  assert.equal(rewriteElectronBundleId('com.github.Electron.helper.GPU'), `${BUNDLE_ID}.helper.GPU`);
  assert.equal(rewriteElectronBundleId('com.github.Electron.helper.Renderer'), `${BUNDLE_ID}.helper.Renderer`);
  assert.equal(rewriteElectronBundleId(`${BUNDLE_ID}.helper`), `${BUNDLE_ID}.helper`);
  assert.equal(rewriteElectronBundleId('com.github.Squirrel'), 'com.github.Squirrel');
});

test('applied bundle reports package.json version on the main app and helpers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'animemine-plist-'));
  const app = path.join(root, 'Anime Mine.app');
  const mainPlist = path.join(app, 'Contents', 'Info.plist');
  const helperPlistPath = path.join(app, 'Contents', 'Frameworks', 'Electron Helper (GPU).app', 'Contents', 'Info.plist');
  const frameworkPlist = path.join(app, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Resources', 'Info.plist');
  fs.mkdirSync(path.dirname(mainPlist), { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', APP_NAME), '');
  fs.mkdirSync(path.dirname(helperPlistPath), { recursive: true });
  fs.mkdirSync(path.dirname(frameworkPlist), { recursive: true });
  fs.writeFileSync(mainPlist, ELECTRON_PLIST);
  fs.writeFileSync(helperPlistPath, helperPlist('com.github.Electron.helper.GPU'));
  fs.writeFileSync(frameworkPlist, ELECTRON_PLIST.replace('com.github.Electron', 'com.github.Electron.framework'));
  // Versions/Current is a symlink. The real plist under Versions/A must be the one we edit.
  fs.symlinkSync('A', path.join(app, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'Current'));

  const config = loadPackagingConfig(process.cwd());
  assert.equal(config.version, '0.1.0');
  await applyBundleMetadata(app, config);

  const main = fs.readFileSync(mainPlist, 'utf8');
  assert.equal(readStringKey(main, 'CFBundleShortVersionString'), '0.1.0');
  assert.equal(readStringKey(main, 'CFBundleVersion'), '0.1.0');
  assert.equal(readStringKey(main, 'CFBundleIdentifier'), BUNDLE_ID);
  assert.equal(readStringKey(main, 'CFBundleExecutable'), APP_NAME);

  const helper = fs.readFileSync(helperPlistPath, 'utf8');
  assert.equal(readStringKey(helper, 'CFBundleShortVersionString'), '0.1.0');
  assert.equal(readStringKey(helper, 'CFBundleIdentifier'), `${BUNDLE_ID}.helper.GPU`);
  assert.equal(readStringKey(helper, 'CFBundleExecutable'), 'Electron Helper');

  const framework = fs.readFileSync(frameworkPlist, 'utf8');
  assert.equal(readStringKey(framework, 'CFBundleVersion'), '0.1.0');
  assert.equal(readStringKey(framework, 'CFBundleIdentifier'), `${BUNDLE_ID}.framework`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('packaged modules are the production tree, not Electron or undici', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8'));
  const names = productionPackageNames(lock);
  assert.ok(names.includes('fflate'));
  assert.ok(names.includes('kuromoji'));
  assert.ok(names.includes('ffmpeg-static'));
  assert.ok(names.includes('lodash'));
  assert.equal(names.includes('electron'), false);
  assert.equal(names.includes('undici'), false);
  assert.equal(names.includes('@electron/get'), false);
});

test('Mach-O magic is recognized and Java class files are not', () => {
  const macho = Buffer.alloc(8);
  macho.writeUInt32BE(0xcffaedfe, 0);
  assert.equal(isMachO(macho), true);
  const java = Buffer.alloc(8);
  java.writeUInt32BE(0xcafebabe, 0);
  assert.equal(isMachO(java, { executable: false }), false);
  assert.equal(isMachO(java, { executable: true }), true);
  assert.equal(isMachO(Buffer.from('not a binary')), false);
});

test('ad-hoc signing walks inside out, never with --deep, and does not notarize', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'animemine-sign-'));
  const outside = path.join(root, 'outside.bin');
  fs.writeFileSync(outside, 'ffmpeg-bytes');
  const app = path.join(root, 'Demo.app');
  const contents = path.join(app, 'Contents');
  writeMachO(path.join(contents, 'MacOS', 'Demo'));
  writeMachO(path.join(contents, 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework'));
  writeMachO(path.join(contents, 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Libraries', 'libffmpeg.dylib'));
  fs.mkdirSync(path.join(contents, 'Frameworks', 'Electron Framework.framework', 'Versions'), { recursive: true });
  fs.symlinkSync('A', path.join(contents, 'Frameworks', 'Electron Framework.framework', 'Versions', 'Current'));
  writeMachO(path.join(contents, 'Frameworks', 'Electron Helper.app', 'Contents', 'MacOS', 'Electron Helper'));
  writeMachO(path.join(contents, 'Frameworks', 'Electron Helper (Plugin).app', 'Contents', 'MacOS', 'Electron Helper (Plugin)'));
  const linked = path.join(contents, 'Resources', 'app', 'node_modules', 'ffmpeg-static', 'ffmpeg');
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.symlinkSync(outside, linked);
  const script = path.join(contents, 'Resources', 'app', 'src', 'main', 'main.js');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, 'console.log(1)\n');
  fs.mkdirSync(path.join(contents, 'Info.plist').split(path.sep).slice(0, -1).join(path.sep), { recursive: true });
  fs.writeFileSync(path.join(contents, 'Info.plist'), '<plist></plist>');

  const calls = [];
  const result = await signMacApp(app, {
    platform: 'linux',
    env: {},
    execFile: async (cmd, args) => {
      calls.push([cmd, args]);
    },
  });

  assert.equal(fs.readFileSync(linked, 'utf8'), 'ffmpeg-bytes');
  assert.equal(fs.lstatSync(linked).isSymbolicLink(), false);
  assert.equal(result.mode, 'adhoc');
  assert.equal(result.notarized, false);
  assert.equal(signatureSummary(result), 'ad-hoc (not notarized)');

  const signed = calls.filter(([cmd, args]) => cmd === 'codesign' && !args.includes('--verify'));
  const verified = calls.filter(([, args]) => args.includes('--verify'));
  assert.equal(verified.length, 1);
  assert.deepEqual(verified[0][1], ['--verify', '--deep', '--strict', '--verbose=2', app]);
  assert.equal(calls.some(([cmd]) => cmd === 'xcrun'), false);

  const targets = signed.map(([, args]) => args.at(-1));
  assert.equal(targets.at(-1), app);
  assert.equal(targets.some((target) => target.includes(`${path.sep}Current`)), false);
  assert.equal(targets.some((target) => target.endsWith('main.js')), false);
  const at = (suffix) => targets.findIndex((target) => target.endsWith(suffix));
  assert.ok(at(`${path.sep}libffmpeg.dylib`) < at('Electron Framework.framework'));
  assert.ok(at(`${path.sep}Electron Helper`) < at('Electron Helper.app'));
  assert.ok(at('Electron Helper.app') < at(`${path.sep}Demo`));
  assert.ok(at(`${path.sep}Demo`) < targets.length - 1);

  for (const [, args] of signed) {
    assert.equal(args.includes('--deep'), false);
    assert.equal(args.includes('--force'), true);
    assert.equal(args.includes('--timestamp=none'), true);
    assert.equal(args.includes('--options'), false);
    assert.equal(args[1], '-');
  }
  const plugin = signed.find(([, args]) => args.at(-1).includes('(Plugin).app'));
  assert.ok(plugin);
  assert.equal(plugin[1].includes('--entitlements'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Developer ID signing uses hardened runtime, helper entitlements, and notarizes only when asked', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'animemine-devid-'));
  const app = path.join(root, 'Demo.app');
  writeMachO(path.join(app, 'Contents', 'MacOS', 'Demo'));
  writeMachO(path.join(app, 'Contents', 'Frameworks', 'Electron Helper (Plugin).app', 'Contents', 'MacOS', 'Electron Helper'));
  writeMachO(path.join(app, 'Contents', 'Frameworks', 'Electron Helper (GPU).app', 'Contents', 'MacOS', 'Electron Helper'));
  writeMachO(path.join(app, 'Contents', 'Frameworks', 'Electron Helper (Renderer).app', 'Contents', 'MacOS', 'Electron Helper'));

  const calls = [];
  const execFile = async (cmd, args) => {
    calls.push([cmd, args]);
  };
  const identity = 'Developer ID Application: Example (TEAMID)';
  const unsigned = await signMacApp(app, {
    platform: 'linux',
    env: { CODESIGN_IDENTITY: identity },
    entitlementsDir: path.join(process.cwd(), 'scripts'),
    execFile,
  });
  assert.equal(unsigned.notarized, false);
  assert.equal(signatureSummary(unsigned), 'Developer ID (not notarized)');
  assert.equal(calls.some(([cmd]) => cmd === 'xcrun'), false);

  const pluginCall = calls.find(([, args]) => String(args.at(-1)).includes('(Plugin).app') && !args.includes('--verify'));
  const gpuCall = calls.find(([, args]) => String(args.at(-1)).includes('(GPU).app') && !args.includes('--verify'));
  const rendererCall = calls.find(([, args]) => String(args.at(-1)).includes('(Renderer).app') && !args.includes('--verify'));
  const appCall = calls.find(([, args]) => args.at(-1) === app);
  assert.equal(pluginCall[1].at(-2), path.join(process.cwd(), 'scripts', 'entitlements.mac.plugin.plist'));
  assert.equal(gpuCall[1].at(-2), path.join(process.cwd(), 'scripts', 'entitlements.mac.gpu.plist'));
  assert.equal(rendererCall[1].at(-2), path.join(process.cwd(), 'scripts', 'entitlements.mac.renderer.plist'));
  assert.equal(appCall[1].at(-2), path.join(process.cwd(), 'scripts', 'entitlements.mac.plist'));
  for (const [, args] of [pluginCall, gpuCall, rendererCall, appCall]) {
    assert.equal(args.includes('--deep'), false);
    assert.ok(args.includes('--timestamp'));
    assert.equal(args.includes('--timestamp=none'), false);
    assert.equal(args[args.indexOf('--options') + 1], 'runtime');
    assert.equal(args[1], identity);
  }

  await assert.rejects(
    () => signMacApp(app, { platform: 'linux', env: { NOTARIZE: '1' }, execFile }),
    /Ad-hoc signatures cannot be notarized/,
  );

  calls.length = 0;
  const env = {
    CODESIGN_IDENTITY: identity,
    NOTARIZE: '1',
    APPLE_KEYCHAIN_PROFILE: 'animemine-notary',
  };
  const notarized = await signMacApp(app, { platform: 'linux', env, execFile });
  assert.equal(notarized.notarized, true);
  assert.equal(signatureSummary(notarized), 'Developer ID, notarized and stapled');
  const submitted = calls.find(([cmd, args]) => cmd === 'xcrun' && args[0] === 'notarytool');
  const stapled = calls.find(([cmd, args]) => cmd === 'xcrun' && args[0] === 'stapler');
  assert.ok(submitted[1].includes('--keychain-profile'));
  assert.equal(submitted[1].includes('--password'), false);
  assert.deepEqual(stapled[1].slice(0, 2), ['stapler', 'staple']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('notarytool password form redacts the password and names missing variables', () => {
  const args = notarytoolArgs('app.zip', {
    APPLE_ID: 'dev@example.com',
    APPLE_TEAM_ID: 'TEAMID',
    APPLE_APP_SPECIFIC_PASSWORD: 'secret-value',
  });
  assert.ok(args.includes('--password'));
  assert.equal(args.at(-1), 'secret-value');
  const rendered = formatCommand('xcrun', args);
  assert.match(rendered, /--password \*\*\*/);
  assert.doesNotMatch(rendered, /secret-value/);
  assert.throws(() => notarytoolArgs('app.zip', { APPLE_ID: 'dev@example.com' }), /APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD/);
});

test('codesign arguments for ad-hoc do not include --deep', () => {
  const args = codesignArgs({ identity: '-', target: '/tmp/Demo.app', mode: 'adhoc' });
  assert.deepEqual(args, ['--sign', '-', '--force', '--timestamp=none', '/tmp/Demo.app']);
  const ordered = sortForSigning([
    '/App.app/Contents/MacOS/App',
    '/App.app/Contents/Frameworks/Helper.app',
    '/App.app',
  ]);
  assert.deepEqual(ordered, [
    '/App.app/Contents/Frameworks/Helper.app',
    '/App.app/Contents/MacOS/App',
    '/App.app',
  ]);
});

test('dangling symlinks fail before signing, internal framework links stay', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'animemine-link-'));
  const app = path.join(root, 'Demo.app');
  const link = path.join(app, 'Contents', 'Resources', 'missing');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(path.join(root, 'nope'), link);
  await assert.rejects(() => materializeEscapingSymlinks(app), /Dangling symlink/);

  const ok = fs.mkdtempSync(path.join(os.tmpdir(), 'animemine-internal-'));
  const current = path.join(ok, 'Demo.app', 'Contents', 'Frameworks', 'F.framework', 'Versions', 'Current');
  fs.mkdirSync(path.dirname(current), { recursive: true });
  fs.mkdirSync(path.join(path.dirname(current), 'A'), { recursive: true });
  fs.symlinkSync('A', current);
  const replaced = await materializeEscapingSymlinks(path.join(ok, 'Demo.app'));
  assert.deepEqual(replaced, []);
  assert.equal(fs.lstatSync(current).isSymbolicLink(), true);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(ok, { recursive: true, force: true });
});

test('collectSignPaths ignores unsigned text and symlink aliases', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'animemine-walk-'));
  const base = path.join(root, 'Demo.app', 'Contents');
  writeMachO(path.join(base, 'MacOS', 'Demo'));
  fs.mkdirSync(path.join(base, 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(base, 'Resources', 'readme.txt'), 'hello');
  const paths = await collectSignPaths(base);
  assert.deepEqual(paths, [path.join(base, 'MacOS', 'Demo')]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('package-mac.sh delegates sealing and keeps Developer ID hooks', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'package-mac.sh'), 'utf8');
  assert.match(source, /node scripts\/mac-bundle\.mjs apply/);
  assert.match(source, /node scripts\/mac-sign\.mjs/);
  assert.match(source, /CODESIGN_IDENTITY/);
  assert.match(source, /NOTARIZE=1/);
  assert.match(source, /list-prod-modules/);
  assert.doesNotMatch(source, /mapfile/);
  const code = source.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(code, /codesign/);
  assert.doesNotMatch(code, /--deep/);
});

function versionLess(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

test('lockfile keeps a patched Electron 44 and patched undici 7', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const electron = lock.packages['node_modules/electron'].version;
  const undici = lock.packages['node_modules/undici'].version;
  assert.equal(versionLess(electron, '44.9.1'), false);
  assert.equal(versionLess(electron, '45.0.0'), true);
  assert.equal(versionLess(undici, '7.30.1'), false);
  assert.equal(versionLess(undici, '8.0.0'), true);
  assert.equal(pkg.overrides['@electron/get'].undici, '7.30.1');
});
