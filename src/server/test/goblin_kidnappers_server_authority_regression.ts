import { strict as assert } from 'assert';
import * as path from 'path';
import { EntityState, EntityTeam } from '../core/Entity';
import { GameData } from '../core/GameData';
import { GlobalState } from '../core/GlobalState';
import { LevelConfig } from '../core/LevelConfig';
import { getClientLevelScope } from '../core/LevelScope';
import {
    applyTutorialDungeonSnapshotClientState,
    GOBLIN_KIDNAPPERS_INITIAL_PROGRESS,
    GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET_ID,
    TutorialDungeonClientSnapshotState,
    TutorialDungeonMechanics,
    TutorialDungeonSnapshot
} from '../core/TutorialDungeonMechanics';
import { NpcLoader } from '../data/NpcLoader';
import { LevelHandler } from '../handlers/LevelHandler';
import { BitBuffer } from '../network/protocol/bitBuffer';

type SentPacket = { id: number; payload: Buffer };

type FakeClient = {
    authenticated: boolean;
    currentLevel: string;
    levelInstanceId: string;
    currentRoomId: number;
    token: number;
    userId: number;
    playerSpawned: boolean;
    clientEntID: number;
    character: any;
    sentPackets: SentPacket[];
    entities: Map<number, any>;
    knownEntityIds: Set<number>;
    entityIdAliases: Map<number, number>;
    startedRoomEvents: Set<string>;
    lastEmoteName: string;
    lastEmoteAt: number;
    send(id: number, payload: Buffer): void;
    sendBitBuffer(id: number, bb: BitBuffer): void;
};

function ensureDataLoaded(): void {
    const dataDir = path.resolve(__dirname, '../data');
    if (!LevelConfig.has('TutorialDungeon')) {
        LevelConfig.load(dataDir);
    }
    if (Object.keys(GameData.ENTTYPES).length === 0) {
        GameData.load(dataDir);
    }
    NpcLoader.load(dataDir);
}

function createFakeClient(name: string, token: number, instanceId: string): FakeClient {
    const sentPackets: SentPacket[] = [];
    const clientEntID = token + 100000;
    const character = {
        name,
        CurrentLevel: { name: 'TutorialDungeon', x: 1327, y: 1880 },
        questTrackerState: GOBLIN_KIDNAPPERS_INITIAL_PROGRESS,
        level: 12,
        xp: 0,
        gold: 0
    };
    const client: FakeClient = {
        authenticated: true,
        currentLevel: 'TutorialDungeon',
        levelInstanceId: instanceId,
        currentRoomId: 1,
        token,
        userId: token,
        playerSpawned: true,
        clientEntID,
        character,
        sentPackets,
        entities: new Map(),
        knownEntityIds: new Set(),
        entityIdAliases: new Map(),
        startedRoomEvents: new Set(),
        lastEmoteName: '',
        lastEmoteAt: 0,
        send(id: number, payload: Buffer) {
            sentPackets.push({ id, payload: Buffer.from(payload) });
        },
        sendBitBuffer(id: number, bb: BitBuffer) {
            sentPackets.push({ id, payload: bb.toBuffer() });
        }
    };
    setRoom(client, 1, 1327, 1880);
    return client;
}

function setRoom(client: FakeClient, roomId: number, x: number, y: number): void {
    client.currentRoomId = roomId;
    client.character.CurrentLevel = { name: 'TutorialDungeon', x, y };
    client.entities.set(client.clientEntID, {
        id: client.clientEntID,
        isPlayer: true,
        x,
        y,
        roomId
    });
}

function register(...clients: FakeClient[]): void {
    for (const client of clients) {
        GlobalState.sessionsByToken.set(client.token, client as never);
    }
}

function clearHarness(...scopes: string[]): void {
    GlobalState.sessionsByToken.clear();
    GlobalState.levelEntities.clear();
    GlobalState.levelQuestProgress.clear();
    GlobalState.dungeonCutscenes.clear();
    for (const scope of scopes) {
        TutorialDungeonMechanics.resetState(scope);
    }
}

function latestSnapshot(client: FakeClient): TutorialDungeonSnapshot {
    const packet = [...client.sentPackets].reverse().find((entry) => entry.id === GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET_ID);
    assert.ok(packet, `${client.character.name} should have a snapshot packet`);
    return TutorialDungeonMechanics.parseSnapshotPayload(packet.payload);
}

function revision(client: FakeClient): number {
    return TutorialDungeonMechanics.getClientState(client as never)?.revision ?? -1;
}

function progress(client: FakeClient): number {
    return TutorialDungeonMechanics.getClientState(client as never)?.progress ?? -1;
}

function logicalObjectiveRequest(client: FakeClient, key: string, roomId: number, expectedRevision = revision(client)): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod6(2, 2);
    bb.writeMethod4(1);
    bb.writeMethod13(getClientLevelScope(client as never));
    bb.writeMethod4(expectedRevision);
    bb.writeMethod13(key);
    bb.writeMethod9(roomId);
    return bb.toBuffer();
}

function roomPacket(roomId: number): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod9(roomId);
    return bb.toBuffer();
}

function completeIntroAndDummies(client: FakeClient): void {
    setRoom(client, 1, 1327, 1880);
    assert.equal(TutorialDungeonMechanics.breakChain(client as never, 3268190, revision(client)).status, 'applied');
    setRoom(client, 2, 4000, 2099);
    for (const id of [4841054, 4906590, 4972126]) {
        assert.equal(TutorialDungeonMechanics.completeDummy(client as never, id, revision(client)).status, 'applied');
    }
}

function completeTraversal(client: FakeClient): void {
    setRoom(client, 4, 7271, 2074);
    assert.equal(TutorialDungeonMechanics.startCutscene(client as never, 'traversal', 4, 'jump_and_drop', revision(client)).status, 'applied');
    assert.equal(TutorialDungeonMechanics.advanceCutscene(client as never, 'traversal', 4, 2, revision(client)).status, 'applied');
    assert.equal(TutorialDungeonMechanics.completeCutscene(client as never, 'traversal', 4, revision(client)).status, 'applied');
}

function openChestAndGrantReward(client: FakeClient, id: number, roomId: number, x: number, y: number): void {
    setRoom(client, roomId, x, y);
    assert.equal(TutorialDungeonMechanics.openChest(client as never, id, revision(client)).status, 'applied');
    assert.equal(TutorialDungeonMechanics.noteRewardsGranted(client as never, { id }).status, 'applied');
}

function testStableCatalogAndInternalIdentity(): void {
    assert.equal(LevelConfig.normalizeLevelName('GoblinKidnappers'), 'TutorialDungeon');
    assert.equal(TutorialDungeonMechanics.isTutorialDungeon('TutorialDungeonHard'), false);
    const authority = TutorialDungeonMechanics.getAuthorityEntities();
    assert.deepEqual(
        authority.filter((entry) => entry.role === 'dummy').map((entry) => entry.id),
        [4841054, 4906590, 4972126]
    );
    assert.deepEqual(
        authority.filter((entry) => entry.role === 'tutorial_chest' || entry.role === 'boss_chest').map((entry) => entry.id),
        [4709982, 2612830, 2481758, 3989086]
    );
    assert.deepEqual(
        authority.filter((entry) => entry.role === 'parrot').map((entry) => entry.id),
        [3006046, 2743902, 384606, 4775518, 2547294, 712286, 3333726]
    );
    assert.equal(TutorialDungeonMechanics.getServerAuthorityEntities().length, 10);
    const serverNpcs = NpcLoader.getNpcsForLevel('TutorialDungeon');
    for (const expected of TutorialDungeonMechanics.getServerAuthorityEntities()) {
        assert.ok(serverNpcs.some((npc) => npc.id === expected.id), `canonical NPC ${expected.id} should be registered`);
    }
    const objectiveWeight = TutorialDungeonMechanics.getObjectiveTable().reduce((sum, entry) => sum + entry.weight, 0);
    assert.equal(GOBLIN_KIDNAPPERS_INITIAL_PROGRESS + objectiveWeight, 100);
}

function testChainLateJoinAndDuplicate(): void {
    const a = createFakeClient('ChainA', 61001, 'chain-scope');
    const b = createFakeClient('ChainB', 61002, 'chain-scope');
    const scope = getClientLevelScope(a as never);
    clearHarness(scope);
    register(a);

    const initialRevision = revision(a);
    assert.equal(initialRevision, 0);
    const applied = TutorialDungeonMechanics.breakChain(a as never, 'chain:3268190', initialRevision);
    assert.equal(applied.status, 'applied');
    assert.equal(applied.revision, initialRevision + 1);
    assert.equal(progress(a), 17);

    const duplicate = TutorialDungeonMechanics.breakChain(a as never, 3268190, initialRevision);
    assert.equal(duplicate.status, 'already_completed');
    assert.equal(revision(a), applied.revision);
    assert.equal(progress(a), 17);

    register(b);
    TutorialDungeonMechanics.sendSnapshot(b as never, 'late_join_test');
    const snapshot = latestSnapshot(b);
    assert.equal(snapshot.scope, scope);
    assert.equal(snapshot.revision, applied.revision);
    assert.equal(snapshot.progress, 17);
    assert.equal(snapshot.chains['3268190'].broken, true);
    assert.equal(snapshot.parrot.rescued, true);
    assert.equal(snapshot.dummies['4841054'].completed, false);
}

function testDummyBroadcastAndLateJoin(): void {
    const a = createFakeClient('DummyA', 61101, 'dummy-scope');
    const b = createFakeClient('DummyB', 61102, 'dummy-scope');
    const late = createFakeClient('DummyLate', 61103, 'dummy-scope');
    const scope = getClientLevelScope(a as never);
    clearHarness(scope);
    register(a, b);
    TutorialDungeonMechanics.breakChain(a as never, 3268190, revision(a));
    setRoom(a, 2, 4000, 2099);
    setRoom(b, 2, 4000, 2099);
    const beforeB = b.sentPackets.length;
    const result = TutorialDungeonMechanics.completeDummy(a as never, 4841054, revision(a));
    assert.equal(result.status, 'applied');
    assert.ok(b.sentPackets.slice(beforeB).some((packet) => packet.id === GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET_ID));
    assert.equal(latestSnapshot(b).dummies['4841054'].completed, true);
    assert.equal(TutorialDungeonMechanics.completeDummy(b as never, 4841054, revision(b)).status, 'already_completed');
    register(late);
    TutorialDungeonMechanics.sendSnapshot(late as never, 'dummy_late_join');
    assert.equal(latestSnapshot(late).dummies['4841054'].destroyed, true);
}

function testChestRewardsOnce(): void {
    const a = createFakeClient('ChestA', 61201, 'chest-scope');
    const b = createFakeClient('ChestB', 61202, 'chest-scope');
    const scope = getClientLevelScope(a as never);
    clearHarness(scope);
    register(a, b);
    completeIntroAndDummies(a);
    completeTraversal(a);
    const tutorialChests = [
        { id: 4709982, roomId: 5, x: 11228, y: 2381 },
        { id: 2612830, roomId: 6, x: 13252, y: 2679 },
        { id: 2481758, roomId: 8, x: 16680, y: 2566 }
    ];
    for (const chest of tutorialChests) {
        setRoom(a, chest.roomId, chest.x, chest.y);
        setRoom(b, chest.roomId, chest.x, chest.y);
        assert.equal(TutorialDungeonMechanics.openChest(a as never, chest.id, revision(a)).status, 'applied');
        assert.equal(TutorialDungeonMechanics.noteRewardsGranted(a as never, { id: chest.id }).status, 'applied');
        const rewardRevision = revision(a);
        assert.equal(TutorialDungeonMechanics.openChest(b as never, chest.id, revision(b)).status, 'already_completed');
        assert.equal(TutorialDungeonMechanics.noteRewardsGranted(b as never, { id: chest.id }).status, 'already_completed');
        assert.equal(revision(a), rewardRevision);
        assert.equal(latestSnapshot(b).chests[String(chest.id)].rewardsGranted, true);
    }
}

function testCutsceneLogicalStateAndLocalPresentation(): void {
    const a = createFakeClient('CutsceneA', 61301, 'cutscene-scope');
    const b = createFakeClient('CutsceneB', 61302, 'cutscene-scope');
    const late = createFakeClient('CutsceneLate', 61303, 'cutscene-scope');
    const scope = getClientLevelScope(a as never);
    clearHarness(scope);
    register(a, b);
    completeIntroAndDummies(a);
    setRoom(a, 4, 7271, 2074);
    setRoom(b, 4, 7271, 2074);
    assert.equal(TutorialDungeonMechanics.startCutscene(a as never, 'traversal', 4, 'jump_and_drop', revision(a)).status, 'applied');
    assert.equal(TutorialDungeonMechanics.advanceCutscene(a as never, 'traversal', 4, 3, revision(a)).status, 'applied');
    assert.equal(latestSnapshot(b).cutscenes.traversal.sequenceStep, 3);
    assert.equal(a.sentPackets.some((packet) => packet.id === 0x76), false, 'shared state must not send dialogue UI');
    assert.equal(b.sentPackets.some((packet) => packet.id === 0x76), false, 'peer must not receive local dialogue UI');
    register(late);
    TutorialDungeonMechanics.sendSnapshot(late as never, 'active_cutscene_join');
    assert.equal(latestSnapshot(late).cutscenes.traversal.state, 'active');
    assert.equal(latestSnapshot(late).cutscenes.traversal.sequenceStep, 3);
    assert.equal(TutorialDungeonMechanics.completeCutscene(a as never, 'traversal', 4, revision(a)).status, 'applied');
    const completedRevision = revision(a);
    assert.equal(TutorialDungeonMechanics.completeCutscene(b as never, 'traversal', 4, revision(b)).status, 'already_completed');
    assert.equal(revision(a), completedRevision);
    assert.equal(latestSnapshot(b).cutscenes.traversal.completionEffectApplied, true);
}

function testValidatedLogicalObjectiveRequests(): void {
    const a = createFakeClient('ObjectiveA', 61311, 'objective-scope');
    const late = createFakeClient('ObjectiveLate', 61312, 'objective-scope');
    const scope = getClientLevelScope(a as never);
    clearHarness(scope);
    register(a, late);
    completeIntroAndDummies(a);
    setRoom(a, 4, 7271, 2074);

    assert.equal(TutorialDungeonMechanics.startCutscene(a as never, 'traversal', 4, 'room_event_start', revision(a)).status, 'applied');
    LevelHandler.handleRoomClose(a as never, roomPacket(4));
    assert.equal(progress(a), 28, 'generic room-close packets must not complete a progress objective');
    assert.equal(TutorialDungeonMechanics.getClientState(a as never)?.cutscenes.get('traversal')?.state, 'active');

    const beforeRejected = revision(a);
    TutorialDungeonMechanics.handleSnapshotControl(a as never, logicalObjectiveRequest(a, 'traversal', 4));
    assert.equal(revision(a), beforeRejected, 'traversal request without a server-started room event must be rejected');
    assert.equal(progress(a), 28);

    a.startedRoomEvents.add('TutorialDungeon:5');
    TutorialDungeonMechanics.handleSnapshotControl(a as never, logicalObjectiveRequest(a, 'traversal', 4));
    assert.equal(revision(a), beforeRejected, 'traversal request outside the completed drop position must be rejected');
    setRoom(a, 4, 7500, 2200);
    TutorialDungeonMechanics.handleSnapshotControl(a as never, logicalObjectiveRequest(a, 'traversal', 4));
    assert.equal(progress(a), 39);
    assert.equal(TutorialDungeonMechanics.getClientState(a as never)?.cutscenes.get('traversal')?.state, 'completed');
    const traversalRevision = revision(a);
    TutorialDungeonMechanics.handleSnapshotControl(a as never, logicalObjectiveRequest(a, 'traversal', 4));
    assert.equal(revision(a), traversalRevision, 'duplicate traversal request must be idempotent');

    openChestAndGrantReward(a, 4709982, 5, 11228, 2381);
    openChestAndGrantReward(a, 2612830, 6, 13252, 2679);
    openChestAndGrantReward(a, 2481758, 8, 16680, 2566);
    setRoom(a, 9, 17981, 2343);
    const beforeCheer = revision(a);
    TutorialDungeonMechanics.handleSnapshotControl(a as never, logicalObjectiveRequest(a, 'cheer_gate', 9));
    assert.equal(revision(a), beforeCheer, 'cheer request without a recent self emote must be rejected');
    a.lastEmoteName = 'Cheer L';
    a.lastEmoteAt = Date.now();
    TutorialDungeonMechanics.handleSnapshotControl(a as never, logicalObjectiveRequest(a, 'cheer_gate', 9));
    assert.equal(progress(a), 83);
    assert.equal(TutorialDungeonMechanics.getClientState(a as never)?.cutscenes.get('cheer_gate')?.state, 'completed');

    TutorialDungeonMechanics.sendSnapshot(late as never, 'validated_objective_late_join');
    const snapshot = latestSnapshot(late);
    assert.equal(snapshot.cutscenes.traversal.state, 'completed');
    assert.equal(snapshot.cutscenes.cheer_gate.state, 'completed');
    assert.equal(snapshot.progress, 83);
}

function testRoomCheckpointAndParrotState(): void {
    const a = createFakeClient('CheckpointA', 61321, 'checkpoint-scope');
    const scope = getClientLevelScope(a as never);
    clearHarness(scope);
    register(a);
    assert.equal(TutorialDungeonMechanics.noteRoomStarted(a as never, 1).status, 'applied');
    const roomOneRevision = revision(a);
    assert.equal(TutorialDungeonMechanics.noteRoomStarted(a as never, 1).status, 'already_completed');
    assert.equal(revision(a), roomOneRevision);
    assert.equal(progress(a), 11, 'entering a room must not complete an objective');
    assert.equal(TutorialDungeonMechanics.getClientState(a as never)?.parrots.get('3006046')?.state, 'waiting');

    setRoom(a, 11, 22695, 2959);
    const impossibleCheckpoint = TutorialDungeonMechanics.noteRoomStarted(a as never, 11);
    assert.equal(impossibleCheckpoint.reason, 'missing_room_prerequisite:cutscene:cheer_gate');
    assert.equal(TutorialDungeonMechanics.buildSnapshot(scope)!.checkpointRoomId, 1);

    setRoom(a, 1, 1327, 1880);
    assert.equal(TutorialDungeonMechanics.breakChain(a as never, 3268190, revision(a)).status, 'applied');
    setRoom(a, 2, 4000, 2099);
    assert.equal(TutorialDungeonMechanics.noteRoomStarted(a as never, 2).status, 'applied');
    const snapshot = TutorialDungeonMechanics.buildSnapshot(scope)!;
    assert.equal(snapshot.checkpointRoomId, 2);
    assert.deepEqual(snapshot.unlockedRooms, [1, 2]);
    assert.equal(snapshot.parrots['3006046'].state, 'removed');
    assert.equal(snapshot.parrots['3006046'].sourceRoom, 'a_Room_Tutorial_01');
    assert.equal(snapshot.parrots['3006046'].sourceVar, 'am_Parrot');
    assert.equal(snapshot.parrots['2743902'].state, 'following');
    assert.equal(snapshot.progress, 17, 'checkpoint updates must preserve objective-derived progress');
}

function testBossHpDeathRewardsAndCompletionOnce(): void {
    const a = createFakeClient('BossA', 61401, 'boss-scope');
    const b = createFakeClient('BossB', 61402, 'boss-scope');
    const late = createFakeClient('BossLate', 61403, 'boss-scope');
    const scope = getClientLevelScope(a as never);
    clearHarness(scope);
    register(a, b);
    completeIntroAndDummies(a);
    completeTraversal(a);
    openChestAndGrantReward(a, 4709982, 5, 11228, 2381);
    openChestAndGrantReward(a, 2612830, 6, 13252, 2679);
    openChestAndGrantReward(a, 2481758, 8, 16680, 2566);
    setRoom(a, 9, 17981, 2343);
    assert.equal(TutorialDungeonMechanics.startCutscene(a as never, 'cheer_gate', 9, 'cheer', revision(a)).status, 'applied');
    assert.equal(TutorialDungeonMechanics.completeCutscene(a as never, 'cheer_gate', 9, revision(a)).status, 'applied');
    setRoom(a, 11, 22695, 2959);
    setRoom(b, 11, 22695, 2959);
    assert.equal(
        TutorialDungeonMechanics.markBossDead(a as never, revision(a)).reason,
        'missing_prerequisite:boss_encounter_started'
    );
    assert.deepEqual(TutorialDungeonMechanics.noteBossIntroStarted(a as never, 3923550, 'Tag Ugo'), ['boss_intro_started']);
    const boss = { id: 3923550, canonicalId: 3923550, name: 'GoblinBoss1', hp: 790, maxHp: 1000 };
    TutorialDungeonMechanics.noteBossHealth(a as never, boss);
    boss.hp = 490;
    TutorialDungeonMechanics.noteBossHealth(b as never, boss);
    assert.equal(latestSnapshot(a).boss.currentHp, 490);
    assert.equal(latestSnapshot(b).boss.currentHp, 490);
    assert.equal(latestSnapshot(a).boss.wave80, true);
    assert.equal(latestSnapshot(a).boss.wave50, true);

    const dead = TutorialDungeonMechanics.markBossDead(a as never, revision(a));
    assert.equal(dead.status, 'applied');
    assert.equal(TutorialDungeonMechanics.noteRewardsGranted(a as never, { id: 3923550 }).status, 'applied');
    const rewardRevision = revision(a);
    assert.equal(TutorialDungeonMechanics.markBossDead(b as never, revision(b)).status, 'already_completed');
    assert.equal(TutorialDungeonMechanics.noteRewardsGranted(b as never, { id: 3923550 }).status, 'already_completed');
    assert.equal(revision(a), rewardRevision);

    setRoom(a, 11, 22721, 2959);
    assert.equal(TutorialDungeonMechanics.breakChain(a as never, 4054622, revision(a)).status, 'applied');
    assert.equal(progress(a), 100);
    assert.equal(TutorialDungeonMechanics.getClientState(a as never)?.dungeonCompleted, true);

    setRoom(a, 11, 22832, 2959);
    setRoom(b, 11, 22832, 2959);
    assert.equal(TutorialDungeonMechanics.openChest(a as never, 3989086, revision(a)).status, 'applied');
    assert.equal(TutorialDungeonMechanics.noteRewardsGranted(a as never, { id: 3989086 }).status, 'applied');
    const bossChestRewardRevision = revision(a);
    assert.equal(TutorialDungeonMechanics.openChest(b as never, 3989086, revision(b)).status, 'already_completed');
    assert.equal(TutorialDungeonMechanics.noteRewardsGranted(b as never, { id: 3989086 }).status, 'already_completed');
    assert.equal(revision(a), bossChestRewardRevision);

    register(late);
    TutorialDungeonMechanics.sendSnapshot(late as never, 'boss_late_join');
    const snapshot = latestSnapshot(late);
    assert.equal(snapshot.boss.dead, true);
    assert.equal(snapshot.boss.spawned, false);
    assert.equal(snapshot.boss.rewardsGranted, true);
    assert.equal(snapshot.chests['3989086'].opened, true);
    assert.equal(snapshot.chests['3989086'].rewardsGranted, true);
    assert.equal(snapshot.dungeonCompleted, true);
}

function testRevisionRulesAndSnapshotReconstruction(): void {
    const a = createFakeClient('RevisionA', 61501, 'revision-scope');
    const scope = getClientLevelScope(a as never);
    clearHarness(scope);
    register(a);
    TutorialDungeonMechanics.breakChain(a as never, 3268190, revision(a));
    const current = TutorialDungeonMechanics.buildSnapshot(scope)!;
    const clientState: TutorialDungeonClientSnapshotState = { scope: '', revision: -1, snapshot: null };
    assert.deepEqual(applyTutorialDungeonSnapshotClientState(clientState, current), { status: 'applied', requestResync: false });
    assert.deepEqual(applyTutorialDungeonSnapshotClientState(clientState, current), { status: 'equal', requestResync: false });
    const stale = { ...current, revision: current.revision - 1 };
    assert.deepEqual(applyTutorialDungeonSnapshotClientState(clientState, stale), { status: 'stale', requestResync: false });
    const gap = JSON.parse(JSON.stringify(current)) as TutorialDungeonSnapshot;
    gap.revision = current.revision + 3;
    gap.progress = 28;
    gap.dummies['4841054'].completed = true;
    assert.deepEqual(applyTutorialDungeonSnapshotClientState(clientState, gap), { status: 'applied', requestResync: true });
    assert.equal(clientState.snapshot?.chains['3268190'].broken, true);
    assert.equal(clientState.snapshot?.dummies['4841054'].completed, true);
    assert.equal(clientState.snapshot?.progress, 28);
}

function testInstanceIsolationAndScopeFilteredBroadcast(): void {
    const a = createFakeClient('PartyOne', 61601, 'party-one');
    const b = createFakeClient('PartyTwo', 61602, 'party-two');
    const scopeA = getClientLevelScope(a as never);
    const scopeB = getClientLevelScope(b as never);
    clearHarness(scopeA, scopeB);
    register(a, b);
    const bPacketsBefore = b.sentPackets.length;
    TutorialDungeonMechanics.breakChain(a as never, 3268190, revision(a));
    assert.equal(TutorialDungeonMechanics.getClientState(a as never)?.chains.get('3268190')?.broken, true);
    assert.equal(TutorialDungeonMechanics.getClientState(b as never)?.chains.get('3268190')?.broken, false);
    assert.equal(TutorialDungeonMechanics.getClientState(b as never)?.progress, 11);
    assert.equal(b.sentPackets.length, bPacketsBefore, 'other instance must receive no broadcast');
}

function testDisconnectReconnectPreservesActiveScope(): void {
    const a = createFakeClient('ReconnectA', 61701, 'reconnect-scope');
    const b = createFakeClient('ReconnectB', 61702, 'reconnect-scope');
    const scope = getClientLevelScope(a as never);
    clearHarness(scope);
    register(a, b);
    TutorialDungeonMechanics.breakChain(a as never, 3268190, revision(a));
    GlobalState.sessionsByToken.delete(a.token);
    setRoom(b, 2, 4000, 2099);
    TutorialDungeonMechanics.completeDummy(b as never, 4841054, revision(b));

    const reconnected = createFakeClient('ReconnectA', 61703, 'reconnect-scope');
    register(reconnected);
    TutorialDungeonMechanics.sendSnapshot(reconnected as never, 'reconnect');
    const snapshot = latestSnapshot(reconnected);
    assert.equal(snapshot.scope, scope);
    assert.equal(snapshot.chains['3268190'].broken, true);
    assert.equal(snapshot.dummies['4841054'].completed, true);
    assert.equal(snapshot.progress, 21);
}

function testValidationAndResyncResult(): void {
    const a = createFakeClient('ValidationA', 61801, 'validation-scope');
    const scope = getClientLevelScope(a as never);
    clearHarness(scope);
    register(a);
    setRoom(a, 2, 4000, 2099);
    assert.equal(TutorialDungeonMechanics.breakChain(a as never, 3268190, revision(a)).reason, 'wrong_room');
    setRoom(a, 1, 9999, 9999);
    assert.equal(TutorialDungeonMechanics.breakChain(a as never, 3268190, revision(a)).reason, 'interaction_out_of_range');
    setRoom(a, 1, 1327, 1880);
    assert.equal(TutorialDungeonMechanics.breakChain(a as never, 3268190, revision(a) + 1).reason, 'future_revision');
    assert.equal(TutorialDungeonMechanics.breakChain(a as never, 3268190, revision(a)).status, 'applied');
    setRoom(a, 2, 4000, 2099);
    const stale = TutorialDungeonMechanics.completeDummy(a as never, 4841054, 0);
    assert.equal(stale.status, 'requires_resync');
    assert.equal(stale.reason, 'stale_revision');
    assert.ok(a.sentPackets.some((packet) => packet.id === GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET_ID));
    assert.equal(TutorialDungeonMechanics.completeDummy(a as never, 'dummy:not-an-id', revision(a)).reason, 'invalid_stable_entity_key');
}

function main(): void {
    ensureDataLoaded();
    testStableCatalogAndInternalIdentity();
    testChainLateJoinAndDuplicate();
    testDummyBroadcastAndLateJoin();
    testChestRewardsOnce();
    testCutsceneLogicalStateAndLocalPresentation();
    testValidatedLogicalObjectiveRequests();
    testRoomCheckpointAndParrotState();
    testBossHpDeathRewardsAndCompletionOnce();
    testRevisionRulesAndSnapshotReconstruction();
    testInstanceIsolationAndScopeFilteredBroadcast();
    testDisconnectReconnectPreservesActiveScope();
    testValidationAndResyncResult();
    GlobalState.sessionsByToken.clear();
    console.log('goblin_kidnappers_server_authority_regression: ok');
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
