#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_SWF = path.join('src', 'client', 'content', 'localhost', 'p', 'cbp', 'LevelsNR.swf');
const CLASS_NAMES = [
  'a_Cue',
  'a_Room_Tutorial_01',
  'a_Room_Tutorial_02',
  'a_Room_Tutorial_04',
  'a_Room_Tutorial_05_ALT',
  'a_Room_NRIMR05_ALT',
  'a_Room_NRIMR06',
  'a_Room_NRIMR03',
  'a_Room_NRM02RGoblinCaveBoss'
];

function parseArgs(argv) {
  const args = { swf: DEFAULT_SWF, ffdec: '', verify: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--swf' || argv[i] === '--swf-path') args.swf = argv[++i] || args.swf;
    else if (argv[i] === '--ffdec' || argv[i] === '-f') args.ffdec = argv[++i] || '';
    else if (argv[i] === '--verify' || argv[i] === '--dry-run') args.verify = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node patch-levelsnr-goblinkidnappers-server-authority.js [--verify] [--swf <path>] [--ffdec <path>]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function rootDir() { return path.resolve(__dirname, '..', '..', '..'); }
function resolveFrom(root, value) { return path.isAbsolute(value) ? value : path.join(root, value); }
function detectFfdec(root, preferred) {
  const candidates = [
    preferred ? resolveFrom(root, preferred) : '',
    'C:\\Program Files (x86)\\FFDec\\ffdec-cli.exe',
    'C:\\Program Files\\FFDec\\ffdec-cli.exe',
    path.join(root, 'build', 'tools', 'ffdec_25.1.3', 'ffdec.jar')
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}
function runFfdec(ffdec, args) {
  if (ffdec.toLowerCase().endsWith('.jar')) execFileSync('java', ['-jar', ffdec, '-cli', ...args], { stdio: 'inherit' });
  else execFileSync(ffdec, ['-cli', ...args], { stdio: 'inherit' });
}

function findMethodRange(source, methodName) {
  const marker = `public function ${methodName}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing method ${methodName}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1, closingBrace: i };
    }
  }
  throw new Error(`Unterminated method ${methodName}`);
}

function replaceMethod(source, methodName, replacement) {
  const range = findMethodRange(source, methodName);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const normalizedReplacement = replacement.replace(/\r?\n/g, newline);
  return `${source.slice(0, range.start)}${normalizedReplacement}${source.slice(range.end)}`;
}

function injectBeforeMethodEnd(source, methodName, uniqueMarker, block) {
  const range = findMethodRange(source, methodName);
  const method = source.slice(range.start, range.end).replace(/\r\n/g, '\n');
  const canonicalBlock = block
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  if (!canonicalBlock.includes(uniqueMarker)) {
    throw new Error(`${methodName} canonical block missing marker ${uniqueMarker}`);
  }
  let cleanedMethod = method;
  while (cleanedMethod.includes(canonicalBlock)) {
    cleanedMethod = cleanedMethod.replace(canonicalBlock, '');
  }
  const closingBrace = cleanedMethod.lastIndexOf('}');
  if (closingBrace < 0) throw new Error(`Missing closing brace for ${methodName}`);
  const patchedMethod = `${cleanedMethod.slice(0, closingBrace)}${canonicalBlock}\n      ${cleanedMethod.slice(closingBrace)}`;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return `${source.slice(0, range.start)}${patchedMethod.replace(/\n/g, newline)}${source.slice(range.end)}`;
}

function patchCue(source) {
  source = replaceMethod(source, 'Spawn', `public function Spawn() : void
      {
         if(LinkUpdater.GoblinKidnappersShouldSuppressCue(this,this.room))
         {
            this.bSpawned = false;
            return;
         }
         if(this.room)
         {
            this.room.CueHookSpawn(this);
         }
      }`);
  source = replaceMethod(source, 'Kill', `public function Kill() : void
      {
         if(LinkUpdater.GoblinKidnappersShouldSuppressCue(this,this.room))
         {
            return;
         }
         if(this.room)
         {
            this.room.CueHookKill(this);
         }
      }`);
  return source;
}

function patchTutorial01(source) {
  source = replaceMethod(source, 'ServerAuthorityVisualCueDefeated', `public function ServerAuthorityVisualCueDefeated(param1:a_Cue) : Boolean
      {
         return LinkUpdater.GoblinKidnappersEntityCompleted(3268190) || Boolean(param1) && (param1.Defeated() || param1.Health() <= 0);
      }`);
  source = injectBeforeMethodEnd(source, 'InitRoom', 'if(LinkUpdater.GoblinKidnappersEntityCompleted(3268190))', `
         // GoblinKidnappersSnapshotInitRoom1
         if(LinkUpdater.GoblinKidnappersEntityCompleted(3268190))
         {
            this.bTriggerTripped = true;
            param1.initialPhase = this.ExitingRoom;
            param1.Animate("am_ChainsTut","Remove",true);
            param1.Animate("am_ChainGlow","Remove",true);
            param1.CollisionOff("am_DynamicCollision_WaitingForHelp");
         }`);
  return injectBeforeMethodEnd(source, 'InitRoom', 'if(LinkUpdater.GoblinKidnappersRoomCompleted(this))', `
         if(LinkUpdater.GoblinKidnappersRoomCompleted(this))
         {
            param1.initialPhase = null;
         }`);
}

function patchTutorial02(source) {
  source = replaceMethod(source, 'ServerAuthorityVisualDummyDefeated', `public function ServerAuthorityVisualDummyDefeated(param1:a_Cue) : Boolean
      {
         if(param1 == this.am_Dummy1 && LinkUpdater.GoblinKidnappersEntityCompleted(4841054)) return true;
         if(param1 == this.am_Dummy2 && LinkUpdater.GoblinKidnappersEntityCompleted(4906590)) return true;
         if(param1 == this.am_Dummy3 && LinkUpdater.GoblinKidnappersEntityCompleted(4972126)) return true;
         return Boolean(param1) && param1.bSpawned && (param1.Defeated() || param1.Health() <= 0);
      }`);
  return injectBeforeMethodEnd(source, 'InitRoom', 'if(LinkUpdater.GoblinKidnappersEntityCompleted(4841054))', `
         // GoblinKidnappersSnapshotInitRoom2
         if(LinkUpdater.GoblinKidnappersEntityCompleted(4841054))
         {
            this.bDummyOneDead = true;
            this.bDummyOneHandled = true;
            param1.initialPhase = this.FirstPowerTick;
         }
         if(LinkUpdater.GoblinKidnappersEntityCompleted(4906590))
         {
            this.bDummyTwoHandled = true;
            param1.initialPhase = this.SecondPowerTick;
         }
         if(LinkUpdater.GoblinKidnappersEntityCompleted(4972126))
         {
            this.bDummyThreeHandled = true;
            param1.initialPhase = null;
            param1.CollisionOff("am_DynamicCollision_GateBlock");
            param1.Animate("am_Gate","Open",true);
         }`);
}

function patchTutorial04(source) {
  source = injectBeforeMethodEnd(source, 'CompleteDroppingTutorial', 'GoblinKidnappersRequestObjective("traversal",4)', `
         LinkUpdater.GoblinKidnappersRequestObjective("traversal",4);`);
  return injectBeforeMethodEnd(source, 'InitRoom', 'if(LinkUpdater.GoblinKidnappersObjectiveCompleted("cutscene:traversal"))', `
         // GoblinKidnappersSnapshotInitRoom4
         if(LinkUpdater.GoblinKidnappersObjectiveCompleted("cutscene:traversal"))
         {
            this.jumpPhaseState = "COMPLETE_JUMPING";
            this.dropPhaseState = "COMPLETE_DROPPING";
            this.jumpCompleted = true;
            this.dropCompleted = true;
            param1.initialPhase = null;
            param1.Animate("am_JumpTut","Remove",true);
            param1.Animate("am_DoorTut","Remove",true);
         }`);
}

function patchTutorial05(source) {
  source = replaceMethod(source, 'ServerAuthorityVisualChestOpened', `public function ServerAuthorityVisualChestOpened(param1:a_Cue) : Boolean
      {
         return LinkUpdater.GoblinKidnappersEntityCompleted(4709982) || Boolean(param1) && (param1.Defeated() || param1.Health() <= 0);
      }`);
  source = injectBeforeMethodEnd(source, 'InitRoom', 'if(LinkUpdater.GoblinKidnappersEntityCompleted(4709982))', `
         // GoblinKidnappersSnapshotInitRoom5
         if(LinkUpdater.GoblinKidnappersEntityCompleted(4709982))
         {
            this.bChestOpened = true;
            param1.initialPhase = this.ChestRoomTick;
            param1.CollisionOff("am_DynamicCollision_PathBlock02");
         }`);
  return injectBeforeMethodEnd(source, 'InitRoom', 'if(LinkUpdater.GoblinKidnappersRoomCompleted(this))', `
         if(LinkUpdater.GoblinKidnappersRoomCompleted(this))
         {
            param1.initialPhase = null;
         }`);
}

function patchTrapRoom(source) {
  return injectBeforeMethodEnd(source, 'InitRoom', 'if(LinkUpdater.GoblinKidnappersEntityCompleted(2612830))', `
         // GoblinKidnappersSnapshotInitRoom6
         if(LinkUpdater.GoblinKidnappersEntityCompleted(2612830))
         {
            this.bTrapSequenceStarted = true;
            param1.CollisionOff("am_DynamicCollision_TrapWall");
            if(LinkUpdater.GoblinKidnappersRoomCompleted(this))
            {
               this.bPhageAlive = false;
               param1.initialPhase = null;
               this.am_TrapEnt.Remove();
               param1.Animate("am_Claw1","Open",true);
               param1.Animate("am_Claw2","Open",true);
               param1.Animate("am_Claw3","Open",true);
               param1.Animate("am_Claw4","Open",true);
               param1.Animate("am_Gate","Open",true);
               param1.CollisionOff("am_DynamicCollision_Gate");
            }
         }`);
}

function patchCheerRoom(source) {
  if (!source.includes('GoblinKidnappersRequestObjective("cheer_gate",9)')) {
    const range = findMethodRange(source, 'WaitingOnEmoteTick');
    const method = source.slice(range.start, range.end);
    const needle = '            param1.SetPhase(null);';
    if (!method.includes(needle)) throw new Error('Missing cheer completion gate sequence');
    const patchedMethod = method.replace(
      needle,
      '            LinkUpdater.GoblinKidnappersRequestObjective("cheer_gate",9);\n            param1.SetPhase(null);'
    );
    source = `${source.slice(0, range.start)}${patchedMethod}${source.slice(range.end)}`;
  }
  return injectBeforeMethodEnd(source, 'InitRoom', 'if(LinkUpdater.GoblinKidnappersObjectiveCompleted("cutscene:cheer_gate"))', `
         // GoblinKidnappersSnapshotInitCheerRoom
         if(LinkUpdater.GoblinKidnappersObjectiveCompleted("cutscene:cheer_gate"))
         {
            this.bGoblinPromptStarted = true;
            this.bEmoteTutorialShown = true;
            this.bOpenDoorScriptStarted = true;
            param1.initialPhase = null;
            param1.CollisionOff("am_DynamicCollision_PathBlock01");
            param1.CollisionOff("am_DynamicCollision_PathBlock02");
            param1.Animate("am_Gate","Open",true);
         }`);
}

function patchBossRoom(source) {
  source = replaceMethod(source, 'ServerAuthorityVisualBossAtHealth', `public function ServerAuthorityVisualBossAtHealth(param1:a_Cue, param2:Number) : Boolean
      {
         if(LinkUpdater.goblinKidnappersSnapshotReady)
         {
            return LinkUpdater.GoblinKidnappersConsumeBossWave(param2);
         }
         return Boolean(param1) && param1.AtHealth(param2);
      }`);
  source = replaceMethod(source, 'ServerAuthorityVisualCueDefeated', `public function ServerAuthorityVisualCueDefeated(param1:a_Cue) : Boolean
      {
         if(param1 == this.am_Boss && LinkUpdater.GoblinKidnappersEntityCompleted(3923550)) return true;
         if(param1 == this.am_Chains && LinkUpdater.GoblinKidnappersEntityCompleted(4054622)) return true;
         return Boolean(param1) && (param1.Defeated() || param1.Health() <= 0);
      }`);
  source = injectBeforeMethodEnd(source, 'InitRoom', 'if(LinkUpdater.GoblinKidnappersEntityCompleted(3923550))', `
         // GoblinKidnappersSnapshotInitBossRoom
         if(LinkUpdater.GoblinKidnappersEntityCompleted(3923550))
         {
            param1.bossFightPhase = this.AfterBossTick;
         }
         if(LinkUpdater.GoblinKidnappersEntityCompleted(4054622))
         {
            this.bChainsBroken = true;
            this.am_Anna.SetAnimation("Sexy");
         }`);
  return injectBeforeMethodEnd(source, 'InitRoom', 'if(LinkUpdater.GoblinKidnappersEntityCompleted(3923550) && LinkUpdater.GoblinKidnappersEntityCompleted(4054622))', `
         if(LinkUpdater.GoblinKidnappersEntityCompleted(3923550) && LinkUpdater.GoblinKidnappersEntityCompleted(4054622))
         {
            param1.bossFightPhase = null;
         }`);
}

const PATCHERS = new Map([
  ['a_Cue', patchCue],
  ['a_Room_Tutorial_01', patchTutorial01],
  ['a_Room_Tutorial_02', patchTutorial02],
  ['a_Room_Tutorial_04', patchTutorial04],
  ['a_Room_Tutorial_05_ALT', patchTutorial05],
  ['a_Room_NRIMR05_ALT', patchTrapRoom],
  ['a_Room_NRIMR06', (source) => source],
  ['a_Room_NRIMR03', patchCheerRoom],
  ['a_Room_NRM02RGoblinCaveBoss', patchBossRoom]
]);

const VERIFY_MARKERS = new Map([
  ['a_Cue', ['LinkUpdater.GoblinKidnappersShouldSuppressCue(this,this.room)']],
  ['a_Room_Tutorial_01', ['GoblinKidnappersEntityCompleted(3268190)', 'GoblinKidnappersRoomCompleted(this)']],
  ['a_Room_Tutorial_02', ['GoblinKidnappersEntityCompleted(4841054)', 'GoblinKidnappersEntityCompleted(4972126)']],
  ['a_Room_Tutorial_04', ['GoblinKidnappersObjectiveCompleted("cutscene:traversal")', 'GoblinKidnappersRequestObjective("traversal",4)']],
  ['a_Room_Tutorial_05_ALT', ['GoblinKidnappersEntityCompleted(4709982)', 'GoblinKidnappersRoomCompleted(this)']],
  ['a_Room_NRIMR05_ALT', ['GoblinKidnappersEntityCompleted(2612830)', 'GoblinKidnappersRoomCompleted(this)']],
  ['a_Room_NRIMR06', ['public var __id453_:ac_TreasureChestEmpty;']],
  ['a_Room_NRIMR03', ['GoblinKidnappersObjectiveCompleted("cutscene:cheer_gate")', 'GoblinKidnappersRequestObjective("cheer_gate",9)']],
  ['a_Room_NRM02RGoblinCaveBoss', ['GoblinKidnappersEntityCompleted(3923550)', 'GoblinKidnappersConsumeBossWave(param2)', 'param1.bossFightPhase = null;']]
]);

const UNIQUE_MARKERS = new Map([
  ['a_Room_Tutorial_01', [
    'if(LinkUpdater.GoblinKidnappersEntityCompleted(3268190))',
    'if(LinkUpdater.GoblinKidnappersRoomCompleted(this))'
  ]],
  ['a_Room_Tutorial_02', [
    'if(LinkUpdater.GoblinKidnappersEntityCompleted(4841054))',
    'if(LinkUpdater.GoblinKidnappersEntityCompleted(4906590))',
    'if(LinkUpdater.GoblinKidnappersEntityCompleted(4972126))'
  ]],
  ['a_Room_Tutorial_04', [
    'GoblinKidnappersRequestObjective("traversal",4)',
    'if(LinkUpdater.GoblinKidnappersObjectiveCompleted("cutscene:traversal"))'
  ]],
  ['a_Room_Tutorial_05_ALT', [
    'if(LinkUpdater.GoblinKidnappersEntityCompleted(4709982))',
    'if(LinkUpdater.GoblinKidnappersRoomCompleted(this))'
  ]],
  ['a_Room_NRIMR05_ALT', ['if(LinkUpdater.GoblinKidnappersEntityCompleted(2612830))']],
  ['a_Room_NRIMR03', [
    'GoblinKidnappersRequestObjective("cheer_gate",9)',
    'if(LinkUpdater.GoblinKidnappersObjectiveCompleted("cutscene:cheer_gate"))'
  ]],
  ['a_Room_NRM02RGoblinCaveBoss', [
    'if(LinkUpdater.GoblinKidnappersEntityCompleted(3923550))',
    'if(LinkUpdater.GoblinKidnappersEntityCompleted(3923550) && LinkUpdater.GoblinKidnappersEntityCompleted(4054622))'
  ]]
]);

function exportScripts(ffdec, work, swf) {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  runFfdec(ffdec, ['-selectclass', CLASS_NAMES.join(','), '-export', 'script', work, swf]);
  const scripts = path.join(work, 'scripts');
  for (const name of CLASS_NAMES) {
    if (!fs.existsSync(path.join(scripts, `${name}.as`))) throw new Error(`Missing exported ${name}.as`);
  }
  return scripts;
}

function verifyScripts(scripts) {
  for (const [name, markers] of VERIFY_MARKERS) {
    const source = fs.readFileSync(path.join(scripts, `${name}.as`), 'utf8');
    for (const marker of markers) if (!source.includes(marker)) throw new Error(`${name} missing ${marker}`);
  }
  for (const [name, markers] of UNIQUE_MARKERS) {
    const source = fs.readFileSync(path.join(scripts, `${name}.as`), 'utf8');
    for (const marker of markers) {
      const occurrences = source.split(marker).length - 1;
      if (occurrences !== 1) throw new Error(`${name} expected exactly one ${marker}, found ${occurrences}`);
    }
  }
}

function patchScripts(scripts) {
  let changed = false;
  for (const [name, patcher] of PATCHERS) {
    const file = path.join(scripts, `${name}.as`);
    const original = fs.readFileSync(file, 'utf8');
    const patched = patcher(original);
    if (patched !== original) {
      fs.writeFileSync(file, patched, 'utf8');
      changed = true;
    }
  }
  return changed;
}

function main() {
  const root = rootDir();
  const args = parseArgs(process.argv);
  const swf = resolveFrom(root, args.swf);
  const ffdec = detectFfdec(root, args.ffdec);
  if (!ffdec) throw new Error('FFDec not found; pass --ffdec.');
  const work = path.join(root, 'build', args.verify ? 'ffdec-goblin-rooms-verify' : 'ffdec-goblin-rooms-patch');
  const scripts = exportScripts(ffdec, work, swf);
  if (args.verify) {
    verifyScripts(scripts);
    console.log(`Verified Goblin Kidnappers snapshot room gates in ${swf}`);
    return;
  }
  const changed = patchScripts(scripts);
  verifyScripts(scripts);
  if (!changed) {
    console.log(`Goblin Kidnappers snapshot room gates already present in ${swf}`);
    return;
  }
  const patched = path.join(work, 'LevelsNR.patched.swf');
  runFfdec(ffdec, ['-importScript', swf, patched, scripts]);
  fs.copyFileSync(patched, swf);
  const verifyDir = exportScripts(ffdec, path.join(root, 'build', 'ffdec-goblin-rooms-verify'), swf);
  verifyScripts(verifyDir);
  console.log(`Patched and verified Goblin Kidnappers snapshot room gates in ${swf}`);
}

try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
