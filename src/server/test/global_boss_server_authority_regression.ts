import './helpers/disable_production_mongo';
import { strict as assert } from 'assert';
import * as path from 'path';
import { GlobalState } from '../core/GlobalState';
import { GameData } from '../core/GameData';
import { LevelConfig } from '../core/LevelConfig';
import { Entity, EntityState, EntityTeam } from '../core/Entity';
import { DungeonSpawnLoader } from '../data/DungeonSpawnLoader';
import { NpcLoader } from '../data/NpcLoader';
import { CombatHandler } from '../handlers/CombatHandler';
import { EntityHandler } from '../handlers/EntityHandler';
import { BitBuffer } from '../network/protocol/bitBuffer';
import { getLevelScopeKey } from '../core/LevelScope';

type FakeClient = {
    token: number;
    character: { name: string; level: number; class: string; MasterClass: number; CurrentLevel: { name: string; x: number; y: number } };
    currentLevel: string;
    levelInstanceId: string;
    syncAnchorStartedAt: number;
    currentRoomId: number;
    playerSpawned: boolean;
    clientEntID: number;
    userId: number;
    authoritativeMaxHp: number;
    authoritativeCurrentHp: number;
    processedRewardSources: Set<string>;
    pendingLoot: Map<number, any>;
    knownEntityIds: Set<number>;
    entityIdAliases: Map<number, number>;
    sharedEntityRemoteUpdateDeferredIds: Set<number>;
    startedRoomEvents: Set<string>;
    entities: Map<number, any>;
    sentPackets: Array<{ id: number; payload: Buffer }>;
    send: (id: number, payload: Buffer) => void;
    sendBitBuffer: (id: number, bb: BitBuffer) => void;
};

const WOLFS_END_BOSS_LEVELS = [
    'TutorialBoat',
    'TutorialDungeon',
    'TutorialDungeonHard',
    'GoblinRiverDungeon',
    'GoblinRiverDungeonHard',
    'GhostBossDungeon',
    'GhostBossDungeonHard',
    'DreamDragonDungeon',
    'DreamDragonDungeonHard'
] as const;

function ensureDataLoaded(): void {
    const dataDir = path.resolve(__dirname, '../data');
    LevelConfig.load(dataDir);
    GameData.load(dataDir);
    NpcLoader.load(dataDir);
}

function createFakeClient(levelName: string, instanceId: string, token: number): FakeClient {
    const sentPackets: Array<{ id: number; payload: Buffer }> = [];
    return {
        token,
        character: {
            name: `BossTester${token}`,
            level: 50,
            class: 'mage',
            MasterClass: 0,
            CurrentLevel: { name: levelName, x: 100, y: 200 }
        },
        currentLevel: levelName,
        levelInstanceId: instanceId,
        syncAnchorStartedAt: token,
        currentRoomId: 1,
        playerSpawned: true,
        clientEntID: token + 1000,
        userId: token,
        authoritativeMaxHp: 5000,
        authoritativeCurrentHp: 5000,
        processedRewardSources: new Set<string>(),
        pendingLoot: new Map<number, any>(),
        knownEntityIds: new Set<number>(),
        entityIdAliases: new Map<number, number>(),
        sharedEntityRemoteUpdateDeferredIds: new Set<number>(),
        startedRoomEvents: new Set<string>(),
        entities: new Map<number, any>(),
        sentPackets,
        send(id: number, payload: Buffer) {
            sentPackets.push({ id, payload: Buffer.from(payload) });
        },
        sendBitBuffer(id: number, bb: BitBuffer) {
            sentPackets.push({ id, payload: bb.toBuffer() });
        }
    };
}

function attachPlayer(client: FakeClient): void {
    const scope = getLevelScopeKey(client.currentLevel, client.levelInstanceId);
    const player = {
        ...Entity.fromCharacter(client.clientEntID, client.character as never, {
            x: 100,
            y: 200,
            team: EntityTeam.PLAYER,
            entState: EntityState.ACTIVE,
            roomId: client.currentRoomId
        }),
        ownerToken: client.token,
        ownerUserId: client.userId,
        hp: client.authoritativeCurrentHp,
        maxHp: client.authoritativeMaxHp
    };
    client.entities.set(client.clientEntID, player);
    client.knownEntityIds.add(client.clientEntID);
    let levelMap = GlobalState.levelEntities.get(scope);
    if (!levelMap) {
        levelMap = new Map<number, any>();
        GlobalState.levelEntities.set(scope, levelMap);
    }
    levelMap.set(client.clientEntID, player);
}

function buildHostileFullUpdate(entityId: number, name: string, x: number, y: number, roomId: number): Buffer {
    const payload = (EntityHandler as any).buildEntityFullUpdatePayload({
        id: entityId,
        name,
        isPlayer: false,
        x,
        y,
        v: 0,
        team: EntityTeam.ENEMY,
        renderDepthOffset: 0,
        characterName: '',
        dramaAnim: '',
        sleepAnim: '',
        summonerId: 0,
        powerId: 0,
        entState: EntityState.ACTIVE,
        facingLeft: false,
        running: false,
        jumping: false,
        dropping: false,
        backpedal: false,
        roomId
    });
    return Buffer.concat([payload, Buffer.from([0])]);
}

function buildPowerCastPayload(sourceId: number, powerId: number = 77): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod4(sourceId);
    bb.writeMethod4(powerId);
    for (let index = 0; index < 6; index++) {
        bb.writeMethod15(false);
    }
    return bb.toBuffer();
}

function buildPowerHitPayload(targetId: number, sourceId: number, damage: number, powerId: number = 77): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod4(targetId);
    bb.writeMethod4(sourceId);
    bb.writeMethod24(damage);
    bb.writeMethod4(powerId);
    bb.writeMethod15(false);
    bb.writeMethod15(false);
    bb.writeMethod15(false);
    return bb.toBuffer();
}

function testGlobalBossRegistry(): void {
    const loadedLevels = DungeonSpawnLoader.getLoadedLevelNames();
    const globalBossLevels = loadedLevels.filter((levelName) => levelName !== 'JC_Mini2');
    assert.equal(globalBossLevels.length, 130, 'global registry must cover every authored boss level not already using legacy server authority');

    let bossCount = 0;
    let serverHostileCount = 0;
    const ids = new Set<number>();
    const spawnKeys = new Set<string>();
    for (const levelName of globalBossLevels) {
        const config = DungeonSpawnLoader.getSpawnConfigForLevel(levelName);
        assert.ok(config, `${levelName} must have a boss spawn config`);
        assert.ok(config.enemies.length > 0, `${levelName} must export at least one server-authority hostile`);
        assert.ok(config.enemies.some((enemy) => enemy.boss === true), `${levelName} must preserve at least one authored boss`);
        for (const enemy of config.enemies) {
            serverHostileCount += 1;
            if (enemy.boss === true) {
                bossCount += 1;
            }
            assert.equal(enemy.serverSpawn, true, `${levelName}/${enemy.type} must be server-spawned`);
            assert.notEqual(enemy.miniboss, true, `${levelName}/${enemy.type} must not broaden the feature to minibosses`);
            assert.ok(Number.isFinite(Number(enemy.x)) && Number.isFinite(Number(enemy.y)), `${levelName}/${enemy.type} needs finite coordinates`);
            assert.ok(!ids.has(Number(enemy.canonicalId)), `${levelName}/${enemy.type} canonical id must be globally unique`);
            assert.ok(!spawnKeys.has(String(enemy.spawnKey)), `${levelName}/${enemy.type} spawn key must be globally unique`);
            ids.add(Number(enemy.canonicalId));
            spawnKeys.add(String(enemy.spawnKey));
        }
    }
    assert.equal(bossCount, 160, 'global registry must preserve all authored server-owned boss slots');
    assert.ok(serverHostileCount >= bossCount, 'scripted dungeon waves may add server-owned non-boss hostiles without changing boss coverage');

    for (const levelName of WOLFS_END_BOSS_LEVELS) {
        assert.equal(EntityHandler.hasServerSpawnedHostiles(levelName), true, `${levelName} must enable server-authority hostile spawning`);
        assert.ok(DungeonSpawnLoader.getNpcsForLevel(levelName).length > 0, `${levelName} must expose its canonical hostile seed`);
    }
}

async function testWolfsEndBossProxyAndRegularHostile(levelName: 'TutorialDungeon' | 'TutorialDungeonHard'): Promise<void> {
    const client = createFakeClient(levelName, `global-boss-${levelName}`, levelName.endsWith('Hard') ? 52002 : 51001);
    attachPlayer(client);
    GlobalState.sessionsByToken.set(client.token, client as never);
    EntityHandler.sendInitialLevelEntities(client as never, levelName);

    const scope = getLevelScopeKey(levelName, client.levelInstanceId);
    const levelMap = GlobalState.levelEntities.get(scope);
    assert.ok(levelMap, `${levelName} must have a level entity map`);
    const bosses = Array.from(levelMap.values()).filter((entity) =>
        EntityHandler.isServerAuthorityHostileEntity(levelName, entity)
    );
    assert.equal(bosses.length, 1, `${levelName} must seed exactly one canonical boss`);
    const boss = bosses[0];
    assert.equal(Boolean(boss.clientSpawned), false, `${levelName} boss must be server canonical`);

    const localBossId = levelName.endsWith('Hard') ? 820002 : 810001;
    EntityHandler.handleEntityFullUpdate(
        client as never,
        buildHostileFullUpdate(localBossId, String(boss.name), Number(boss.x), Number(boss.y), Number(boss.roomId))
    );
    assert.equal(EntityHandler.resolveEntityAlias(client as never, localBossId), boss.id, `${levelName} client boss cue must alias to canonical boss`);
    assert.equal(levelMap.has(localBossId), false, `${levelName} client boss cue must not create a second canonical entity`);

    const regularLocalId = localBossId + 100;
    const regularName = levelName.endsWith('Hard') ? 'GoblinDaggerHard' : 'GoblinDagger';
    EntityHandler.handleEntityFullUpdate(
        client as never,
        buildHostileFullUpdate(regularLocalId, regularName, Number(boss.x) - 500, Number(boss.y), Number(boss.roomId))
    );
    assert.equal(EntityHandler.resolveEntityAlias(client as never, regularLocalId), regularLocalId, `${levelName} regular hostile must stay client-owned`);
    assert.equal(Boolean(client.entities.get(regularLocalId)?.clientSpawned), true, `${levelName} regular hostile must remain a client spawn`);
    assert.equal(EntityHandler.isServerAuthorityHostileEntity(levelName, client.entities.get(regularLocalId)), false, `${levelName} regular hostile must not enter boss authority`);

    client.currentRoomId = Number(boss.roomId);
    await CombatHandler.handlePowerCast(client as never, buildPowerCastPayload(client.clientEntID));
    await CombatHandler.handlePowerHit(
        client as never,
        buildPowerHitPayload(localBossId, client.clientEntID, Math.max(1, Number(boss.hp ?? boss.maxHp ?? 1)) + 1)
    );
    assert.equal(boss.hp, 0, `${levelName} lethal player damage must commit canonical boss HP`);
    assert.equal(boss.dead, true, `${levelName} lethal player damage must mark canonical boss dead`);
    assert.equal(boss.destroyed, true, `${levelName} lethal player damage must finalize canonical boss destruction`);
    assert.equal(Math.max(0, Number(boss.deathVersion ?? 0)), 1, `${levelName} canonical boss death must commit once`);
}

function testMultiBossProxyIdentity(): void {
    const levelName = 'SD_Mission4';
    const client = createFakeClient(levelName, 'global-boss-multi-identity', 53003);
    attachPlayer(client);
    GlobalState.sessionsByToken.set(client.token, client as never);
    EntityHandler.sendInitialLevelEntities(client as never, levelName);

    const scope = getLevelScopeKey(levelName, client.levelInstanceId);
    const canonicalBosses = Array.from(GlobalState.levelEntities.get(scope)?.values() ?? [])
        .filter((entity) => EntityHandler.isServerAuthorityHostileEntity(levelName, entity))
        .sort((left, right) => Number(left.id) - Number(right.id));
    assert.equal(canonicalBosses.length, 4, 'SD_Mission4 must seed all four distinct boss actors');

    const resolvedCanonicalIds = new Set<number>();
    for (const [index, boss] of canonicalBosses.entries()) {
        const localId = 830100 + index;
        EntityHandler.handleEntityFullUpdate(
            client as never,
            buildHostileFullUpdate(localId, String(boss.name), Number(boss.x), Number(boss.y), Number(boss.roomId))
        );
        const resolved = EntityHandler.resolveEntityAlias(client as never, localId);
        assert.equal(resolved, boss.id, `${boss.name} proxy must resolve by its authored position`);
        resolvedCanonicalIds.add(resolved);
    }
    assert.equal(resolvedCanonicalIds.size, 4, 'same-room multi-boss proxies must not collapse onto one canonical id');
}

async function main(): Promise<void> {
    const levelEntities = new Map(GlobalState.levelEntities);
    const sessionsByToken = new Map(GlobalState.sessionsByToken);
    const partyByMember = new Map(GlobalState.partyByMember);
    const partyGroups = new Map(GlobalState.partyGroups);
    ensureDataLoaded();
    try {
        GlobalState.levelEntities.clear();
        GlobalState.sessionsByToken.clear();
        GlobalState.partyByMember.clear();
        GlobalState.partyGroups.clear();
        testGlobalBossRegistry();

        GlobalState.levelEntities.clear();
        GlobalState.sessionsByToken.clear();
        await testWolfsEndBossProxyAndRegularHostile('TutorialDungeon');

        GlobalState.levelEntities.clear();
        GlobalState.sessionsByToken.clear();
        await testWolfsEndBossProxyAndRegularHostile('TutorialDungeonHard');

        GlobalState.levelEntities.clear();
        GlobalState.sessionsByToken.clear();
        testMultiBossProxyIdentity();

        console.log('global_boss_server_authority_regression: ok');
    } finally {
        GlobalState.levelEntities = levelEntities;
        GlobalState.sessionsByToken = sessionsByToken;
        GlobalState.partyByMember = partyByMember;
        GlobalState.partyGroups = partyGroups;
    }
}

void main().catch((error) => {
    console.error('global_boss_server_authority_regression: failed');
    console.error(error);
    process.exitCode = 1;
});
