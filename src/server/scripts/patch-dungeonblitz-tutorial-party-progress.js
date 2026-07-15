#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_SWF = path.join('src', 'client', 'content', 'localhost', 'p', 'cbp', 'DungeonBlitz.swf');
const SNAPSHOT_PACKET_ID = 0x115;

function parseArgs(argv) {
  const args = { ffdec: '', swf: DEFAULT_SWF, verify: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--ffdec' || argv[i] === '-f') args.ffdec = argv[++i] || '';
    else if (argv[i] === '--swf' || argv[i] === '-s') args.swf = argv[++i] || args.swf;
    else if (argv[i] === '--verify') args.verify = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node patch-dungeonblitz-tutorial-party-progress.js [--verify] [--swf <path>] [--ffdec <path>]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function repoRoot() { return path.resolve(__dirname, '..', '..', '..'); }
function resolveFrom(root, value) { return path.isAbsolute(value) ? value : path.join(root, value); }

function detectFfdec(root, preferred) {
  const candidates = [
    preferred ? resolveFrom(root, preferred) : '',
    'C:\\Program Files (x86)\\FFDec\\ffdec-cli.exe',
    path.join(root, 'build', 'tools', 'ffdec_25.1.3', 'ffdec.jar'),
    path.join(root, 'build', 'tools', 'ffdec_25.1.3', 'ffdec-cli.jar')
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function runFfdec(ffdec, args) {
  if (ffdec.toLowerCase().endsWith('.jar')) execFileSync('java', ['-jar', ffdec, '-cli', ...args], { stdio: 'inherit' });
  else execFileSync(ffdec, ['-cli', ...args], { stdio: 'inherit' });
}

function replaceExact(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`Missing patch marker: ${label}`);
  return source.replace(needle, replacement);
}

function replaceMethod(source, methodName, replacement) {
  const marker = `function ${methodName}(`;
  const markerAt = source.indexOf(marker);
  if (markerAt < 0) throw new Error(`Missing method ${methodName}`);
  const methodAt = source.lastIndexOf('      public ', markerAt);
  const braceAt = source.indexOf('{', markerAt);
  let depth = 0;
  for (let i = braceAt; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return `${source.slice(0, methodAt)}${replacement}${source.slice(i + 1)}`;
    }
  }
  throw new Error(`Unterminated method ${methodName}`);
}

function injectMethodStart(source, methodName, lines) {
  if (source.includes(lines.trim())) return source;
  const marker = `function ${methodName}(`;
  const markerAt = source.indexOf(marker);
  if (markerAt < 0) throw new Error(`Missing method ${methodName}`);
  const braceAt = source.indexOf('{', markerAt);
  return `${source.slice(0, braceAt + 1)}\n${lines}${source.slice(braceAt + 1)}`;
}

function patchLinkUpdater(source) {
  if (!source.includes('import flash.utils.getQualifiedClassName;')) {
    source = replaceExact(
      source,
      '   import flash.geom.Point;',
      '   import flash.geom.Point;\n   import flash.utils.getQualifiedClassName;',
      'LinkUpdater import'
    );
  }

  if (!source.includes('GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET')) {
    source = replaceExact(
      source,
      '      private static const DUPLICATE_REMOTE_ENTITY_POSITION_TOLERANCE:uint = 24;',
      `      private static const DUPLICATE_REMOTE_ENTITY_POSITION_TOLERANCE:uint = 24;

      public static const GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET:uint = ${SNAPSHOT_PACKET_ID};
      public static const GOBLIN_KIDNAPPERS_PROTOCOL:uint = 1;
      public static var goblinKidnappersSnapshotReady:Boolean = false;
      public static var goblinKidnappersScope:String = "";
      public static var goblinKidnappersRevision:int = -1;
      public static var goblinKidnappersSnapshot:Object = null;
      private static var goblinKidnappersUpdater:LinkUpdater = null;
      private static var goblinKidnappersWave80Pending:Boolean = false;
      private static var goblinKidnappersWave50Pending:Boolean = false;
      private static var goblinKidnappersWave33Pending:Boolean = false;

      public static function GoblinKidnappersEntityCompleted(param1:uint) : Boolean
      {
         var _loc2_:Object = null;
         if(!goblinKidnappersSnapshotReady || !goblinKidnappersSnapshot)
         {
            return false;
         }
         if(param1 == 3923550)
         {
            return Boolean(goblinKidnappersSnapshot.boss) && Boolean(goblinKidnappersSnapshot.boss.dead);
         }
         _loc2_ = goblinKidnappersSnapshot.dummies ? goblinKidnappersSnapshot.dummies[String(param1)] : null;
         if(_loc2_ && Boolean(_loc2_.completed))
         {
            return true;
         }
         _loc2_ = goblinKidnappersSnapshot.chains ? goblinKidnappersSnapshot.chains[String(param1)] : null;
         if(_loc2_ && Boolean(_loc2_.broken))
         {
            return true;
         }
         _loc2_ = goblinKidnappersSnapshot.chests ? goblinKidnappersSnapshot.chests[String(param1)] : null;
         return Boolean(_loc2_) && Boolean(_loc2_.opened);
      }

      public static function GoblinKidnappersObjectiveCompleted(param1:String) : Boolean
      {
         var _loc2_:String = null;
         if(!goblinKidnappersSnapshotReady || !goblinKidnappersSnapshot || !goblinKidnappersSnapshot.completedObjectives)
         {
            return false;
         }
         for each(_loc2_ in goblinKidnappersSnapshot.completedObjectives)
         {
            if(_loc2_ == param1)
            {
               return true;
            }
         }
         return false;
      }

      public static function GoblinKidnappersRoomCompleted(param1:Object) : Boolean
      {
         var _loc2_:String = getQualifiedClassName(param1);
         var _loc3_:int = GoblinKidnappersRoomId(_loc2_);
         var _loc4_:Object = null;
         if(_loc3_ <= 0 || !goblinKidnappersSnapshotReady || !goblinKidnappersSnapshot || !goblinKidnappersSnapshot.completedRooms)
         {
            return false;
         }
         for each(_loc4_ in goblinKidnappersSnapshot.completedRooms)
         {
            if(int(_loc4_) == _loc3_)
            {
               return true;
            }
         }
         return false;
      }

      private static function GoblinKidnappersRoomId(param1:String) : int
      {
         if(param1.indexOf("a_Room_Tutorial_01") >= 0) return 1;
         if(param1.indexOf("a_Room_Tutorial_02") >= 0) return 2;
         if(param1.indexOf("a_Room_Tutorial_04") >= 0) return 4;
         if(param1.indexOf("a_Room_Tutorial_05_ALT") >= 0) return 5;
         if(param1.indexOf("a_Room_NRIMR05_ALT") >= 0) return 6;
         if(param1.indexOf("a_Room_NRIMR06") >= 0) return 8;
         if(param1.indexOf("a_Room_NRIMR03") >= 0) return 9;
         if(param1.indexOf("a_Room_NRM02RGoblinCaveBoss") >= 0) return 11;
         return 0;
      }

      private static function GoblinKidnappersCueRecord(param1:a_Cue, param2:Object) : Object
      {
         var _loc3_:String = getQualifiedClassName(param2);
         var _loc4_:String = param1 ? param1.name : "";
         var _loc5_:Object = null;
         var _loc6_:Object = null;
         if(!goblinKidnappersSnapshotReady || !goblinKidnappersSnapshot || !_loc4_)
         {
            return null;
         }
         for each(_loc5_ in [goblinKidnappersSnapshot.dummies,goblinKidnappersSnapshot.chains,goblinKidnappersSnapshot.chests])
         {
            if(!_loc5_) continue;
            for each(_loc6_ in _loc5_)
            {
               if(_loc3_.indexOf(String(_loc6_.sourceRoom)) >= 0 && _loc4_ == String(_loc6_.sourceVar))
               {
                  return _loc6_;
               }
            }
         }
         if(_loc3_.indexOf("a_Room_NRM02RGoblinCaveBoss") >= 0 && _loc4_ == "am_Boss")
         {
            return goblinKidnappersSnapshot.boss;
         }
         return null;
      }

      public static function GoblinKidnappersShouldSuppressCue(param1:a_Cue, param2:Object) : Boolean
      {
         var _loc3_:Object = GoblinKidnappersCueRecord(param1,param2);
         return Boolean(_loc3_) && (Boolean(_loc3_.completed) || Boolean(_loc3_.broken) || Boolean(_loc3_.opened) || Boolean(_loc3_.dead));
      }

      public static function GoblinKidnappersShouldKeepCollisionOff(param1:Object, param2:String) : Boolean
      {
         if(!goblinKidnappersSnapshotReady)
         {
            return false;
         }
         if(param2 == "am_DynamicCollision_WaitingForHelp" && GoblinKidnappersEntityCompleted(3268190)) return true;
         if(param2 == "am_DynamicCollision_GateBlock" && GoblinKidnappersEntityCompleted(4972126)) return true;
         if(param2 == "am_DynamicCollision_PathBlock02" && (GoblinKidnappersEntityCompleted(4709982) || GoblinKidnappersObjectiveCompleted("cutscene:cheer_gate"))) return true;
         if((param2 == "am_DynamicCollision_TrapWall" || param2 == "am_DynamicCollision_Gate") && GoblinKidnappersRoomCompleted(param1)) return true;
         return false;
      }

      public static function GoblinKidnappersConsumeBossWave(param1:Number) : Boolean
      {
         if(!goblinKidnappersSnapshotReady) return false;
         if(param1 == 0.8 && goblinKidnappersWave80Pending) { goblinKidnappersWave80Pending = false; return true; }
         if(param1 == 0.5 && goblinKidnappersWave50Pending) { goblinKidnappersWave50Pending = false; return true; }
         if(param1 == 0.33 && goblinKidnappersWave33Pending) { goblinKidnappersWave33Pending = false; return true; }
         return false;
      }`,
      'LinkUpdater snapshot state'
    );
  }

  if (!source.includes('public static function GoblinKidnappersRequestObjective(')) {
    source = replaceExact(
      source,
      '      public static function GoblinKidnappersEntityCompleted(param1:uint) : Boolean',
      `      public static function GoblinKidnappersRequestObjective(param1:String, param2:uint) : void
      {
         var _loc3_:Packet = null;
         if(!goblinKidnappersSnapshotReady || !goblinKidnappersUpdater || !goblinKidnappersUpdater.var_1 || !goblinKidnappersUpdater.var_1.serverConn)
         {
            return;
         }
         _loc3_ = new Packet(GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET);
         _loc3_.method_6(2,2);
         _loc3_.method_4(GOBLIN_KIDNAPPERS_PROTOCOL);
         _loc3_.method_13(goblinKidnappersScope);
         _loc3_.method_4(uint(goblinKidnappersRevision));
         _loc3_.method_13(param1);
         _loc3_.method_9(param2);
         goblinKidnappersUpdater.var_1.serverConn.SendPacket(_loc3_);
      }

      public static function GoblinKidnappersEntityCompleted(param1:uint) : Boolean`,
      'LinkUpdater objective request'
    );
  }

  if (!source.includes('goblinKidnappersSnapshot.parrots]')) {
    source = replaceExact(
      source,
      '[goblinKidnappersSnapshot.dummies,goblinKidnappersSnapshot.chains,goblinKidnappersSnapshot.chests]',
      '[goblinKidnappersSnapshot.dummies,goblinKidnappersSnapshot.chains,goblinKidnappersSnapshot.chests,goblinKidnappersSnapshot.parrots]',
      'LinkUpdater parrot cue records'
    );
  }

  if (!source.includes('String(_loc3_.state) == "removed"')) {
    source = replaceExact(
      source,
      'return Boolean(_loc3_) && (Boolean(_loc3_.completed) || Boolean(_loc3_.broken) || Boolean(_loc3_.opened) || Boolean(_loc3_.dead));',
      'return Boolean(_loc3_) && (Boolean(_loc3_.completed) || Boolean(_loc3_.broken) || Boolean(_loc3_.opened) || Boolean(_loc3_.dead) || String(_loc3_.state) == "removed");',
      'LinkUpdater removed parrot suppression'
    );
  }

  if (!source.includes('goblinKidnappersUpdater = this;')) {
    source = replaceExact(
      source,
      '         this.var_1 = param1;\n      }',
      '         this.var_1 = param1;\n         goblinKidnappersUpdater = this;\n      }',
      'LinkUpdater constructor'
    );
  }

  if (!source.includes('case GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET:')) {
    source = replaceExact(
      source,
      '         switch(param1.type)\n         {\n            case PKTTYPE_ENT_INCREMENTAL_UPDATE:',
      '         switch(param1.type)\n         {\n            case GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET:\n               this.GoblinKidnappersApplySnapshot(param1);\n               break;\n            case PKTTYPE_ENT_INCREMENTAL_UPDATE:',
      'LinkUpdater snapshot dispatch'
    );
  }

  if (!source.includes('private function GoblinKidnappersApplySnapshot(')) {
    source = replaceExact(
      source,
      '      public function method_1750() : void',
      `      private function GoblinKidnappersSendControl(param1:uint, param2:uint, param3:uint = 0) : void
      {
         var _loc4_:Packet = null;
         if(!this.var_1 || !this.var_1.serverConn)
         {
            return;
         }
         _loc4_ = new Packet(GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET);
         _loc4_.method_6(param1,2);
         _loc4_.method_4(GOBLIN_KIDNAPPERS_PROTOCOL);
         _loc4_.method_13(goblinKidnappersScope);
         _loc4_.method_4(param2);
         if(param1 == 0)
         {
            _loc4_.method_6(param3,2);
         }
         this.var_1.serverConn.SendPacket(_loc4_);
      }

      private function GoblinKidnappersApplySnapshot(param1:Packet) : void
      {
         var _loc2_:uint = param1.method_4();
         var _loc3_:String = param1.method_13();
         var _loc4_:int = int(param1.method_4());
         var _loc5_:Object = null;
         var _loc6_:Boolean = false;
         var _loc7_:Object = goblinKidnappersSnapshot;
         if(_loc2_ != GOBLIN_KIDNAPPERS_PROTOCOL)
         {
            return;
         }
         try
         {
            _loc5_ = JSON.parse(param1.method_13());
         }
         catch(error:Error)
         {
            return;
         }
         if(goblinKidnappersScope && goblinKidnappersScope != _loc3_)
         {
            goblinKidnappersRevision = -1;
            goblinKidnappersSnapshot = null;
            goblinKidnappersSnapshotReady = false;
            _loc7_ = null;
         }
         goblinKidnappersScope = _loc3_;
         if(_loc4_ < goblinKidnappersRevision)
         {
            this.GoblinKidnappersSendControl(0,uint(goblinKidnappersRevision),2);
            return;
         }
         if(_loc4_ == goblinKidnappersRevision && goblinKidnappersSnapshotReady)
         {
            this.GoblinKidnappersSendControl(0,uint(goblinKidnappersRevision),1);
            return;
         }
         _loc6_ = goblinKidnappersRevision >= 0 && _loc4_ > goblinKidnappersRevision + 1;
         if(_loc7_ && _loc7_.boss && _loc5_.boss)
         {
            goblinKidnappersWave80Pending = !Boolean(_loc7_.boss.wave80) && Boolean(_loc5_.boss.wave80);
            goblinKidnappersWave50Pending = !Boolean(_loc7_.boss.wave50) && Boolean(_loc5_.boss.wave50);
            goblinKidnappersWave33Pending = !Boolean(_loc7_.boss.wave33) && Boolean(_loc5_.boss.wave33);
         }
         goblinKidnappersSnapshot = _loc5_;
         goblinKidnappersRevision = _loc4_;
         goblinKidnappersSnapshotReady = true;
         this.GoblinKidnappersSendControl(0,uint(goblinKidnappersRevision),_loc6_ ? 3 : 0);
         if(_loc6_)
         {
            this.GoblinKidnappersSendControl(1,uint(goblinKidnappersRevision));
         }
      }

      public function method_1750() : void`,
      'LinkUpdater snapshot handler'
    );
  }
  return source;
}

function verify(linkUpdater) {
  const linkMarkers = [
    'GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET:uint = 277',
    'private function GoblinKidnappersApplySnapshot(param1:Packet)',
    'case GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET:',
    'GoblinKidnappersShouldSuppressCue',
    'public static function GoblinKidnappersRequestObjective(',
    'goblinKidnappersSnapshot.parrots]',
    'String(_loc3_.state) == "removed"',
    'GoblinKidnappersConsumeBossWave',
    'this.GoblinKidnappersSendControl(1,uint(goblinKidnappersRevision));'
  ];
  for (const marker of linkMarkers) if (!linkUpdater.includes(marker)) throw new Error(`LinkUpdater missing ${marker}`);
  const uniqueMarkers = [
    'GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET:uint = 277',
    'private function GoblinKidnappersApplySnapshot(param1:Packet)',
    'case GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET:',
    'public static function GoblinKidnappersRequestObjective(',
    'goblinKidnappersUpdater = this;'
  ];
  for (const marker of uniqueMarkers) {
    const occurrences = linkUpdater.split(marker).length - 1;
    if (occurrences !== 1) throw new Error(`LinkUpdater expected exactly one ${marker}, found ${occurrences}`);
  }
}

function exportScripts(ffdec, work, swf) {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  runFfdec(ffdec, ['-selectclass', 'LinkUpdater', '-export', 'script', work, swf]);
  const scripts = path.join(work, 'scripts');
  return { scripts, link: path.join(scripts, 'LinkUpdater.as') };
}

function main() {
  const root = repoRoot();
  const args = parseArgs(process.argv);
  const swf = resolveFrom(root, args.swf);
  const ffdec = detectFfdec(root, args.ffdec);
  if (!ffdec) throw new Error('FFDec not found; pass --ffdec.');
  const work = path.join(root, 'build', args.verify ? 'ffdec-goblin-snapshot-verify' : 'ffdec-goblin-snapshot-patch');
  const exported = exportScripts(ffdec, work, swf);
  let link = fs.readFileSync(exported.link, 'utf8').replace(/\r\n/g, '\n');
  if (args.verify) {
    verify(link);
    console.log(`Verified Goblin Kidnappers snapshot protocol in ${swf}`);
    return;
  }
  const patchedLink = patchLinkUpdater(link);
  verify(patchedLink);
  if (patchedLink === link) {
    console.log(`Goblin Kidnappers snapshot protocol already present in ${swf}`);
    return;
  }
  fs.writeFileSync(exported.link, patchedLink, 'utf8');
  const patchedSwf = path.join(work, 'DungeonBlitz.patched.swf');
  runFfdec(ffdec, ['-importScript', swf, patchedSwf, exported.scripts]);
  fs.copyFileSync(patchedSwf, swf);
  const verifyExport = exportScripts(ffdec, path.join(root, 'build', 'ffdec-goblin-snapshot-verify'), swf);
  verify(fs.readFileSync(verifyExport.link, 'utf8'));
  console.log(`Patched and verified Goblin Kidnappers snapshot protocol in ${swf}`);
}

try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
