// Read-only model inspection: run `npm.cmd run inspect:device-model -- [file.json] [deviceId]`.
const fs = require('node:fs');
const path = require('node:path');
const { migrateTopology } = require('../out/modules/topology/migrations.js');
const { toNetworkDevice } = require('../out/shared/deviceConfiguration.js');
const { DeviceConfigurationValidationError } = require('../out/shared/validateDeviceConfiguration.js');

try {
    const file = path.resolve(process.argv[2] ?? path.join(__dirname, '../test-workspace/h2c-topology.json'));
    const topology = migrateTopology(JSON.parse(fs.readFileSync(file, 'utf8')));
    const devices = process.argv[3] ? topology.devices.filter((device) => device.id === process.argv[3]) : topology.devices;
    if (!devices.length) { throw new Error('Kein passendes Gerät gefunden.'); }
    for (const device of devices) {
        const model = toNetworkDevice(device, topology.devices.filter((item) => item.id !== device.id)
            .map((item) => item.hostname));
        console.log(JSON.stringify({
            modelClass: model.constructor.name,
            id: model.id, hostname: model.hostname, type: model.type,
            interfaces: model.interfaces.map((iface) => ({ modelClass: iface.constructor.name, ...iface })),
            protocols: model.protocols.map((protocol) => ({ modelClass: protocol.constructor.name, ...protocol }))
        }, null, 2));
    }
    console.log('OK: gespeicherte Konfiguration als H1c-Modell geladen. Quelldatei unverändert.');
} catch (error) {
    if (error instanceof DeviceConfigurationValidationError) {
        console.error('H2c: Konfiguration ungültig:');
        for (const issue of error.errors) { console.error(`[${issue.field}] ${issue.message}`); }
    } else {
        console.error(`H2c: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exitCode = 1;
}
