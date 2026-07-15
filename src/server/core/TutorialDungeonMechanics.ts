import { Client } from './Client';
import { EntityState, EntityTeam } from './Entity';
import { GlobalState } from './GlobalState';
import { getClientLevelScope, getScopeLevelName } from './LevelScope';
import { BitBuffer } from '../network/protocol/bitBuffer';
import { BitReader } from '../network/protocol/bitReader';

export const GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET_ID = 0x115;
export const GOBLIN_KIDNAPPERS_PROTOCOL_VERSION = 1;
export const GOBLIN_KIDNAPPERS_INITIAL_PROGRESS = 11;

export type TutorialDungeonMutationStatus =
    | 'applied'
    | 'already_completed'
    | 'rejected'
    | 'requires_resync';

export type TutorialDungeonMechanicEvent =
    | 'early_chain_broken'
    | 'dummy_one_defeated'
    | 'dummy_two_defeated'
    | 'dummy_three_defeated'
    | 'tutorial_chest_opened'
    | 'boss_chest_opened'
    | 'boss_intro_started'
    | 'boss_wave_80'
    | 'boss_wave_50'
    | 'boss_wave_33'
    | 'boss_defeated'
    | 'anna_freed';

export type TutorialDungeonAuthorityRole =
    | 'early_chain'
    | 'dummy'
    | 'tutorial_chest'
    | 'boss'
    | 'boss_chest'
    | 'anna_chain'
    | 'anna'
    | 'parrot';

export type TutorialDungeonAuthorityEntity = {
    id: number;
    name: string;
    role: TutorialDungeonAuthorityRole;
    sourceRoom: string;
    sourceVar: string;
    roomId: number;
    x: number;
    y: number;
    objectiveKey?: string;
    requiredForCompletion?: boolean;
    boss?: boolean;
    displayName?: string;
    serverEntity?: boolean;
};

export type TutorialDungeonObjectiveDefinition = {
    key: string;
    weight: number;
    roomId: number;
    trigger: string;
};

export type TutorialDungeonEntityState = {
    entityKey: string;
    entityId: number;
    roomId: number;
    sourceRoom: string;
    sourceVar: string;
    spawned: boolean;
    destroyed: boolean;
    completed: boolean;
};

export type TutorialDungeonChainState = {
    entityKey: string;
    entityId: number;
    roomId: number;
    sourceRoom: string;
    sourceVar: string;
    broken: boolean;
    brokenBy?: string;
};

export type TutorialDungeonChestState = {
    entityKey: string;
    entityId: number;
    roomId: number;
    sourceRoom: string;
    sourceVar: string;
    opened: boolean;
    rewardsGranted: boolean;
};

export type TutorialDungeonParrotState = {
    entityKey: string;
    entityId: number;
    roomId: number;
    sourceRoom: string;
    sourceVar: string;
    state: 'waiting' | 'following' | 'removed';
};

export type TutorialDungeonCutsceneState = {
    key: string;
    roomId: number;
    state: 'not_started' | 'active' | 'completed';
    sequenceStep: number;
    trigger: string;
    completionEffectApplied: boolean;
    startedAt?: number;
};

export type TutorialDungeonBossState = {
    entityKey: string;
    entityId: number;
    roomId: number;
    spawned: boolean;
    encounterStarted: boolean;
    currentHp: number;
    maxHp: number;
    dead: boolean;
    rewardsGranted: boolean;
    completionTriggered: boolean;
    wave80: boolean;
    wave50: boolean;
    wave33: boolean;
};

export type TutorialDungeonMechanicsState = {
    levelScope: string;
    revision: number;
    progress: number;
    checkpointRoomId: number;
    unlockedRooms: Set<number>;
    completedRooms: Set<number>;
    startedRoomIds: Set<number>;
    completedObjectives: Set<string>;
    dummies: Map<string, TutorialDungeonEntityState>;
    chains: Map<string, TutorialDungeonChainState>;
    parrots: Map<string, TutorialDungeonParrotState>;
    chests: Map<string, TutorialDungeonChestState>;
    boss: TutorialDungeonBossState;
    cutscenes: Map<string, TutorialDungeonCutsceneState>;
    dungeonCompleted: boolean;
    defeatedEntityIds: Set<number>;
    events: TutorialDungeonMechanicEvent[];
    createdAt: number;
    lastMutationAt: number;
    // Compatibility fields retained for existing callers while the maps are canonical.
    earlyChainsBroken: boolean;
    dummyOneDefeated: boolean;
    dummyTwoDefeated: boolean;
    dummyThreeDefeated: boolean;
    tutorialChestOpened: boolean;
    bossChestOpened: boolean;
    bossIntroStarted: boolean;
    bossWave80: boolean;
    bossWave50: boolean;
    bossWave33: boolean;
    bossDefeated: boolean;
    annaFreed: boolean;
};

export type TutorialDungeonSnapshot = {
    protocolVersion: number;
    scope: string;
    revision: number;
    progress: number;
    checkpointRoomId: number;
    unlockedRooms: number[];
    completedRooms: number[];
    completedObjectives: string[];
    dummies: Record<string, TutorialDungeonEntityState>;
    chains: Record<string, TutorialDungeonChainState>;
    parrots: Record<string, TutorialDungeonParrotState>;
    parrot: {
        rescued: boolean;
        chainBroken: boolean;
        cutsceneStarted: boolean;
        cutsceneCompleted: boolean;
    };
    chests: Record<string, TutorialDungeonChestState>;
    boss: TutorialDungeonBossState;
    cutscenes: Record<string, TutorialDungeonCutsceneState>;
    dungeonCompleted: boolean;
};

export type TutorialDungeonMutationResult = {
    status: TutorialDungeonMutationStatus;
    revision: number;
    reason?: string;
    events: TutorialDungeonMechanicEvent[];
    progressChanged: boolean;
};

export type TutorialDungeonClientSnapshotState = {
    scope: string;
    revision: number;
    snapshot: TutorialDungeonSnapshot | null;
};

export type TutorialDungeonClientApplyResult = {
    status: 'applied' | 'equal' | 'stale';
    requestResync: boolean;
};

const TUTORIAL_DUNGEON = 'TutorialDungeon';
const INTERACTION_DISTANCE = 900;
const TRAVERSAL_COMPLETION_MIN_X = 7350;
const TRAVERSAL_COMPLETION_MIN_Y = 2150;
const CUTSCENE_COMPLETE_SEQUENCE = 65535;

const objective = (
    key: string,
    weight: number,
    roomId: number,
    trigger: string
): TutorialDungeonObjectiveDefinition => ({ key, weight, roomId, trigger });

// The original level contributes progress in nine authored room-sized slices. The
// first slice is the 11% entry floor; the remaining named objectives reproduce the
// authored 17/28/39/... checkpoints without trusting the client progress scalar.
export const GOBLIN_KIDNAPPERS_OBJECTIVES: readonly TutorialDungeonObjectiveDefinition[] = [
    objective('chain:3268190', 6, 1, 'break the first parrot chain'),
    objective('dummy:4841054', 4, 2, 'complete training dummy one'),
    objective('dummy:4906590', 4, 2, 'complete training dummy two'),
    objective('dummy:4972126', 3, 2, 'complete training dummy three'),
    objective('cutscene:traversal', 11, 4, 'complete the traversal tutorial'),
    objective('chest:4709982', 11, 5, 'open the ambush chest'),
    objective('chest:2612830', 11, 6, 'complete the trap chest sequence'),
    objective('chest:2481758', 11, 8, 'open the cavern chest'),
    objective('cutscene:cheer_gate', 11, 9, 'complete the cheer gate sequence'),
    objective('boss:3923550', 11, 11, 'defeat Tag Ugo'),
    objective('chain:4054622', 6, 11, 'free Anna')
] as const;

const OBJECTIVES_BY_KEY = new Map(GOBLIN_KIDNAPPERS_OBJECTIVES.map((entry) => [entry.key, entry]));

const AUTHORITY_ENTITIES: readonly TutorialDungeonAuthorityEntity[] = [
    { id: 3006046, name: 'IntroParrot', role: 'parrot', sourceRoom: 'a_Room_Tutorial_01', sourceVar: 'am_Parrot', roomId: 1, x: 1325, y: 1672 },
    { id: 3268190, name: 'Chains02', role: 'early_chain', sourceRoom: 'a_Room_Tutorial_01', sourceVar: 'am_Chains', roomId: 1, x: 1327, y: 1880, objectiveKey: 'chain:3268190', serverEntity: true },
    { id: 2743902, name: 'IntroParrot', role: 'parrot', sourceRoom: 'a_Room_Tutorial_02', sourceVar: 'am_Parrot', roomId: 2, x: 3178, y: 1457 },
    { id: 4841054, name: 'IntroDummy1', role: 'dummy', sourceRoom: 'a_Room_Tutorial_02', sourceVar: 'am_Dummy1', roomId: 2, x: 4000, y: 2099, objectiveKey: 'dummy:4841054', serverEntity: true },
    { id: 4906590, name: 'IntroDummy2', role: 'dummy', sourceRoom: 'a_Room_Tutorial_02', sourceVar: 'am_Dummy2', roomId: 2, x: 4000, y: 2099, objectiveKey: 'dummy:4906590', serverEntity: true },
    { id: 4972126, name: 'IntroDummy3', role: 'dummy', sourceRoom: 'a_Room_Tutorial_02', sourceVar: 'am_Dummy3', roomId: 2, x: 4000, y: 2099, objectiveKey: 'dummy:4972126', serverEntity: true },
    { id: 384606, name: 'IntroParrot', role: 'parrot', sourceRoom: 'a_Room_Tutorial_04', sourceVar: 'am_Parrot', roomId: 4, x: 7271, y: 2074 },
    { id: 4775518, name: 'IntroParrot', role: 'parrot', sourceRoom: 'a_Room_Tutorial_05_ALT', sourceVar: 'am_Parrot', roomId: 5, x: 10523, y: 2313 },
    { id: 4709982, name: 'TreasureChestEmpty', role: 'tutorial_chest', sourceRoom: 'a_Room_Tutorial_05_ALT', sourceVar: 'am_WaveBoss', roomId: 5, x: 11228, y: 2381, objectiveKey: 'chest:4709982', serverEntity: true },
    { id: 2547294, name: 'IntroParrot', role: 'parrot', sourceRoom: 'a_Room_NRIMR05_ALT', sourceVar: 'am_Parrot', roomId: 6, x: 12560, y: 2377 },
    { id: 2612830, name: 'TreasureChestEmpty', role: 'tutorial_chest', sourceRoom: 'a_Room_NRIMR05_ALT', sourceVar: 'am_Chest', roomId: 6, x: 13252, y: 2679, objectiveKey: 'chest:2612830', serverEntity: true },
    { id: 2481758, name: 'TreasureChestEmpty', role: 'tutorial_chest', sourceRoom: 'a_Room_NRIMR06', sourceVar: '__id453_', roomId: 8, x: 16680, y: 2566, objectiveKey: 'chest:2481758', serverEntity: true },
    { id: 712286, name: 'IntroParrot', role: 'parrot', sourceRoom: 'a_Room_NRIMR03', sourceVar: 'am_Parrot', roomId: 9, x: 17981, y: 2343 },
    { id: 3333726, name: 'IntroParrot', role: 'parrot', sourceRoom: 'a_Room_NRM02RGoblinCaveBoss', sourceVar: 'am_Parrot', roomId: 11, x: 21479, y: 2717 },
    { id: 3989086, name: 'TreasureChestEmpty', role: 'boss_chest', sourceRoom: 'a_Room_NRM02RGoblinCaveBoss', sourceVar: '__id462_', roomId: 11, x: 22832, y: 2959, serverEntity: true },
    { id: 3858014, name: 'NPCAnna', role: 'anna', sourceRoom: 'a_Room_NRM02RGoblinCaveBoss', sourceVar: 'am_Anna', roomId: 11, x: 22716, y: 2959 },
    { id: 3923550, name: 'GoblinBoss1', role: 'boss', sourceRoom: 'a_Room_NRM02RGoblinCaveBoss', sourceVar: 'am_Boss', roomId: 11, x: 22695, y: 2959, objectiveKey: 'boss:3923550', requiredForCompletion: true, boss: true, displayName: 'Tag Ugo', serverEntity: true },
    { id: 4054622, name: 'Chains03', role: 'anna_chain', sourceRoom: 'a_Room_NRM02RGoblinCaveBoss', sourceVar: 'am_Chains', roomId: 11, x: 22721, y: 2959, objectiveKey: 'chain:4054622', requiredForCompletion: true, serverEntity: true }
] as const;

const AUTHORITY_BY_ID = new Map(AUTHORITY_ENTITIES.map((entry) => [entry.id, entry]));
const AUTHORITY_BY_NAME = new Map<string, TutorialDungeonAuthorityEntity[]>();
for (const entry of AUTHORITY_ENTITIES) {
    const key = normalizeName(entry.name);
    const bucket = AUTHORITY_BY_NAME.get(key) ?? [];
    bucket.push(entry);
    AUTHORITY_BY_NAME.set(key, bucket);
}

const states = new Map<string, TutorialDungeonMechanicsState>();

function normalizeName(value: unknown): string {
    return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getEntityId(entity: any): number {
    return Math.max(0, Math.round(Number(entity?.canonicalId ?? entity?.id ?? 0)));
}

function getEntityName(entity: any): string {
    return String(entity?.name ?? entity?.EntName ?? entity?.entName ?? entity?.characterName ?? entity?.character_name ?? '').trim();
}

function getActorName(client: Client | null | undefined): string {
    return String(client?.character?.name ?? 'server').trim() || 'server';
}

function mapToRecord<T>(map: Map<string, T>): Record<string, T> {
    const result: Record<string, T> = {};
    for (const [key, value] of map.entries()) {
        result[key] = { ...value };
    }
    return result;
}

function makeEntityKey(authority: TutorialDungeonAuthorityEntity): string {
    return `room:${authority.roomId}/entity:${authority.id}`;
}

function createState(levelScope: string): TutorialDungeonMechanicsState {
    const dummies = new Map<string, TutorialDungeonEntityState>();
    const chains = new Map<string, TutorialDungeonChainState>();
    const parrots = new Map<string, TutorialDungeonParrotState>();
    const chests = new Map<string, TutorialDungeonChestState>();

    for (const authority of AUTHORITY_ENTITIES) {
        const entityKey = makeEntityKey(authority);
        if (authority.role === 'dummy') {
            dummies.set(String(authority.id), {
                entityKey,
                entityId: authority.id,
                roomId: authority.roomId,
                sourceRoom: authority.sourceRoom,
                sourceVar: authority.sourceVar,
                spawned: true,
                destroyed: false,
                completed: false
            });
        } else if (authority.role === 'early_chain' || authority.role === 'anna_chain') {
            chains.set(String(authority.id), {
                entityKey,
                entityId: authority.id,
                roomId: authority.roomId,
                sourceRoom: authority.sourceRoom,
                sourceVar: authority.sourceVar,
                broken: false
            });
        } else if (authority.role === 'tutorial_chest' || authority.role === 'boss_chest') {
            chests.set(String(authority.id), {
                entityKey,
                entityId: authority.id,
                roomId: authority.roomId,
                sourceRoom: authority.sourceRoom,
                sourceVar: authority.sourceVar,
                opened: false,
                rewardsGranted: false
            });
        } else if (authority.role === 'parrot') {
            parrots.set(String(authority.id), {
                entityKey,
                entityId: authority.id,
                roomId: authority.roomId,
                sourceRoom: authority.sourceRoom,
                sourceVar: authority.sourceVar,
                state: authority.roomId === 1 ? 'waiting' : 'following'
            });
        }
    }

    const now = Date.now();
    return {
        levelScope,
        revision: 0,
        progress: GOBLIN_KIDNAPPERS_INITIAL_PROGRESS,
        checkpointRoomId: 0,
        unlockedRooms: new Set([1]),
        completedRooms: new Set(),
        startedRoomIds: new Set(),
        completedObjectives: new Set(),
        dummies,
        chains,
        parrots,
        chests,
        boss: {
            entityKey: 'room:11/entity:3923550',
            entityId: 3923550,
            roomId: 11,
            spawned: false,
            encounterStarted: false,
            currentHp: 0,
            maxHp: 0,
            dead: false,
            rewardsGranted: false,
            completionTriggered: false,
            wave80: false,
            wave50: false,
            wave33: false
        },
        cutscenes: new Map(),
        dungeonCompleted: false,
        defeatedEntityIds: new Set(),
        events: [],
        createdAt: now,
        lastMutationAt: now,
        earlyChainsBroken: false,
        dummyOneDefeated: false,
        dummyTwoDefeated: false,
        dummyThreeDefeated: false,
        tutorialChestOpened: false,
        bossChestOpened: false,
        bossIntroStarted: false,
        bossWave80: false,
        bossWave50: false,
        bossWave33: false,
        bossDefeated: false,
        annaFreed: false
    };
}

function calculateProgress(state: TutorialDungeonMechanicsState): number {
    let progress = GOBLIN_KIDNAPPERS_INITIAL_PROGRESS;
    for (const key of state.completedObjectives) {
        progress += OBJECTIVES_BY_KEY.get(key)?.weight ?? 0;
    }
    return Math.max(state.progress, Math.min(100, progress));
}

function pushEvent(state: TutorialDungeonMechanicsState, event: TutorialDungeonMechanicEvent): void {
    if (!state.events.includes(event)) {
        state.events.push(event);
    }
}

function actorPosition(client: Client): { x: number; y: number } | null {
    const playerEntity = client.entities.get(client.clientEntID);
    const x = Number(playerEntity?.x ?? client.character?.CurrentLevel?.x);
    const y = Number(playerEntity?.y ?? client.character?.CurrentLevel?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function clientApplicationCode(status: number): string {
    return ['applied', 'equal', 'stale', 'gap'][Math.max(0, Math.min(3, status))] ?? 'unknown';
}

export function applyTutorialDungeonSnapshotClientState(
    clientState: TutorialDungeonClientSnapshotState,
    snapshot: TutorialDungeonSnapshot
): TutorialDungeonClientApplyResult {
    if (clientState.scope && clientState.scope !== snapshot.scope) {
        clientState.scope = snapshot.scope;
        clientState.revision = -1;
        clientState.snapshot = null;
    }
    if (!clientState.scope) {
        clientState.scope = snapshot.scope;
    }
    if (snapshot.revision < clientState.revision) {
        return { status: 'stale', requestResync: false };
    }
    if (snapshot.revision === clientState.revision && clientState.snapshot) {
        return { status: 'equal', requestResync: false };
    }
    const requestResync = clientState.revision >= 0 && snapshot.revision > clientState.revision + 1;
    clientState.revision = snapshot.revision;
    clientState.snapshot = JSON.parse(JSON.stringify(snapshot)) as TutorialDungeonSnapshot;
    return { status: 'applied', requestResync };
}

export class TutorialDungeonMechanics {
    static readonly LEVEL_NAME = TUTORIAL_DUNGEON;
    static readonly TAG_UGO_BOSS_ID = 3923550;
    static readonly ANNA_CHAIN_ID = 4054622;
    static readonly SNAPSHOT_PACKET_ID = GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET_ID;

    static isTutorialDungeon(levelNameOrScope: string | null | undefined): boolean {
        const levelName = getScopeLevelName(String(levelNameOrScope ?? '')) || String(levelNameOrScope ?? '').trim();
        return levelName === TUTORIAL_DUNGEON;
    }

    static getAuthorityEntities(): readonly TutorialDungeonAuthorityEntity[] {
        return AUTHORITY_ENTITIES;
    }

    static getServerAuthorityEntities(): readonly TutorialDungeonAuthorityEntity[] {
        return AUTHORITY_ENTITIES.filter((entry) => entry.serverEntity);
    }

    static getObjectiveTable(): readonly TutorialDungeonObjectiveDefinition[] {
        return GOBLIN_KIDNAPPERS_OBJECTIVES;
    }

    static getAuthorityEntity(entityOrId: any): TutorialDungeonAuthorityEntity | null {
        const id = typeof entityOrId === 'number' ? Math.max(0, Math.round(entityOrId)) : getEntityId(entityOrId);
        if (id > 0) {
            return AUTHORITY_BY_ID.get(id) ?? null;
        }
        const name = typeof entityOrId === 'string' ? entityOrId : getEntityName(entityOrId);
        const candidates = AUTHORITY_BY_NAME.get(normalizeName(name)) ?? [];
        return candidates.length === 1 ? candidates[0] : null;
    }

    static isAuthorityEntity(levelNameOrScope: string | null | undefined, entityOrId: any): boolean {
        return TutorialDungeonMechanics.isTutorialDungeon(levelNameOrScope) && Boolean(TutorialDungeonMechanics.getAuthorityEntity(entityOrId));
    }

    static isCompletionBoss(levelNameOrScope: string | null | undefined, entity: any): boolean {
        if (!TutorialDungeonMechanics.isTutorialDungeon(levelNameOrScope)) {
            return false;
        }
        const authority = TutorialDungeonMechanics.getAuthorityEntity(entity);
        const nameKey = normalizeName(getEntityName(entity));
        return authority?.role === 'boss' || nameKey === 'goblinboss1' || nameKey === 'tagugo';
    }

    static isAnnaRescueObjective(levelNameOrScope: string | null | undefined, entity: any): boolean {
        if (!TutorialDungeonMechanics.isTutorialDungeon(levelNameOrScope)) {
            return false;
        }
        const authority = TutorialDungeonMechanics.getAuthorityEntity(entity);
        return authority?.role === 'anna_chain' || normalizeName(getEntityName(entity)) === 'chains03';
    }

    static isTrackedChest(levelNameOrScope: string | null | undefined, entity: any): boolean {
        if (!TutorialDungeonMechanics.isTutorialDungeon(levelNameOrScope)) {
            return false;
        }
        const authority = TutorialDungeonMechanics.getAuthorityEntity(entity);
        return authority?.role === 'tutorial_chest' || authority?.role === 'boss_chest';
    }

    static decorateNpc(levelName: string | null | undefined, npc: any): any {
        const authority = TutorialDungeonMechanics.getAuthorityEntity(npc);
        if (!TutorialDungeonMechanics.isTutorialDungeon(levelName) || !authority) {
            return npc;
        }
        return {
            ...npc,
            roomId: authority.roomId,
            room_id: authority.roomId,
            sourceRoom: authority.sourceRoom,
            sourceVar: authority.sourceVar,
            scripted: true,
            serverOnlyObjective: !authority.boss,
            tutorialDungeonAuthorityRole: authority.role,
            requiredForClear: Boolean(authority.requiredForCompletion),
            boss: Boolean(authority.boss),
            roomBoss: Boolean(authority.boss),
            roomBossName: authority.displayName ?? '',
            displayName: authority.displayName ?? String(npc?.displayName ?? ''),
            clientSpawned: false,
            canonicalId: authority.id
        };
    }

    static getState(levelScope: string | null | undefined): TutorialDungeonMechanicsState | null {
        const scope = String(levelScope ?? '').trim();
        if (!scope || !TutorialDungeonMechanics.isTutorialDungeon(scope)) {
            return null;
        }
        let state = states.get(scope);
        if (!state) {
            state = createState(scope);
            states.set(scope, state);
        }
        return state;
    }

    static getClientState(client: Client | null | undefined): TutorialDungeonMechanicsState | null {
        if (!client || !TutorialDungeonMechanics.isTutorialDungeon(client.currentLevel)) {
            return null;
        }
        return TutorialDungeonMechanics.getState(getClientLevelScope(client));
    }

    static resetState(levelScope: string | null | undefined): void {
        const scope = String(levelScope ?? '').trim();
        if (scope) {
            states.delete(scope);
        }
    }

    static buildSnapshot(levelScopeOrState: string | TutorialDungeonMechanicsState): TutorialDungeonSnapshot | null {
        const state = typeof levelScopeOrState === 'string'
            ? TutorialDungeonMechanics.getState(levelScopeOrState)
            : levelScopeOrState;
        if (!state) {
            return null;
        }
        const traversal = state.cutscenes.get('traversal');
        return {
            protocolVersion: GOBLIN_KIDNAPPERS_PROTOCOL_VERSION,
            scope: state.levelScope,
            revision: state.revision,
            progress: state.progress,
            checkpointRoomId: state.checkpointRoomId,
            unlockedRooms: Array.from(state.unlockedRooms).sort((a, b) => a - b),
            completedRooms: Array.from(state.completedRooms).sort((a, b) => a - b),
            completedObjectives: Array.from(state.completedObjectives).sort(),
            dummies: mapToRecord(state.dummies),
            chains: mapToRecord(state.chains),
            parrots: mapToRecord(state.parrots),
            parrot: {
                rescued: Boolean(state.chains.get('3268190')?.broken),
                chainBroken: Boolean(state.chains.get('3268190')?.broken),
                cutsceneStarted: Boolean(traversal && traversal.state !== 'not_started'),
                cutsceneCompleted: traversal?.state === 'completed'
            },
            chests: mapToRecord(state.chests),
            boss: { ...state.boss },
            cutscenes: mapToRecord(state.cutscenes),
            dungeonCompleted: state.dungeonCompleted
        };
    }

    static buildSnapshotPayload(snapshot: TutorialDungeonSnapshot): Buffer {
        const bb = new BitBuffer(false);
        bb.writeMethod4(GOBLIN_KIDNAPPERS_PROTOCOL_VERSION);
        bb.writeMethod13(snapshot.scope);
        bb.writeMethod4(snapshot.revision);
        bb.writeMethod13(JSON.stringify(snapshot));
        return bb.toBuffer();
    }

    static parseSnapshotPayload(data: Buffer): TutorialDungeonSnapshot {
        const br = new BitReader(data);
        const protocolVersion = br.readMethod4();
        const scope = br.readMethod13();
        const revision = br.readMethod4();
        const snapshot = JSON.parse(br.readMethod13()) as TutorialDungeonSnapshot;
        if (protocolVersion !== GOBLIN_KIDNAPPERS_PROTOCOL_VERSION || snapshot.protocolVersion !== protocolVersion) {
            throw new Error(`Unsupported Goblin Kidnappers snapshot protocol ${protocolVersion}`);
        }
        if (snapshot.scope !== scope || snapshot.revision !== revision) {
            throw new Error('Goblin Kidnappers snapshot envelope mismatch');
        }
        return snapshot;
    }

    static sendSnapshot(client: Client, reason: string = 'entry'): TutorialDungeonSnapshot | null {
        const state = TutorialDungeonMechanics.getClientState(client);
        const snapshot = state ? TutorialDungeonMechanics.buildSnapshot(state) : null;
        if (!snapshot) {
            return null;
        }
        client.send(GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET_ID, TutorialDungeonMechanics.buildSnapshotPayload(snapshot));
        TutorialDungeonMechanics.logAuthority(client, 'snapshot_sent', {
            reason,
            revision: snapshot.revision,
            progress: snapshot.progress,
            checkpointRoomId: snapshot.checkpointRoomId,
            recipientCount: 1
        });
        return snapshot;
    }

    static handleSnapshotControl(client: Client, data: Buffer): void {
        const br = new BitReader(data);
        try {
            const mode = br.readMethod6(2);
            const protocolVersion = br.readMethod4();
            const scope = br.readMethod13();
            const clientRevision = br.readMethod4();
            const actualScope = getClientLevelScope(client);
            if (
                !client.authenticated ||
                !client.character ||
                protocolVersion !== GOBLIN_KIDNAPPERS_PROTOCOL_VERSION ||
                !TutorialDungeonMechanics.isTutorialDungeon(actualScope) ||
                scope !== actualScope
            ) {
                TutorialDungeonMechanics.logAuthority(client, 'request_rejected', {
                    objectKey: 'snapshot',
                    requestedScope: scope,
                    actualScope,
                    rejectionReason: 'invalid_snapshot_control_scope_or_session'
                });
                return;
            }
            const state = TutorialDungeonMechanics.getClientState(client);
            if (!state) {
                return;
            }
            if (mode === 0) {
                const applicationStatus = br.readMethod6(2);
                TutorialDungeonMechanics.logAuthority(client, 'snapshot_applied', {
                    revision: state.revision,
                    clientRevision,
                    applicationStatus: clientApplicationCode(applicationStatus),
                    recipientCount: 1
                });
                if (clientRevision !== state.revision) {
                    TutorialDungeonMechanics.logAuthority(client, 'revision_gap', {
                        revision: state.revision,
                        clientRevision,
                        objectKey: 'snapshot_ack'
                    });
                    TutorialDungeonMechanics.sendSnapshot(client, 'ack_revision_mismatch');
                }
                return;
            }
            if (mode === 1) {
                TutorialDungeonMechanics.logAuthority(client, 'revision_gap', {
                    revision: state.revision,
                    clientRevision,
                    objectKey: 'explicit_resync'
                });
                TutorialDungeonMechanics.sendSnapshot(client, 'explicit_resync');
                return;
            }
            if (mode === 2) {
                const objectiveKey = br.readMethod13();
                const roomId = br.readMethod9();
                TutorialDungeonMechanics.handleLogicalObjectiveRequest(
                    client,
                    objectiveKey,
                    roomId,
                    clientRevision
                );
                return;
            }
            TutorialDungeonMechanics.logAuthority(client, 'request_rejected', {
                objectKey: 'snapshot',
                revision: state.revision,
                rejectionReason: 'unknown_snapshot_control_mode'
            });
        } catch (error) {
            TutorialDungeonMechanics.logAuthority(client, 'request_rejected', {
                objectKey: 'snapshot',
                rejectionReason: 'malformed_snapshot_control',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    static noteRoomStarted(client: Client, roomId: number): TutorialDungeonMutationResult {
        const state = TutorialDungeonMechanics.getClientState(client);
        const normalizedRoomId = Math.max(0, Math.round(Number(roomId) || 0));
        const validation = TutorialDungeonMechanics.validateScopedRequest(client, state, normalizedRoomId);
        if (validation) {
            return validation;
        }
        if (!state) {
            return TutorialDungeonMechanics.result(state, 'rejected', 'missing_instance_state');
        }
        if (state.startedRoomIds.has(normalizedRoomId)) {
            return TutorialDungeonMechanics.result(state, 'already_completed');
        }
        const previous = {
            checkpointRoomId: state.checkpointRoomId,
            unlockedRooms: Array.from(state.unlockedRooms)
        };
        state.startedRoomIds.add(normalizedRoomId);
        state.unlockedRooms.add(normalizedRoomId);
        state.checkpointRoomId = Math.max(state.checkpointRoomId, normalizedRoomId);
        for (const parrot of state.parrots.values()) {
            if (parrot.roomId < normalizedRoomId) {
                parrot.state = 'removed';
            } else if (parrot.roomId === normalizedRoomId) {
                parrot.state = parrot.entityId === 3006046 && !state.earlyChainsBroken
                    ? 'waiting'
                    : 'following';
            }
        }
        const result = TutorialDungeonMechanics.commit(client, state, [], false);
        TutorialDungeonMechanics.logMutation(client, 'room_started', `room:${normalizedRoomId}`, previous, {
            checkpointRoomId: state.checkpointRoomId,
            unlockedRooms: Array.from(state.unlockedRooms)
        }, result);
        return result;
    }

    static unlockRoom(client: Client, roomId: number): TutorialDungeonMutationResult {
        const state = TutorialDungeonMechanics.getClientState(client);
        const normalizedRoomId = Math.max(0, Math.round(Number(roomId) || 0));
        const validation = TutorialDungeonMechanics.validateScopedRequest(client, state, normalizedRoomId);
        if (validation) {
            return validation;
        }
        if (!state) {
            return TutorialDungeonMechanics.result(state, 'rejected', 'missing_instance_state');
        }
        if (state.unlockedRooms.has(normalizedRoomId)) {
            return TutorialDungeonMechanics.result(state, 'already_completed');
        }
        state.unlockedRooms.add(normalizedRoomId);
        state.checkpointRoomId = Math.max(state.checkpointRoomId, normalizedRoomId);
        return TutorialDungeonMechanics.commit(client, state, [], false);
    }

    static completeRoom(client: Client, roomId: number): TutorialDungeonMutationResult {
        const state = TutorialDungeonMechanics.getClientState(client);
        const normalizedRoomId = Math.max(0, Math.round(Number(roomId) || 0));
        const validation = TutorialDungeonMechanics.validateScopedRequest(client, state, normalizedRoomId);
        if (validation) {
            return validation;
        }
        if (!state) {
            return TutorialDungeonMechanics.result(state, 'rejected', 'missing_instance_state');
        }
        if (state.completedRooms.has(normalizedRoomId)) {
            return TutorialDungeonMechanics.result(state, 'already_completed');
        }
        state.completedRooms.add(normalizedRoomId);
        return TutorialDungeonMechanics.commit(client, state, [], false);
    }

    static startCutscene(
        client: Client,
        key: string,
        roomId: number,
        trigger: string,
        expectedRevision?: number
    ): TutorialDungeonMutationResult {
        return TutorialDungeonMechanics.mutateCutscene(client, key, roomId, trigger, 'active', 0, expectedRevision);
    }

    static advanceCutscene(
        client: Client,
        key: string,
        roomId: number,
        step: number,
        expectedRevision?: number
    ): TutorialDungeonMutationResult {
        const state = TutorialDungeonMechanics.getClientState(client);
        const current = state?.cutscenes.get(key);
        const validation = TutorialDungeonMechanics.validateScopedRequest(client, state, roomId, expectedRevision);
        if (validation) {
            return validation;
        }
        if (!state || !current || current.state !== 'active') {
            return TutorialDungeonMechanics.result(state, 'rejected', 'cutscene_not_active');
        }
        const normalizedStep = Math.max(0, Math.round(Number(step) || 0));
        if (normalizedStep <= current.sequenceStep) {
            return TutorialDungeonMechanics.result(state, 'already_completed');
        }
        current.sequenceStep = normalizedStep;
        return TutorialDungeonMechanics.commit(client, state, [], false);
    }

    static completeCutscene(
        client: Client,
        key: string,
        roomId: number,
        expectedRevision?: number
    ): TutorialDungeonMutationResult {
        return TutorialDungeonMechanics.mutateCutscene(
            client,
            key,
            roomId,
            'room_close',
            'completed',
            CUTSCENE_COMPLETE_SEQUENCE,
            expectedRevision
        );
    }

    static noteBossIntroStarted(client: Client, bossId: number, bossName: string): TutorialDungeonMechanicEvent[] {
        const authority = AUTHORITY_BY_ID.get(Math.max(0, Math.round(Number(bossId) || 0)));
        if (
            !authority ||
            authority.role !== 'boss' ||
            !TutorialDungeonMechanics.isCompletionBoss(client.currentLevel, { id: bossId, name: bossName }) ||
            TutorialDungeonMechanics.validateAuthorityInteraction(client, authority, undefined, false, true)
        ) {
            return [];
        }
        const state = TutorialDungeonMechanics.getClientState(client);
        if (!state || state.boss.encounterStarted) {
            return [];
        }
        state.boss.spawned = true;
        state.boss.encounterStarted = true;
        state.bossIntroStarted = true;
        pushEvent(state, 'boss_intro_started');
        TutorialDungeonMechanics.commit(client, state, ['boss_intro_started'], false);
        TutorialDungeonMechanics.logAuthority(client, 'boss_encounter_started', {
            revision: state.revision,
            objectKey: state.boss.entityKey,
            previousState: { encounterStarted: false },
            nextState: { encounterStarted: true }
        });
        return ['boss_intro_started'];
    }

    static breakChain(
        client: Client,
        chainKeyOrId: string | number,
        expectedRevision?: number
    ): TutorialDungeonMutationResult {
        return TutorialDungeonMechanics.requestAuthorityCompletion(
            client,
            chainKeyOrId,
            new Set<TutorialDungeonAuthorityRole>(['early_chain', 'anna_chain']),
            expectedRevision
        );
    }

    static completeDummy(
        client: Client,
        dummyKeyOrId: string | number,
        expectedRevision?: number
    ): TutorialDungeonMutationResult {
        return TutorialDungeonMechanics.requestAuthorityCompletion(
            client,
            dummyKeyOrId,
            new Set<TutorialDungeonAuthorityRole>(['dummy']),
            expectedRevision
        );
    }

    static openChest(
        client: Client,
        chestKeyOrId: string | number,
        expectedRevision?: number
    ): TutorialDungeonMutationResult {
        return TutorialDungeonMechanics.requestAuthorityCompletion(
            client,
            chestKeyOrId,
            new Set<TutorialDungeonAuthorityRole>(['tutorial_chest', 'boss_chest']),
            expectedRevision
        );
    }

    static markBossDead(client: Client, expectedRevision?: number): TutorialDungeonMutationResult {
        return TutorialDungeonMechanics.requestAuthorityCompletion(
            client,
            TutorialDungeonMechanics.TAG_UGO_BOSS_ID,
            new Set<TutorialDungeonAuthorityRole>(['boss']),
            expectedRevision
        );
    }

    static noteBossHealth(client: Client, entity: any): TutorialDungeonMechanicEvent[] {
        if (!TutorialDungeonMechanics.isCompletionBoss(client.currentLevel, entity)) {
            return [];
        }
        const state = TutorialDungeonMechanics.getClientState(client);
        if (!state || state.boss.dead || !state.boss.encounterStarted) {
            return [];
        }
        const maxHp = Math.max(0, Math.round(Number(entity?.maxHp ?? 0)));
        const hp = Math.max(0, Math.min(maxHp || Number.MAX_SAFE_INTEGER, Math.round(Number(entity?.hp ?? maxHp))));
        if (maxHp <= 0 || hp <= 0 || (state.boss.currentHp === hp && state.boss.maxHp === maxHp)) {
            return [];
        }
        const previousState = { currentHp: state.boss.currentHp, maxHp: state.boss.maxHp };
        state.boss.spawned = true;
        state.boss.currentHp = hp;
        state.boss.maxHp = maxHp;
        const ratio = hp / maxHp;
        const events: TutorialDungeonMechanicEvent[] = [];
        if (ratio <= 0.8 && !state.boss.wave80) {
            state.boss.wave80 = state.bossWave80 = true;
            events.push('boss_wave_80');
        }
        if (ratio <= 0.5 && !state.boss.wave50) {
            state.boss.wave50 = state.bossWave50 = true;
            events.push('boss_wave_50');
        }
        if (ratio <= 0.33 && !state.boss.wave33) {
            state.boss.wave33 = state.bossWave33 = true;
            events.push('boss_wave_33');
        }
        events.forEach((event) => pushEvent(state, event));
        TutorialDungeonMechanics.commit(client, state, events, false);
        TutorialDungeonMechanics.logAuthority(client, 'boss_hp_changed', {
            revision: state.revision,
            objectKey: state.boss.entityKey,
            previousState,
            nextState: { currentHp: hp, maxHp },
            recipientCount: TutorialDungeonMechanics.getRecipients(state.levelScope).length
        });
        return events;
    }

    static noteEntityDefeated(client: Client, entity: any): TutorialDungeonMechanicEvent[] {
        if (!client || !entity || entity.isPlayer || !TutorialDungeonMechanics.isTutorialDungeon(client.currentLevel)) {
            return [];
        }
        const authority = AUTHORITY_BY_ID.get(getEntityId(entity));
        if (!authority || !authority.serverEntity) {
            TutorialDungeonMechanics.logAuthority(client, 'request_rejected', {
                objectKey: `entity:${getEntityId(entity)}`,
                rejectionReason: 'unknown_or_non_authoritative_entity'
            });
            return [];
        }
        const validation = TutorialDungeonMechanics.validateAuthorityInteraction(client, authority, undefined, true);
        if (validation) {
            TutorialDungeonMechanics.logMutation(
                client,
                'request_rejected',
                makeEntityKey(authority),
                TutorialDungeonMechanics.describeAuthorityState(TutorialDungeonMechanics.getClientState(client)!, authority),
                null,
                validation
            );
            return [];
        }
        const result = TutorialDungeonMechanics.completeAuthorityEntity(client, authority, entity);
        return result.events;
    }

    static noteRewardsGranted(client: Client, entity: any): TutorialDungeonMutationResult {
        const state = TutorialDungeonMechanics.getClientState(client);
        const authority = AUTHORITY_BY_ID.get(getEntityId(entity));
        if (!state || !authority) {
            return TutorialDungeonMechanics.result(state, 'rejected', 'unknown_reward_source');
        }
        if (authority.role === 'boss') {
            if (!state.boss.dead) {
                return TutorialDungeonMechanics.result(state, 'rejected', 'boss_not_defeated');
            }
            if (state.boss.rewardsGranted) {
                return TutorialDungeonMechanics.result(state, 'already_completed');
            }
            state.boss.rewardsGranted = true;
        } else if (authority.role === 'tutorial_chest' || authority.role === 'boss_chest') {
            const chest = state.chests.get(String(authority.id));
            if (!chest?.opened) {
                return TutorialDungeonMechanics.result(state, 'rejected', 'chest_not_opened');
            }
            if (chest.rewardsGranted) {
                return TutorialDungeonMechanics.result(state, 'already_completed');
            }
            chest.rewardsGranted = true;
        } else {
            return TutorialDungeonMechanics.result(state, 'rejected', 'source_has_no_instance_reward');
        }
        return TutorialDungeonMechanics.commit(client, state, [], false);
    }

    static isAuthorityEntityDefeated(client: Client, entityOrId: any): boolean {
        const authority = TutorialDungeonMechanics.getAuthorityEntity(entityOrId);
        return Boolean(authority && TutorialDungeonMechanics.getClientState(client)?.defeatedEntityIds.has(authority.id));
    }

    static getDefeatedAuthorityEntities(client: Client): TutorialDungeonAuthorityEntity[] {
        const state = TutorialDungeonMechanics.getClientState(client);
        return state ? AUTHORITY_ENTITIES.filter((entry) => state.defeatedEntityIds.has(entry.id)) : [];
    }

    static getProgressFloor(client: Client): number {
        return TutorialDungeonMechanics.getClientState(client)?.progress ?? 0;
    }

    static noteQuestProgress(client: Client, _requestedProgress: number): number {
        const state = TutorialDungeonMechanics.getClientState(client);
        if (!state) {
            return 0;
        }
        TutorialDungeonMechanics.logAuthority(client, 'request_rejected', {
            objectKey: 'progress',
            revision: state.revision,
            rejectionReason: 'client_progress_is_not_authoritative',
            canonicalProgress: state.progress
        });
        TutorialDungeonMechanics.sendSnapshot(client, 'client_progress_rejected');
        return state.progress;
    }

    static markCanonicalDefeated(entity: any): void {
        if (!entity || entity.isPlayer || Number(entity.team ?? EntityTeam.ENEMY) !== EntityTeam.ENEMY) {
            return;
        }
        entity.dead = true;
        entity.hp = 0;
        entity.entState = EntityState.DEAD;
        entity.clientDefeatVerified = true;
    }

    private static completeAuthorityEntity(
        client: Client,
        authority: TutorialDungeonAuthorityEntity,
        entity: any
    ): TutorialDungeonMutationResult {
        const state = TutorialDungeonMechanics.getClientState(client);
        if (!state) {
            return TutorialDungeonMechanics.result(state, 'rejected', 'missing_instance_state');
        }
        const previousState = TutorialDungeonMechanics.describeAuthorityState(state, authority);
        if (state.defeatedEntityIds.has(authority.id)) {
            const duplicate = TutorialDungeonMechanics.result(state, 'already_completed');
            TutorialDungeonMechanics.logMutation(client, 'request_duplicate', makeEntityKey(authority), previousState, previousState, duplicate);
            return duplicate;
        }

        state.defeatedEntityIds.add(authority.id);
        const events: TutorialDungeonMechanicEvent[] = [];
        if (authority.role === 'dummy') {
            const dummy = state.dummies.get(String(authority.id));
            if (!dummy) {
                return TutorialDungeonMechanics.result(state, 'rejected', 'missing_dummy_state');
            }
            dummy.spawned = false;
            dummy.destroyed = true;
            dummy.completed = true;
            if (authority.id === 4841054) {
                state.dummyOneDefeated = true;
                events.push('dummy_one_defeated');
            } else if (authority.id === 4906590) {
                state.dummyTwoDefeated = true;
                events.push('dummy_two_defeated');
            } else {
                state.dummyThreeDefeated = true;
                events.push('dummy_three_defeated');
            }
        } else if (authority.role === 'early_chain' || authority.role === 'anna_chain') {
            const chain = state.chains.get(String(authority.id));
            if (!chain) {
                return TutorialDungeonMechanics.result(state, 'rejected', 'missing_chain_state');
            }
            chain.broken = true;
            chain.brokenBy = getActorName(client);
            if (authority.role === 'early_chain') {
                state.earlyChainsBroken = true;
                const parrot = state.parrots.get('3006046');
                if (parrot) {
                    parrot.state = 'following';
                }
                events.push('early_chain_broken');
            } else {
                state.annaFreed = true;
                events.push('anna_freed');
            }
        } else if (authority.role === 'tutorial_chest' || authority.role === 'boss_chest') {
            const chest = state.chests.get(String(authority.id));
            if (!chest) {
                return TutorialDungeonMechanics.result(state, 'rejected', 'missing_chest_state');
            }
            chest.opened = true;
            if (authority.role === 'boss_chest') {
                state.bossChestOpened = true;
                events.push('boss_chest_opened');
            } else {
                state.tutorialChestOpened = true;
                events.push('tutorial_chest_opened');
            }
        } else if (authority.role === 'boss') {
            state.boss.spawned = false;
            state.boss.currentHp = 0;
            state.boss.dead = true;
            state.bossDefeated = true;
            entity.dead = true;
            entity.hp = 0;
            entity.entState = EntityState.DEAD;
            events.push('boss_defeated');
        } else {
            return TutorialDungeonMechanics.result(state, 'rejected', 'unsupported_authority_role');
        }

        if (authority.objectiveKey) {
            state.completedObjectives.add(authority.objectiveKey);
        }
        events.forEach((event) => pushEvent(state, event));
        if (state.boss.dead && state.chains.get('4054622')?.broken) {
            state.boss.completionTriggered = true;
            state.dungeonCompleted = true;
        }
        const result = TutorialDungeonMechanics.commit(client, state, events, true);
        const eventName = authority.role === 'dummy'
            ? 'dummy_completed'
            : authority.role === 'tutorial_chest' || authority.role === 'boss_chest'
                ? 'chest_opened'
                : authority.role === 'boss'
                    ? 'boss_dead'
                    : 'chain_state_changed';
        TutorialDungeonMechanics.logMutation(client, eventName, makeEntityKey(authority), previousState, TutorialDungeonMechanics.describeAuthorityState(state, authority), result);
        return result;
    }

    private static requestAuthorityCompletion(
        client: Client,
        keyOrId: string | number,
        permittedRoles: Set<TutorialDungeonAuthorityRole>,
        expectedRevision?: number
    ): TutorialDungeonMutationResult {
        const authorityId = typeof keyOrId === 'number'
            ? Math.max(0, Math.round(keyOrId))
            : Math.max(0, Math.round(Number(String(keyOrId).match(/(\d+)$/)?.[1] ?? 0)));
        const authority = AUTHORITY_BY_ID.get(authorityId);
        const state = TutorialDungeonMechanics.getClientState(client);
        if (!authority || !authority.serverEntity || !permittedRoles.has(authority.role)) {
            const rejected = TutorialDungeonMechanics.result(state, 'rejected', 'invalid_stable_entity_key');
            TutorialDungeonMechanics.logMutation(client, 'request_rejected', String(keyOrId), null, null, rejected);
            return rejected;
        }
        if (state?.defeatedEntityIds.has(authority.id)) {
            return TutorialDungeonMechanics.result(state, 'already_completed');
        }
        const validation = TutorialDungeonMechanics.validateAuthorityInteraction(
            client,
            authority,
            expectedRevision,
            false
        );
        if (validation) {
            TutorialDungeonMechanics.logMutation(
                client,
                'request_rejected',
                makeEntityKey(authority),
                state ? TutorialDungeonMechanics.describeAuthorityState(state, authority) : null,
                null,
                validation
            );
            if (validation.status === 'requires_resync') {
                TutorialDungeonMechanics.sendSnapshot(client, 'interaction_revision_mismatch');
            }
            return validation;
        }
        return TutorialDungeonMechanics.completeAuthorityEntity(client, authority, {
            id: authority.id,
            canonicalId: authority.id,
            name: authority.name,
            team: EntityTeam.ENEMY,
            hp: 0,
            entState: EntityState.DEAD
        });
    }

    private static validateAuthorityInteraction(
        client: Client,
        authority: TutorialDungeonAuthorityEntity,
        expectedRevision: number | undefined,
        serverVerifiedCombat: boolean,
        allowBossEncounterStart: boolean = false
    ): TutorialDungeonMutationResult | null {
        const state = TutorialDungeonMechanics.getClientState(client);
        if (
            !state ||
            !client.authenticated ||
            !client.character ||
            client.token <= 0 ||
            !String(client.levelInstanceId ?? '').trim() ||
            getClientLevelScope(client) !== state.levelScope
        ) {
            return TutorialDungeonMechanics.result(state, 'rejected', 'invalid_participant_or_scope');
        }
        if (expectedRevision !== undefined) {
            const normalizedRevision = Math.max(0, Math.round(Number(expectedRevision) || 0));
            if (normalizedRevision < state.revision) {
                return TutorialDungeonMechanics.result(state, 'requires_resync', 'stale_revision');
            }
            if (normalizedRevision > state.revision) {
                return TutorialDungeonMechanics.result(state, 'rejected', 'future_revision');
            }
        }
        if (Math.round(Number(client.currentRoomId)) !== authority.roomId) {
            return TutorialDungeonMechanics.result(state, 'rejected', 'wrong_room');
        }
        const missingPrerequisite = TutorialDungeonMechanics.getMissingPrerequisite(
            state,
            authority,
            allowBossEncounterStart
        );
        if (missingPrerequisite) {
            return TutorialDungeonMechanics.result(state, 'rejected', `missing_prerequisite:${missingPrerequisite}`);
        }
        if (!serverVerifiedCombat) {
            const position = actorPosition(client);
            if (!position) {
                return TutorialDungeonMechanics.result(state, 'rejected', 'missing_actor_position');
            }
            const dx = position.x - authority.x;
            const dy = position.y - authority.y;
            if ((dx * dx) + (dy * dy) > INTERACTION_DISTANCE * INTERACTION_DISTANCE) {
                return TutorialDungeonMechanics.result(state, 'rejected', 'interaction_out_of_range');
            }
        }
        return null;
    }

    private static getMissingPrerequisite(
        state: TutorialDungeonMechanicsState,
        authority: TutorialDungeonAuthorityEntity,
        allowBossEncounterStart: boolean = false
    ): string {
        if (authority.role === 'boss' && !state.boss.encounterStarted && !allowBossEncounterStart) {
            return 'boss_encounter_started';
        }
        const prerequisites = new Map<number, string>([
            [4841054, 'chain:3268190'],
            [4906590, 'dummy:4841054'],
            [4972126, 'dummy:4906590'],
            [4709982, 'cutscene:traversal'],
            [2612830, 'chest:4709982'],
            [2481758, 'chest:2612830'],
            [3923550, 'cutscene:cheer_gate'],
            [4054622, 'boss:3923550'],
            [3989086, 'chain:4054622']
        ]);
        const prerequisite = prerequisites.get(authority.id) ?? '';
        return prerequisite && !state.completedObjectives.has(prerequisite) ? prerequisite : '';
    }

    private static mutateCutscene(
        client: Client,
        key: string,
        roomId: number,
        trigger: string,
        nextState: 'active' | 'completed',
        sequenceStep: number,
        expectedRevision?: number
    ): TutorialDungeonMutationResult {
        const state = TutorialDungeonMechanics.getClientState(client);
        const normalizedKey = String(key ?? '').trim();
        const normalizedRoomId = Math.max(0, Math.round(Number(roomId) || 0));
        const validation = TutorialDungeonMechanics.validateScopedRequest(
            client,
            state,
            normalizedRoomId,
            expectedRevision
        );
        if (validation) {
            return validation;
        }
        if (!state || !normalizedKey || normalizedRoomId <= 0) {
            return TutorialDungeonMechanics.result(state, 'rejected', 'invalid_cutscene_scope_or_room');
        }
        const current = state.cutscenes.get(normalizedKey);
        if (current?.state === 'completed' || current?.state === nextState) {
            return TutorialDungeonMechanics.result(state, 'already_completed');
        }
        const previousState = current ? { ...current } : { state: 'not_started', sequenceStep: 0 };
        const cutscene: TutorialDungeonCutsceneState = current ?? {
            key: normalizedKey,
            roomId: normalizedRoomId,
            state: 'not_started',
            sequenceStep: 0,
            trigger,
            completionEffectApplied: false
        };
        cutscene.state = nextState;
        cutscene.sequenceStep = nextState === 'completed'
            ? Math.max(cutscene.sequenceStep, Number.isSafeInteger(sequenceStep) ? sequenceStep : 0)
            : Math.max(cutscene.sequenceStep, sequenceStep);
        cutscene.startedAt = cutscene.startedAt ?? Date.now();
        const objectives: string[] = [];
        if (nextState === 'completed' && !cutscene.completionEffectApplied) {
            cutscene.completionEffectApplied = true;
            if (normalizedKey === 'traversal') {
                objectives.push('cutscene:traversal');
            } else if (normalizedKey === 'cheer_gate') {
                objectives.push('cutscene:cheer_gate');
            }
        }
        state.cutscenes.set(normalizedKey, cutscene);
        objectives.forEach((objectiveKey) => state.completedObjectives.add(objectiveKey));
        const result = TutorialDungeonMechanics.commit(client, state, [], objectives.length > 0);
        TutorialDungeonMechanics.logMutation(client, 'cutscene_state_changed', `cutscene:${normalizedKey}`, previousState, cutscene, result);
        return result;
    }

    private static handleLogicalObjectiveRequest(
        client: Client,
        key: string,
        roomId: number,
        expectedRevision: number
    ): TutorialDungeonMutationResult {
        const state = TutorialDungeonMechanics.getClientState(client);
        const normalizedKey = String(key ?? '').trim();
        const allowedRoom = normalizedKey === 'traversal' ? 4 : normalizedKey === 'cheer_gate' ? 9 : 0;
        if (!state || allowedRoom === 0 || Math.round(Number(roomId)) !== allowedRoom) {
            const rejected = TutorialDungeonMechanics.result(state, 'rejected', 'invalid_logical_objective_key');
            TutorialDungeonMechanics.logMutation(client, 'request_rejected', `cutscene:${normalizedKey}`, null, null, rejected);
            return rejected;
        }
        const current = state.cutscenes.get(normalizedKey);
        if (current?.state === 'completed') {
            const duplicate = TutorialDungeonMechanics.result(state, 'already_completed');
            TutorialDungeonMechanics.logMutation(client, 'request_duplicate', `cutscene:${normalizedKey}`, current, current, duplicate);
            return duplicate;
        }
        const validation = TutorialDungeonMechanics.validateScopedRequest(
            client,
            state,
            allowedRoom,
            expectedRevision
        );
        if (validation) {
            TutorialDungeonMechanics.logMutation(client, 'request_rejected', `cutscene:${normalizedKey}`, current ?? null, null, validation);
            if (validation.status === 'requires_resync') {
                TutorialDungeonMechanics.sendSnapshot(client, 'objective_revision_mismatch');
            }
            return validation;
        }
        if (normalizedKey === 'traversal') {
            const dummiesComplete = [4841054, 4906590, 4972126]
                .every((id) => state.completedObjectives.has(`dummy:${id}`));
            const traversalObserved = client.startedRoomEvents.has(`${client.currentLevel}:5`);
            const position = actorPosition(client);
            const traversalPositionObserved = Boolean(
                position &&
                position.x > TRAVERSAL_COMPLETION_MIN_X &&
                position.y > TRAVERSAL_COMPLETION_MIN_Y
            );
            if (!dummiesComplete || !traversalObserved || !traversalPositionObserved) {
                const rejected = TutorialDungeonMechanics.result(
                    state,
                    'rejected',
                    !dummiesComplete
                        ? 'missing_prerequisite:dummies'
                        : !traversalObserved
                            ? 'traversal_not_observed'
                            : 'traversal_position_not_observed'
                );
                TutorialDungeonMechanics.logMutation(client, 'request_rejected', 'cutscene:traversal', current ?? null, null, rejected);
                return rejected;
            }
        } else {
            const chestsComplete = [4709982, 2612830, 2481758]
                .every((id) => state.chests.get(String(id))?.opened);
            const recentCheer = Date.now() - Number(client.lastEmoteAt ?? 0) <= 5000 &&
                normalizeName(client.lastEmoteName).includes('cheer');
            if (!chestsComplete || !recentCheer) {
                const rejected = TutorialDungeonMechanics.result(
                    state,
                    'rejected',
                    !chestsComplete ? 'missing_prerequisite:chests' : 'cheer_emote_not_observed'
                );
                TutorialDungeonMechanics.logMutation(client, 'request_rejected', 'cutscene:cheer_gate', current ?? null, null, rejected);
                return rejected;
            }
        }
        if (!current) {
            TutorialDungeonMechanics.mutateCutscene(
                client,
                normalizedKey,
                allowedRoom,
                'validated_client_request',
                'active',
                0
            );
        }
        return TutorialDungeonMechanics.mutateCutscene(
            client,
            normalizedKey,
            allowedRoom,
            'validated_client_request',
            'completed',
            CUTSCENE_COMPLETE_SEQUENCE
        );
    }

    private static validateScopedRequest(
        client: Client,
        state: TutorialDungeonMechanicsState | null,
        roomId: number,
        expectedRevision?: number
    ): TutorialDungeonMutationResult | null {
        if (
            !state ||
            !client.authenticated ||
            !client.character ||
            client.token <= 0 ||
            getClientLevelScope(client) !== state.levelScope
        ) {
            return TutorialDungeonMechanics.result(state, 'rejected', 'invalid_participant_or_scope');
        }
        const normalizedRoomId = Math.max(0, Math.round(Number(roomId) || 0));
        if (normalizedRoomId <= 0 || Math.round(Number(client.currentRoomId)) !== normalizedRoomId) {
            return TutorialDungeonMechanics.result(state, 'rejected', 'wrong_room');
        }
        if (expectedRevision !== undefined) {
            const normalizedRevision = Math.max(0, Math.round(Number(expectedRevision) || 0));
            if (normalizedRevision < state.revision) {
                return TutorialDungeonMechanics.result(state, 'requires_resync', 'stale_revision');
            }
            if (normalizedRevision > state.revision) {
                return TutorialDungeonMechanics.result(state, 'rejected', 'future_revision');
            }
        }
        const missingRoomPrerequisite = TutorialDungeonMechanics.getMissingRoomPrerequisite(state, normalizedRoomId);
        if (missingRoomPrerequisite) {
            return TutorialDungeonMechanics.result(
                state,
                'rejected',
                `missing_room_prerequisite:${missingRoomPrerequisite}`
            );
        }
        return null;
    }

    private static getMissingRoomPrerequisite(
        state: TutorialDungeonMechanicsState,
        roomId: number
    ): string {
        const prerequisite = roomId <= 1
            ? ''
            : roomId === 2
                ? 'chain:3268190'
                : roomId <= 4
                    ? 'dummy:4972126'
                    : roomId === 5
                        ? 'cutscene:traversal'
                        : roomId === 6
                            ? 'chest:4709982'
                            : roomId <= 8
                                ? 'chest:2612830'
                                : roomId === 9
                                    ? 'chest:2481758'
                                    : 'cutscene:cheer_gate';
        return prerequisite && !state.completedObjectives.has(prerequisite) ? prerequisite : '';
    }

    private static commit(
        client: Client,
        state: TutorialDungeonMechanicsState,
        events: TutorialDungeonMechanicEvent[],
        progressMayChange: boolean
    ): TutorialDungeonMutationResult {
        const previousProgress = state.progress;
        if (progressMayChange) {
            state.progress = calculateProgress(state);
        }
        state.revision += 1;
        state.lastMutationAt = Date.now();
        const result: TutorialDungeonMutationResult = {
            status: 'applied',
            revision: state.revision,
            events,
            progressChanged: state.progress !== previousProgress
        };
        TutorialDungeonMechanics.broadcastSnapshot(state.levelScope, client, 'mutation');
        if (result.progressChanged) {
            TutorialDungeonMechanics.broadcastProgress(state, client);
        }
        return result;
    }

    private static result(
        state: TutorialDungeonMechanicsState | null | undefined,
        status: TutorialDungeonMutationStatus,
        reason?: string
    ): TutorialDungeonMutationResult {
        return {
            status,
            revision: state?.revision ?? 0,
            reason,
            events: [],
            progressChanged: false
        };
    }

    private static getRecipients(levelScope: string): Client[] {
        const seen = new Set<Client>();
        const recipients: Client[] = [];
        for (const session of GlobalState.sessionsByToken.values()) {
            if (
                !session ||
                seen.has(session) ||
                !session.authenticated ||
                !session.character ||
                getClientLevelScope(session) !== levelScope
            ) {
                continue;
            }
            seen.add(session);
            recipients.push(session);
        }
        return recipients;
    }

    private static broadcastSnapshot(levelScope: string, actor: Client, reason: string): void {
        const state = TutorialDungeonMechanics.getState(levelScope);
        const snapshot = state ? TutorialDungeonMechanics.buildSnapshot(state) : null;
        if (!snapshot) {
            return;
        }
        const payload = TutorialDungeonMechanics.buildSnapshotPayload(snapshot);
        const recipients = TutorialDungeonMechanics.getRecipients(levelScope);
        for (const recipient of recipients) {
            recipient.send(GOBLIN_KIDNAPPERS_SNAPSHOT_PACKET_ID, payload);
        }
        TutorialDungeonMechanics.logAuthority(actor, 'snapshot_sent', {
            reason,
            revision: state?.revision ?? 0,
            progress: state?.progress ?? 0,
            checkpointRoomId: state?.checkpointRoomId ?? 0,
            recipientCount: recipients.length
        });
    }

    private static broadcastProgress(state: TutorialDungeonMechanicsState, actor: Client): void {
        const bb = new BitBuffer(false);
        bb.writeMethod4(state.progress);
        const payload = bb.toBuffer();
        const recipients = TutorialDungeonMechanics.getRecipients(state.levelScope);
        for (const recipient of recipients) {
            if (recipient.character) {
                recipient.character.questTrackerState = state.progress;
            }
            recipient.send(0xB7, payload);
        }
        TutorialDungeonMechanics.logAuthority(actor, 'progress_broadcast', {
            revision: state.revision,
            progress: state.progress,
            checkpointRoomId: state.checkpointRoomId,
            recipientCount: recipients.length
        });
    }

    private static describeAuthorityState(
        state: TutorialDungeonMechanicsState,
        authority: TutorialDungeonAuthorityEntity
    ): unknown {
        if (authority.role === 'dummy') {
            return { ...state.dummies.get(String(authority.id)) };
        }
        if (authority.role === 'early_chain' || authority.role === 'anna_chain') {
            return { ...state.chains.get(String(authority.id)) };
        }
        if (authority.role === 'tutorial_chest' || authority.role === 'boss_chest') {
            return { ...state.chests.get(String(authority.id)) };
        }
        if (authority.role === 'boss') {
            return { ...state.boss };
        }
        return { completed: state.defeatedEntityIds.has(authority.id) };
    }

    private static logMutation(
        client: Client,
        event: string,
        objectKey: string,
        previousState: unknown,
        nextState: unknown,
        result: TutorialDungeonMutationResult
    ): void {
        TutorialDungeonMechanics.logAuthority(client, event, {
            revision: result.revision,
            objectKey,
            previousState,
            nextState,
            newlyApplied: result.status === 'applied',
            duplicate: result.status === 'already_completed',
            rejectionReason: result.reason ?? '',
            recipientCount: TutorialDungeonMechanics.getRecipients(getClientLevelScope(client)).length
        });
    }

    private static logAuthority(client: Client | null, event: string, details: Record<string, unknown> = {}): void {
        const scope = client ? getClientLevelScope(client) : '';
        console.log(`[GoblinKidnappersAuthority] ${JSON.stringify({
            event,
            scope,
            actor: getActorName(client),
            token: Math.max(0, Math.round(Number(client?.token ?? 0))),
            roomId: Math.max(0, Math.round(Number(client?.currentRoomId ?? 0))),
            ...details
        })}`);
    }
}
