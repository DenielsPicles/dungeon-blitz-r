#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseSwfSprites, roundPosition } = require('./exportTheEastWingEnemies');

const repoRoot = path.resolve(__dirname, '../../..');
const swfPath = path.join(repoRoot, 'src/client/content/localhost/p/cbp/LevelsNR.swf');
const outputPath = path.join(repoRoot, 'src/server/data/dungeonSpawns/levelsNR_goblin_kidnappers.enemies.json');
const exportRoot = path.join(repoRoot, 'build/ffdec-goblin-kidnappers-server-authority');
const scriptsRoot = path.join(exportRoot, 'scripts');
const levelClass = 'a_Level_NRTutorial';
const levelSymbolId = 1006;
const canonicalIdBase = 9_500_000;
const roomIds = new Map([
    ['a_Room_Tutorial_01', 0],
    ['a_Room_Tutorial_02', 1],
    ['a_Room_Tutorial_03', 2],
    ['a_Room_Tutorial_04', 3],
    ['a_Room_Tutorial_05_ALT', 4],
    ['a_Room_NRIMR05_ALT', 5],
    ['a_Room_NRIMR06', 6],
    ['a_Room_NRIMR03', 7],
    ['a_Room_NRM02RGoblinCaveBoss', 8]
]);
const hostileRanks = new Set(['Minion', 'Lieutenant', 'MiniBoss', 'Boss']);
const nonCombatType = /Parrot|Dummy|Trap|Chains|TreasureChest|Target|NPC/i;

function detectFfdec(preferred) {
    const candidates = [
        preferred,
        process.env.FFDEC_PATH,
        path.join(repoRoot, 'build/tools/ffdec_25.0.0/ffdec-cli.jar'),
        path.join(repoRoot, '../dungeon-blitz-typescript-old/build/tools/ffdec_25.0.0/ffdec-cli.jar'),
        '/Applications/FFDec.app/Contents/Resources/ffdec.sh'
    ].filter(Boolean).map((candidate) => path.resolve(repoRoot, candidate));
    return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function runFfdec(ffdec, args) {
    if (ffdec.toLowerCase().endsWith('.jar')) {
        execFileSync('java', ['-jar', ffdec, '-cli', ...args], { stdio: 'inherit' });
    } else {
        execFileSync(ffdec, ['-cli', ...args], { stdio: 'inherit' });
    }
}

function exportScripts(ffdec) {
    fs.rmSync(exportRoot, { recursive: true, force: true });
    fs.mkdirSync(exportRoot, { recursive: true });
    runFfdec(ffdec, ['-export', 'script', exportRoot, swfPath]);
}

function readClassSymbols() {
    const bySymbol = new Map();
    for (const file of fs.readdirSync(scriptsRoot).filter((entry) => entry.endsWith('.as'))) {
        const source = fs.readFileSync(path.join(scriptsRoot, file), 'utf8');
        const match = source.match(/symbol="symbol([0-9]+)"/);
        if (match) bySymbol.set(Number(match[1]), file.replace(/\.as$/, ''));
    }
    return bySymbol;
}

function compose(parent, child) {
    return {
        scaleX: (parent.scaleX * child.scaleX) + (parent.rotateSkew0 * child.rotateSkew1),
        scaleY: (parent.rotateSkew1 * child.rotateSkew0) + (parent.scaleY * child.scaleY),
        rotateSkew0: (parent.scaleX * child.rotateSkew0) + (parent.rotateSkew0 * child.scaleY),
        rotateSkew1: (parent.rotateSkew1 * child.scaleX) + (parent.scaleY * child.rotateSkew1),
        x: (parent.scaleX * child.x) + (parent.rotateSkew0 * child.y) + parent.x,
        y: (parent.rotateSkew1 * child.x) + (parent.scaleY * child.y) + parent.y
    };
}

function collectHostiles(sprites, classesBySymbol, ranksByType, spriteId, matrix, stack, pathParts, result) {
    if (stack.has(spriteId)) return;
    const sprite = sprites.get(spriteId);
    if (!sprite) return;
    const nextStack = new Set(stack);
    nextStack.add(spriteId);

    for (const placement of sprite.placements) {
        if (!placement.characterId || !placement.matrix) continue;
        const placed = compose(matrix, placement.matrix);
        const className = classesBySymbol.get(placement.characterId) || '';
        const type = className.startsWith('ac_') ? className.slice(3) : '';
        const rank = ranksByType.get(type) || '';
        const sourcePath = [...pathParts, placement.depth];
        if (hostileRanks.has(rank) && !nonCombatType.test(type)) {
            result.push({
                type,
                rank,
                x: roundPosition(placed.x),
                y: roundPosition(placed.y),
                sourceCharacterId: placement.characterId,
                depth: placement.depth,
                sourcePath: sourcePath.join('.')
            });
            continue;
        }
        collectHostiles(sprites, classesBySymbol, ranksByType, placement.characterId, placed, nextStack, sourcePath, result);
    }
}

function buildRegistry() {
    const entTypes = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src/server/data/EntTypes.json'), 'utf8').replace(/^\uFEFF/, '')).EntTypes.EntType;
    const ranksByType = new Map(entTypes.map((entry) => [String(entry.EntName), String(entry.EntRank || '')]));
    const classesBySymbol = readClassSymbols();
    const sprites = parseSwfSprites(swfPath);
    const levelSprite = sprites.get(levelSymbolId);
    if (!levelSprite) throw new Error(`Missing ${levelClass} sprite ${levelSymbolId}`);

    const enemies = [];
    for (const roomPlacement of levelSprite.placements) {
        const sourceRoom = classesBySymbol.get(roomPlacement.characterId) || '';
        if (!roomIds.has(sourceRoom) || !roomPlacement.matrix) continue;
        const found = [];
        collectHostiles(
            sprites,
            classesBySymbol,
            ranksByType,
            roomPlacement.characterId,
            roomPlacement.matrix,
            new Set(),
            [roomPlacement.depth],
            found
        );
        const unique = new Map();
        for (const hostile of found) {
            unique.set(`${hostile.type}:${Math.round(hostile.x)}:${Math.round(hostile.y)}`, hostile);
        }
        for (const hostile of unique.values()) {
            const spawnIndex = enemies.length;
            const canonicalId = canonicalIdBase + spawnIndex + 1;
            const roomId = roomIds.get(sourceRoom);
            const boss = hostile.rank === 'Boss';
            const enemy = {
                id: canonicalId,
                canonicalId,
                spawnIndex,
                type: hostile.type,
                name: hostile.type,
                x: hostile.x,
                y: hostile.y,
                roomId,
                groupId: sourceRoom,
                waveId: hostile.sourcePath.split('.').length > 2 ? hostile.sourcePath : null,
                triggerId: null,
                hostile: true,
                serverSpawn: true,
                requiredForClear: true,
                boss,
                miniboss: hostile.rank === 'MiniBoss',
                roomBoss: boss,
                isRoomBoss: boss,
                roomBossName: boss ? 'Tag Ugo' : '',
                displayName: boss ? 'Tag Ugo' : '',
                scripted: true,
                classification: boss ? 'boss' : hostile.rank.toLowerCase(),
                sourceRoom,
                sourceScript: sourceRoom,
                sourceVar: hostile.sourcePath,
                sourceLine: 0,
                sourceSymbolId: roomPlacement.characterId,
                sourceCharacterId: hostile.sourceCharacterId,
                depth: hostile.depth
            };
            enemy.spawnKey = [
                'levelsNR',
                'goblin_kidnappers',
                `room:${roomId}`,
                `index:${spawnIndex}`,
                `type:${hostile.type}`,
                `pos:${Math.round(hostile.x)}:${Math.round(hostile.y)}`
            ].join('|');
            enemies.push(enemy);
        }
    }
    enemies.sort((left, right) => left.roomId - right.roomId || left.spawnIndex - right.spawnIndex);
    return {
        levelId: 'levelsNR',
        levelName: 'TutorialDungeon',
        dungeonName: 'Goblin Kidnappers',
        source: {
            swf: 'src/client/content/localhost/p/cbp/LevelsNR.swf',
            levelClass,
            roomClasses: Array.from(roomIds.keys()),
            extractor: 'src/server/tools/exportGoblinKidnappersEnemies.js'
        },
        generatedFromScript: true,
        canonicalIdBase,
        coordinates: 'absolute world pixels from recursive SWF placement matrices',
        enemies
    };
}

function validate(registry) {
    if (registry.enemies.length !== 76) throw new Error(`Expected 76 authored hostiles, got ${registry.enemies.length}`);
    if (registry.enemies.filter((enemy) => enemy.boss).length !== 1) throw new Error('Expected exactly one Goblin Kidnappers boss');
    if (new Set(registry.enemies.map((enemy) => enemy.canonicalId)).size !== registry.enemies.length) throw new Error('Duplicate canonical IDs');
    if (new Set(registry.enemies.map((enemy) => enemy.spawnKey)).size !== registry.enemies.length) throw new Error('Duplicate spawn keys');
}

function main() {
    const verify = process.argv.includes('--verify');
    const ffdecArg = process.argv.indexOf('--ffdec');
    const ffdec = detectFfdec(ffdecArg >= 0 ? process.argv[ffdecArg + 1] : '');
    if (!ffdec) throw new Error('FFDec not found; pass --ffdec <path>');
    exportScripts(ffdec);
    const registry = buildRegistry();
    validate(registry);
    if (verify) {
        const tracked = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        if (JSON.stringify(tracked) !== JSON.stringify(registry)) throw new Error('Tracked Goblin Kidnappers registry is stale');
        console.log(`[GoblinKidnappersExport] verified hostiles=${registry.enemies.length} boss=1 rooms=${roomIds.size}`);
        return;
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(registry, null, 2)}\n`);
    console.log(`[GoblinKidnappersExport] wrote ${outputPath} hostiles=${registry.enemies.length} boss=1 rooms=${roomIds.size}`);
}

main();
