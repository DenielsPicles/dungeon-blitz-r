const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CLASS_NAME = 'a_Room_JCMini2_03';
const DEFAULT_SWF = path.join('src', 'client', 'content', 'localhost', 'p', 'cbp', 'LevelsJC.swf');
const LEGACY_HOLD_MARKER = 'this.am_Boss.bHoldSpawn = true;';

function parseArgs(argv) {
  const args = { swf: DEFAULT_SWF, ffdec: '', verify: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--swf') args.swf = argv[++index] || args.swf;
    else if (arg === '--ffdec' || arg === '-f') args.ffdec = argv[++index] || '';
    else if (arg === '--verify') args.verify = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function repoRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function detectFfdec(root, preferred) {
  const candidates = [
    preferred && path.resolve(root, preferred),
    path.join(root, 'build', 'tools', 'ffdec_25.0.0', 'ffdec-cli.jar'),
    '/Applications/FFDec.app/Contents/Resources/ffdec.sh'
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function runFfdec(ffdec, args) {
  if (ffdec.endsWith('.jar')) execFileSync('java', ['-jar', ffdec, '-cli', ...args], { stdio: 'inherit' });
  else execFileSync(ffdec, ['-cli', ...args], { stdio: 'inherit' });
}

function exportRoom(ffdec, workDir, swf) {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  runFfdec(ffdec, ['-selectclass', CLASS_NAME, '-export', 'script', workDir, swf]);
  const sourcePath = path.join(workDir, 'scripts', `${CLASS_NAME}.as`);
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing FFDec export: ${sourcePath}`);
  return sourcePath;
}

function verifySource(source) {
  const count = source.split(LEGACY_HOLD_MARKER).length - 1;
  if (count !== 0) throw new Error(`East Wing boss cue is still held (${count} marker found)`);
  if (!source.includes('public var am_Boss:ac_TowerGuard2;')) throw new Error('East Wing boss cue type changed');
  if (source.includes('this.removeChild(this.am_Boss)')) throw new Error('Boss cue must be preserved for the server proxy');
}

function patchSource(source) {
  const patched = source.replace(/^\s*this\.am_Boss\.bHoldSpawn = true;\s*$/m, '');
  verifySource(patched);
  return patched;
}

function main() {
  const args = parseArgs(process.argv);
  const root = repoRoot();
  const swf = path.resolve(root, args.swf);
  const ffdec = detectFfdec(root, args.ffdec);
  if (!ffdec) throw new Error('FFDec not found; pass --ffdec <path>');

  const work = path.join(root, 'build', `ffdec-east-wing-server-boss${args.verify ? '-verify' : ''}`);
  let sourcePath = exportRoom(ffdec, work, swf);
  if (args.verify) {
    verifySource(fs.readFileSync(sourcePath, 'utf8'));
    console.log('[EastWingServerBoss] verified boss cue is available as the canonical server proxy');
    return;
  }

  fs.writeFileSync(sourcePath, patchSource(fs.readFileSync(sourcePath, 'utf8')));
  const patchedSwf = path.join(work, 'LevelsJC.patched.swf');
  runFfdec(ffdec, ['-importScript', swf, patchedSwf, path.dirname(sourcePath)]);
  fs.copyFileSync(patchedSwf, swf);
  sourcePath = exportRoom(ffdec, `${work}-roundtrip`, swf);
  verifySource(fs.readFileSync(sourcePath, 'utf8'));
  console.log('[EastWingServerBoss] restored and round-trip verified the visible canonical boss proxy');
}

main();
