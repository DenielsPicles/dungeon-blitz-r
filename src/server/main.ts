import './core/loadEnv';

import { GameServer } from './core/server';
import { PolicyServer } from './network/policyServer';
import { Config } from './core/config';
import { PacketRouter } from './network/packetRouter';
import { LoginHandler } from './handlers/LoginHandler';
import { CharacterHandler } from './handlers/CharacterHandler';
import { EntityHandler } from './handlers/EntityHandler';
import { CommandHandler } from './handlers/CommandHandler';
import { LevelHandler } from './handlers/LevelHandler';
import { SocialHandler } from './handlers/SocialHandler';
import { LevelConfig } from './core/LevelConfig';
import { CharacterTemplates } from './core/CharacterTemplates';
import { PetConfig } from './core/PetConfig';
import { TalentHandler } from './handlers/TalentHandler';
import { SigilHandler } from './handlers/SigilHandler';
import { GameData } from './core/GameData';
import { MissionLoader } from './data/MissionLoader';
import { MissionDialogueLoader } from './data/MissionDialogueLoader';
import { NpcDialogueLoader } from './data/NpcDialogueLoader';
import { DialogueTranslationLoader } from './data/DialogueTranslationLoader';
import { NpcLoader } from './data/NpcLoader';
import { CombatHandler } from './handlers/CombatHandler';
import { BuildingHandler } from './handlers/BuildingHandler';
import { SystemHandler } from './handlers/SystemHandler';
import { AILogic } from './core/AILogic';
import { MissionHandler } from './handlers/MissionHandler';
import { LockboxHandler } from './handlers/LockboxHandler';
import { NpcHandler } from './handlers/NpcHandler';
import { RewardHandler } from './handlers/RewardHandler';
import { LootDepthRewardHandler } from './handlers/LootDepthRewardHandler';
import { EquipmentHandler } from './handlers/EquipmentHandler';
import { GearSetHandler } from './handlers/GearSetHandler';
import { AbilityHandler } from './handlers/AbilityHandler';
import { DebugLogger } from './core/Debug';
import { GuildHandler } from './handlers/GuildHandler';
import { ForgeHandler } from './handlers/ForgeHandler';
import { discordSocialBridge } from './integrations/DiscordSocialBridge';
import { ProjectInfo } from './core/ProjectInfo';
import * as path from 'path';

import { StaticServer } from './core/StaticServer';

type DungeonCompletionPatchTarget = {
    DUNGEONS_REQUIRING_BOSS_DEFEAT?: Set<string>;
    REQUIRED_DUNGEON_BOSS_NAMES_BY_LEVEL?: Record<string, ReadonlySet<string>>;
    DUNGEONS_WHERE_CLIENT_COMPLETION_RELEASES_POST_DEATH_CUTSCENE?: Set<string>;
};

function applyDungeonCompletionPatches(): void {
    const missionHandler = MissionHandler as unknown as DungeonCompletionPatchTarget;

    missionHandler.DUNGEONS_REQUIRING_BOSS_DEFEAT?.add('SRN_Mission3');
    missionHandler.DUNGEONS_REQUIRING_BOSS_DEFEAT?.add('SRN_Mission3Hard');
    missionHandler.DUNGEONS_REQUIRING_BOSS_DEFEAT?.add('GhostBossDungeon');
    missionHandler.DUNGEONS_REQUIRING_BOSS_DEFEAT?.add('GhostBossDungeonHard');

    // Nephit's Quest/GhostBossDungeon uses the client completion flow to release the
    // post-death boss cutscene. Without this, the server waits for a cutscene that the
    // client never starts, so the dungeon remains stuck after the boss dies.
    missionHandler.DUNGEONS_WHERE_CLIENT_COMPLETION_RELEASES_POST_DEATH_CUTSCENE?.add('GhostBossDungeon');
    missionHandler.DUNGEONS_WHERE_CLIENT_COMPLETION_RELEASES_POST_DEATH_CUTSCENE?.add('GhostBossDungeonHard');

    const requiredBossNames = missionHandler.REQUIRED_DUNGEON_BOSS_NAMES_BY_LEVEL;
    if (!requiredBossNames) {
        return;
    }

    requiredBossNames.SRN_Mission3 = new Set(['YoungDragonGreen']);
    requiredBossNames.SRN_Mission3Hard = new Set(['YoungDragonGreenHard']);
    requiredBossNames.GhostBossDungeon = new Set(['NephitLargeEye']);
    requiredBossNames.GhostBossDungeonHard = new Set(['NephitLargeEyeHard']);
}

applyDungeonCompletionPatches();

// Load Config
const dataDir = path.join(Config.DATA_DIR, 'data');
LevelConfig.load(dataDir);
CharacterTemplates.load(dataDir);
PetConfig.load(dataDir);
GameData.load(dataDir);
MissionLoader.load(dataDir);
MissionDialogueLoader.load(dataDir);
NpcDialogueLoader.load(dataDir);
DialogueTranslationLoader.load(dataDir);
NpcLoader.load(dataDir);
console.log(`[Startup] ${ProjectInfo.name} v${ProjectInfo.version}`);
DebugLogger.logStartup();