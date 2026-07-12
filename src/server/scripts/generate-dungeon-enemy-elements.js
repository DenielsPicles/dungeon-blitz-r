#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
    getLineNumber,
    getSymbolId,
    parseStringLiteral,
    parseSwfSprites,
    roundPosition
} = require('../tools/exportTheEastWingEnemies');

const ELEMENT_ORDER = ['Fire', 'Ice', 'Air', 'Earth', 'Life', 'Death'];
const KINGDOM_TO_ELEMENT = {
    Draconic: 'Fire',
    Infernal: 'Air',
    Mythic: 'Ice',
    Sylvan: 'Life',
    Trog: 'Earth',
    Undead: 'Death'
};
const LEGACY_SERVER_AUTHORITY_LEVELS = new Set([
    'AC_Mission1',
    'Castle',
    'CastleHard',
    'JC_Mini1Hard',
    'JC_Mini2',
    'JC_Mini2Hard'
]);

function resolveRepoRoot() {
    return path.resolve(__dirname, '..', '..', '..');
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function detectFfdec(repoRoot) {
    const candidates = [
        path.join(repoRoot, 'build', 'ffdec', 'ffdec.sh'),
        path.join(repoRoot, 'build', 'ffdec', 'ffdec.jar'),
        path.join(repoRoot, 'build', 'ffdec', 'ffdec-cli.jar'),
        path.join(repoRoot, 'build', 'tools', 'ffdec_25.1.3', 'ffdec.sh'),
        path.join(repoRoot, 'build', 'tools', 'ffdec_25.1.3', 'ffdec.jar'),
        path.join(repoRoot, 'build', 'tools', 'ffdec_25.1.3', 'ffdec-cli.jar'),
        '/Applications/FFDec.app/Contents/Resources/ffdec.sh',
        '/Applications/FFDec.app/Contents/Resources/ffdec.jar',
        '/Applications/FFDec.app/Contents/Resources/ffdec-cli.jar'
    ];

    return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function runFfdec(ffdecPath, args) {
    const basename = path.basename(ffdecPath).toLowerCase();
    if (basename.endsWith('.jar')) {
        execFileSync('java', ['-jar', ffdecPath, '-cli', ...args], { stdio: 'ignore' });
        return;
    }

    execFileSync(ffdecPath, ['-cli', ...args], { stdio: 'ignore' });
}

function findSwf(repoRoot, swfName) {
    const candidates = [
        path.join(repoRoot, 'src', 'client', 'content', 'localhost', 'p', 'cbp', swfName),
        path.join(repoRoot, 'src', 'client', 'content', 'localhost', 'p', 'cam', swfName)
    ];

    return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function exportSwfScripts(repoRoot, ffdecPath, swfName) {
    const swfPath = findSwf(repoRoot, swfName);
    if (!swfPath) {
        return null;
    }

    const exportRoot = path.join(repoRoot, 'build', 'ffdec-global-dungeon-bosses', swfName.replace(/\.swf$/i, ''));
    const scriptsRoot = path.join(exportRoot, 'scripts');
    if (!fs.existsSync(scriptsRoot)) {
        fs.rmSync(exportRoot, { recursive: true, force: true });
        fs.mkdirSync(exportRoot, { recursive: true });
        runFfdec(ffdecPath, ['-export', 'script', exportRoot, swfPath]);
    }

    return scriptsRoot;
}

function parseLevelSpec(spec) {
    const parts = String(spec ?? '').trim().split(/\s+/);
    const [swfAndSymbol = '', mapLevel = '0', baseLevel = '0', dungeonFlag = 'false', hardFlag = ''] = parts;
    const [swf = '', symbol = ''] = swfAndSymbol.split('/');
    return {
        swf,
        symbol,
        mapLevel: Number(mapLevel),
        baseLevel: Number(baseLevel),
        isDungeon: dungeonFlag === 'true',
        isHard: hardFlag === 'Hard'
    };
}

function normalizeElement(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        return '';
    }

    const normalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    return ELEMENT_ORDER.includes(normalized) ? normalized : '';
}

function resolveEntType(name, entTypes) {
    return entTypes[name] || null;
}

function resolveElement(entType) {
    return normalizeElement(entType?.Element) || normalizeElement(KINGDOM_TO_ELEMENT[String(entType?.Kingdom ?? '')]);
}

function isEnemyEntType(entName, entType) {
    if (!entName || !entType) {
        return false;
    }

    const behavior = String(entType.Behavior ?? '');
    if (/TreasureChest|Ambient|Decoration/i.test(behavior)) {
        return false;
    }

    const rank = String(entType.EntRank ?? '');
    const kingdom = String(entType.Kingdom ?? '');
    const element = resolveElement(entType);
    return Boolean(element || rank || kingdom);
}

function extractCueTypes(source) {
    const vars = new Map();
    for (const match of source.matchAll(/public var\s+([A-Za-z0-9_]+):ac_([A-Za-z0-9_]+)/g)) {
        vars.set(match[1], match[2]);
    }

    for (const match of source.matchAll(/this\.([A-Za-z0-9_]+)\.characterName\s*=\s*"([^"]*)"/g)) {
        const varName = match[1];
        const characterName = match[2].trim();
        if (characterName && !characterName.includes(',')) {
            vars.set(varName, characterName);
        }
    }

    for (const match of source.matchAll(/this\.([A-Za-z0-9_]+)\.team\s*=\s*"([^"]*)"/g)) {
        const varName = match[1];
        const team = match[2].trim().toLowerCase();
        if (team === 'neutral' || team === 'good' || team === 'goodguy') {
            vars.delete(varName);
        }
    }

    return Array.from(vars.values());
}

function roomPatternsForLevel(levelName, symbol) {
    const base = symbol.replace(/^a_Level_/, '');
    const patterns = [
        new RegExp(`^a_Room_${escapeRegex(base)}(?:_|$)`)
    ];

    const levelMission = levelName.match(/^([A-Z]+)_Mission(\d+)/);
    const miniMission = levelName.match(/^CH_MiniMission(\d+)/);
    const jcMini = levelName.match(/^JC_Mini(\d+)/);
    const nrTales = levelName.match(/^NR_Tales(\d+)/);
    const sdTales = levelName.match(/^SD_Tales(\d+)/);

    if (levelMission) {
        const zone = levelMission[1];
        const mission = Number(levelMission[2]);
        const padded = String(mission).padStart(2, '0');
        patterns.push(new RegExp(`^a_Room_${zone}Mission${mission}(?:_|$)`));
        if (zone !== 'SD' || mission === 1) {
            patterns.push(new RegExp(`^a_Room_${zone}Mission${padded}(?:_|$)`));
        }

        if (zone === 'SRN') {
            patterns.push(new RegExp(`^a_Room_SRNM${padded}`));
        }
        if (zone === 'BT') {
            patterns.push(new RegExp(`^a_Room_BTM${padded}`));
        }
        if (zone === 'CH') {
            patterns.push(new RegExp(`^a_Room_CHM${padded}`));
            patterns.push(new RegExp(`^a_Room_CH${mission}(?:_|R|$)`));
            patterns.push(new RegExp(`^a_Room_CH${padded}(?:_|R|$)`));
        }
        if (zone === 'OMM') {
            patterns.push(new RegExp(`^a_Room_OMM${padded}`));
            patterns.push(new RegExp(`^a_Room_SSM${padded}`));
        }
        if (zone === 'EG') {
            patterns.push(new RegExp(`^a_Room_M${padded}`));
            patterns.push(new RegExp(`^a_Room_${egMissionRoomStem(mission)}`));
        }
        if (zone === 'AC') {
            for (const stem of acMissionRoomStems(mission)) {
                patterns.push(new RegExp(`^a_Room_${stem}`));
            }
            patterns.push(new RegExp(`^a_Room_ACM${padded}`));
        }
        if (zone === 'SD') {
            patterns.push(new RegExp(`^a_Room_SDMission${mission}(?:_|$)`));
            if (mission === 1) {
                patterns.push(/^a_Room_SDMission15$/);
            }
        }
        if (zone === 'JC') {
            patterns.push(new RegExp(`^a_Room_JCMission${mission}(?:_|$)`));
        }
    }

    if (miniMission) {
        const mission = Number(miniMission[1]);
        const padded = String(mission).padStart(2, '0');
        patterns.push(new RegExp(`^a_Room_CHmini${padded}(?:_|$)`));
        patterns.push(new RegExp(`^a_Room_CHMini${mission}(?:_|$)`));
    }

    if (jcMini) {
        patterns.push(new RegExp(`^a_Room_JCMini${Number(jcMini[1])}(?:_|$)`));
    }

    if (nrTales) {
        patterns.push(new RegExp(`^a_Room_NRTales${Number(nrTales[1])}`));
    }

    if (sdTales) {
        patterns.push(new RegExp(`^a_Room_SDTales${Number(sdTales[1])}`));
    }

    if (base === 'GoblinRiver') {
        patterns.push(/^a_Room_GoblinCamp/);
    }
    if (base === 'NRGhost') {
        patterns.push(/^a_Room_NRM03/);
    }
    if (base === 'NRDragon') {
        patterns.push(/^a_Room_NRM04/);
    }
    if (base === 'GoblinBeachHard') {
        patterns.push(/^a_Room_GoblinBeachHard_/);
    }
    if (base === 'SwampRoadConnectionMission') {
        patterns.push(/^a_Room_SRConnM/);
        patterns.push(/^a_Room_SRCM/);
    }
    if (base === 'LDArena1') {
        patterns.push(/^a_Room_LDArena1_/);
    }

    return patterns;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function egMissionRoomStem(mission) {
    switch (mission) {
        case 1: return 'M01|Ashen|Eternal';
        case 2: return 'M02|Limb';
        case 3: return 'M03|Rotten';
        case 4: return 'M04|Hopes';
        case 5: return 'M05|Refuge';
        default: return `EGMission${mission}`;
    }
}

function acMissionRoomStems(mission) {
    switch (mission) {
        case 1: return ['ACM01', 'Dragon_R', 'DGC_R', 'ZDGC_R', 'ZDragon_R'];
        case 2: return ['ACM02', 'Throne_R'];
        case 3: return ['ACM03', 'Battle_R', 'ZBattle_R'];
        case 4: return ['ACM04', 'Observe_R', 'Obersve_R', 'ZObserve_R'];
        case 5: return ['ACM05', 'Ramparts_R'];
        case 6: return ['Capstone_R', 'FinalNephitFight'];
        default: return [`ACM${String(mission).padStart(2, '0')}`];
    }
}

function getMatchingRoomFiles(scriptsRoot, levelName, symbol) {
    const patterns = roomPatternsForLevel(levelName, symbol);
    return fs.readdirSync(scriptsRoot)
        .filter((file) => file.endsWith('.as'))
        .map((file) => file.replace(/\.as$/, ''))
        .filter((className) => patterns.some((pattern) => pattern.test(className)))
        .map((className) => `${className}.as`)
        .sort();
}

function parseRoomScript(scriptsRoot, roomFile, roomIndex) {
    const className = roomFile.replace(/\.as$/i, '');
    const source = fs.readFileSync(path.join(scriptsRoot, roomFile), 'utf8');
    const symbolId = getSymbolId(source, className);
    const fields = new Map();
    const declarationRegex = /public\s+var\s+([A-Za-z_$][\w$]*):ac_([A-Za-z_$][\w$]*)\s*;/g;
    let declaration;
    while ((declaration = declarationRegex.exec(source)) !== null) {
        fields.set(declaration[1], {
            sourceVar: declaration[1],
            type: declaration[2],
            sourceLine: getLineNumber(source, declaration.index),
            props: {}
        });
    }

    const assignmentRegex = /this\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=\s*((?:"(?:\\.|[^"\\])*")|(?:'(?:\\.|[^'\\])*'))\s*;/g;
    let assignment;
    while ((assignment = assignmentRegex.exec(source)) !== null) {
        const field = fields.get(assignment[1]);
        if (field) {
            field.props[assignment[2]] = parseStringLiteral(assignment[3]);
        }
    }

    const numericSuffix = className.match(/(\d+)(?:[^\d]*)$/)?.[1];
    return {
        className,
        symbolId,
        roomId: numericSuffix ? Number(numericSuffix) : roomIndex + 1,
        fields: Array.from(fields.values())
    };
}

function normalizeBossKey(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildBossSpawnKey(levelName, boss) {
    return [
        levelName,
        `room:${boss.roomId}`,
        `index:${boss.spawnIndex}`,
        `type:${boss.type}`,
        `pos:${Math.round(boss.x)}:${Math.round(boss.y)}`
    ].join('|');
}

function resolveHardType(typeName, spec, entTypes) {
    if (!spec.isHard || typeName.endsWith('Hard')) {
        return typeName;
    }
    return entTypes[`${typeName}Hard`] ? `${typeName}Hard` : typeName;
}

function composeMatrix(parent, child) {
    return {
        scaleX: (parent.scaleX * child.scaleX) + (parent.rotateSkew0 * child.rotateSkew1),
        scaleY: (parent.rotateSkew1 * child.rotateSkew0) + (parent.scaleY * child.scaleY),
        rotateSkew0: (parent.scaleX * child.rotateSkew0) + (parent.rotateSkew0 * child.scaleY),
        rotateSkew1: (parent.rotateSkew1 * child.scaleX) + (parent.scaleY * child.rotateSkew1),
        x: (parent.scaleX * child.x) + (parent.rotateSkew0 * child.y) + parent.x,
        y: (parent.rotateSkew1 * child.x) + (parent.scaleY * child.y) + parent.y
    };
}

function findNestedPlacementMatrix(sprites, rootSpriteId, targetCharacterId) {
    const identity = { scaleX: 1, scaleY: 1, rotateSkew0: 0, rotateSkew1: 0, x: 0, y: 0 };
    const visit = (spriteId, parentMatrix, path) => {
        if (path.has(spriteId)) {
            return null;
        }
        const sprite = sprites.get(spriteId);
        if (!sprite) {
            return null;
        }
        const nextPath = new Set(path);
        nextPath.add(spriteId);
        for (const placement of sprite.placements) {
            if (!placement.characterId || !placement.matrix) {
                continue;
            }
            const worldMatrix = composeMatrix(parentMatrix, placement.matrix);
            if (placement.characterId === targetCharacterId) {
                return worldMatrix;
            }
            if (sprites.has(placement.characterId)) {
                const nested = visit(placement.characterId, worldMatrix, nextPath);
                if (nested) {
                    return nested;
                }
            }
        }
        return null;
    };
    return visit(rootSpriteId, identity, new Set());
}

function buildBossSpawnsForLevel(repoRoot, levelName, spec, scriptsRoot, roomFiles, entTypes, levelOrdinal, swfSpriteCache) {
    const swfPath = findSwf(repoRoot, spec.swf);
    if (!swfPath || !scriptsRoot || roomFiles.length === 0) {
        return [];
    }

    const levelScriptPath = path.join(scriptsRoot, `${spec.symbol}.as`);
    if (!fs.existsSync(levelScriptPath)) {
        return [];
    }

    let sprites = swfSpriteCache.get(swfPath);
    if (!sprites) {
        sprites = parseSwfSprites(swfPath);
        swfSpriteCache.set(swfPath, sprites);
    }

    const levelSource = fs.readFileSync(levelScriptPath, 'utf8');
    const levelSprite = sprites.get(getSymbolId(levelSource, spec.symbol));
    if (!levelSprite) {
        return [];
    }

    const rooms = roomFiles.map((roomFile, roomIndex) => parseRoomScript(scriptsRoot, roomFile, roomIndex));
    const excludedBossCue = (field) =>
        /Marker|Aura|Statue/i.test(field.type) ||
        /Marker|Aura|Statue|DummyBoss|PowerMarker|FireLeft|FireRight/i.test(field.sourceVar);
    const isExplicitBossCue = (field) => /^am_Boss\d*$/i.test(field.sourceVar) && !excludedBossCue(field);
    const levelHasExplicitBossCue = rooms.some((room) => room.fields.some(isExplicitBossCue));

    const bosses = [];
    for (const room of rooms) {
        const roomSprite = sprites.get(room.symbolId);
        const authoredRoomMatrix = findNestedPlacementMatrix(sprites, getSymbolId(levelSource, spec.symbol), room.symbolId);
        const roomMatrix = authoredRoomMatrix ?? {
            scaleX: 1,
            scaleY: 1,
            rotateSkew0: 0,
            rotateSkew1: 0,
            x: 0,
            y: 0
        };
        if (!roomSprite) {
            continue;
        }

        const placementsByName = new Map(
            roomSprite.placements
                .filter((placement) => placement.name && placement.matrix)
                .map((placement) => [placement.name, placement])
        );

        for (const field of room.fields) {
            const placement = placementsByName.get(field.sourceVar);
            if (!placement?.matrix) {
                continue;
            }

            const type = resolveHardType(field.type, spec, entTypes);
            const entType = entTypes[type] ?? {};
            const rank = String(entType.EntRank ?? '');
            const authoredBossCue = isExplicitBossCue(field);
            const roomHasExplicitBossCue = room.fields.some(isExplicitBossCue);
            if (
                excludedBossCue(field) ||
                (rank !== 'Boss' && !authoredBossCue) ||
                (levelHasExplicitBossCue && !roomHasExplicitBossCue)
            ) {
                continue;
            }

            const spawnIndex = bosses.length;
            const canonicalId = 9_300_000 + (levelOrdinal * 1_000) + spawnIndex + 1;
            const displayName = String(
                field.props.characterName ??
                field.props.displayName ??
                type
            ).trim();
            const boss = {
                id: canonicalId,
                canonicalId,
                spawnIndex,
                type,
                name: type,
                x: roundPosition((roomMatrix.scaleX * placement.matrix.x) + (roomMatrix.rotateSkew0 * placement.matrix.y) + roomMatrix.x),
                y: roundPosition((roomMatrix.rotateSkew1 * placement.matrix.x) + (roomMatrix.scaleY * placement.matrix.y) + roomMatrix.y),
                roomId: room.roomId,
                hostile: true,
                serverSpawn: true,
                requiredForClear: false,
                boss: true,
                miniboss: false,
                roomBoss: true,
                isRoomBoss: true,
                roomBossName: displayName || type,
                displayName: displayName || type,
                scripted: true,
                classification: 'boss',
                sourceRoom: room.className,
                sourceScript: room.className,
                sourceVar: field.sourceVar,
                sourceLine: field.sourceLine,
                sourceSymbolId: room.symbolId,
                sourceCharacterId: placement.characterId,
                depth: placement.depth
            };
            if (!authoredRoomMatrix) {
                boss.coordinateSpace = 'room-local fallback; canonical position converges when the client boss cue attaches';
            }
            boss.spawnKey = buildBossSpawnKey(levelName, boss);
            bosses.push(boss);
        }
    }

    const seen = new Set();
    return bosses.filter((boss) => {
        const key = `${normalizeBossKey(boss.type)}:${boss.roomId}:${Math.round(boss.x)}:${Math.round(boss.y)}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function buildRawBossFallbacks(repoRoot, levelName, spec, entTypes, levelOrdinal) {
    const normalLevel = spec.isHard && levelName.endsWith('Hard') ? levelName.slice(0, -4) : levelName;
    const candidates = [levelName, normalLevel];
    for (const candidate of candidates) {
        const npcPath = path.join(repoRoot, 'src', 'server', 'data', 'npcs', `${candidate}.json`);
        if (!fs.existsSync(npcPath)) {
            continue;
        }
        const npcs = readJson(npcPath);
        const bosses = Array.isArray(npcs)
            ? npcs.filter((npc) => {
                const type = resolveHardType(String(npc?.name ?? ''), spec, entTypes);
                return Number(npc?.team ?? 0) === 2 && String(entTypes[type]?.EntRank ?? '') === 'Boss';
            })
            : [];
        if (bosses.length === 0) {
            continue;
        }
        return bosses.map((npc, spawnIndex) => {
            const type = resolveHardType(String(npc.name), spec, entTypes);
            const canonicalId = 9_300_000 + (levelOrdinal * 1_000) + spawnIndex + 1;
            const boss = {
                id: canonicalId,
                canonicalId,
                spawnIndex,
                type,
                name: type,
                x: Number(npc.x ?? 0),
                y: Number(npc.y ?? 0),
                roomId: Number(npc.roomId ?? 0),
                hostile: true,
                serverSpawn: true,
                requiredForClear: false,
                boss: true,
                miniboss: false,
                roomBoss: true,
                isRoomBoss: true,
                roomBossName: String(npc.character_name ?? type).trim() || type,
                displayName: String(npc.character_name ?? type).trim() || type,
                scripted: false,
                classification: 'boss',
                sourceRoom: String(npc.sourceRoom ?? ''),
                sourceScript: `src/server/data/npcs/${candidate}.json`,
                sourceVar: '',
                sourceLine: 0,
                sourceSymbolId: 0,
                sourceCharacterId: 0,
                depth: Number(npc.render_depth_offset ?? 0)
            };
            boss.spawnKey = buildBossSpawnKey(levelName, boss);
            return boss;
        });
    }
    return [];
}

function buildEntTypeMap(repoRoot) {
    const entTypes = readJson(path.join(repoRoot, 'src', 'server', 'data', 'EntTypes.json')).EntTypes?.EntType ?? [];
    const map = {};
    for (const entType of entTypes) {
        map[entType.EntName] = entType;
    }
    return map;
}

function main() {
    const repoRoot = resolveRepoRoot();
    const ffdecPath = detectFfdec(repoRoot);
    if (!ffdecPath) {
        throw new Error('FFDec not found. Install JPEXS FFDec or add it under build/ffdec.');
    }

    const levelConfig = readJson(path.join(repoRoot, 'src', 'server', 'data', 'level_config.json'));
    const entTypes = buildEntTypeMap(repoRoot);
    const manifest = {};
    const swfCache = new Map();
    const swfSpriteCache = new Map();
    const bossSpawnLevels = [];
    let levelOrdinal = 0;

    for (const [levelName, rawSpec] of Object.entries(levelConfig)) {
        const spec = parseLevelSpec(rawSpec);
        if (!spec.isDungeon || !spec.swf || !spec.symbol) {
            continue;
        }
        levelOrdinal += 1;

        if (!swfCache.has(spec.swf)) {
            swfCache.set(spec.swf, exportSwfScripts(repoRoot, ffdecPath, spec.swf));
        }

        const scriptsRoot = swfCache.get(spec.swf);
        if (!scriptsRoot) {
            manifest[levelName] = { elements: [], enemyTypes: [], source: 'missing-swf', rooms: [] };
            continue;
        }

        const roomFiles = getMatchingRoomFiles(scriptsRoot, levelName, spec.symbol);
        const enemyCounts = {};
        const elementCounts = {};

        for (const roomFile of roomFiles) {
            const source = fs.readFileSync(path.join(scriptsRoot, roomFile), 'utf8');
            for (const rawEntName of extractCueTypes(source)) {
                const entName = spec.isHard && !rawEntName.endsWith('Hard') && resolveEntType(`${rawEntName}Hard`, entTypes)
                    ? `${rawEntName}Hard`
                    : rawEntName;
                const entType = resolveEntType(entName, entTypes);
                if (!isEnemyEntType(entName, entType)) {
                    continue;
                }
                const element = resolveElement(entType);
                if (!element) {
                    continue;
                }
                enemyCounts[entName] = (enemyCounts[entName] ?? 0) + 1;
                elementCounts[element] = (elementCounts[element] ?? 0) + 1;
            }
        }

        const elements = Object.entries(elementCounts)
            .sort((left, right) => {
                if (right[1] !== left[1]) {
                    return right[1] - left[1];
                }
                return ELEMENT_ORDER.indexOf(left[0]) - ELEMENT_ORDER.indexOf(right[0]);
            })
            .map(([element]) => element);

        const enemyTypes = Object.entries(enemyCounts)
            .sort((left, right) => {
                if (right[1] !== left[1]) {
                    return right[1] - left[1];
                }
                return left[0].localeCompare(right[0]);
            })
            .map(([enemyType, count]) => ({ enemyType, count }));

        manifest[levelName] = {
            elements,
            enemyTypes,
            source: roomFiles.length > 0 ? 'level-swf' : 'no-matching-rooms',
            rooms: roomFiles.map((file) => file.replace(/\.as$/, ''))
        };

        if (!LEGACY_SERVER_AUTHORITY_LEVELS.has(levelName)) {
            let bosses = buildBossSpawnsForLevel(
                repoRoot,
                levelName,
                spec,
                scriptsRoot,
                roomFiles,
                entTypes,
                levelOrdinal,
                swfSpriteCache
            );
            if (bosses.length === 0) {
                bosses = buildRawBossFallbacks(repoRoot, levelName, spec, entTypes, levelOrdinal);
            }
            if (bosses.length > 0) {
                bossSpawnLevels.push({
                    levelId: spec.swf.replace(/\.swf$/i, ''),
                    levelName,
                    dungeonName: levelName,
                    source: {
                        swf: `src/client/content/localhost/p/${findSwf(repoRoot, spec.swf)?.includes('/cam/') ? 'cam' : 'cbp'}/${spec.swf}`,
                        levelClass: spec.symbol,
                        roomClasses: roomFiles.map((file) => file.replace(/\.as$/, '')),
                        extractor: 'src/server/scripts/generate-dungeon-enemy-elements.js'
                    },
                    generatedFromScript: roomFiles.length > 0,
                    coordinates: 'absolute world pixels from SWF room placement MATRIX plus boss cue MATRIX',
                    enemies: bosses
                });
            }
        }
    }

    const outputPath = path.join(repoRoot, 'src', 'server', 'data', 'dungeon_enemy_elements.json');
    fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const bossOutputPath = path.join(repoRoot, 'src', 'server', 'data', 'dungeonSpawns', 'global_dungeon_bosses.json');
    fs.writeFileSync(bossOutputPath, `${JSON.stringify({
        generatedBy: 'src/server/scripts/generate-dungeon-enemy-elements.js',
        bossScope: 'all authored Boss cues; regular hostiles remain client-owned',
        levels: bossSpawnLevels
    }, null, 2)}\n`);

    const detected = Object.values(manifest).filter((entry) => entry.elements.length > 0).length;
    const total = Object.keys(manifest).length;
    console.log(`[DungeonEnemyElements] Wrote ${outputPath}`);
    console.log(`[DungeonEnemyElements] Detected elements for ${detected}/${total} dungeon entries.`);
    console.log(`[DungeonBossSpawns] Wrote ${bossOutputPath}`);
    console.log(`[DungeonBossSpawns] Exported ${bossSpawnLevels.reduce((sum, level) => sum + level.enemies.length, 0)} bosses for ${bossSpawnLevels.length} dungeon variants.`);
}

main();
