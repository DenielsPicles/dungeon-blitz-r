import { strict as assert } from 'assert';
import path from 'path';
import { Character } from '../database/Database';
import { JsonAdapter } from '../database/JsonAdapter';
import { MissionLoader } from '../data/MissionLoader';
import { MissionHandler } from '../handlers/MissionHandler';
import { BitBuffer } from '../network/protocol/bitBuffer';
import { BitReader } from '../network/protocol/bitReader';

type SentPacket = {
    id: number;
    payload: Buffer;
};

type FakeClient = {
    userId: number;
    character: Character;
    characters: Character[];
    sentPackets: SentPacket[];
    sendBitBuffer(id: number, bb: BitBuffer): void;
};

function createCharacter(): Character {
    return {
        name: 'Neodevil',
        class: 'Paladin',
        gender: 'male',
        level: 25,
        mammothIdols: 7,
        showHigher: false,
        missions: {},
        CurrentLevel: { name: 'BridgeTown', x: 100, y: 100 }
    };
}

function createClient(): FakeClient {
    const sentPackets: SentPacket[] = [];
    const character = createCharacter();

    return {
        userId: 99,
        character,
        characters: [character],
        sentPackets,
        sendBitBuffer(id: number, bb: BitBuffer): void {
            sentPackets.push({ id, payload: bb.toBuffer() });
        }
    };
}

function createBadgePacket(badgeKey: string): Buffer {
    const bb = new BitBuffer();
    bb.writeMethod26(badgeKey);
    return bb.toBuffer();
}

async function withMockedCharacterPersistence<T>(fn: () => Promise<T>): Promise<T> {
    const originalLoadCharacters = JsonAdapter.prototype.loadCharacters;
    const originalSaveCharacters = JsonAdapter.prototype.saveCharacters;
    let savedCharacters: Character[] | null = null;

    JsonAdapter.prototype.loadCharacters = async function(userId: number): Promise<Character[]> {
        assert.equal(userId, 99);
        return [createCharacter()];
    };

    JsonAdapter.prototype.saveCharacters = async function(userId: number, characters: Character[]): Promise<void> {
        assert.equal(userId, 99);
        savedCharacters = characters;
    };

    try {
        const result = await fn();
        assert.ok(savedCharacters, 'achievement claim should persist the updated character snapshot');
        const persistedCharacters = savedCharacters as Character[];
        assert.equal(persistedCharacters[0]?.mammothIdols, 17, 'persisted character should include the new idol total');
        return result;
    } finally {
        JsonAdapter.prototype.loadCharacters = originalLoadCharacters;
        JsonAdapter.prototype.saveCharacters = originalSaveCharacters;
    }
}

async function testAchievementBadgeGrantRefreshesIdolsWithoutMissionPopup(): Promise<void> {
    MissionLoader.load(path.resolve(__dirname, '..', 'data'));

    const client = createClient();

    await withMockedCharacterPersistence(async () => {
        await MissionHandler.handleBadgeRequest(client as never, createBadgePacket('KingOfTheWorld'));
    });

    assert.equal(client.character.mammothIdols, 17, 'achievement claim should grant 10 mammoth idols');

    const missionEntry = client.character.missions?.['80'];
    assert.ok(missionEntry, 'achievement mission entry should be created');
    assert.equal(Number(missionEntry.state ?? 0), 3, 'achievement mission should be marked as claimed');

    const idolUpdatePacket = client.sentPackets.find((packet) => packet.id === 0xA1);
    assert.ok(idolUpdatePacket, 'achievement claim should refresh mammoth idols immediately on the client');
    const idolReader = new BitReader(idolUpdatePacket!.payload);
    assert.equal(idolReader.readMethod4(), 17, 'idol refresh packet should contain the new total');
    assert.equal(idolReader.readMethod4(), 0, 'idol refresh packet should not trigger a USD purchase analytics popup');
    assert.equal(idolReader.readMethod15(), false, 'idol refresh packet should preserve the higher-offer flag');

    assert.equal(
        client.sentPackets.some((packet) => packet.id === 0x84),
        true,
        'achievement claim should still show the achievement-complete UI'
    );
    assert.equal(
        client.sentPackets.some((packet) => packet.id === 0x85),
        false,
        'achievement claim should not send a mission-added popup packet'
    );
}

async function main(): Promise<void> {
    await testAchievementBadgeGrantRefreshesIdolsWithoutMissionPopup();
    console.log('achievement_badge_idol_regression: ok');
}

void main().catch((error) => {
    console.error('achievement_badge_idol_regression: failed');
    console.error(error);
    process.exitCode = 1;
});
