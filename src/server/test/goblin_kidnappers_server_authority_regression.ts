import './helpers/disable_production_mongo';
import { strict as assert } from 'assert';
import * as path from 'path';
import { AILogic } from '../core/AILogic';
import { DungeonSession } from '../core/DungeonSession';
import { EntityState, EntityTeam } from '../core/Entity';
import { GameData } from '../core/GameData';
import { GlobalState } from '../core/GlobalState';
import { LevelConfig } from '../core/LevelConfig';
import { getLevelScopeKey } from '../core/LevelScope';
import { DungeonSpawnLoader } from '../data/DungeonSpawnLoader';
import { BitBuffer } from '../network/protocol/bitBuffer';

type FakeClient = {
    token: number;
    userId: number;
    clientEntID: number;
    currentLevel: string;
    levelInstanceId: string;
    currentRoomId: number;
    playerSpawned: boolean;
    startedRoomEvents: Set<string>;
    knownEntityIds: Set<number>;
    entityIdAliases: Map<number, number>;
    entities: Map<number, any>;
    sentPackets: Array<{ id: number; payload: Buffer }>;
    character: {
        name: string;
        level: number;
        class: string;
        MasterClass: number;
        questTrackerState: number;
        CurrentLevel: { name: string; x: number; y: number };
    };
    send: (id: number, payload: Buffer) => void;
    sendBitBuffer: (id: number, payload: BitBuffer) => void;
};

const LEVEL = 'TutorialDungeon';
const INSTANCE = 'goblin-kidnappers-authority-regression';

function createClient(token: number, roomId: number = 0): FakeClient {
    const sentPackets: Array<{ id: number; payload: Buffer }> = [];
    return {
        token,
        userId: token,
        clientEntID: token + 1000,
        currentLevel: LEVEL,
        levelInstanceId: INSTANCE,
        currentRoomId: roomId,
        playerSpawned: true,
        startedRoomEvents: new Set<string>(),
        knownEntityIds: new Set<number>(),
        entityIdAliases: new Map<number, number>(),
        entities: new Map<number, any>(),
        sentPackets,
        character: {
            name: `GoblinKidnappersTester${token}`,
            level: 30,
            class: 'mage',
            MasterClass: 0,
            questTrackerState: 0,
            CurrentLevel: { name: LEVEL, x: 150, y: 0 }
        },
        send(id: number, payload: Buffer) {
            sentPackets.push({ id, payload: Buffer.from(payload) });
        },
        sendBitBuffer(id: number, payload: BitBuffer) {
            sentPackets.push({ id, payload: payload.toBuffer() });
        }
    };
}

function resetState(): void {
    GlobalState.sessionsByToken.clear();
    GlobalState.levelEntities.clear();
    GlobalState.dungeonSessions.clear();
}

function loadData(): void {
    const dataDir = path.resolve(__dirname, '../data');
    LevelConfig.load(dataDir);
    GameData.load(dataDir);
    DungeonSpawnLoader.load(dataDir);
}

function testExtractedRoster(): void {
    const config = DungeonSpawnLoader.getSpawnConfigForLevel(LEVEL);
    assert.ok(config, 'Goblin Kidnappers must have a dedicated extracted spawn registry');
    assert.equal(config.enemies.length, 76, 'all 76 authored combat cues must have canonical identities');
    assert.equal(config.enemies.filter((enemy) => enemy.boss === true).length, 1, 'Tag Ugo must be the single canonical boss');
    assert.equal(new Set(config.enemies.map((enemy) => enemy.canonicalId)).size, 76, 'canonical entity ids must be unique');
    assert.equal(new Set(config.enemies.map((enemy) => enemy.spawnKey)).size, 76, 'spawn keys must be unique');
    assert.ok(config.enemies.every((enemy) => enemy.serverSpawn === true), 'normal enemies and boss must be server spawned');
    assert.deepEqual(
        [...new Set(config.enemies.map((enemy) => Number(enemy.roomId)))].sort((a, b) => a - b),
        [0, 2, 3, 4, 5, 6, 7, 8],
        'combat cues must retain their authored room ownership'
    );
}

function testMonotonicSessionLateJoinAndLeaderExit(): { scope: string; member: FakeClient; reconnect: FakeClient } {
    const leader = createClient(101);
    const member = createClient(102);
    GlobalState.sessionsByToken.set(leader.token, leader as never);
    GlobalState.sessionsByToken.set(member.token, member as never);

    const scope = getLevelScopeKey(LEVEL, INSTANCE);
    const leaderState = DungeonSession.getOrCreate(leader as never);
    const memberState = DungeonSession.getOrCreate(member as never);
    assert.ok(leaderState && memberState);
    assert.equal(leaderState, memberState, 'party members must attach to one dungeon session');

    assert.equal(DungeonSession.requestRoomChange(member as never, 4), 4);
    const transitionVersion = leaderState.transitionVersion;
    assert.equal(leader.currentRoomId, 4, 'one room transition must update every connected player');
    assert.equal(DungeonSession.requestRoomChange(leader as never, 4), 4);
    assert.equal(leaderState.transitionVersion, transitionVersion, 'duplicate room triggers must be idempotent');
    assert.equal(DungeonSession.requestRoomChange(leader as never, 2), 4, 'backward room transitions must be rejected');
    assert.deepEqual([...leaderState.completedRoomIds], [0, 1, 2, 3]);

    DungeonSession.updateProgress(scope, 63);
    DungeonSession.noteCutscene(scope, 1, 'kidnapper_intro', true);
    DungeonSession.noteCutscene(scope, 1, 'kidnapper_intro', true);
    assert.equal(leaderState.triggeredCutscenes.size, 1, 'cutscene completion must be idempotent');

    DungeonSession.detachClient(leader as never);
    GlobalState.sessionsByToken.delete(leader.token);
    assert.equal(DungeonSession.get(scope), leaderState, 'the session must survive party leader exit');
    assert.deepEqual([...leaderState.connectedPlayerIds], [member.clientEntID]);

    const reconnect = createClient(103);
    GlobalState.sessionsByToken.set(reconnect.token, reconnect as never);
    DungeonSession.getOrCreate(reconnect as never);
    assert.equal(reconnect.currentRoomId, 4, 'late join/reconnect must hydrate the authoritative room');
    assert.equal(reconnect.character.questTrackerState, 63, 'late join/reconnect must hydrate progress');
    assert.ok(reconnect.startedRoomEvents.has(`${LEVEL}:0`) && reconnect.startedRoomEvents.has(`${LEVEL}:4`));
    return { scope, member, reconnect };
}

function testServerAiAndSnapshot(scope: string, member: FakeClient, reconnect: FakeClient): void {
    const canonicalId = 9500040;
    const hostile: any = {
        id: canonicalId,
        canonicalId,
        name: 'GoblinDagger',
        entType: 'GoblinDagger',
        isPlayer: false,
        team: EntityTeam.ENEMY,
        entState: EntityState.ACTIVE,
        roomId: 4,
        x: 0,
        y: 0,
        v: 0,
        hp: 120,
        maxHp: 120,
        serverSpawned: true,
        serverAuthorityHostile: true,
        generatedFromScript: true,
        localIdsByToken: new Map<number, number>([[member.token, 7001]])
    };
    const entities = new Map<number, any>([[canonicalId, hostile]]);
    GlobalState.levelEntities.set(scope, entities);
    member.knownEntityIds.add(canonicalId);
    reconnect.knownEntityIds.add(canonicalId);

    assert.equal(DungeonSession.canPlayerInteractWithEntity(member as never, hostile), true);
    member.currentRoomId = 3;
    assert.equal(DungeonSession.canPlayerInteractWithEntity(member as never, hostile), false, 'players cannot damage enemies in an old room');
    member.currentRoomId = 4;

    const previousX = hostile.x;
    AILogic.updateLevel(scope);
    assert.ok(hostile.x > previousX, 'server AI must continue moving an activated enemy without the leader');
    assert.equal(hostile.aggroTargetEntityId, member.clientEntID, 'server AI must own target selection');
    assert.equal(hostile.attackState, 'chasing');

    const snapshot = DungeonSession.snapshot(scope);
    assert.ok(snapshot);
    assert.equal(snapshot.currentRoomId, 4);
    assert.equal(snapshot.progressPercent, 63);
    assert.deepEqual(snapshot.connectedPlayerIds, [member.clientEntID, reconnect.clientEntID]);
    assert.equal(snapshot.activeEntities.length, 1);
    assert.equal(snapshot.activeEntities[0].entityId, canonicalId);
    assert.equal(snapshot.activeEntities[0].targetPlayerId, member.clientEntID);
    assert.equal(snapshot.activeEntities[0].state, String(EntityState.ACTIVE));
}

function main(): void {
    resetState();
    loadData();
    testExtractedRoster();
    const { scope, member, reconnect } = testMonotonicSessionLateJoinAndLeaderExit();
    testServerAiAndSnapshot(scope, member, reconnect);
    resetState();
    console.log('Goblin Kidnappers server-authority regression checks passed.');
}

main();
