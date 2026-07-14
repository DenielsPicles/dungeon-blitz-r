function applyDevServerEnv(env = process.env) {
    env.MULTIPLAYER_MODE = 'false';
    env.STATIC_PORT = env.STATIC_PORT || '8000';
    env.ENABLE_POLICY_SERVER = env.ENABLE_POLICY_SERVER || 'false';
    env.DEBUG_PROGRESS = env.DEBUG_PROGRESS || 'false';
    env.DEBUG_PACKETS = env.DEBUG_PACKETS || 'false';
    env.DEBUG_PAYLOAD_PREVIEW_BYTES = env.DEBUG_PAYLOAD_PREVIEW_BYTES || '64';
    env.ENABLE_MONGO_GAME_DATA = 'false';
    env.GAME_MONGODB_URI = '';
    env.MONGODB_URI = '';
    env.SPONSOR_MONGODB_URI = '';
    env.SPONSOR_ACCOUNT_CREATION_REQUIRED = 'false';
}

function startDevServer() {
    require('../scripts/cleanup-dev-instance');
    applyDevServerEnv();

    require('ts-node/register');
    require('../main.ts');
}

if (require.main === module) {
    startDevServer();
}

module.exports = {
    applyDevServerEnv,
    startDevServer
};
