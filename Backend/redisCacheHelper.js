// filename: redisCacheHelper.js - Redis Cache Helper Module
const redisClient = require('./redisClient');

/**
 * 🚀 REDIS CACHE HELPER: Unified caching interface for MVT tiles and JSON data
 * Compatible with Redis Server 4.0.9
 */
class RedisCacheHelper {
    
    /**
     * Check if Redis is connected and ready
     */
    isReady() {
        return redisClient.isReady;
    }

    /**
     * Get cached data from Redis
     * @param {string} key - Cache key
     * @returns {Promise<any|null>} - Parsed cached data or null
     */
    async get(key) {
        try {
            if (!this.isReady()) {
                console.warn('⚠️  Redis not ready, skipping cache get');
                return null;
            }

            const cached = await redisClient.get(key);
            if (!cached) {
                return null;
            }
            
            // 🚀 MVT tiles are binary data - return as Buffer
            if (key.includes('_mvt_')) {
                return Buffer.from(cached, 'base64');
            }
            
            // 🚀 JSON data - parse it
            try {
                return JSON.parse(cached);
            } catch (parseErr) {
                // If not JSON, return as string
                return cached;
            }
        } catch (err) {
            console.error(`❌ Redis GET error for key "${key}":`, err.message);
            return null;
        }
    }

    /**
     * Set cached data in Redis with TTL
     * @param {string} key - Cache key
     * @param {any} value - Data to cache (Buffer, Object, Array, or String)
     * @param {number} ttl - Time to live in seconds (default: 300 = 5 minutes)
     */
    async set(key, value, ttl = 300) {
        try {
            if (!this.isReady()) {
                console.warn('⚠️  Redis not ready, skipping cache set');
                return false;
            }

            let dataToStore;
            
            // 🚀 Handle Buffer (binary MVT tiles)
            if (Buffer.isBuffer(value)) {
                dataToStore = value.toString('base64');
            } 
            // 🚀 Handle Objects/Arrays
            else if (typeof value === 'object') {
                dataToStore = JSON.stringify(value);
            } 
            // 🚀 Handle primitives
            else {
                dataToStore = String(value);
            }
            
            // Use SETEX for Redis 4.0.9 compatibility (SET with EX option)
            await redisClient.setEx(key, ttl, dataToStore);
            return true;
        } catch (err) {
            console.error(`❌ Redis SET error for key "${key}":`, err.message);
            return false;
        }
    }

    /**
     * Delete cached data by key
     * @param {string} key - Cache key
     */
    async del(key) {
        try {
            if (!this.isReady()) {
                return false;
            }
            
            await redisClient.del(key);
            return true;
        } catch (err) {
            console.error(`❌ Redis DEL error for key "${key}":`, err.message);
            return false;
        }
    }

    /**
     * Delete multiple keys matching a pattern
     * @param {string} pattern - Pattern to match (e.g., 'complaint_data_mvt_*')
     * Uses SCAN instead of KEYS to avoid blocking Redis in production
     */
    async delPattern(pattern) {
        try {
            if (!this.isReady()) {
                return 0;
            }

            let cursor = '0';
            let totalDeleted = 0;
            const keysToDelete = [];

            // 🚀 Use SCAN instead of KEYS - non-blocking iteration
            do {
                // SCAN returns [nextCursor, matchingKeys]
                // COUNT 100 suggests batch size (Redis may return more/less)
                const result = await redisClient.scan(cursor, {
                    MATCH: pattern,
                    COUNT: 100
                });

                cursor = result.cursor;
                const keys = result.keys;

                if (keys.length > 0) {
                    keysToDelete.push(...keys);
                }

            } while (cursor !== '0'); // cursor=0 means iteration complete

            // Delete all matched keys in batches to avoid overwhelming Redis
            if (keysToDelete.length > 0) {
                const batchSize = 1000;
                for (let i = 0; i < keysToDelete.length; i += batchSize) {
                    const batch = keysToDelete.slice(i, i + batchSize);
                    await redisClient.del(batch);
                    totalDeleted += batch.length;
                }
                console.log(`✅ Deleted ${totalDeleted} Redis keys matching "${pattern}"`);
            }

            return totalDeleted;
        } catch (err) {
            console.error(`❌ Redis DEL PATTERN error for "${pattern}":`, err.message);
            return 0;
        }
    }

    /**
     * Check if key exists in Redis
     * @param {string} key - Cache key
     */
    async exists(key) {
        try {
            if (!this.isReady()) {
                return false;
            }
            
            return (await redisClient.exists(key)) === 1;
        } catch (err) {
            console.error(`❌ Redis EXISTS error for key "${key}":`, err.message);
            return false;
        }
    }

    /**
     * Get Redis server info
     */
    async getInfo(section = 'stats') {
        try {
            if (!this.isReady()) {
                return 'Redis not connected';
            }
            
            return await redisClient.info(section);
        } catch (err) {
            console.error('❌ Redis INFO error:', err.message);
            return null;
        }
    }

    /**
     * Get cache statistics for monitoring
     */
    async getStats() {
        try {
            if (!this.isReady()) {
                return {
                    connected: false,
                    error: 'Redis not connected'
                };
            }

            const info = await this.getInfo('stats');
            const memory = await this.getInfo('memory');
            const keyspace = await this.getInfo('keyspace');
            
            return {
                connected: true,
                info,
                memory,
                keyspace
            };
        } catch (err) {
            console.error('❌ Redis STATS error:', err.message);
            return {
                connected: false,
                error: err.message
            };
        }
    }

    /**
     * Get TTL (time to live) for a key
     */
    async ttl(key) {
        try {
            if (!this.isReady()) {
                return -2;
            }
            
            return await redisClient.ttl(key);
        } catch (err) {
            console.error(`❌ Redis TTL error for key "${key}":`, err.message);
            return -2;
        }
    }
}

// Export singleton instance
module.exports = new RedisCacheHelper();

