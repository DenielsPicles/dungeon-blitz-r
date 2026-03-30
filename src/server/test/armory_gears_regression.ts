import { strict as assert } from 'assert';
import { CharacterHandler } from '../handlers/CharacterHandler';
import { BitBuffer } from '../network/protocol/bitBuffer';
import { BitReader } from '../network/protocol/bitReader';

type SentPacket = {
    id: number;
    payload: Buffer;
};

function createClient(): any {
    const sentPackets: SentPacket[] = [];

    return {
        character: {
            name: 'Neo',
            class: 'Mage',
            inventoryGears: [
                { gearID: 1177, tier: 2 },
                { gearID: 1181, tier: 1 },
                { gearID: 65, tier: 0 }
            ]
        },
        sentPackets,
        send(id: number, payload: Buffer) {
            sentPackets.push({ id, payload });
        },
        sendBitBuffer(id: number, bb: BitBuffer) {
            sentPackets.push({ id, payload: bb.toBuffer() });
        }
    };
}

function createArmoryRequestPacket(token: number): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod9(token);
    return bb.toBuffer();
}

function testArmoryGearRequestReturnsInventoryGearList(): void {
    const client = createClient();

    CharacterHandler.handleRequestArmoryGears(client, createArmoryRequestPacket(412));

    assert.equal(client.sentPackets.length, 1, 'armory request should produce one response packet');
    assert.equal(client.sentPackets[0].id, 0xF5, 'armory request should reply with 0xF5');

    const br = new BitReader(client.sentPackets[0].payload);
    const gearCount = br.readMethod4();
    assert.equal(gearCount, 3);

    const parsed = [];
    for (let i = 0; i < gearCount; i++) {
        parsed.push({
            gearID: br.readMethod6(11),
            tier: br.readMethod6(2)
        });
    }

    assert.deepEqual(parsed, [
        { gearID: 1177, tier: 2 },
        { gearID: 1181, tier: 1 },
        { gearID: 65, tier: 0 }
    ]);
}

function main(): void {
    testArmoryGearRequestReturnsInventoryGearList();
    console.log('armory_gears_regression: ok');
}

try {
    main();
} catch (error) {
    console.error('armory_gears_regression: failed');
    console.error(error);
    process.exitCode = 1;
}
