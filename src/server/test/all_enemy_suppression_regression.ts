import assert from 'node:assert/strict';
import { Config } from '../core/config';
import { EntityState, EntityTeam } from '../core/Entity';
import { EntityHandler } from '../handlers/EntityHandler';

function createClient(): any {
    const sentPackets: Array<{ packetId: number; payload: Buffer }> = [];
    return {
        token: 123,
        userId: 456,
        character: { name: 'EnemySuppressionTester' },
        currentLevel: 'NewbieRoad',
        levelInstanceId: 'test-instance',
        currentRoomId: 7,
        entities: new Map<number, any>(),
        knownEntityIds: new Set<number>(),
        entityIdAliases: new Map<number, number>(),
        sentPackets,
        send(packetId: number, payload: Buffer): void {
            sentPackets.push({ packetId, payload });
        }
    };
}

function runAllEnemySuppressionRegression(): void {
    assert.equal(Config.DISABLE_ALL_ENEMIES, true, 'global enemy removal should be enabled by default');

    const client = createClient();
    client.entities.set(9001, { id: 9001 });
    client.knownEntityIds.add(9001);
    client.entityIdAliases.set(9001, 9002);

    const suppressedClientEnemy = EntityHandler.suppressGlobalEnemyTestSpawn(
        client,
        {
            id: 9001,
            name: 'ClientOnlyGoblin',
            isPlayer: false,
            team: EntityTeam.ENEMY,
            clientSpawned: true
        },
        9001
    );

    assert.equal(suppressedClientEnemy, true, 'client-authored enemies must be rejected');
    assert.equal(client.entities.has(9001), false, 'the rejected client enemy must leave the entity cache');
    assert.equal(client.knownEntityIds.has(9001), false, 'the rejected client enemy must leave the known-id cache');
    assert.equal(client.entityIdAliases.has(9001), false, 'the rejected client enemy alias must be removed');
    assert.equal(client.sentPackets.at(-1)?.packetId, 0x0D, 'client enemy cleanup must use entity destroy');

    const packetCountBeforeServerEnemy = client.sentPackets.length;
    EntityHandler.sendEntity(client, {
        id: 9100,
        name: 'ServerOnlyBoss',
        isPlayer: false,
        team: EntityTeam.ENEMY,
        entState: EntityState.ACTIVE,
        clientSpawned: false
    });
    assert.equal(client.sentPackets.length, packetCountBeforeServerEnemy + 1, 'server enemy suppression must emit cleanup');
    assert.equal(client.sentPackets.at(-1)?.packetId, 0x0D, 'server enemy cleanup must use entity destroy');
    assert.equal(client.sentPackets.some((packet: any) => packet.packetId === 0x0F), false, 'no enemy spawn packet may be sent');

    const friendlyPacketCount = client.sentPackets.length;
    EntityHandler.sendEntity(client, {
        id: 9200,
        name: 'FriendlyNpc',
        isPlayer: false,
        team: 3,
        entState: EntityState.ACTIVE,
        clientSpawned: false
    });
    assert.equal(client.sentPackets.length, friendlyPacketCount + 1, 'friendly NPCs must remain visible');
    assert.equal(client.sentPackets.at(-1)?.packetId, 0x0F, 'friendly NPCs must keep their spawn packet');
}

runAllEnemySuppressionRegression();
console.log('all enemy suppression regression passed');
