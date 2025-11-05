// filename: redisClient.js - Redis Connection Module
const redis = require('redis');

// 🚀 Redis Client Configuration for Redis 4.0.9 server
// Compatible with redis npm package v4.x
const redisClient = redis.createClient({
    socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        reconnectStrategy: (retries) => {
            if (retries > 10) {
                console.error('❌ Redis: Too many reconnection attempts, giving up');
                return new Error('Redis reconnection failed');
            }
            const delay = Math.min(retries * 100, 3000);
            console.log(`🔄 Redis: Reconnecting in ${delay}ms... (attempt ${retries})`);
            return delay;
        },
        // Add timeouts for better error handling
        connectTimeout: 10000
    },
    password: process.env.REDIS_PASSWORD || undefined,
    database: parseInt(process.env.REDIS_DB) || 0,
    // Gracefully handle connection errors without crashing
    legacyMode: false
});

// 🔔 Event handlers for monitoring Redis connection
redisClient.on('error', (err) => {
    console.error('❌ Redis Client Error:', err.message);
    // Don't crash the server on Redis errors
});

redisClient.on('connect', () => {
    console.log('✅ Redis: Connection established');
});

redisClient.on('ready', () => {
    console.log('✅ Redis: Ready to accept commands (Server version should be 4.0.9)');
});

redisClient.on('reconnecting', () => {
    console.log('🔄 Redis: Attempting to reconnect...');
});

redisClient.on('end', () => {
    console.log('⚠️  Redis: Connection closed');
});

// 🚀 Connect to Redis with error handling
(async () => {
    try {
        await redisClient.connect();
        // Verify Redis version
        const info = await redisClient.info('server');
        const versionMatch = info.match(/redis_version:(\d+\.\d+\.\d+)/);
        if (versionMatch) {
            console.log(`✅ Redis: Server version ${versionMatch[1]} detected`);
        }
    } catch (err) {
        console.error('❌ Failed to connect to Redis:', err.message);
        console.error('⚠️  Application will continue with node-cache only');
        // Don't crash the server, just log the error
    }
})();

// 🛡️ Shutdown helper - called by server.js gracefulShutdown
// DO NOT register signal handlers here - let server.js coordinate shutdown
redisClient.closeGracefully = async () => {
    try {
        if (redisClient.isReady) {
            await redisClient.quit();
            console.log('✅ Redis connection closed cleanly');
        } else {
            console.log('ℹ️  Redis already disconnected');
        }
    } catch (err) {
        console.error('⚠️  Error closing Redis connection:', err.message);
        // Force disconnect if quit fails
        try {
            await redisClient.disconnect();
        } catch (disconnectErr) {
            console.error('⚠️  Error forcing Redis disconnect:', disconnectErr.message);
        }
    }
};

module.exports = redisClient;

