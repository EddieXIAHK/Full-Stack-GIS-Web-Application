// filename: server.js - Backend Code
const express = require('express');
const cors = require('cors');
const compression = require('compression');
require('dotenv').config();
const { Pool } = require('pg');
// 🚀 REDIS: Centralized Redis-only caching architecture
// All caching now handled by Redis for:
// - API responses and MVT tiles
// - Expensive PostGIS ST_Union computations
// - GeoJSON file data
// - Spatial filtering results
const redisCache = require('./redisCacheHelper');
const redisClient = require('./redisClient'); // For graceful shutdown

// 🗺️ MBTILES: Serve local Hong Kong base map tiles
const MBTiles = require('@mapbox/mbtiles');
const path = require('path');

const app = express();
const port = parseInt(process.env.PORT) || 3000;

app.use(cors());
// 🚀 PERFORMANCE: Enable Gzip compression for all responses
// 🗺️ EXCEPTION: Disable compression for base-tiles (PBF tiles are pre-compressed)
app.use((req, res, next) => {
    if (req.path.startsWith('/base-tiles/')) {
        req.skipCompression = true;
    }
    next();
});
app.use(compression({ filter: (req) => !req.skipCompression }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 🚀 NEW: Serve simulation raw data (TIF files) from simulation-raw-data folder
const simulationDataPath = '/home/radio/Grid Data Display/Backend/simulation-raw-data';
app.use('/simulation-raw-data', express.static(simulationDataPath));


// 🚀 SECURITY FIX: Setup the PostgreSQL connection pool with environment variables
// 🚀 PERFORMANCE FIX: Add proper connection pool limits and timeouts
// 🚀 CONNECTION FIX: Reduced max connections to prevent exhausting database connection slots
const poolConfig = {
    max: 5, // maximum number of connections in the pool (reduced from 10 to prevent connection exhaustion)
    min: 1, // minimum number of connections to maintain
    idleTimeoutMillis: 20000, // close idle connections after 20 seconds (reduced for faster cleanup)
    connectionTimeoutMillis: 5000, // return error after 5 seconds if connection can't be established (increased for better handling)
    maxUses: 7500, // close connection after 7500 queries (helps with memory leaks)
    allowExitOnIdle: false, // keep pool alive to maintain connections
    evictionRunIntervalMillis: 10000, // run eviction every 10 seconds
    softIdleTimeoutMillis: 15000 // soft idle timeout before hard idle timeout
};

const pool = new Pool({
    user: process.env.DB_USER || 'xxxxxxxx',
    host: process.env.DB_HOST || 'xxxxxxxxx',
    database: process.env.DB_NAME || 'xxxxxxxxx',
    password: process.env.DB_PASSWORD || 'xxxxxxxxx',
    port: parseInt(process.env.DB_PORT) || xxxxxxxxx,
    ...poolConfig
});

const hkmapPool = new Pool({
    user: process.env.HKMAP_DB_USER || 'xxxxxxxxx',
    host: process.env.HKMAP_DB_HOST || 'xxxxxxxxx',
    database: process.env.HKMAP_DB_NAME || 'xxxxxxxxx',
    password: process.env.HKMAP_DB_PASSWORD || 'xxxxxxxxx',
    port: parseInt(process.env.HKMAP_DB_PORT) || xxxxxxxxx,
    ...poolConfig
});

const newPool = new Pool({
    user: process.env.DISCOVERY_DB_USER || 'xxxxxxxxx',
    host: process.env.DISCOVERY_DB_HOST || 'xxxxxxxxx',
    database: process.env.DISCOVERY_DB_NAME || 'xxxxxxxxx',
    password: process.env.DISCOVERY_DB_PASSWORD || 'xxxxxxxxx',
    port: parseInt(process.env.DISCOVERY_DB_PORT) || xxxxxxxxx,
    ...poolConfig
});

const siteDbPool = new Pool({
    user: process.env.SITE_DB_USER || 'xxxxxxxxx',
    host: process.env.SITE_DB_HOST || 'xxxxxxxxx',
    database: process.env.SITE_DB_NAME || 'xxxxxxxxx',
    password: process.env.SITE_DB_PASSWORD || 'xxxxxxxxx',
    port: parseInt(process.env.SITE_DB_PORT) || xxxxxxxxx,
    ...poolConfig
});

const complaintDbPool = new Pool({
    user: process.env.SITE_DB_USER || 'xxxxxxxxx',
    host: process.env.SITE_DB_HOST || 'xxxxxxxxx',
    database: process.env.SITE_DB_NAME || 'nodxxxxxxxxx',
    password: process.env.SITE_DB_PASSWORD || 'xxxxxxxxx',
    port: parseInt(process.env.SITE_DB_PORT) || xxxxxxxxx,
    ...poolConfig
});

// 🚀 PERFORMANCE FIX: Add connection pool monitoring and error handling
// All 5 database pools must be monitored for errors and health
const pools = [
    { name: 'pool', instance: pool },
    { name: 'hkmapPool', instance: hkmapPool },
    { name: 'newPool', instance: newPool },
    { name: 'siteDbPool', instance: siteDbPool },
    { name: 'complaintDbPool', instance: complaintDbPool }
];

pools.forEach(({ name, instance }) => {
    instance.on('error', (err) => {
        console.error(`Database pool ${name} error:`, err);
    });

    instance.on('connect', () => {
    });
});

// 🚀 PERFORMANCE FIX: Add pool status monitoring endpoint
app.get('/pool-status', (req, res) => {
    const status = pools.map(({ name, instance }) => ({
        name,
        totalCount: instance.totalCount,
        idleCount: instance.idleCount,
        waitingCount: instance.waitingCount
    }));
    res.json({ pools: status });
});

// 🚀 REDIS-ONLY: Cache statistics endpoint
app.get('/cache-stats', async (req, res) => {
    try {
        const redisStats = await redisCache.getStats();
        const redisConnected = redisCache.isReady();

        res.json({
            architecture: 'Redis-Only Centralized Caching',
            redis: {
                connected: redisConnected,
                status: redisConnected ? 'All caching handled by Redis' : 'Redis disconnected - no caching active',
                stats: redisConnected ? redisStats : null
            },
            cacheTypes: {
                mvtTiles: 'MVT vector tiles (5-minute TTL)',
                apiResponses: 'API JSON responses (5-minute TTL)',
                spatialQueries: 'PostGIS ST_Union results (30-minute TTL)',
                microGridBounds: 'Micro grid geometries (1-hour TTL)',
                competitiveSites: 'GeoJSON file data (1-hour TTL)'
            },
            memory: {
                used: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB',
                total: (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2) + ' MB',
                note: 'Memory usage significantly reduced - no in-memory node-cache'
            }
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to retrieve cache stats',
            message: error.message
        });
    }
});

// 🚀 REDIS: Redis cache monitoring endpoint
app.get('/redis-cache-comparison', async (req, res) => {
    try {
        // Get Redis stats
        const redisStats = await redisCache.getStats();
        const redisConnected = redisCache.isReady();

        res.json({
            message: '🚀 Migrated to Redis-Only Architecture',
            architecture: {
                old: 'Hybrid (Redis + 3 NodeCache instances)',
                new: 'Centralized Redis-Only',
                benefits: [
                    'Simplified architecture - single cache system',
                    'Caches survive server restarts',
                    'Can be shared across multiple server instances',
                    'Reduced memory footprint (~5MB saved)',
                    'Centralized monitoring and management'
                ]
            },
            redis: {
                connected: redisConnected,
                status: redisConnected ? 'Redis is the EXCLUSIVE cache for all data' : 'Redis disconnected - NO CACHING',
                stats: redisConnected ? redisStats : null,
                note: redisConnected ? 'Check X-Cache headers: HIT-REDIS or MISS' : 'WARNING: No caching active when Redis is down'
            },
            cacheKeys: {
                mvtTiles: '*_mvt_* (5-minute TTL)',
                spatialQueries: 'spatial_district_union_* (30-minute TTL)',
                microGridBounds: 'spatial_microgrid_union_* (1-hour TTL)',
                competitiveSites: 'geojson_* (1-hour TTL)',
                apiResponses: 'Various API response caches (5-minute TTL)'
            },
            removedNodeCaches: {
                spatialCache: 'Migrated to Redis',
                microGridBoundsCache: 'Migrated to Redis',
                competitiveSitesCache: 'Migrated to Redis',
                geometryCache: 'Removed (unused)',
                mvtCache: 'Removed (Redis handles MVTs)'
            },
            memory: {
                used: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB',
                total: (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2) + ' MB',
                note: 'Significantly reduced - no in-memory caching overhead'
            }
        });
    } catch (err) {
        res.status(500).json({
            error: 'Error fetching Redis comparison stats',
            message: err.message
        });
    }
});

// 🚀 REDIS EXPERIMENT: Clear Redis cache endpoint (for testing)
app.post('/clear-redis-cache', async (req, res) => {
    try {
        const { pattern } = req.body;
        const cachePattern = pattern || 'complaint_data_mvt_*';
        
        const deletedCount = await redisCache.delPattern(cachePattern);
        
        res.json({
            success: true,
            message: `Cleared Redis cache matching pattern: ${cachePattern}`,
            deletedKeys: deletedCount
        });
    } catch (err) {
        res.status(500).json({
            error: 'Error clearing Redis cache',
            message: err.message
        });
    }
});

// 🚀 NEW: Clear all server-side caches endpoint - for hard refresh functionality
app.post('/clear-all-caches', async (req, res) => {
    try {

        // 🚀 REDIS-ONLY: Clear all Redis caches
        const clearedCaches = {};

        if (redisCache.isReady()) {
            // Clear all MVT tiles
            const mvtDeleted = await redisCache.delPattern('*_mvt_*');
            clearedCaches.mvtTiles = mvtDeleted;

            // Clear all spatial query results
            const spatialDeleted = await redisCache.delPattern('spatial_*');
            clearedCaches.spatialQueries = spatialDeleted;

            // Clear all GeoJSON file caches
            const geojsonDeleted = await redisCache.delPattern('geojson_*');
            clearedCaches.competitiveSites = geojsonDeleted;

            // Clear all other API response caches
            const apiDeleted = await redisCache.delPattern('*');
            clearedCaches.totalKeys = apiDeleted;

            console.log(`✅ Cleared ${apiDeleted} total Redis keys`);
            console.log(`   - MVT tiles: ${mvtDeleted}`);
            console.log(`   - Spatial queries: ${spatialDeleted}`);
            console.log(`   - Competitive sites: ${geojsonDeleted}`);
        } else {
            console.warn('⚠️  Redis not connected - no caches to clear');
        }

        // Force garbage collection if available
        let gcTriggered = false;
        if (global.gc && typeof global.gc === 'function') {
            try {
                global.gc();
                gcTriggered = true;
                console.log('✅ Manual garbage collection triggered');
            } catch (err) {
                console.warn('⚠️  Failed to trigger garbage collection:', err.message);
            }
        } else {
            console.log('ℹ️  Manual GC not available (start Node.js with --expose-gc to enable)');
        }


        res.json({
            success: true,
            message: 'All server-side caches cleared successfully',
            clearedCaches,
            gcTriggered,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error clearing server-side caches:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clear server-side caches',
            details: error.message
        });
    }
});

// 🚀 FIXED: Planning Sites Data Endpoint - 改為基於選擇的優化版本
// 1. 六维数据 -> 站点结构数据 -> 规划站点 (Enhanced with spatial filtering)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/planning_sites', async (req, res) => {
    // 🚀 PERFORMANCE FIX: 不再一次性加載所有數據，只返回站點類型信息用於selection list
    const { scenarios, districts, microGrids } = req.query;

    if (!scenarios) {
        // 只返回空結構，讓前端知道需要選擇場景
        return res.json({
            type: 'FeatureCollection',
            features: [],
            message: 'Please select scenarios to load data'
        });
    }

    const scenarioArray = scenarios.split(',');
    if (scenarioArray.length === 0) {
        return res.json({
            type: 'FeatureCollection',
            features: []
        });
    }

    // 🚀 REDIS CACHE: Generate cache key based on query parameters
    const cacheKey = `planning_sites_${scenarios}_${districts || 'no_districts'}_${microGrids || 'no_microgrids'}`;
    console.log(`🔍 [Planning Sites] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);

    if (cached) {
        res.setHeader('X-Cache', 'HIT-REDIS');
        console.log(`✅ [Planning Sites] REDIS HIT! Returning cached data`);
        return res.json(cached);
    }

    console.log(`❌ [Planning Sites] REDIS MISS - Will query database and store in Redis`);

    // 🚀 SECURITY FIX: Validate scenarios against whitelist to prevent SQL injection
    const allowedScenarios = ['1_高投訴', '2_重點場景', '3_弱覆蓋', '4_高負荷', '5_高端區域', '6_tobgn'];
    const validScenarios = scenarioArray.filter(scenario => allowedScenarios.includes(scenario));

    if (validScenarios.length === 0) {
        return res.json({
            type: 'FeatureCollection',
            features: []
        });
    }

    // Parse spatial filter parameters
    const microGridArray = microGrids ? (typeof microGrids === 'string' ? microGrids.split(',').map(id => parseInt(id, 10)) : microGrids.map(id => parseInt(id, 10))) : [];
    const districtArray = districts ? districts.split(',').filter(d => d.trim()) : [];

    // Safe to use validated scenarios in dynamic SQL
    const scenarioConditions = validScenarios.map((scenario) => {
        return `"${scenario}" = true`;
    }).join(' OR ');

    // 🚀 FIX: Build spatial filter conditions by first querying spatial tables from cmhk_grid_data database
    let spatialWhereClause = '';
    let queryParams = [];
    let paramIndex = 1;

    // Step 1: Get actual microgrid geometries from cmhk_grid_data database (districts ignored)
    // Two-step approach: Query micro_grid from correct database (pool), then use in site query
    try {
        if (microGridArray.length > 0) {
            console.log(`🔍 [/planning_sites] Applying spatial filter for microgrids: ${microGridArray.join(',')}`);

            // STEP 1: Query actual geometries from cmhk_grid_data database (pool)
            const microGridPlaceholders = microGridArray.map((_, index) => `$${index + 1}`).join(',');
            const geomQuery = `
                SELECT ST_AsText(ST_Union(ST_Transform(geom, 4326))) as union_geom 
                FROM public.micro_grid 
                WHERE id IN (${microGridPlaceholders})
            `;
            const geomResult = await pool.query(geomQuery, microGridArray);

            if (geomResult.rows.length > 0 && geomResult.rows[0].union_geom) {
                const unionGeomWKT = geomResult.rows[0].union_geom;

                // STEP 2: Use the geometry WKT in the site database query
                spatialWhereClause = `
                    AND ST_Intersects(
                        ST_Transform(geom, 4326),
                        ST_GeomFromText($${paramIndex}, 4326)
                    )`;

                queryParams = [unionGeomWKT];
                paramIndex++;

                console.log(`✅ [/planning_sites] Spatial filter applied successfully`);
            }
        }
    } catch (spatialErr) {
        console.warn('⚠️ [/planning_sites] Spatial filtering failed, proceeding without spatial filter:', spatialErr.message);
        spatialWhereClause = '';
        queryParams = [];
        paramIndex = 1;
    }

    const query = `
        SELECT *,
               ST_AsGeoJSON(
                   COALESCE(
                       ST_Transform(geom, 4326),
                       CASE
                           WHEN longitude IS NOT NULL AND latitude IS NOT NULL THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
                           ELSE NULL
                       END
                   )
               )::json AS geometry,
               -- Add scenario priority logic for overlapping scenarios
               CASE 
                   WHEN "1_高投訴" = true THEN '1_高投訴'
                   WHEN "2_重點場景" = true THEN '2_重點場景' 
                   WHEN "3_弱覆蓋" = true THEN '3_弱覆蓋'
                   WHEN "4_高負荷" = true THEN '4_高負荷'
                   WHEN "5_高端區域" = true THEN '5_高端區域'
                   WHEN "6_tobgn" = true THEN '6_tobgn'
                   ELSE null
               END AS primary_scenario,
               -- Create array of all satisfied scenarios
               ARRAY_REMOVE(ARRAY[
                   CASE WHEN "1_高投訴" = true THEN '1_高投訴' ELSE NULL END,
                   CASE WHEN "2_重點場景" = true THEN '2_重點場景' ELSE NULL END,
                   CASE WHEN "3_弱覆蓋" = true THEN '3_弱覆蓋' ELSE NULL END,
                   CASE WHEN "4_高負荷" = true THEN '4_高負荷' ELSE NULL END,
                   CASE WHEN "5_高端區域" = true THEN '5_高端區域' ELSE NULL END,
                   CASE WHEN "6_tobgn" = true THEN '6_tobgn' ELSE NULL END
               ], NULL) AS satisfied_scenarios
        FROM public.master_planning_table
        WHERE (geom IS NOT NULL OR (longitude IS NOT NULL AND latitude IS NOT NULL))
          AND (${scenarioConditions})
          AND master_solution_type = '新站'
          ${spatialWhereClause};
    `;

    try {
        const { rows } = await siteDbPool.query(query, queryParams);
        const features = rows
            .filter(r => r.geometry) // ensure valid geometry is returned to the client
            .map(row => {
                const { geometry, geom, ...props } = row;
                return {
                    type: 'Feature',
                    properties: props,
                    geometry,
                };
            });

        const responseData = {
            type: 'FeatureCollection',
            features
        };

        // 🚀 REDIS ONLY: Store in Redis with 300s TTL
        console.log(`💾 [Planning Sites] Storing ${features.length} features in Redis...`);
        const redisStored = await redisCache.set(cacheKey, responseData, 300);
        if (redisStored) {
            console.log(`✅ [Planning Sites] Successfully stored in Redis with 300s TTL`);
        } else {
            console.error(`❌ [Planning Sites] FAILED to store in Redis!`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(responseData);
    } catch (err) {
        console.error('Error retrieving planning sites:', err.stack);
        res.status(500).send('Server Error');
    }
});

// 🚀 FIXED: Planning Sites Data Endpoint - 改為基於選擇的優化版本
// 1. 六维数据 -> 站点结构数据 -> 规划站点 (Enhanced with spatial filtering)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/complaint_year', async (req, res) => {
    // 🚀 PERFORMANCE FIX: 不再一次性加載所有數據，只返回站點類型信息用於selection list
    const { years, microGrids } = req.query;
    const yearArray = years.split(',');
    // Parse spatial filter parameters
    const microGridArray = microGrids ? (typeof microGrids === 'string' ? microGrids.split(',').map(id => parseInt(id, 10)) : microGrids.map(id => parseInt(id, 10))) : [];

    // 🚀 REDIS CACHE: Generate cache key based on query parameters
    const cacheKey = `complaint_year_${years}_${microGrids || 'no_microgrids'}`;
    console.log(`🔍 [Complaint Year] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);

    if (cached) {
        res.setHeader('X-Cache', 'HIT-REDIS');
        console.log(`✅ [Complaint Year] REDIS HIT! Returning cached data`);
        return res.json(cached);
    }

    console.log(`❌ [Complaint Year] REDIS MISS - Will query database and store in Redis`);

    // 🚀 FIX: Build spatial filter conditions using actual microgrid geometries
    // Two-step approach: Query micro_grid from correct database (pool), then use in complaint query
    let spatialWhereClause = '';
    let queryParams = [];
    let paramIndex = 1;

    try {
        if (microGridArray.length > 0) {
            console.log(`🔍 [/complaint_year] Applying spatial filter for microgrids: ${microGridArray.join(',')}`);

            // STEP 1: Query actual geometries from cmhk_grid_data database (pool)
            const microGridPlaceholders = microGridArray.map((_, index) => `$${index + 1}`).join(',');
            const geomQuery = `
                SELECT ST_AsText(ST_Union(ST_Transform(geom, 4326))) as union_geom 
                FROM public.micro_grid 
                WHERE id IN (${microGridPlaceholders})
            `;
            const geomResult = await pool.query(geomQuery, microGridArray);

            if (geomResult.rows.length > 0 && geomResult.rows[0].union_geom) {
                const unionGeomWKT = geomResult.rows[0].union_geom;

                // STEP 2: Use the geometry WKT in the complaint database query
                spatialWhereClause = `
                    AND ST_Intersects(
                        ST_Transform(ST_SetSRID(geom, 2326), 4326),
                        ST_GeomFromText($${paramIndex}, 4326)
                    )`;

                queryParams = [unionGeomWKT];
                paramIndex++;

                console.log(`✅ [/complaint_year] Spatial filter applied successfully`);
            }
        }
    } catch (spatialErr) {
        console.warn('⚠️ [/complaint_year] Spatial filtering failed, proceeding without spatial filter:', spatialErr.message);
        spatialWhereClause = '';
        queryParams = [];
        paramIndex = 1;
    }

    let yearSQL = '';
    for (const year of yearArray)
        yearSQL += `raw_input_date BETWEEN '${year}-01-01' AND '${year}-12-31' OR `;
    yearSQL = yearSQL.slice(0, -4);

    const query = `
        SELECT raw_month, raw_input_date, raw_ref_no, raw_sub_case_no, raw_addess_seq, raw_ref_no_addess_seq, raw_sam_complaint_defination, raw_category, raw_complaint_type_level_4, raw_complaint_type_level_5, raw_complaint_type_level_6, raw_complaint_type_level_7, raw_remark, raw_customer_type, raw_rateplan, raw_postpaid_prepaid, raw_customer_class, raw_indoor_outdoor_signal_bar, root_user, root_rne_current_situation, root_rne_action, root_volte_active, root_locaion_invalid, root_cmhk_define_id, root_root_cause, root_sub_root_cause, root_root_cause_site, root_root_cause_cell, root_root_cause_remark, root_4g_serving_site, root_3g_serving_cell, root_emos_ticket, root_emos_status, root_clear_date, final_final_name_eng, final_layer1_eng, final_layer2_eng, final_final_name_chi, final_layer1_chi, final_layer2_chi, final_street_name_eng, final_street_name_chi, final_street_no, final_region_eng, final_region_chi, final_hk_district_eng, final_hk_district_chi, final_x, final_y, final_cmhk_define_id, final_mtr_line_eng, final_mtr_line_chi, solu_type, solu_sub_type, solu_related_site, solu_related_cell, solu_details,
               ST_AsGeoJSON(
                   ST_Transform(ST_SetSRID(geom, 2326), 4326)
               )::json AS geometry
        FROM masscomplaint.complaint_root_master_final
        WHERE (geom IS NOT NULL)
          AND raw_month != 'removed'
          AND (${yearSQL})
          ${spatialWhereClause};
    `;

    try {
        const { rows } = await complaintDbPool.query(query, queryParams);
        const features = rows
            .filter(r => r.geometry) // ensure valid geometry is returned to the client
            .map(row => {
                const { geometry, geom, ...props} = row;
                return {
                    type: 'Feature',
                    properties: props,
                    geometry,
                };
            });

        const responseData = {
            type: 'FeatureCollection',
            features
        };

        // 🚀 REDIS ONLY: Store in Redis with 300s TTL
        console.log(`💾 [Complaint Year] Storing ${features.length} features in Redis...`);
        const redisStored = await redisCache.set(cacheKey, responseData, 300);
        if (redisStored) {
            console.log(`✅ [Complaint Year] Successfully stored in Redis with 300s TTL`);
        } else {
            console.error(`❌ [Complaint Year] FAILED to store in Redis!`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(responseData);
    } catch (err) {
        console.error('Error retrieving complaint year data:', err.stack);
        res.status(500).send('Server Error');
    }
});

// 🚀 NEW: 126 New Site Data Endpoint - 基於GeoJSON文件
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/126_new_sites', async (req, res) => {
    const fs = require('fs');
    const path = require('path');

    try {
        // Get the keys query parameter for filtering
        const { keys } = req.query;

        // 🚀 REDIS CACHE: Generate cache key based on query parameters
        const cacheKey = `126_new_sites_${keys || 'all'}`;
        console.log(`🔍 [126 New Sites] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
        const cached = await redisCache.get(cacheKey);

        if (cached) {
            res.setHeader('X-Cache', 'HIT-REDIS');
            console.log(`✅ [126 New Sites] REDIS HIT! Returning cached data`);
            return res.json(cached);
        }

        console.log(`❌ [126 New Sites] REDIS MISS - Will read file and store in Redis`);

        // Path to the GeoJSON file - inside Backend folder
        const geoJsonPath = path.join(__dirname, '126 Site List/126sitelist.geojson');

        // Check if file exists
        if (!fs.existsSync(geoJsonPath)) {
            console.error('126 New Sites GeoJSON file not found:', geoJsonPath);
            return res.status(404).json({
                type: 'FeatureCollection',
                features: [],
                error: 'GeoJSON file not found'
            });
        }

        // Read and parse the GeoJSON file
        const geoJsonData = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));

        // Filter out features without valid coordinates (as requested by user)
        let validFeatures = geoJsonData.features.filter(feature => {
            if (!feature.geometry || feature.geometry.type !== 'Point') {
                return false;
            }

            const coords = feature.geometry.coordinates;
            if (!coords || coords.length !== 2) {
                return false;
            }

            const [lon, lat] = coords;
            // Check for valid coordinate values (not null, undefined, or 0,0)
            const hasValidCoords = lon !== null && lat !== null &&
                lon !== undefined && lat !== undefined &&
                !(lon === 0 && lat === 0);

            if (!hasValidCoords) {
                return false;
            }

            return true;
        });


        // Apply filtering based on selected keys if provided
        if (keys && keys.trim() !== '') {
            const selectedKeys = keys.split(',').map(key => key.trim());


            validFeatures = validFeatures.filter(feature => {
                const properties = feature.properties || {};
                const typeField = properties.Type || '';
                const coverageType = properties['覆蓋類型'];


                // Check if this feature matches any of the selected keys
                const isMatch = selectedKeys.some(key => {
                    if (key.includes('-')) {
                        // Combined key format: "SAF-室內" or "新站-室外"
                        const [keyType, keyCoverage] = key.split('-');

                        // Map frontend labels to backend values
                        let mappedType = keyType;
                        if (keyType === '新站') {
                            mappedType = 'NewSite';
                        }

                        // Check if both Type and 覆蓋類型 match
                        const typeMatches = typeField === mappedType;

                        // Handle null or invalid coverage types - treat them as non-matching for specific filters
                        const coverageMatches = (coverageType && typeof coverageType === 'string')
                            ? coverageType === keyCoverage
                            : false;


                        return typeMatches && coverageMatches;
                    }
                    return false;
                });
                return isMatch;
            });
        } else {
            // No filtering keys provided - show all valid features
        }


        const responseData = {
            type: 'FeatureCollection',
            features: validFeatures
        };

        // 🚀 REDIS ONLY: Store in Redis with 300s TTL
        console.log(`💾 [126 New Sites] Storing ${validFeatures.length} features in Redis...`);
        const redisStored = await redisCache.set(cacheKey, responseData, 300);
        if (redisStored) {
            console.log(`✅ [126 New Sites] Successfully stored in Redis with 300s TTL`);
        } else {
            console.error(`❌ [126 New Sites] FAILED to store in Redis!`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(responseData);

    } catch (err) {
        console.error('Error loading 126 New Sites:', err.stack);
        res.status(500).json({
            type: 'FeatureCollection',
            features: [],
            error: 'Server error loading 126 New Sites'
        });
    }
});

// 🚀 NEW: 126 Activated Sites Data Endpoint - 已開通站點
// Filters sites from the main 126sitelist.geojson where 完成情況 and 完成日期 are not null
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/126_activated_sites', async (req, res) => {
    const fs = require('fs');
    const path = require('path');

    try {
        // 🚀 REDIS CACHE: Generate cache key
        const cacheKey = '126_activated_sites_all';
        console.log(`🔍 [126 Activated Sites] Checking Redis for key: ${cacheKey}...`);
        const cached = await redisCache.get(cacheKey);

        if (cached) {
            res.setHeader('X-Cache', 'HIT-REDIS');
            console.log(`✅ [126 Activated Sites] REDIS HIT! Returning cached data`);
            return res.json(cached);
        }

        console.log(`❌ [126 Activated Sites] REDIS MISS - Will read file and store in Redis`);

        // Use the same GeoJSON file as regular 126 new sites - inside Backend folder
        const geoJsonPath = path.join(__dirname, '126 Site List/126sitelist.geojson');

        if (!fs.existsSync(geoJsonPath)) {
            console.error('126 Activated Sites GeoJSON file not found:', geoJsonPath);
            return res.status(404).json({
                type: 'FeatureCollection',
                features: [],
                error: 'GeoJSON file not found'
            });
        }

        // Read and parse the GeoJSON file
        const geoJsonData = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));

        // Filter for activated sites: those with 完成情況 and 完成日期 not null
        let activatedFeatures = geoJsonData.features.filter(feature => {
            // First check for valid geometry and coordinates
            if (!feature.geometry || feature.geometry.type !== 'Point') {
                return false;
            }

            const coords = feature.geometry.coordinates;
            if (!coords || coords.length !== 2) {
                return false;
            }

            const [lon, lat] = coords;
            // Check for valid coordinate values (not null, undefined, or 0,0)
            const hasValidCoords = lon !== null && lat !== null &&
                lon !== undefined && lat !== undefined &&
                !(lon === 0 && lat === 0);

            if (!hasValidCoords) {
                return false;
            }

            // Check if the site is activated (both 完成情況 and 完成日期 are not null/empty)
            const properties = feature.properties || {};
            const completionStatus = properties['完成情況'];
            const completionDate = properties['完成日期'];

            // Consider activated if both fields exist and are not null/undefined/empty
            const isActivated = completionStatus != null &&
                completionStatus !== '' &&
                completionDate != null &&
                completionDate !== '';

            return isActivated;
        });

        const responseData = {
            type: 'FeatureCollection',
            features: activatedFeatures
        };

        // 🚀 REDIS ONLY: Store in Redis with 300s TTL
        console.log(`💾 [126 Activated Sites] Storing ${activatedFeatures.length} features in Redis...`);
        const redisStored = await redisCache.set(cacheKey, responseData, 300);
        if (redisStored) {
            console.log(`✅ [126 Activated Sites] Successfully stored in Redis with 300s TTL`);
        } else {
            console.error(`❌ [126 Activated Sites] FAILED to store in Redis!`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(responseData);

    } catch (err) {
        console.error('Error loading 126 Activated Sites:', err.stack);
        res.status(500).json({
            type: 'FeatureCollection',
            features: [],
            error: 'Server error loading 126 Activated Sites'
        });
    }
});

// 🚀 NEW: 729 Planning Sites Data Endpoint - 目標網729清單
// Display all planning sites from micro_grid.planning_729list table with click-to-display details
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/planning_729_sites', async (req, res) => {
    const { districts, microGrids } = req.query;

    // 🚀 REDIS CACHE: Generate cache key based on query parameters
    const cacheKey = `planning_729_sites_${districts || 'no_districts'}_${microGrids || 'no_microgrids'}`;
    console.log(`🔍 [Planning 729 Sites] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);

    if (cached) {
        res.setHeader('X-Cache', 'HIT-REDIS');
        console.log(`✅ [Planning 729 Sites] REDIS HIT! Returning cached data`);
        return res.json(cached);
    }

    console.log(`❌ [Planning 729 Sites] REDIS MISS - Will query database and store in Redis`);

    try {
        // Parse spatial filter parameters
        const microGridArray = microGrids ? (typeof microGrids === 'string' ? microGrids.split(',').map(id => parseInt(id, 10)) : microGrids.map(id => parseInt(id, 10))) : [];
        const districtArray = districts ? districts.split(',').filter(d => d.trim()) : [];

        // Build spatial filter conditions using actual microgrid geometries
        let spatialWhereClause = '';
        let queryParams = [];
        let paramIndex = 1;

        try {
            if (microGridArray.length > 0) {
                console.log(`🔍 [/planning_729_sites] Applying spatial filter for microgrids: ${microGridArray.join(',')}`);

                // Use actual microgrid geometries for precise spatial filtering
                const microGridPlaceholders = microGridArray.map((_, index) => `$${paramIndex + index}`).join(',');

                spatialWhereClause = `
                    AND ST_Intersects(
                        geom,
                        (SELECT ST_Union(ST_Transform(mg.geom, 4326))
                         FROM public.micro_grid mg
                         WHERE mg.id IN (${microGridPlaceholders}))
                    )`;

                queryParams = [...queryParams, ...microGridArray];
                paramIndex += microGridArray.length;

                console.log(`✅ [/planning_729_sites] Spatial filter applied successfully`);
            }
        } catch (spatialErr) {
            console.warn('⚠️ [/planning_729_sites] Spatial filtering failed, proceeding without spatial filter:', spatialErr.message);
            spatialWhereClause = '';
            queryParams = [];
            paramIndex = 1;
        }

        // Query the planning_729list table
        const query = `
            SELECT 
                master_solution_id,
                "site ID" as site_id,
                "site name" as site_name,
                覆蓋類型,
                master_solution_type,
                district,
                "需求(單項)" as requirement_single,
                "6維(單項)" as six_dimension_single,
                退網相關,
                "3G site code" as site_code_3g,
                "3G退網" as decommission_3g,
                "Grade (A,B,C)" as grade,
                會審後結果,
                "微网格(by lat lon)" as micro_grid_lat_lon,
                "6維子項排名" as six_dimension_ranking,
                "Grade remark 1" as grade_remark_1,
                "Grade remark 2" as grade_remark_2,
                由2023年7月至2025年6月的投訴累計數字 as complaint_count,
                "高投訴 (Y/N)" as high_complaint,
                "重點場景(兩專) (Y/N)" as key_scenario,
                "弱覆蓋 (Y/N)" as weak_coverage,
                "高負荷 (Y/N)" as high_load,
                "高端/高價值 (Y/N)" as high_value,
                "高端/高價值 (獨立ABC)" as high_value_abc,
                "5項count" as five_item_count,
                remark,
                "check?",
                status,
                longitude,
                latitude,
                "需求(多項)" as requirement_multiple,
                "option",
                "replacement id" as replacement_id,
                objective,
                ST_AsGeoJSON(geom)::json AS geometry
            FROM micro_grid.planning_729list
            WHERE (geom IS NOT NULL OR (longitude IS NOT NULL AND latitude IS NOT NULL))
                ${spatialWhereClause}
            ORDER BY master_solution_id;
        `;

        const { rows } = await pool.query(query, queryParams);

        const features = rows
            .filter(r => r.geometry || (r.longitude && r.latitude)) // Ensure valid geometry
            .map(row => {
                const { geometry, ...props } = row;

                // If no geometry, create point from longitude/latitude
                const finalGeometry = geometry || {
                    type: 'Point',
                    coordinates: [row.longitude, row.latitude]
                };

                return {
                    type: 'Feature',
                    properties: props,
                    geometry: finalGeometry,
                };
            });

        const responseData = {
            type: 'FeatureCollection',
            features,
            count: features.length
        };

        // 🚀 REDIS ONLY: Store in Redis with 300s TTL
        console.log(`💾 [Planning 729 Sites] Storing ${features.length} features in Redis...`);
        const redisStored = await redisCache.set(cacheKey, responseData, 300);
        if (redisStored) {
            console.log(`✅ [Planning 729 Sites] Successfully stored in Redis with 300s TTL`);
        } else {
            console.error(`❌ [Planning 729 Sites] FAILED to store in Redis!`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(responseData);

    } catch (err) {
        console.error('Error retrieving 729 planning sites:', err.stack);
        res.status(500).json({
            type: 'FeatureCollection',
            features: [],
            error: 'Server error loading 729 planning sites',
            details: err.message
        });
    }
});

// 🚀 NEW: CMHK Live Sites Data Endpoint - 基於站點類型選擇
// 2. 六维数据 -> 站点结构数据 -> 现网站点 (Enhanced with spatial filtering)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/live_sites', async (req, res) => {
    const { site_types, districts, microGrids } = req.query;

    if (!site_types) {
        // 返回空結構，讓前端知道需要選擇站點類型
        return res.json({
            type: 'FeatureCollection',
            features: [],
            message: 'Please select site types to load data'
        });
    }

    const siteTypeArray = site_types.split(',');
    if (siteTypeArray.length === 0) {
        return res.json({
            type: 'FeatureCollection',
            features: []
        });
    }

    // 🚀 REDIS CACHE: Generate cache key based on query parameters
    const cacheKey = `live_sites_${site_types}_${districts || 'no_districts'}_${microGrids || 'no_microgrids'}`;
    console.log(`🔍 [Live Sites] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);

    if (cached) {
        res.setHeader('X-Cache', 'HIT-REDIS');
        console.log(`✅ [Live Sites] REDIS HIT! Returning cached data`);
        return res.json(cached);
    }

    console.log(`❌ [Live Sites] REDIS MISS - Will query database and store in Redis`);

    // 🚀 NEW: Map new frontend site type names to database values
    const siteTypeMapping = {
        'Outdoor Site': ['Outdoor'],
        'Indoor Site': ['Indoor'],
        'Indoor-Pico/Micro Site': ['Indoor-Pico', 'Indoor-Micro'], // Combined selection
        'Indoor + Outdoor Site': ['Indoor + Outdoor']
    };

    // Expand the site types based on the mapping
    const dbSiteTypes = [];
    siteTypeArray.forEach(frontendType => {
        const dbTypes = siteTypeMapping[frontendType];
        if (dbTypes) {
            dbSiteTypes.push(...dbTypes);
        } else {
            // Fallback for unknown types (use as-is)
            dbSiteTypes.push(frontendType);
        }
    });

    if (dbSiteTypes.length === 0) {
        return res.json({
            type: 'FeatureCollection',
            features: []
        });
    }

    // Parse spatial filter parameters
    const microGridArray = microGrids ? (typeof microGrids === 'string' ? microGrids.split(',').map(id => parseInt(id, 10)) : microGrids.map(id => parseInt(id, 10))) : [];
    const districtArray = districts ? districts.split(',').filter(d => d.trim()) : [];

    // 🚀 SECURITY FIX: Use parameterized query to prevent SQL injection
    // Generate placeholders for the parameterized query
    let queryParams = [...dbSiteTypes];
    let paramIndex = dbSiteTypes.length + 1;
    const placeholders = dbSiteTypes.map((_, index) => `$${index + 1}`).join(', ');

    // 🚀 FIX: Build spatial filter conditions using actual microgrid geometries
    // Two-step approach: Query micro_grid from correct database (pool), then use in site query
    let spatialWhereClause = '';

    try {
        if (microGridArray.length > 0) {
            console.log(`🔍 [/live_sites] Applying spatial filter for microgrids: ${microGridArray.join(',')}`);

            // STEP 1: Query actual geometries from cmhk_grid_data database (pool)
            const microGridPlaceholders = microGridArray.map((_, index) => `$${index + 1}`).join(',');
            const geomQuery = `
                SELECT ST_AsText(ST_Union(ST_Transform(geom, 4326))) as union_geom 
                FROM public.micro_grid 
                WHERE id IN (${microGridPlaceholders})
            `;
            const geomResult = await pool.query(geomQuery, microGridArray);

            if (geomResult.rows.length > 0 && geomResult.rows[0].union_geom) {
                const unionGeomWKT = geomResult.rows[0].union_geom;

                // STEP 2: Use the geometry WKT in the site database query
                spatialWhereClause = `
                    AND ST_Intersects(
                        ST_Transform(geom, 4326),
                        ST_GeomFromText($${paramIndex}, 4326)
                    )`;

                queryParams = [...queryParams, unionGeomWKT];
                paramIndex++;

                console.log(`✅ [/live_sites] Spatial filter applied successfully`);
            }
        }
    } catch (spatialErr) {
        console.warn('⚠️ [/live_sites] Spatial filtering failed, proceeding without spatial filter:', spatialErr.message);
        spatialWhereClause = '';
    }

    const query = `
        SELECT master_idx, live_site_id, plan_site_name, coverage_objective, address,
               site_revision, site_on_air_date, fdlte_active_date, tdlte_active_date,
               lte900_activation_date, l2600_active_date, l1800_active_date, l2100_active_date,
               nr3500_active_date, nr4900_active_date, nr28000_active_date, nr3300_active_date,
               nr_active_date, nr1800_active_date, nr2100_active_date, nr2600_active_date,
               moran_nr3500_shrfromhkt_activation_date, moran_nr4900_shrfromhkt_activation_date,
               moran_nr3500_shrtohkt_activation_date, moran_nr4900_shrtohkt_activation_date,
               moran_nr3500_shrfromhtl_activation_date, moran_nr3500_shrtohtl_activation_date,
               nr700_activation_date, lte700_activation_date, building_height,
               site_type, objective, district, district_chinese, indoor_category,
               network_symbol, site_ownership, site_equipment_classification,
               site_classification_category, specific_site_location, mtr_site,
               coverage_scenario_chinese, radio_scenario, radio_scenario_important,
               coverage_objective_chinese,
               ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geometry
        FROM public.cmhk_livesite
        WHERE geom IS NOT NULL AND site_type IN (${placeholders})
        ${spatialWhereClause};
    `;

    try {
        const { rows } = await siteDbPool.query(query, queryParams);
        const features = rows
            .filter(r => r.geometry) // ensure valid geometry is returned to the client
            .map(row => {
                const { geometry, geom, ...props } = row;
                return {
                    type: 'Feature',
                    properties: props,
                    geometry,
                };
            });

        const responseData = {
            type: 'FeatureCollection',
            features
        };

        // 🚀 REDIS ONLY: Store in Redis with 300s TTL
        console.log(`💾 [Live Sites] Storing ${features.length} features in Redis...`);
        const redisStored = await redisCache.set(cacheKey, responseData, 300);
        if (redisStored) {
            console.log(`✅ [Live Sites] Successfully stored in Redis with 300s TTL`);
        } else {
            console.error(`❌ [Live Sites] FAILED to store in Redis!`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(responseData);
    } catch (err) {
        console.error('Error retrieving live sites:', err.stack);

        // 🚀 DEVELOPMENT FIX: Return mock data when database is not accessible

        const mockFeatures = [];
        const mockCoordinates = [
            // Hong Kong coordinates (longitude, latitude)
            [114.1694, 22.3193], // Central Hong Kong
            [114.2095, 22.3964], // Sha Tin
            [114.0605, 22.4197], // Tuen Mun
            [113.9361, 22.3526], // Yuen Long
            [114.2578, 22.5012]  // Tai Po
        ];

        // Generate mock features for each selected site type
        dbSiteTypes.forEach((siteType, typeIndex) => {
            mockCoordinates.forEach((coord, coordIndex) => {
                const feature = {
                    type: 'Feature',
                    properties: {
                        master_idx: `MOCK_${typeIndex}_${coordIndex}`,
                        live_site_id: `MOCK_SITE_${typeIndex}_${coordIndex}`,
                        plan_site_name: `Mock ${siteType} Site ${coordIndex + 1}`,
                        site_type: siteType,
                        coverage_objective: 'Test Coverage',
                        address: `Mock Address ${coordIndex + 1}, Hong Kong`,
                        district: 'Mock District',
                        district_chinese: '測試區域',
                        site_on_air_date: '2024-01-01',
                        objective: 'Development Testing',
                        coverage_objective_chinese: '測試覆蓋目標'
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: coord
                    }
                };
                mockFeatures.push(feature);
            });
        });

        res.json({
            type: 'FeatureCollection',
            features: mockFeatures,
            _isMockData: true
        });
    }
});

// Competition Scenario Testing Data as Mapbox Vector Tiles (MVT) 
// 3. 六维数据 -> 测试数据 -> 競對場景 (LTE/NR)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/competition_scenario_test/:technology/:scenario/mvt/:z/:x/:y', async (req, res) => {
    const { technology, scenario, z, x, y } = req.params;
    const { microGrids, renderingMode } = req.query;

    // Validate technology parameter
    if (technology !== 'lte' && technology !== 'nr') {
        return res.status(400).json({
            error: 'Invalid technology',
            validTechnologies: ['lte', 'nr']
        });
    }

    // Validate scenario parameter (expect Chinese scenario names directly)
    const validScenarios = ['競強我強', '競強我弱', '競弱我強', '競弱我弱'];
    if (!validScenarios.includes(scenario)) {
        return res.status(400).json({
            error: 'Invalid competition scenario',
            validScenarios: validScenarios
        });
    }

    const chineseScenario = scenario; // Already in Chinese

    // 🚀 SECURITY: Block 六維數據 (CMHK test data) access in 區域模式 - micro grids only
    if (renderingMode === 'spatial' && (!microGrids || microGrids === '')) {
        return res.status(403).json({
            error: 'Access denied',
            message: '請先選擇微網格後才能存取六維數據競對場景資料'
        });
    }

    const zi = parseInt(z, 10);
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);
    if ([zi, xi, yi].some(Number.isNaN)) {
        return res.status(400).send('Invalid tile coordinates');
    }

    // 🔍 DEBUG: Log received query parameters

    // Parse spatial filter parameters
    const microGridArray = microGrids ? (typeof microGrids === 'string' ? microGrids.split(',').map(id => parseInt(id, 10)) : microGrids.map(id => parseInt(id, 10))) : [];
    const districtArray = []; // No districts parameter in this endpoint

    // 🔍 DEBUG: Log parsed arrays

    // 🚀 OPTIMIZED: Use hierarchical cache key generation for better cache hit rates
    const baseCacheKey = `competition_scenario_test_${technology}_${scenario}_mvt_${zi}_${xi}_${yi}`;
    const cacheKey = generateHierarchicalCacheKey(baseCacheKey, microGridArray, zi);

    // 🔍 DEBUG: Log cache key

    // 🚀 REDIS ONLY: No fallback to node-cache (Plan B)
    console.log(`🔍 [Competition Scenario MVT] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);

    if (cached) {
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader('X-Cache', 'HIT-REDIS');
        res.setHeader('X-Cache-Experiment', 'Redis-Only-No-Fallback');
        console.log(`✅ [Competition Scenario MVT] REDIS HIT! Returning cached tile (${cached.length} bytes)`);
        console.log(`✅ [Competition Scenario MVT] Cache key: ${cacheKey}`);
        return res.send(cached);
    }

    console.log(`❌ [Competition Scenario MVT] REDIS MISS - Will query database and store in Redis`);
    console.log(`❌ [Competition Scenario MVT] Cache key: ${cacheKey}`);

    // Compute tile bounds in WGS84 (EPSG:4326)
    const n = Math.pow(2, zi);
    const lonLeft = (xi / n) * 360 - 180;
    const lonRight = ((xi + 1) / n) * 360 - 180;
    const latTopRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * yi / n)));
    const latBottomRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (yi + 1) / n)));
    const latTop = (latTopRad * 180) / Math.PI;
    const latBottom = (latBottomRad * 180) / Math.PI;

    // 🚀 OPTIMIZED: Generate spatial filter clause with enhanced caching
    const { whereClause: spatialWhere, params: spatialParams } = await generateSpatialFilter(microGridArray);

    // 🔍 DEBUG: Log generated spatial filter

    // Build technology-specific query based on LTE or NR - using new four-quadrant tables
    let tableName;
    const scenarioColumn = 'max_rsrp_場景'; // Both new tables use the same column name

    if (technology === 'nr') {
        // For NR data, use the new NR four-quadrant table
        tableName = 'public.cmhk_grid_drive_test_four_quadrants_nr_new';
    } else {
        // For LTE data, use the new LTE four-quadrant table
        tableName = 'public.cmhk_grid_drive_test_four_quadrants_lte_new';
    }

    const sql = `
        WITH bounds AS (
            SELECT 
                ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 2326) AS hk_bounds_2326
        ), mvtgeom AS (
            SELECT 
                t.grid_id as id,
                t.${scenarioColumn} as max_rsrp_scenario,
                ST_AsMVTGeom(
                    ST_Transform(t.geom, 3857),
                    b.merc_bounds,
                    4096,
                    64,
                    true
                ) AS geom
            FROM ${tableName} t, bounds b
            WHERE t.${scenarioColumn} = $${spatialParams.length + 5}
              AND t.geom && b.hk_bounds_2326
              AND ST_Intersects(t.geom, b.hk_bounds_2326)
              ${spatialWhere}
        )
        SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
    `;

    try {
        const queryParams = [lonLeft, latBottom, lonRight, latTop, ...spatialParams, chineseScenario];

        // 🔍 DEBUG: Log final query parameters

        const { rows } = await pool.query(sql, queryParams);
        const tile = rows[0] && rows[0].tile ? rows[0].tile : null;

        // 🔍 DEBUG: Log query results

        res.setHeader('Content-Type', 'application/x-protobuf');
        if (!tile || tile.length === 0) {
            return res.send(Buffer.from([]));
        }

        // 🚀 REDIS ONLY: Store in Redis only (no node-cache backup)
        if (tile) {
            console.log(`💾 [Competition Scenario MVT] Storing tile in Redis (${tile.length} bytes)...`);
            const redisStored = await redisCache.set(cacheKey, tile, 300);
            if (redisStored) {
                console.log(`✅ [Competition Scenario MVT] Successfully stored in Redis with 300s TTL`);
                console.log(`✅ [Competition Scenario MVT] Cache key: ${cacheKey}`);
            } else {
                console.error(`❌ [Competition Scenario MVT] FAILED to store in Redis!`);
            }
        }

        res.setHeader('X-Cache', 'MISS');
        console.log(`📤 [Competition Scenario MVT] Sending tile to client (${tile.length} bytes)`);
        res.send(tile);
    } catch (err) {
        console.error(`🚨 Error generating MVT for ${chineseScenario} competition scenario:`, err.message);
        console.error('Cache stats - Hits:', cacheStats.hits, 'Misses:', cacheStats.misses);
        console.error('🚨 Full error stack:', err.stack);

        // 🔍 DEBUG: Log SQL and parameters that caused the error
        console.error('🚨 Failed SQL query:', sql);
        console.error('🚨 Failed query parameters:', [lonLeft, latBottom, lonRight, latTop, ...spatialParams, chineseScenario]);

        // 🚀 FAILSAFE: Try simpler spatial filter if complex one fails
        if (spatialWhere && (districtArray.length > 0 || microGridArray.length > 0)) {
            try {
                const { whereClause: simpleSpatialWhere, params: simpleSpatialParams } = generateSimpleSpatialFilter(districtArray, microGridArray);

                const fallbackSql = `
                    WITH bounds AS (
                        SELECT 
                            ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                            ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds,
                            ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 2326) AS hk_bounds_2326
                    ), mvtgeom AS (
                        SELECT 
                            t.grid_id as id,
                            t.${scenarioColumn} as max_rsrp_scenario,
                            ST_AsMVTGeom(
                                ST_Transform(t.geom, 3857),
                                b.merc_bounds,
                                4096,
                                64,
                                true
                            ) AS geom
                        FROM ${tableName} t, bounds b
                        WHERE t.${scenarioColumn} = $${simpleSpatialParams.length + 5}
                          AND t.geom && b.hk_bounds_2326
                          AND ST_Intersects(t.geom, b.hk_bounds_2326)
                          ${simpleSpatialWhere}
                    )
                    SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
                `;

                const fallbackParams = [lonLeft, latBottom, lonRight, latTop, ...simpleSpatialParams, chineseScenario];

                const { rows: fallbackRows } = await pool.query(fallbackSql, fallbackParams);
                const fallbackTile = fallbackRows[0] && fallbackRows[0].tile ? fallbackRows[0].tile : null;


                res.setHeader('Content-Type', 'application/x-protobuf');
                if (!fallbackTile || fallbackTile.length === 0) {
                    return res.send(Buffer.from([]));
                }

                // Return fallback tile (Redis-only architecture, no node-cache fallback)
                return res.send(fallbackTile);

            } catch (fallbackErr) {
                console.error(`🚨 FAILSAFE: Simple spatial filter also failed for ${chineseScenario}:`, fallbackErr.message);
            }
        }

        // Check for specific SQL errors that might indicate spatial filtering issues
        if (err.message.includes('relation') && err.message.includes('does not exist')) {
            console.error('🚨 SPATIAL FILTER ERROR: Spatial filtering table does not exist!');
            console.error('🚨 This suggests that micro_grid table is missing from cmhk_grid_data database');
        }

        if (err.message.includes('too many clients') || err.message.includes('remaining connection slots')) {
            return res.status(503).json({
                error: 'Service temporarily unavailable due to high load. Please try again later.',
                retryAfter: 5
            });
        }

        res.status(500).json({
            error: `Internal server error generating map tiles for ${chineseScenario}`,
            debug: {
                scenario: chineseScenario,
                districts: districtArray,
                microGrids: microGridArray,
                spatialFilterApplied: spatialWhere ? true : false,
                sqlError: err.message
            }
        });
    }
});

// 3.1. 六维数据 -> 测试数据 -> RSRP 数据 (LTE/NR)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/cmhk_rsrp_data/:technology/mvt/:z/:x/:y', async (req, res) => {
    const { technology, z, x, y } = req.params;
    const { microGrids, renderingMode } = req.query;

    if (technology !== 'lte' && technology !== 'nr') {
        return res.status(400).json({
            error: 'Invalid technology',
            validTechnologies: ['lte', 'nr']
        });
    }

    if (renderingMode === 'spatial' && (!microGrids || microGrids === '')) {
        return res.status(403).json({
            error: 'Access denied',
            message: '請先選擇微網格後才能存取六維數據RSRP資料'
        });
    }

    const zi = parseInt(z, 10);
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);
    if ([zi, xi, yi].some(Number.isNaN)) {
        return res.status(400).send('Invalid tile coordinates');
    }

    // Parse spatial filter parameters
    const microGridArray = microGrids ? (typeof microGrids === 'string' ? microGrids.split(',').map(id => parseInt(id, 10)) : microGrids.map(id => parseInt(id, 10))) : [];
    const districtArray = []; // No districts parameter in this endpoint

    // 🚀 OPTIMIZED: Use hierarchical cache key generation for better cache hit rates
    const baseCacheKey = `cmhk_rsrp_data_${technology}_mvt_${zi}_${xi}_${yi}`;
    const cacheKey = generateHierarchicalCacheKey(baseCacheKey, microGridArray, zi);

    // 🚀 REDIS ONLY: No fallback to node-cache (Plan B)
    console.log(`🔍 [RSRP MVT] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);

    if (cached) {
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader('X-Cache', 'HIT-REDIS');
        res.setHeader('X-Cache-Experiment', 'Redis-Only-No-Fallback');
        console.log(`✅ [RSRP MVT] REDIS HIT! Returning cached tile (${cached.length} bytes)`);
        console.log(`✅ [RSRP MVT] Cache key: ${cacheKey}`);
        return res.send(cached);
    }

    console.log(`❌ [RSRP MVT] REDIS MISS - Will query database and store in Redis`);
    console.log(`❌ [RSRP MVT] Cache key: ${cacheKey}`);

    // Compute tile bounds in WGS84 (EPSG:4326)
    const n = Math.pow(2, zi);
    const lonLeft = (xi / n) * 360 - 180;
    const lonRight = ((xi + 1) / n) * 360 - 180;
    const latTopRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * yi / n)));
    const latBottomRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (yi + 1) / n)));
    const latTop = (latTopRad * 180) / Math.PI;
    const latBottom = (latBottomRad * 180) / Math.PI;

    // 🚀 OPTIMIZED: Generate spatial filter clause with enhanced caching
    const { whereClause: spatialWhere, params: spatialParams } = await generateSpatialFilter(microGridArray);

    // Build technology-specific query based on LTE or NR
    let tableName;
    let rsrpColumn;

    if (technology === 'nr') {
        // For NR data, use the NR four-quadrant table
        tableName = 'public.cmhk_grid_drive_test_four_quadrants_nr_new';
        rsrpColumn = 'n_rsrp_cmhk';
    } else {
        // For LTE data, use the LTE four-quadrant table
        tableName = 'public.cmhk_grid_drive_test_four_quadrants_lte_new';
        rsrpColumn = 'l_rsrp_cmhk';
    }

    const sql = `
        WITH bounds AS (
            SELECT 
                ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 2326) AS hk_bounds_2326
        ), mvtgeom AS (
            SELECT 
                t.grid_id as id,
                t.${rsrpColumn} as rsrp_value,
                ST_AsMVTGeom(
                    ST_Transform(t.geom, 3857),
                    b.merc_bounds,
                    4096,
                    64,
                    true
                ) AS geom
            FROM ${tableName} t, bounds b
            WHERE t.${rsrpColumn} IS NOT NULL
              AND t.geom && b.hk_bounds_2326
              AND ST_Intersects(t.geom, b.hk_bounds_2326)
              ${spatialWhere}
        )
        SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
    `;

    try {
        const queryParams = [lonLeft, latBottom, lonRight, latTop, ...spatialParams];

        const { rows } = await pool.query(sql, queryParams);
        const tile = rows[0] && rows[0].tile ? rows[0].tile : null;

        res.setHeader('Content-Type', 'application/x-protobuf');
        if (!tile || tile.length === 0) {
            return res.send(Buffer.from([]));
        }

        // 🚀 REDIS ONLY: Store in Redis only (no node-cache backup)
        if (tile) {
            console.log(`💾 [RSRP MVT] Storing tile in Redis (${tile.length} bytes)...`);
            const redisStored = await redisCache.set(cacheKey, tile, 300);
            if (redisStored) {
                console.log(`✅ [RSRP MVT] Successfully stored in Redis with 300s TTL`);
                console.log(`✅ [RSRP MVT] Cache key: ${cacheKey}`);
            } else {
                console.error(`❌ [RSRP MVT] FAILED to store in Redis!`);
            }
        }

        res.setHeader('X-Cache', 'MISS');
        console.log(`📤 [RSRP MVT] Sending tile to client (${tile.length} bytes)`);
        res.send(tile);
    } catch (err) {
        console.error(`🚨 Error generating MVT for ${technology} RSRP data:`, err.message);
        console.error('Cache stats - Hits:', cacheStats.hits, 'Misses:', cacheStats.misses);
        console.error('🚨 Full error stack:', err.stack);

        // 🚀 FAILSAFE: Try simpler spatial filter if complex one fails
        if (spatialWhere && (districtArray.length > 0 || microGridArray.length > 0)) {
            try {
                const { whereClause: simpleSpatialWhere, params: simpleSpatialParams } = generateSimpleSpatialFilter(districtArray, microGridArray);

                const fallbackSql = `
                    WITH bounds AS (
                        SELECT 
                            ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                            ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds,
                            ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 2326) AS hk_bounds_2326
                    ), mvtgeom AS (
                        SELECT 
                            t.grid_id as id,
                            t.${rsrpColumn} as rsrp_value,
                            ST_AsMVTGeom(
                                ST_Transform(t.geom, 3857),
                                b.merc_bounds,
                                4096,
                                64,
                                true
                            ) AS geom
                        FROM ${tableName} t, bounds b
                        WHERE t.${rsrpColumn} IS NOT NULL
                          AND t.geom && b.hk_bounds_2326
                          AND ST_Intersects(t.geom, b.hk_bounds_2326)
                          ${simpleSpatialWhere}
                    )
                    SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
                `;

                const fallbackParams = [lonLeft, latBottom, lonRight, latTop, ...simpleSpatialParams];

                const { rows: fallbackRows } = await pool.query(fallbackSql, fallbackParams);
                const fallbackTile = fallbackRows[0] && fallbackRows[0].tile ? fallbackRows[0].tile : null;

                res.setHeader('Content-Type', 'application/x-protobuf');
                if (!fallbackTile || fallbackTile.length === 0) {
                    return res.send(Buffer.from([]));
                }

                // Return fallback tile (Redis-only architecture, no node-cache fallback)
                return res.send(fallbackTile);

            } catch (fallbackErr) {
                console.error(`🚨 FAILSAFE: Simple spatial filter also failed for ${technology} RSRP:`, fallbackErr.message);
            }
        }

        res.status(500).json({
            error: `Internal server error generating map tiles for ${technology} RSRP data`,
            debug: {
                technology: technology,
                districts: districtArray,
                microGrids: microGridArray,
                spatialFilterApplied: spatialWhere ? true : false,
                sqlError: err.message
            }
        });
    }
});

// 3.2. 六维数据 -> 测试数据 -> SINR 数据 (LTE/NR)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/cmhk_sinr_data/:technology/mvt/:z/:x/:y', async (req, res) => {
    const { technology, z, x, y } = req.params;
    const { microGrids, renderingMode } = req.query;

    // Validate technology parameter
    if (technology !== 'lte' && technology !== 'nr') {
        return res.status(400).json({
            error: 'Invalid technology',
            validTechnologies: ['lte', 'nr']
        });
    }

    // 🚀 SECURITY: Block 六維數據 (CMHK test data) access in 區域模式 - micro grids only
    if (renderingMode === 'spatial' && (!microGrids || microGrids === '')) {
        return res.status(403).json({
            error: 'Access denied',
            message: '請先選擇微網格後才能存取六維數據SINR資料'
        });
    }

    const zi = parseInt(z, 10);
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);
    if ([zi, xi, yi].some(Number.isNaN)) {
        return res.status(400).send('Invalid tile coordinates');
    }

    // Parse spatial filter parameters
    const microGridArray = microGrids ? (typeof microGrids === 'string' ? microGrids.split(',').map(id => parseInt(id, 10)) : microGrids.map(id => parseInt(id, 10))) : [];
    const districtArray = []; // No districts parameter in this endpoint

    // 🚀 OPTIMIZED: Use hierarchical cache key generation for better cache hit rates
    const baseCacheKey = `cmhk_sinr_data_${technology}_mvt_${zi}_${xi}_${yi}`;
    const cacheKey = generateHierarchicalCacheKey(baseCacheKey, microGridArray, zi);

    // 🚀 REDIS ONLY: No fallback to node-cache (Plan B)
    console.log(`🔍 [SINR MVT] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);

    if (cached) {
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader('X-Cache', 'HIT-REDIS');
        res.setHeader('X-Cache-Experiment', 'Redis-Only-No-Fallback');
        console.log(`✅ [SINR MVT] REDIS HIT! Returning cached tile (${cached.length} bytes)`);
        console.log(`✅ [SINR MVT] Cache key: ${cacheKey}`);
        return res.send(cached);
    }

    console.log(`❌ [SINR MVT] REDIS MISS - Will query database and store in Redis`);
    console.log(`❌ [SINR MVT] Cache key: ${cacheKey}`);

    // Compute tile bounds in WGS84 (EPSG:4326)
    const n = Math.pow(2, zi);
    const lonLeft = (xi / n) * 360 - 180;
    const lonRight = ((xi + 1) / n) * 360 - 180;
    const latTopRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * yi / n)));
    const latBottomRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (yi + 1) / n)));
    const latTop = (latTopRad * 180) / Math.PI;
    const latBottom = (latBottomRad * 180) / Math.PI;

    // 🚀 OPTIMIZED: Generate spatial filter clause with enhanced caching
    const { whereClause: spatialWhere, params: spatialParams } = await generateSpatialFilter(microGridArray);

    // Build technology-specific query based on LTE or NR
    let tableName;
    let sinrColumn;

    if (technology === 'nr') {
        // For NR data, use the NR four-quadrant table
        tableName = 'public.cmhk_grid_drive_test_four_quadrants_nr_new';
        sinrColumn = 'n_sinr_cmhk';
    } else {
        // For LTE data, use the LTE four-quadrant table
        tableName = 'public.cmhk_grid_drive_test_four_quadrants_lte_new';
        sinrColumn = 'l_sinr_cmhk';
    }

    const sql = `
        WITH bounds AS (
            SELECT 
                ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 2326) AS hk_bounds_2326
        ), mvtgeom AS (
            SELECT 
                t.grid_id as id,
                t.${sinrColumn} as sinr_value,
                ST_AsMVTGeom(
                    ST_Transform(t.geom, 3857),
                    b.merc_bounds,
                    4096,
                    64,
                    true
                ) AS geom
            FROM ${tableName} t, bounds b
            WHERE t.${sinrColumn} IS NOT NULL
              AND t.geom && b.hk_bounds_2326
              AND ST_Intersects(t.geom, b.hk_bounds_2326)
              ${spatialWhere}
        )
        SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
    `;

    try {
        const queryParams = [lonLeft, latBottom, lonRight, latTop, ...spatialParams];

        const { rows } = await pool.query(sql, queryParams);
        const tile = rows[0] && rows[0].tile ? rows[0].tile : null;

        res.setHeader('Content-Type', 'application/x-protobuf');
        if (!tile || tile.length === 0) {
            return res.send(Buffer.from([]));
        }

        // 🚀 REDIS ONLY: Store in Redis only (no node-cache backup)
        if (tile) {
            console.log(`💾 [SINR MVT] Storing tile in Redis (${tile.length} bytes)...`);
            const redisStored = await redisCache.set(cacheKey, tile, 300);
            if (redisStored) {
                console.log(`✅ [SINR MVT] Successfully stored in Redis with 300s TTL`);
                console.log(`✅ [SINR MVT] Cache key: ${cacheKey}`);
            } else {
                console.error(`❌ [SINR MVT] FAILED to store in Redis!`);
            }
        }

        res.setHeader('X-Cache', 'MISS');
        console.log(`📤 [SINR MVT] Sending tile to client (${tile.length} bytes)`);
        res.send(tile);
    } catch (err) {
        console.error(`🚨 Error generating MVT for ${technology} SINR data:`, err.message);
        console.error('Cache stats - Hits:', cacheStats.hits, 'Misses:', cacheStats.misses);
        console.error('🚨 Full error stack:', err.stack);

        // 🚀 FAILSAFE: Try simpler spatial filter if complex one fails
        if (spatialWhere && (districtArray.length > 0 || microGridArray.length > 0)) {
            try {
                const { whereClause: simpleSpatialWhere, params: simpleSpatialParams } = generateSimpleSpatialFilter(districtArray, microGridArray);

                const fallbackSql = `
                    WITH bounds AS (
                        SELECT 
                            ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                            ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds,
                            ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 2326) AS hk_bounds_2326
                    ), mvtgeom AS (
                        SELECT 
                            t.grid_id as id,
                            t.${sinrColumn} as sinr_value,
                            ST_AsMVTGeom(
                                ST_Transform(t.geom, 3857),
                                b.merc_bounds,
                                4096,
                                64,
                                true
                            ) AS geom
                        FROM ${tableName} t, bounds b
                        WHERE t.${sinrColumn} IS NOT NULL
                          AND t.geom && b.hk_bounds_2326
                          AND ST_Intersects(t.geom, b.hk_bounds_2326)
                          ${simpleSpatialWhere}
                    )
                    SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
                `;

                const fallbackParams = [lonLeft, latBottom, lonRight, latTop, ...simpleSpatialParams];

                const { rows: fallbackRows } = await pool.query(fallbackSql, fallbackParams);
                const fallbackTile = fallbackRows[0] && fallbackRows[0].tile ? fallbackRows[0].tile : null;

                res.setHeader('Content-Type', 'application/x-protobuf');
                if (!fallbackTile || fallbackTile.length === 0) {
                    return res.send(Buffer.from([]));
                }

                // Return fallback tile (Redis-only architecture, no node-cache fallback)
                return res.send(fallbackTile);

            } catch (fallbackErr) {
                console.error(`🚨 FAILSAFE: Simple spatial filter also failed for ${technology} SINR:`, fallbackErr.message);
            }
        }

        res.status(500).json({
            error: `Internal server error generating map tiles for ${technology} SINR data`,
            debug: {
                technology: technology,
                districts: districtArray,
                microGrids: microGridArray,
                spatialFilterApplied: spatialWhere ? true : false,
                sqlError: err.message
            }
        });
    }
});

// Discovery MR NR (strong/weak) as Mapbox Vector Tiles (MVT)
// 4. 六维数据 -> MR 竞对数据 -> 竞对数据 (Enhanced with spatial filtering)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/discovery_mr/:scenario/mvt/:z/:x/:y', async (req, res) => {
    const { scenario, z, x, y } = req.params;
    const { microGrids, renderingMode } = req.query;

    // 🚀 SECURITY: Block 六維數據 (Discovery MR data) access in 區域模式 - micro grids only
    if (renderingMode === 'spatial' && (!microGrids || microGrids === '')) {
        return res.status(403).json({
            error: 'Access denied',
            message: '請先選擇微網格後才能存取六維數據Discovery MR資料'
        });
    }

    const normalized = (scenario || '').toLowerCase();

    if (!['strong', 'weak', 'strong_we_strong', 'weak_we_strong'].includes(normalized)) {
        return res.status(400).json({
            error: 'Invalid scenario',
            message: `Use supported scenarios: strong, weak, strong_we_strong, weak_we_strong`,
            received: normalized
        });
    }

    const zi = parseInt(z, 10);
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);
    if ([zi, xi, yi].some(Number.isNaN)) {
        return res.status(400).send('Invalid tile coordinates');
    }

    // Parse spatial filter parameters
    const microGridArray = microGrids ? (typeof microGrids === 'string' ? microGrids.split(',').map(id => parseInt(id, 10)) : microGrids.map(id => parseInt(id, 10))) : [];

    // 🚀 OPTIMIZED: Use hierarchical cache key generation for better cache hit rates
    const baseCacheKey = `discovery_mr_mvt_${normalized}_${zi}_${xi}_${yi}`;
    const cacheKey = generateHierarchicalCacheKey(baseCacheKey, microGridArray, zi);

    // 🚀 REDIS ONLY: No fallback to node-cache (Plan B)
    console.log(`🔍 [Discovery MR MVT] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);

    if (cached) {
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader('X-Cache', 'HIT-REDIS');
        res.setHeader('X-Cache-Experiment', 'Redis-Only-No-Fallback');
        console.log(`✅ [Discovery MR MVT] REDIS HIT! Returning cached tile (${cached.length} bytes)`);
        console.log(`✅ [Discovery MR MVT] Cache key: ${cacheKey}`);
        return res.send(cached);
    }

    console.log(`❌ [Discovery MR MVT] REDIS MISS - Will query database and store in Redis`);
    console.log(`❌ [Discovery MR MVT] Cache key: ${cacheKey}`);

    // Compute tile bounds in WGS84 (EPSG:4326)
    const n = Math.pow(2, zi);
    const lonLeft = (xi / n) * 360 - 180;
    const lonRight = ((xi + 1) / n) * 360 - 180;
    const latTopRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * yi / n)));
    const latBottomRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (yi + 1) / n)));
    const latTop = (latTopRad * 180) / Math.PI;
    const latBottom = (latBottomRad * 180) / Math.PI;

    // Map scenarios to categories and determine table/view to use
    let category, tableName, isNewTable = false;

    if (normalized === 'strong') {
        category = '競強我弱';
        tableName = 'cmhk_grid_problemdb_after_discovery_競強我弱';
    } else if (normalized === 'weak') {
        category = '競弱我弱';
        tableName = 'cmhk_grid_problemdb_after_discovery_競弱我弱';
    } else if (normalized === 'strong_we_strong') {
        category = '競強我強';
        tableName = 'cmhk_grid_discovery_four_quadrants_combined_after_latest';
        isNewTable = true;
    } else if (normalized === 'weak_we_strong') {
        category = '競弱我強';
        tableName = 'cmhk_grid_discovery_four_quadrants_combined_after_latest';
        isNewTable = true;
    }

    // 🚀 OPTIMIZED: Generate spatial filter clause with enhanced caching
    // Pass the correct geometry column name based on table type
    const geomColumn = isNewTable ? 'geometry_2326' : 'geom';
    const { whereClause: spatialWhere, params: spatialParams } = await generateSpatialFilter(microGridArray, geomColumn);

    // Build SQL query based on table type
    let sql;

    if (isNewTable) {
        // For new scenarios using cmhk_grid_discovery_four_quadrants_combined_after_latest
        sql = `
            WITH bounds AS (
                SELECT 
                    ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                    ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds,
                    ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 2326) AS hk_bounds_2326
            ), mvtgeom AS (
                SELECT 
                    t.grid_id as id,
                    '${category}'::text AS category,
                    ST_AsMVTGeom(
                        ST_Transform(t.geometry_2326, 3857),
                        b.merc_bounds,
                        4096,
                        64,
                        true
                    ) AS geom
                FROM public.${tableName} t, bounds b
                WHERE t.geometry_2326 && b.hk_bounds_2326
                  AND ST_Intersects(t.geometry_2326, b.hk_bounds_2326)
                  AND t.max_rsrp場景 = '${category}'
                  ${spatialWhere}
            )
            SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
        `;
    } else {
        // For existing scenarios using views
        sql = `
            WITH bounds AS (
                SELECT 
                    ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                    ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds,
                    ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 2326) AS hk_bounds_2326
            ), mvtgeom AS (
                SELECT 
                    t.id,
                    '${category}'::text AS category,
                    ST_AsMVTGeom(
                        ST_Transform(t.geom, 3857),
                        b.merc_bounds,
                        4096,
                        64,
                        true
                    ) AS geom
                FROM public.${tableName} t, bounds b
                WHERE t.geom && b.hk_bounds_2326
                  AND ST_Intersects(t.geom, b.hk_bounds_2326)
                  ${spatialWhere}
            )
            SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
        `;
    }

    try {
        const { rows } = await pool.query(sql, [lonLeft, latBottom, lonRight, latTop, ...spatialParams]);
        const tile = rows[0] && rows[0].tile ? rows[0].tile : null;
        res.setHeader('Content-Type', 'application/x-protobuf');
        if (!tile || tile.length === 0) {
            return res.send(Buffer.from([]));
        }

        // 🚀 REDIS ONLY: Store in Redis only (no node-cache backup)
        if (tile) {
            console.log(`💾 [Discovery MR MVT] Storing tile in Redis (${tile.length} bytes)...`);
            const redisStored = await redisCache.set(cacheKey, tile, 300);
            if (redisStored) {
                console.log(`✅ [Discovery MR MVT] Successfully stored in Redis with 300s TTL`);
                console.log(`✅ [Discovery MR MVT] Cache key: ${cacheKey}`);
            } else {
                console.error(`❌ [Discovery MR MVT] FAILED to store in Redis!`);
            }
        }

        res.setHeader('X-Cache', 'MISS');
        console.log(`📤 [Discovery MR MVT] Sending tile to client (${tile.length} bytes)`);
        res.send(tile);
    } catch (err) {
        console.error('Error generating MVT for discovery MR:', err.message);
        console.error('Cache stats - Hits:', cacheStats.hits, 'Misses:', cacheStats.misses);

        if (err.message.includes('too many clients') || err.message.includes('remaining connection slots')) {
            return res.status(503).json({
                error: 'Service temporarily unavailable due to high load. Please try again later.',
                retryAfter: 5
            });
        }

        res.status(500).json({ error: 'Internal server error generating map tiles' });
    }
});

// Complaint high-complaint grids as Mapbox Vector Tiles (MVT)
// 5. 六维数据 -> 投诉数据 -> 投诉网格 (Enhanced with spatial filtering)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/complaint_data/mvt/:z/:x/:y', async (req, res) => {
    const { z, x, y } = req.params;
    const { microGrids, renderingMode } = req.query;

    // 🚀 SECURITY: Block 六維數據 (complaint data) access in 區域模式 - micro grids only
    if (renderingMode === 'spatial' && (!microGrids || microGrids === '')) {
        return res.status(403).json({
            error: 'Access denied',
            message: '請先選擇微網格後才能存取六維數據投訴資料'
        });
    }

    const zi = parseInt(z, 10);
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);
    if ([zi, xi, yi].some(Number.isNaN)) {
        return res.status(400).send('Invalid tile coordinates');
    }

    // Parse spatial filter parameters
    const microGridArray = microGrids ? (typeof microGrids === 'string' ? microGrids.split(',').map(id => parseInt(id, 10)) : microGrids.map(id => parseInt(id, 10))) : [];

    // 🚀 OPTIMIZED: Use hierarchical cache key generation for better cache hit rates  
    const baseCacheKey = `complaint_data_mvt_${zi}_${xi}_${yi}`;
    const cacheKey = generateHierarchicalCacheKey(baseCacheKey, microGridArray, zi);
    
    // 🚀 REDIS ONLY: No fallback to node-cache (Plan B)
    console.log(`🔍 [Complaint MVT] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);
    
    if (cached) {
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader('X-Cache', 'HIT-REDIS');
        res.setHeader('X-Cache-Experiment', 'Redis-Only-No-Fallback');
        console.log(`✅ [Complaint MVT] REDIS HIT! Returning cached tile (${cached.length} bytes)`);
        console.log(`✅ [Complaint MVT] Cache key: ${cacheKey}`);
        return res.send(cached);
    }
    
    console.log(`❌ [Complaint MVT] REDIS MISS - Will query database and store in Redis`);
    console.log(`❌ [Complaint MVT] Cache key: ${cacheKey}`);

    const n = Math.pow(2, zi);
    const lonLeft = (xi / n) * 360 - 180;
    const lonRight = ((xi + 1) / n) * 360 - 180;
    const latTopRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * yi / n)));
    const latBottomRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (yi + 1) / n)));
    const latTop = (latTopRad * 180) / Math.PI;
    const latBottom = (latBottomRad * 180) / Math.PI;

    // 🚀 OPTIMIZED: Generate spatial filter clause with enhanced caching
    const { whereClause: spatialWhere, params: spatialParams } = await generateSpatialFilter(microGridArray);

    const sql = `
        WITH bounds AS (
            SELECT 
                ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 2326) AS hk_bounds_2326
        ), mvtgeom AS (
            SELECT 
                t.id,
                t.highcomplaint,
                ST_AsMVTGeom(
                    ST_Transform(t.geom, 3857),
                    b.merc_bounds,
                    4096,
                    0,
                    true
                ) AS geom
            FROM public.cmhk_grid_problemdb t, bounds b
            WHERE t.highcomplaint IS TRUE
              AND t.geom && b.hk_bounds_2326
              AND ST_Intersects(t.geom, b.hk_bounds_2326)
              ${spatialWhere}
        )
        SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
    `;

    try {
        const queryParams = [lonLeft, latBottom, lonRight, latTop, ...spatialParams];
        const { rows } = await pool.query(sql, queryParams);
        const tile = rows[0] && rows[0].tile ? rows[0].tile : null;
        res.setHeader('Content-Type', 'application/x-protobuf');
        if (!tile || tile.length === 0) {
            return res.send(Buffer.from([]));
        }
        
        // 🚀 REDIS ONLY: Store in Redis only (no node-cache backup)
        if (tile) {
            console.log(`💾 [Complaint MVT] Storing tile in Redis (${tile.length} bytes)...`);
            const redisStored = await redisCache.set(cacheKey, tile, 300);
            if (redisStored) {
                console.log(`✅ [Complaint MVT] Successfully stored in Redis with 300s TTL`);
                console.log(`✅ [Complaint MVT] Cache key: ${cacheKey}`);
            } else {
                console.error(`❌ [Complaint MVT] FAILED to store in Redis!`);
            }
        }
        
        res.setHeader('X-Cache', 'MISS');
        console.log(`📤 [Complaint MVT] Sending tile to client (${tile.length} bytes)`);
        res.send(tile);
    } catch (err) {
        console.error('Error generating MVT for complaint data:', err.message);
        console.error('Cache stats - Hits:', cacheStats.hits, 'Misses:', cacheStats.misses);

        if (err.message.includes('too many clients') || err.message.includes('remaining connection slots')) {
            return res.status(503).json({
                error: 'Service temporarily unavailable due to high load. Please try again later.',
                retryAfter: 5
            });
        }

        res.status(500).json({ error: 'Internal server error generating map tiles' });
    }
});

// Microphone high-load grid as Mapbox Vector Tiles (MVT)
// 6. 六维数据 -> 话统数据 -> 高负载数据 (Enhanced with spatial filtering)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/cmhk_grid_highload/mvt/:z/:x/:y', async (req, res) => {
    const { z, x, y } = req.params;
    const { microGrids, renderingMode } = req.query;

    // 🚀 SECURITY: Block 六維數據 (microphone/high-load data) access in 區域模式 - micro grids only
    if (renderingMode === 'spatial' && (!microGrids || microGrids === '')) {
        return res.status(403).json({
            error: 'Access denied',
            message: '請先選擇微網格後才能存取六維數據話筒資料'
        });
    }

    const zi = parseInt(z, 10);
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);
    if ([zi, xi, yi].some(Number.isNaN)) {
        return res.status(400).send('Invalid tile coordinates');
    }

    // Parse spatial filter parameters
    const microGridArray = microGrids ? (typeof microGrids === 'string' ? microGrids.split(',').map(id => parseInt(id, 10)) : microGrids.map(id => parseInt(id, 10))) : [];

    // 🚀 OPTIMIZED: Use hierarchical cache key generation for better cache hit rates
    const baseCacheKey = `cmhk_grid_highload_mvt_${zi}_${xi}_${yi}`;
    const cacheKey = generateHierarchicalCacheKey(baseCacheKey, microGridArray, zi);

    // 🚀 REDIS ONLY: No fallback to node-cache (Plan B)
    console.log(`🔍 [HighLoad MVT] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);

    if (cached) {
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader('X-Cache', 'HIT-REDIS');
        res.setHeader('X-Cache-Experiment', 'Redis-Only-No-Fallback');
        console.log(`✅ [HighLoad MVT] REDIS HIT! Returning cached tile (${cached.length} bytes)`);
        console.log(`✅ [HighLoad MVT] Cache key: ${cacheKey}`);
        return res.send(cached);
    }

    console.log(`❌ [HighLoad MVT] REDIS MISS - Will query database and store in Redis`);
    console.log(`❌ [HighLoad MVT] Cache key: ${cacheKey}`);

    // Compute tile bounds
    const n = Math.pow(2, zi);
    const lonLeft = (xi / n) * 360 - 180;
    const lonRight = ((xi + 1) / n) * 360 - 180;
    const latTopRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * yi / n)));
    const latBottomRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (yi + 1) / n)));
    const latTop = (latTopRad * 180) / Math.PI;
    const latBottom = (latBottomRad * 180) / Math.PI;

    // 🚀 OPTIMIZED: Generate spatial filter clause with enhanced caching
    const { whereClause: spatialWhere, params: spatialParams } = await generateSpatialFilter(microGridArray);

    const sql = `
        WITH bounds AS (
            SELECT 
                ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 2326) AS hk_bounds_2326
        ), mvtgeom AS (
            SELECT 
                t.id,
                t.s_dl_prb_util,
                ST_AsMVTGeom(
                    ST_Transform(t.geom, 3857),
                    b.merc_bounds,
                    4096,
                    64,
                    true
                ) AS geom
            FROM public.cmhk_grid_highload t, bounds b
            WHERE t.geom && b.hk_bounds_2326
              AND ST_Intersects(t.geom, b.hk_bounds_2326)
              ${spatialWhere}
        )
        SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
    `;

    try {
        const queryParams = [lonLeft, latBottom, lonRight, latTop, ...spatialParams];
        const { rows } = await pool.query(sql, queryParams);
        const tile = rows[0] && rows[0].tile ? rows[0].tile : null;
        res.setHeader('Content-Type', 'application/x-protobuf');
        if (!tile || tile.length === 0) {
            return res.send(Buffer.from([]));
        }

        // 🚀 REDIS ONLY: Store in Redis only (no node-cache backup)
        if (tile) {
            console.log(`💾 [HighLoad MVT] Storing tile in Redis (${tile.length} bytes)...`);
            const redisStored = await redisCache.set(cacheKey, tile, 300);
            if (redisStored) {
                console.log(`✅ [HighLoad MVT] Successfully stored in Redis with 300s TTL`);
                console.log(`✅ [HighLoad MVT] Cache key: ${cacheKey}`);
            } else {
                console.error(`❌ [HighLoad MVT] FAILED to store in Redis!`);
            }
        }

        res.setHeader('X-Cache', 'MISS');
        console.log(`📤 [HighLoad MVT] Sending tile to client (${tile.length} bytes)`);
        res.send(tile);
    } catch (err) {
        console.error('Error generating MVT for high-load:', err.message);
        console.error('Cache stats - Hits:', cacheStats.hits, 'Misses:', cacheStats.misses);

        if (err.message.includes('too many clients') || err.message.includes('remaining connection slots')) {
            return res.status(503).json({
                error: 'Service temporarily unavailable due to high load. Please try again later.',
                retryAfter: 5
            });
        }

        res.status(500).json({ error: 'Internal server error generating map tiles' });
    }
});

// ********************************************************************* //
// 仿真原數據 開始
// ********************************************************************* //

// 🚀 CONFIGURATION: Simulation 5G Raw Data Table Name
// Update this when importing new simulation data with different timestamp
// ⚠️  IMPORTANT: After changing this table, clear Redis cache or wait for TTL (300s) expiration
const SIMULATION_5G_TABLE = 'nr_simulation_data_20251104';

// 🚀 NEW: Simulation 5G Raw Data as Mapbox Vector Tiles (MVT)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
// 📊 Data Source: Table created from 5G_Simulation_Data_Dissolved.geojson (EPSG:32650 → EPSG:4326)
// 📋 Table Structure: id, dn (signal strength), geom (MultiPolygon geometry - dissolved), created_at, data_description
app.get('/api/simulation-pbf/:z/:x/:y', async (req, res) => {
    const { z, x, y } = req.params;
    const { microGrids, renderingMode } = req.query;

    const zi = parseInt(z, 10);
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);
    if ([zi, xi, yi].some(Number.isNaN)) {
        return res.status(400).send('Invalid tile coordinates');
    }

    // Parse spatial filter parameters
    const microGridArray = microGrids ? (typeof microGrids === 'string' ? microGrids.split(',').map(id => parseInt(id, 10)) : microGrids.map(id => parseInt(id, 10))) : [];

    // 🚀 OPTIMIZED: Use hierarchical cache key generation for better cache hit rates
    const baseCacheKey = `simulation_5g_raw_mvt_${zi}_${xi}_${yi}`;
    const cacheKey = generateHierarchicalCacheKey(baseCacheKey, microGridArray, zi);

    // 🚀 REDIS ONLY: No fallback to node-cache (Plan B)
    console.log(`🔍 [Simulation PBF MVT] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);

    if (cached) {
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader('X-Cache', 'HIT-REDIS');
        res.setHeader('X-Cache-Experiment', 'Redis-Only-No-Fallback');
        console.log(`✅ [Simulation PBF MVT] REDIS HIT! Returning cached tile (${cached.length} bytes)`);
        console.log(`✅ [Simulation PBF MVT] Cache key: ${cacheKey}`);
        return res.send(cached);
    }

    console.log(`❌ [Simulation PBF MVT] REDIS MISS - Will query database and store in Redis`);
    console.log(`❌ [Simulation PBF MVT] Cache key: ${cacheKey}`);

    // Compute tile bounds in WGS84 (EPSG:4326)
    const n = Math.pow(2, zi);
    const lonLeft = (xi / n) * 360 - 180;
    const lonRight = ((xi + 1) / n) * 360 - 180;
    const latTopRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * yi / n)));
    const latBottomRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (yi + 1) / n)));
    const latTop = (latTopRad * 180) / Math.PI;
    const latBottom = (latBottomRad * 180) / Math.PI;

    // 🚀 OPTIMIZED: Generate spatial filter clause with enhanced caching
    const { whereClause: spatialWhere, params: spatialParams } = await generateSpatialFilter(microGridArray);

    const sql = `
        WITH bounds AS (
            SELECT 
                ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds
        ), mvtgeom AS (
            SELECT 
                t.id,
                t.dn,
                ST_AsMVTGeom(
                    t.geom,
                    b.wgs_bounds,
                    4096,
                    64,
                    true
                ) AS geom
            FROM "${SIMULATION_5G_TABLE}" t, bounds b
            WHERE t.geom && b.wgs_bounds
              AND ST_Intersects(t.geom, b.wgs_bounds)
              ${spatialWhere}
        )
        SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
    `;

    try {
        const queryParams = [lonLeft, latBottom, lonRight, latTop, ...spatialParams];
        const { rows } = await newPool.query(sql, queryParams);
        const tile = rows[0] && rows[0].tile ? rows[0].tile : null;
        res.setHeader('Content-Type', 'application/x-protobuf');
        if (!tile || tile.length === 0) {
            return res.send(Buffer.from([]));
        }

        // 🚀 REDIS ONLY: Store in Redis only (no node-cache backup)
        if (tile) {
            console.log(`💾 [Simulation PBF MVT] Storing tile in Redis (${tile.length} bytes)...`);
            const redisStored = await redisCache.set(cacheKey, tile, 300);
            if (redisStored) {
                console.log(`✅ [Simulation PBF MVT] Successfully stored in Redis with 300s TTL`);
                console.log(`✅ [Simulation PBF MVT] Cache key: ${cacheKey}`);
            } else {
                console.error(`❌ [Simulation PBF MVT] FAILED to store in Redis!`);
            }
        }

        res.setHeader('X-Cache', 'MISS');
        console.log(`📤 [Simulation PBF MVT] Sending tile to client (${tile.length} bytes)`);
        res.send(tile);
    } catch (err) {
        console.error('Error generating MVT for 5G simulation raw data:', err.message);
        console.error('Cache stats - Hits:', cacheStats.hits, 'Misses:', cacheStats.misses);

        if (err.message.includes('too many clients') || err.message.includes('remaining connection slots')) {
            return res.status(503).json({
                error: 'Service temporarily unavailable due to high load. Please try again later.',
                retryAfter: 5
            });
        }

        res.status(500).json({ error: 'Internal server error generating map tiles' });
    }
});

// ********************************************************************* //
// 🚀 NEW: Simulation 4G/LTE Raw Data as Mapbox Vector Tiles (MVT)
// ********************************************************************* //

// 🚀 CONFIGURATION: Simulation 4G Raw Data Table Name
// Update this when importing new simulation data with different timestamp
// ⚠️  IMPORTANT: After changing this table, clear Redis cache or wait for TTL (300s) expiration
const SIMULATION_4G_TABLE = 'lte_simulation_data_20251104';

// 🚀 NEW: Simulation 4G Raw Data as Mapbox Vector Tiles (MVT)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
// 📊 Data Source: Table created from 4G_Simulation_Data_Dissolved.geojson (EPSG:32650 → EPSG:4326)
// 📋 Table Structure: id, dn (signal strength), geom (MultiPolygon geometry - dissolved), created_at, data_description
app.get('/api/simulation-4g-pbf/:z/:x/:y', async (req, res) => {
    const { z, x, y } = req.params;
    const { microGrids, renderingMode } = req.query;

    const zi = parseInt(z, 10);
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);
    if ([zi, xi, yi].some(Number.isNaN)) {
        return res.status(400).send('Invalid tile coordinates');
    }

    // Parse spatial filter parameters
    const microGridArray = microGrids ? (typeof microGrids === 'string' ? microGrids.split(',').map(id => parseInt(id, 10)) : microGrids.map(id => parseInt(id, 10))) : [];

    // 🚀 OPTIMIZED: Use hierarchical cache key generation for better cache hit rates
    const baseCacheKey = `simulation_4g_raw_mvt_${zi}_${xi}_${yi}`;
    const cacheKey = generateHierarchicalCacheKey(baseCacheKey, microGridArray, zi);

    // 🚀 REDIS ONLY: No fallback to node-cache (Plan B)
    console.log(`🔍 [Simulation 4G PBF MVT] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);

    if (cached) {
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader('X-Cache', 'HIT-REDIS');
        res.setHeader('X-Cache-Experiment', 'Redis-Only-No-Fallback');
        console.log(`✅ [Simulation 4G PBF MVT] REDIS HIT! Returning cached tile (${cached.length} bytes)`);
        console.log(`✅ [Simulation 4G PBF MVT] Cache key: ${cacheKey}`);
        return res.send(cached);
    }

    console.log(`❌ [Simulation 4G PBF MVT] REDIS MISS - Will query database and store in Redis`);
    console.log(`❌ [Simulation 4G PBF MVT] Cache key: ${cacheKey}`);

    // Compute tile bounds in WGS84 (EPSG:4326)
    const n = Math.pow(2, zi);
    const lonLeft = (xi / n) * 360 - 180;
    const lonRight = ((xi + 1) / n) * 360 - 180;
    const latTopRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * yi / n)));
    const latBottomRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (yi + 1) / n)));
    const latTop = (latTopRad * 180) / Math.PI;
    const latBottom = (latBottomRad * 180) / Math.PI;

    // 🚀 OPTIMIZED: Generate spatial filter clause with enhanced caching
    const { whereClause: spatialWhere, params: spatialParams } = await generateSpatialFilter(microGridArray);

    const sql = `
        WITH bounds AS (
            SELECT 
                ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds
        ), mvtgeom AS (
            SELECT 
                t.id,
                t.dn,
                ST_AsMVTGeom(
                    t.geom,
                    b.wgs_bounds,
                    4096,
                    64,
                    true
                ) AS geom
            FROM "${SIMULATION_4G_TABLE}" t, bounds b
            WHERE t.geom && b.wgs_bounds
              AND ST_Intersects(t.geom, b.wgs_bounds)
              ${spatialWhere}
        )
        SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
    `;

    try {
        const queryParams = [lonLeft, latBottom, lonRight, latTop, ...spatialParams];
        const { rows } = await newPool.query(sql, queryParams);
        const tile = rows[0] && rows[0].tile ? rows[0].tile : null;
        res.setHeader('Content-Type', 'application/x-protobuf');
        if (!tile || tile.length === 0) {
            return res.send(Buffer.from([]));
        }

        // 🚀 REDIS ONLY: Store in Redis only (no node-cache backup)
        if (tile) {
            console.log(`💾 [Simulation 4G PBF MVT] Storing tile in Redis (${tile.length} bytes)...`);
            const redisStored = await redisCache.set(cacheKey, tile, 300);
            if (redisStored) {
                console.log(`✅ [Simulation 4G PBF MVT] Successfully stored in Redis with 300s TTL`);
                console.log(`✅ [Simulation 4G PBF MVT] Cache key: ${cacheKey}`);
            } else {
                console.error(`❌ [Simulation 4G PBF MVT] FAILED to store in Redis!`);
            }
        }

        res.setHeader('X-Cache', 'MISS');
        console.log(`📤 [Simulation 4G PBF MVT] Sending tile to client (${tile.length} bytes)`);
        res.send(tile);
    } catch (err) {
        console.error('Error generating MVT for 4G simulation raw data:', err.message);
        console.error('Cache stats - Hits:', cacheStats.hits, 'Misses:', cacheStats.misses);

        if (err.message.includes('too many clients') || err.message.includes('remaining connection slots')) {
            return res.status(503).json({
                error: 'Service temporarily unavailable due to high load. Please try again later.',
                retryAfter: 5
            });
        }

        res.status(500).json({ error: 'Internal server error generating map tiles' });
    }
});

// 仿真原數據 結束
// ********************************************************************* //

// ********************************************************************* //
// 🚀 SPATIAL FILTERING ENHANCEMENT: Utility function for spatial filtering
// ********************************************************************* //

/**
 * 🚀 PERFORMANCE OPTIMIZED: Generates spatial filtering SQL clause based on micro grids only
 * @param {Array} microGrids - Array of micro grid IDs
 * @param {String} geomColumn - Name of the geometry column (default: 'geom')
 * @returns {Promise<Object>} { whereClause, params }
 */
async function generateSpatialFilter(microGrids = [], geomColumn = 'geom') {
    // 🔍 DEBUG: Log input parameters

    if (microGrids.length === 0) {
        return { whereClause: '', params: [] };
    }

    // 🚀 NEW: Use optimized bounds-based filtering instead of complex spatial joins
    try {
        const result = await generateBoundsBasedSpatialFilter(microGrids, geomColumn);
        return result;
    } catch (error) {
        console.warn(`🌍 Optimized filtering failed, falling back to simple spatial filter:`, error.message);
        // Fallback to simple filtering
        return generateSimpleSpatialFilter(microGrids, geomColumn);
    }
}

/**
 * Simple spatial filter that uses basic SRID assumptions (fallback method) - micro grids only
 * @param {Array} microGrids - Array of micro grid IDs
 * @param {String} geomColumn - Name of the geometry column (default: 'geom')
 * @returns {Object} { whereClause, params }
 */
function generateSimpleSpatialFilter(microGrids = [], geomColumn = 'geom') {
    if (microGrids.length === 0) {
        return { whereClause: '', params: [] };
    }

    let whereClause = '';
    let params = [];
    let paramIndex = 5;

    // Only use micro grids for spatial filtering
    const microGridPlaceholders = microGrids.map((_, index) => `$${paramIndex + index}`).join(',');
    whereClause = `
        AND EXISTS (
            SELECT 1 FROM public.micro_grid m
            WHERE m.id IN (${microGridPlaceholders})  
            AND ST_Intersects(t.${geomColumn}, m.geom)
        )`;
    params = [...params, ...microGrids];

    return { whereClause, params };
}

// ********************************************************************* //
// 六维数据 结束
// ********************************************************************* //

// ********************************************************************* //
// 六维数据详情接口 开始 (This group of endpoints will be further verified and examinated)
// ********************************************************************* //

// Unified Grid Details endpoint for Six-Dimension Data (excluding planning sites and live sites)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/api/grid-details/:grid_id', async (req, res) => {
    const { grid_id } = req.params;
    const { categories, renderingMode, districts, microGrids } = req.query; // Optional filter for specific categories

    // 🚀 SECURITY: Block 六維數據 details access in 區域模式 - micro grids only
    if (renderingMode === 'spatial' && categories && (!microGrids || microGrids === '')) {
        const sixDimensionCategories = ['complaint_data', 'discovery_mr', 'high_load_data', 'simulation_data', 'cmhk_test_data'];
        const requestedCategories = categories.split(',');
        const hasSixDimensionData = requestedCategories.some(cat => sixDimensionCategories.includes(cat));

        if (hasSixDimensionData) {
            return res.status(403).json({
                error: 'Access denied',
                message: '請先選擇微網格後才能存取六維數據詳細資訊'
            });
        }
    }

    if (!grid_id) {
        return res.status(400).json({ error: 'Grid ID is required' });
    }

    // 🚀 REDIS CACHE: Check Redis cache first for grid details
    const cacheKey = `grid_details_${grid_id}_${categories || 'all'}_${renderingMode || 'default'}`;
    console.log(`🔍 [Grid Details] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cachedResult = await redisCache.get(cacheKey);

    if (cachedResult) {
        res.setHeader('X-Cache', 'HIT-REDIS');
        console.log(`✅ [Grid Details] REDIS HIT! Returning cached data`);
        return res.json(cachedResult);
    }

    console.log(`❌ [Grid Details] REDIS MISS - Will query database and store in Redis`);

    try {

        // Initialize response structure
        const gridDetails = {
            grid_id: grid_id,
            coordinates: null,
            categories: {},
            available_categories: [],
            metadata: {
                last_updated: new Date().toISOString(),
                total_records: 0,
                query_time: Date.now()
            }
        };

        // Array to store all query promises for parallel execution
        const queryPromises = [];

        // Parse requested categories (if specified)
        const requestedCategories = categories ? categories.split(',').map(c => c.trim()) : null;

        // Helper function to check if category is requested
        const shouldQueryCategory = (category) => {
            const shouldQuery = !requestedCategories || requestedCategories.includes(category);
            return shouldQuery;
        };

        // 1. Discovery MR Data queries (競對數據 - strong/weak competition analysis)
        if (shouldQueryCategory('discovery_mr')) {
            const discoveryMrPromise = async () => {
                try {
                    const discoveryData = { strong: null, weak: null };
                    let hasData = false;

                    // Query strong competition scenario (競強我弱)
                    try {
                        const strongQuery = `
                            SELECT id, 
                                   ST_X(ST_Transform(ST_Centroid(geom), 4326)) as longitude,
                                   ST_Y(ST_Transform(ST_Centroid(geom), 4326)) as latitude
                            FROM public.cmhk_grid_problemdb_after_discovery_競強我弱
                            WHERE id = $1
                            LIMIT 1;
                        `;
                        const strongResult = await pool.query(strongQuery, [grid_id]);
                        if (strongResult.rows.length > 0) {
                            const row = strongResult.rows[0];
                            discoveryData.strong = {
                                category: '競強我弱',
                                scenario: '強勢競爭',
                                description: '競爭對手強勢，CMHK弱覆蓋區域',
                                analysis_type: 'competitive_disadvantage'
                            };
                            // Set grid coordinates from query
                            if (!gridDetails.coordinates && row.longitude && row.latitude) {
                                gridDetails.coordinates = [parseFloat(row.latitude), parseFloat(row.longitude)];
                            }
                            hasData = true;
                        }
                    } catch (err) {
                        console.warn('Failed to query strong competition data:', err.message);
                    }

                    // Query weak competition scenario (競弱我弱)  
                    try {
                        const weakQuery = `
                            SELECT id,
                                   ST_X(ST_Transform(ST_Centroid(geom), 4326)) as longitude,
                                   ST_Y(ST_Transform(ST_Centroid(geom), 4326)) as latitude
                            FROM public.cmhk_grid_problemdb_after_discovery_競弱我弱
                            WHERE id = $1
                            LIMIT 1;
                        `;
                        const weakResult = await pool.query(weakQuery, [grid_id]);
                        if (weakResult.rows.length > 0) {
                            const row = weakResult.rows[0];
                            discoveryData.weak = {
                                category: '競弱我弱',
                                scenario: '弱勢競爭',
                                description: '競爭對手與CMHK均為弱覆蓋區域',
                                analysis_type: 'mutual_weakness'
                            };
                            // Set grid coordinates from query
                            if (!gridDetails.coordinates && row.longitude && row.latitude) {
                                gridDetails.coordinates = [parseFloat(row.latitude), parseFloat(row.longitude)];
                            }
                            hasData = true;
                        }
                    } catch (err) {
                        console.warn('Failed to query weak competition data:', err.message);
                    }

                    if (hasData) {
                        gridDetails.categories.discovery_mr = discoveryData;
                        gridDetails.available_categories.push('discovery_mr');
                    }

                } catch (err) {
                    console.error('Error querying Discovery MR data:', err.message);
                }
            };
            queryPromises.push(discoveryMrPromise());
        }

        // 2. Complaint Data queries (投诉数据 - high complaint grids)
        if (shouldQueryCategory('complaint_data')) {
            const complaintPromise = async () => {
                try {
                    const complaintQuery = `
                        SELECT id, highcomplaint,
                               ST_X(ST_Transform(ST_Centroid(geom), 4326)) as longitude,
                               ST_Y(ST_Transform(ST_Centroid(geom), 4326)) as latitude
                        FROM public.cmhk_grid_problemdb
                        WHERE id = $1 AND highcomplaint = true
                        LIMIT 1;
                    `;
                    const complaintResult = await pool.query(complaintQuery, [grid_id]);
                    if (complaintResult.rows.length > 0) {
                        const row = complaintResult.rows[0];
                        gridDetails.categories.complaint_data = {
                            status: '高投訴網格',
                            complaint_level: '高',
                            description: '客戶投訴量高的網格',
                            risk_category: '服務品質問題'
                        };
                        // Set grid coordinates from query
                        if (!gridDetails.coordinates && row.longitude && row.latitude) {
                            gridDetails.coordinates = [parseFloat(row.latitude), parseFloat(row.longitude)];
                        }
                        gridDetails.available_categories.push('complaint_data');
                    }
                } catch (err) {
                    console.error('Error querying complaint data:', err.message);
                }
            };
            queryPromises.push(complaintPromise());
        }

        // 3. High Load Data queries (话筒数据 - high load grids)
        if (shouldQueryCategory('high_load_data')) {
            const highLoadPromise = async () => {
                try {
                    const highLoadQuery = `
                        SELECT id, s_dl_prb_util,
                               ST_X(ST_Transform(ST_Centroid(geom), 4326)) as longitude,
                               ST_Y(ST_Transform(ST_Centroid(geom), 4326)) as latitude
                        FROM public.cmhk_grid_highload
                        WHERE id = $1
                        LIMIT 1;
                    `;
                    const highLoadResult = await pool.query(highLoadQuery, [grid_id]);
                    if (highLoadResult.rows.length > 0) {
                        const row = highLoadResult.rows[0];
                        const utilizationPercent = parseFloat(row.s_dl_prb_util) || 0;

                        gridDetails.categories.high_load_data = {
                            dl_prb_utilization: row.s_dl_prb_util,
                            utilization_percentage: `${utilizationPercent.toFixed(2)}%`,
                            load_status: utilizationPercent > 80 ? '嚴重' : utilizationPercent > 60 ? '高' : '中等',
                            description: '下行PRB利用率統計',
                            capacity_recommendation: utilizationPercent > 80 ? '需要立即擴容' : '密切監控'
                        };
                        // Set grid coordinates from query
                        if (!gridDetails.coordinates && row.longitude && row.latitude) {
                            gridDetails.coordinates = [parseFloat(row.latitude), parseFloat(row.longitude)];
                        }
                        gridDetails.available_categories.push('high_load_data');
                    }
                } catch (err) {
                    console.error('Error querying high load data:', err.message);
                }
            };
            queryPromises.push(highLoadPromise());
        }

        // 4. Simulation Data queries (仿真数据 - LTE simulation weak coverage)
        if (shouldQueryCategory('simulation_data')) {
            const simulationPromise = async () => {
                try {
                    const simulationQuery = `
                        SELECT id, district_id, "_mean",
                               ST_X(ST_Transform(ST_Centroid(geom), 4326)) as longitude,
                               ST_Y(ST_Transform(ST_Centroid(geom), 4326)) as latitude
                        FROM public.cmhk_grid_simulation_weak
                        WHERE id = $1
                        LIMIT 1;
                    `;
                    const simulationResult = await pool.query(simulationQuery, [grid_id]);
                    if (simulationResult.rows.length > 0) {
                        const row = simulationResult.rows[0];
                        const meanValue = parseFloat(row._mean) || 0;

                        gridDetails.categories.simulation_data = {
                            district_id: row.district_id,
                            mean_signal_strength: row._mean,
                            coverage_quality: meanValue >= -100 ? '良好' : meanValue >= -110 ? '一般' : '弱',
                            simulation_type: 'LTE弱覆蓋分析',
                            description: '基於網絡仿真的覆蓋預測',
                            improvement_priority: meanValue < -110 ? '高' : meanValue < -100 ? '中' : '低'
                        };
                        // Set grid coordinates from query
                        if (!gridDetails.coordinates && row.longitude && row.latitude) {
                            gridDetails.coordinates = [parseFloat(row.latitude), parseFloat(row.longitude)];
                        }
                        gridDetails.available_categories.push('simulation_data');
                    }
                } catch (err) {
                    console.error('Error querying simulation data:', err.message);
                }
            };
            queryPromises.push(simulationPromise());
        }

        // 5. CMHK Weak Coverage Testing Data queries (測試數據 - drive test four quadrants analysis)
        if (shouldQueryCategory('cmhk_test_data')) {
            const testDataPromise = async () => {
                try {
                    const testDataQuery = `
                        SELECT id, drive_test_four_quadrants,
                               ST_X(ST_Transform(ST_Centroid(geom), 4326)) as longitude,
                               ST_Y(ST_Transform(ST_Centroid(geom), 4326)) as latitude
                        FROM public.cmhk_grid_problemdb
                        WHERE id = $1 AND drive_test_four_quadrants IS NOT NULL
                        LIMIT 1;
                    `;
                    const testDataResult = await pool.query(testDataQuery, [grid_id]);
                    if (testDataResult.rows.length > 0) {
                        const row = testDataResult.rows[0];

                        // Parse the drive test four quadrants result
                        const testResult = row.drive_test_four_quadrants;
                        const isWeakCoverage = testResult && testResult.includes('我弱');

                        gridDetails.categories.cmhk_test_data = {
                            drive_test_result: testResult,
                            coverage_analysis: isWeakCoverage ? '檢測到CMHK弱覆蓋' : '覆蓋分析可用',
                            test_type: '駕駛測試四象限分析',
                            description: 'CMHK與競爭對手的駕駛測試覆蓋分析',
                            priority: isWeakCoverage ? '高 - 需要改進' : '標準',
                            category: '測試數據',
                            subcategory: 'CMHK 弱覆蓋'
                        };
                        // Set grid coordinates from query
                        if (!gridDetails.coordinates && row.longitude && row.latitude) {
                            gridDetails.coordinates = [parseFloat(row.latitude), parseFloat(row.longitude)];
                        }
                        gridDetails.available_categories.push('cmhk_test_data');
                    }
                } catch (err) {
                    console.error('Error querying CMHK test data:', err.message);
                }
            };
            queryPromises.push(testDataPromise());
        }

        // Execute all queries in parallel
        const startTime = Date.now();
        await Promise.allSettled(queryPromises);
        const endTime = Date.now();

        // Calculate final metadata
        gridDetails.metadata.total_records = gridDetails.available_categories.length;
        gridDetails.metadata.query_time = Date.now() - gridDetails.metadata.query_time;


        // Return grid details or empty response if no data found
        if (gridDetails.available_categories.length === 0) {
            return res.json({
                ...gridDetails,
                message: 'No data found for this grid ID'
            });
        }

        // 🚀 REDIS ONLY: Store in Redis with 300s TTL
        console.log(`💾 [Grid Details] Storing grid details in Redis...`);
        const redisStored = await redisCache.set(cacheKey, gridDetails, 300);
        if (redisStored) {
            console.log(`✅ [Grid Details] Successfully stored in Redis with 300s TTL`);
        } else {
            console.error(`❌ [Grid Details] FAILED to store in Redis!`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(gridDetails);

    } catch (err) {
        console.error('Error fetching grid details:', err.stack);
        res.status(500).json({
            error: 'Internal server error fetching grid details',
            grid_id: grid_id
        });
    }
});

// ********************************************************************* //
// 六维数据详情接口 结束
// ********************************************************************* //

// ********************************************************************* //
// 其他测试数据 开始
// ********************************************************************* //

// Other operators LTE weak coverage as Mapbox Vector Tiles (MVT)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/other_lte_weak/mvt/:table/:z/:x/:y', async (req, res) => {
    const { table, z, x, y } = req.params;

    // Whitelist allowed non-CMHK LTE field-test tables
    const allowedTables = new Set([
        'xcsl_l900',
        'xcsl_l1800',
        'xcsl_l2600',
        'xhut_l700',
        'xhut_l900',
        'xhut_l1800',
        'xhut_l2300',
        'xhut_l2600',
        'xsmt_l900',
        'xsmt_l1800',
        'xsmt_l2600'
    ]);

    if (!allowedTables.has(table)) {
        return res.status(400).json({
            error: 'Invalid table. Allowed: xcsl_l900, xcsl_l1800, xcsl_l2600, xhut_l700, xhut_l900, xhut_l1800, xhut_l2300, xhut_l2600, xsmt_l900, xsmt_l1800, xsmt_l2600'
        });
    }

    const zi = parseInt(z, 10);
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);
    if ([zi, xi, yi].some(Number.isNaN)) {
        return res.status(400).send('Invalid tile coordinates');
    }

    const cacheKey = `other_lte_weak_mvt_${table}_${zi}_${xi}_${yi}`;

    // 🚀 REDIS ONLY: No fallback to node-cache (Plan B)
    console.log(`🔍 [Other LTE Weak MVT] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);

    if (cached) {
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader('X-Cache', 'HIT-REDIS');
        res.setHeader('X-Cache-Experiment', 'Redis-Only-No-Fallback');
        console.log(`✅ [Other LTE Weak MVT] REDIS HIT! Returning cached tile (${cached.length} bytes)`);
        console.log(`✅ [Other LTE Weak MVT] Cache key: ${cacheKey}`);
        return res.send(cached);
    }

    console.log(`❌ [Other LTE Weak MVT] REDIS MISS - Will query database and store in Redis`);
    console.log(`❌ [Other LTE Weak MVT] Cache key: ${cacheKey}`);

    // Compute tile bounds in WGS84 (4326)
    const n = Math.pow(2, zi);
    const lonLeft = (xi / n) * 360 - 180;
    const lonRight = ((xi + 1) / n) * 360 - 180;
    const latTopRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * yi / n)));
    const latBottomRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (yi + 1) / n)));
    const latTop = (latTopRad * 180) / Math.PI;
    const latBottom = (latBottomRad * 180) / Math.PI;

    // Build MVT using PostGIS ST_AsMVT with bounds supplied as WGS84 envelope
    const sql = `
        WITH bounds AS (
            SELECT 
                ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds
        ), mvtgeom AS (
            SELECT 
                t.rsrp_value,
                ST_AsMVTGeom(
                    ST_Transform(t.geom, 3857),
                    b.merc_bounds,
                    4096,
                    64,
                    true
                ) AS geom
            FROM public.${table} t, bounds b
            WHERE t.rsrp_value < -110
              AND t.geom && b.wgs_bounds
              AND ST_Intersects(t.geom, b.wgs_bounds)
        )
        SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
    `;

    try {
        const { rows } = await newPool.query(sql, [lonLeft, latBottom, lonRight, latTop]);
        const tile = rows[0] && rows[0].tile ? rows[0].tile : null;
        res.setHeader('Content-Type', 'application/x-protobuf');
        if (!tile || tile.length === 0) {
            return res.send(Buffer.from([]));
        }

        // 🚀 REDIS ONLY: Store in Redis only (no node-cache backup)
        if (tile) {
            console.log(`💾 [Other LTE Weak MVT] Storing tile in Redis (${tile.length} bytes)...`);
            const redisStored = await redisCache.set(cacheKey, tile, 300);
            if (redisStored) {
                console.log(`✅ [Other LTE Weak MVT] Successfully stored in Redis with 300s TTL`);
                console.log(`✅ [Other LTE Weak MVT] Cache key: ${cacheKey}`);
            } else {
                console.error(`❌ [Other LTE Weak MVT] FAILED to store in Redis!`);
            }
        }

        res.setHeader('X-Cache', 'MISS');
        console.log(`📤 [Other LTE Weak MVT] Sending tile to client (${tile.length} bytes)`);
        res.send(tile);
    } catch (err) {
        console.error('Error generating MVT for other LTE weak:', err.message);
        console.error('Cache stats - Hits:', cacheStats.hits, 'Misses:', cacheStats.misses);

        if (err.message.includes('too many clients') || err.message.includes('remaining connection slots')) {
            return res.status(503).json({
                error: 'Service temporarily unavailable due to high load. Please try again later.',
                retryAfter: 5
            });
        }

        res.status(500).json({ error: 'Internal server error generating map tiles' });
    }
});

// Other operators NR weak coverage as Mapbox Vector Tiles (MVT)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/other_nr_weak/mvt/:table/:z/:x/:y', async (req, res) => {
    const { table, z, x, y } = req.params;

    // Whitelist allowed non-CMHK NR field-test tables
    const allowedTables = new Set([
        'fieldtest_grid_xcsl_ft_nr2100_rsrp',
        'fieldtest_grid_xcsl_ft_nr3500_rsrp',
        'fieldtest_grid_xcsl_ft_nr4900_rsrp',
        'fieldtest_grid_xhut_ft_nr2100_rsrp',
        'fieldtest_grid_xhut_ft_nr3500_rsrp',
        'fieldtest_grid_xsmt_ft_nr2100_rsrp',
        'fieldtest_grid_xsmt_ft_nr3500_rsrp',
        'fieldtest_grid_xsmt_ft_nr4900_rsrp'
    ]);

    if (!allowedTables.has(table)) {
        return res.status(400).json({
            error: 'Invalid table. Allowed: fieldtest_grid_xcsl_ft_nr2100_rsrp, fieldtest_grid_xcsl_ft_nr3500_rsrp, fieldtest_grid_xcsl_ft_nr4900_rsrp, fieldtest_grid_xhut_ft_nr2100_rsrp, fieldtest_grid_xhut_ft_nr3500_rsrp, fieldtest_grid_xsmt_ft_nr2100_rsrp, fieldtest_grid_xsmt_ft_nr3500_rsrp, fieldtest_grid_xsmt_ft_nr4900_rsrp'
        });
    }

    const zi = parseInt(z, 10);
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);
    if ([zi, xi, yi].some(Number.isNaN)) {
        return res.status(400).send('Invalid tile coordinates');
    }

    const cacheKey = `other_nr_weak_mvt_${table}_${zi}_${xi}_${yi}`;

    // 🚀 REDIS ONLY: No fallback to node-cache (Plan B)
    console.log(`🔍 [Other NR Weak MVT] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);

    if (cached) {
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader('X-Cache', 'HIT-REDIS');
        res.setHeader('X-Cache-Experiment', 'Redis-Only-No-Fallback');
        console.log(`✅ [Other NR Weak MVT] REDIS HIT! Returning cached tile (${cached.length} bytes)`);
        console.log(`✅ [Other NR Weak MVT] Cache key: ${cacheKey}`);
        return res.send(cached);
    }


    console.log(`❌ [Other NR Weak MVT] REDIS MISS - Will query database and store in Redis`);
    console.log(`❌ [Other NR Weak MVT] Cache key: ${cacheKey}`);

    // Compute tile bounds in WGS84 (EPSG:4326)
    const n = Math.pow(2, zi);
    const lonLeft = (xi / n) * 360 - 180;
    const lonRight = ((xi + 1) / n) * 360 - 180;
    const latTopRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * yi / n)));
    const latBottomRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (yi + 1) / n)));
    const latTop = (latTopRad * 180) / Math.PI;
    const latBottom = (latBottomRad * 180) / Math.PI;

    // Build MVT using PostGIS ST_AsMVT. Source geom is EPSG:2326; clip in EPSG:3857; filter in native SRID
    const sql = `
        WITH bounds AS (
            SELECT 
                ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds,
                ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 2326) AS hk_bounds_2326
        ), mvtgeom AS (
            SELECT 
                t.rsrp_value,
                ST_AsMVTGeom(
                    ST_Transform(t.geom, 3857),
                    b.merc_bounds,
                    4096,
                    64,
                    true
                ) AS geom
            FROM public.${table} t, bounds b
            WHERE t.rsrp_value < -110
              AND t.geom && b.hk_bounds_2326
              AND ST_Intersects(t.geom, b.hk_bounds_2326)
        )
        SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
    `;

    try {
        const { rows } = await newPool.query(sql, [lonLeft, latBottom, lonRight, latTop]);
        const tile = rows[0] && rows[0].tile ? rows[0].tile : null;
        res.setHeader('Content-Type', 'application/x-protobuf');
        if (!tile || tile.length === 0) {
            return res.send(Buffer.from([]));
        }

        // 🚀 REDIS ONLY: Store in Redis only (no node-cache backup)
        if (tile) {
            console.log(`💾 [Other NR Weak MVT] Storing tile in Redis (${tile.length} bytes)...`);
            const redisStored = await redisCache.set(cacheKey, tile, 300);
            if (redisStored) {
                console.log(`✅ [Other NR Weak MVT] Successfully stored in Redis with 300s TTL`);
                console.log(`✅ [Other NR Weak MVT] Cache key: ${cacheKey}`);
            } else {
                console.error(`❌ [Other NR Weak MVT] FAILED to store in Redis!`);
            }
        }

        res.setHeader('X-Cache', 'MISS');
        console.log(`📤 [Other NR Weak MVT] Sending tile to client (${tile.length} bytes)`);
        res.send(tile);
    } catch (err) {
        console.error('Error generating MVT for other NR weak:', err.message);
        console.error('Cache stats - Hits:', cacheStats.hits, 'Misses:', cacheStats.misses);

        if (err.message.includes('too many clients') || err.message.includes('remaining connection slots')) {
            return res.status(503).json({
                error: 'Service temporarily unavailable due to high load. Please try again later.',
                retryAfter: 5
            });
        }

        res.status(500).json({ error: 'Internal server error generating map tiles' });
    }
});

//  CMHK Testing Data (LTE and NR) as Mapbox Vector Tiles (MVT) (Enhanced with spatial filtering)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/cmhk_weak_coverage/mvt/:type/:band/:z/:x/:y', async (req, res) => {
    const { type, band, z, x, y } = req.params;
    const { microGrids, renderingMode } = req.query;

    // 🚀 SECURITY: Block 六維數據 (CMHK weak coverage data) access in 區域模式 - micro grids only
    if (renderingMode === 'spatial' && (!microGrids || microGrids === '')) {
        return res.status(403).json({
            error: 'Access denied',
            message: '請先選擇微網格後才能存取六維數據CMHK弱覆蓋資料'
        });
    }

    // Validate type (lte or nr)
    if (!['lte', 'nr'].includes(type.toLowerCase())) {
        return res.status(400).json({
            error: 'Invalid type. Use: lte | nr'
        });
    }

    // Validate bands and map to table names
    const lteTableMap = {
        '700': 'cmhk_l700',
        '900': 'cmhk_l900',
        '1800': 'cmhk_l1800',
        '2300': 'cmhk_l2300',
        '2600': 'cmhk_l2600'
    };

    const nrTableMap = {
        '2100': 'fieldtest_grid_cmhk_ft_nr2100_rsrp',
        '3500': 'fieldtest_grid_cmhk_ft_nr3500_rsrp',
        '4900': 'fieldtest_grid_cmhk_ft_nr4900_rsrp'
    };

    let tableName;
    let geomSrid;

    if (type.toLowerCase() === 'lte') {
        tableName = lteTableMap[band];
        geomSrid = 4326; // LTE tables use EPSG:4326
        if (!tableName) {
            return res.status(400).json({
                error: 'Invalid LTE band. Use: 700, 900, 1800, 2300, 2600'
            });
        }
    } else {
        tableName = nrTableMap[band];
        geomSrid = 2326; // NR tables use EPSG:2326
        if (!tableName) {
            return res.status(400).json({
                error: 'Invalid NR band. Use: 2100, 3500, 4900'
            });
        }
    }

    const zi = parseInt(z, 10);
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);
    if ([zi, xi, yi].some(Number.isNaN)) {
        return res.status(400).send('Invalid tile coordinates');
    }

    // Parse spatial filter parameters
    const microGridArray = microGrids ? (typeof microGrids === 'string' ? microGrids.split(',').map(id => parseInt(id, 10)) : microGrids.map(id => parseInt(id, 10))) : [];

    // 🚀 OPTIMIZED: Use hierarchical cache key generation for better cache hit rates
    const baseCacheKey = `cmhk_weak_coverage_mvt_${type}_${band}_${zi}_${xi}_${yi}`;
    const cacheKey = generateHierarchicalCacheKey(baseCacheKey, microGridArray, zi);

    // 🚀 REDIS ONLY: No fallback to node-cache (Plan B)
    console.log(`🔍 [CMHK Weak Coverage MVT] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);
    const cached = await redisCache.get(cacheKey);

    if (cached) {
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader('X-Cache', 'HIT-REDIS');
        res.setHeader('X-Cache-Experiment', 'Redis-Only-No-Fallback');
        console.log(`✅ [CMHK Weak Coverage MVT] REDIS HIT! Returning cached tile (${cached.length} bytes)`);
        console.log(`✅ [CMHK Weak Coverage MVT] Cache key: ${cacheKey}`);
        return res.send(cached);
    }

    console.log(`❌ [CMHK Weak Coverage MVT] REDIS MISS - Will query database and store in Redis`);
    console.log(`❌ [CMHK Weak Coverage MVT] Cache key: ${cacheKey}`);

    // Compute tile bounds in WGS84 (EPSG:4326)
    const n = Math.pow(2, zi);
    const lonLeft = (xi / n) * 360 - 180;
    const lonRight = ((xi + 1) / n) * 360 - 180;
    const latTopRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * yi / n)));
    const latBottomRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (yi + 1) / n)));
    const latTop = (latTopRad * 180) / Math.PI;
    const latBottom = (latBottomRad * 180) / Math.PI;

    // 🚀 OPTIMIZED: Generate spatial filter clause with enhanced caching
    const { whereClause: spatialWhere, params: spatialParams } = await generateSpatialFilter(microGridArray);

    // Build MVT using PostGIS ST_AsMVT with different SRID handling
    let sql;
    if (geomSrid === 4326) {
        // LTE tables: geometry already in WGS84
        // Note: For LTE tables, we need to transform the geom to 2326 for spatial filter comparison
        sql = `
            WITH bounds AS (
                SELECT 
                    ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                    ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds
            ), mvtgeom AS (
                SELECT 
                    t.grid_id,
                    t.rsrp_value,
                    t.aa_date,
                    '${type.toUpperCase()}${band}' AS band_type,
                    ST_AsMVTGeom(
                        ST_Transform(t.geom, 3857),
                        b.merc_bounds,
                        4096,
                        64,
                        true
                    ) AS geom
                FROM public.${tableName} t, bounds b
                WHERE t.rsrp_value IS NOT NULL
                  AND t.geom && b.wgs_bounds
                  AND ST_Intersects(t.geom, b.wgs_bounds)
                  ${spatialWhere ? spatialWhere.replace(/t\.geom/g, 'ST_Transform(t.geom, 2326)') : ''}
            )
            SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
        `;
    } else {
        // NR tables: geometry in EPSG:2326, transform bounds for filtering
        sql = `
            WITH bounds AS (
                SELECT 
                    ST_MakeEnvelope($1, $2, $3, $4, 4326) AS wgs_bounds,
                    ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3857) AS merc_bounds,
                    ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 2326) AS hk_bounds_2326
            ), mvtgeom AS (
                SELECT 
                    t.grid_id,
                    t.rsrp_value,
                    t.aa_date,
                    'NR${band}' AS band_type,
                    ST_AsMVTGeom(
                        ST_Transform(t.geom, 3857),
                        b.merc_bounds,
                        4096,
                        64,
                        true
                    ) AS geom
                FROM public.${tableName} t, bounds b
                WHERE t.rsrp_value IS NOT NULL
                  AND t.geom && b.hk_bounds_2326
                  AND ST_Intersects(t.geom, b.hk_bounds_2326)
                  ${spatialWhere}
            )
            SELECT ST_AsMVT(mvtgeom, 'grid', 4096, 'geom') AS tile FROM mvtgeom;
        `;
    }

    try {

        const { rows } = await newPool.query(sql, [lonLeft, latBottom, lonRight, latTop, ...spatialParams]);
        const tile = rows[0] && rows[0].tile ? rows[0].tile : null;

        res.setHeader('Content-Type', 'application/x-protobuf');
        if (!tile || tile.length === 0) {
            return res.send(Buffer.from([]));
        }

        // 🚀 REDIS ONLY: Store in Redis only (no node-cache backup)
        if (tile) {
            console.log(`💾 [CMHK Weak Coverage MVT] Storing tile in Redis (${tile.length} bytes)...`);
            const redisStored = await redisCache.set(cacheKey, tile, 300);
            if (redisStored) {
                console.log(`✅ [CMHK Weak Coverage MVT] Successfully stored in Redis with 300s TTL`);
                console.log(`✅ [CMHK Weak Coverage MVT] Cache key: ${cacheKey}`);
            } else {
                console.error(`❌ [CMHK Weak Coverage MVT] FAILED to store in Redis!`);
            }
        }

        res.setHeader('X-Cache', 'MISS');
        console.log(`📤 [CMHK Weak Coverage MVT] Sending tile to client (${tile.length} bytes)`);
        res.send(tile);
    } catch (err) {
        console.error(`Error generating MVT for CMHK ${type.toUpperCase()} ${band} weak coverage:`, err.message);
        console.error('Cache stats - Hits:', cacheStats.hits, 'Misses:', cacheStats.misses);
        console.error(`Pool status after error - Total: ${newPool.totalCount}, Idle: ${newPool.idleCount}, Waiting: ${newPool.waitingCount}`);

        // Handle specific connection pool errors
        if (err.message.includes('too many clients') || err.message.includes('remaining connection slots')) {
            console.error('Connection pool exhausted, consider increasing pool size or reducing concurrent requests');
            return res.status(503).json({
                error: 'Service temporarily unavailable due to high load. Please try again later.',
                retryAfter: 5
            });
        }

        res.status(500).json({ error: 'Internal server error generating map tiles' });
    }
});

// ********************************************************************* //
// 其他测试数据 结束
// ********************************************************************* //

// ********************************************************************* //
// 地图数据 开始
// ********************************************************************* //

// Endpoint to list micro grid areas from hkmap database
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/micro_grids', async (req, res) => {
    try {
        const { district } = req.query; // Optional filter by district

        // Generate cache key based on district filter
        const cacheKey = `micro_grids_${district || 'all'}`;
        console.log(`🔍 [Micro Grids] Checking Redis for key: ${cacheKey}`);

        // Check Redis cache
        const cached = await redisCache.get(cacheKey);

        if (cached) {
            res.setHeader('X-Cache', 'HIT-REDIS');
            console.log(`✅ [Micro Grids] REDIS HIT! Returning cached data`);
            return res.json(cached);
        }

        console.log(`❌ [Micro Grids] REDIS MISS - Will query database and store in Redis`);

        let query = `
        SELECT
          id,
          district,
          grid_name,
          ST_AsGeoJSON(
            ST_Transform(
              ST_SimplifyPreserveTopology(geom, 0.0005),
              4326
            ),
            6
          )::json AS geometry
        FROM public.micro_grid
        WHERE geom IS NOT NULL`;

        const params = [];

        if (district) {
            query += ` AND district = $1`;
            params.push(district);
        }

        query += ` ORDER BY district, grid_name`;

        const { rows } = await pool.query(query, params);

        const responseData = {
            type: 'FeatureCollection',
            features: rows.map(row => ({
                type: 'Feature',
                properties: {
                    id: row.id,
                    district: row.district,
                    grid_name: row.grid_name
                },
                geometry: row.geometry
            }))
        };

        // Store in Redis with 300s TTL
        console.log(`💾 [Micro Grids] Storing data in Redis...`);
        const redisStored = await redisCache.set(cacheKey, responseData, 300);
        if (redisStored) {
            console.log(`✅ [Micro Grids] Successfully stored in Redis with 300s TTL`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(responseData);
    } catch (err) {
        console.error('Error fetching micro grids:', err.stack);
        res.status(500).json({ error: 'Failed to fetch micro grids' });
    }
});

// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
// Endpoint to get MR data for a specific micro grid by grid_name
app.get('/micro_grid_mr/:grid_name', async (req, res) => {
    try {
        const { grid_name } = req.params;

        // 🐛 DEBUG: Check for edge cases
        if (!grid_name || grid_name.trim() === '') {
            console.warn(`[DEBUG] WARNING: Empty or undefined grid_name received`);
            return res.status(400).json({ error: 'Grid name is required' });
        }

        // Generate cache key based on grid_name
        const cacheKey = `micro_grid_mr_${grid_name}`;
        console.log(`🔍 [Micro Grid MR] Checking Redis for key: ${cacheKey}`);

        // Check Redis cache
        const cached = await redisCache.get(cacheKey);

        if (cached) {
            res.setHeader('X-Cache', 'HIT-REDIS');
            console.log(`✅ [Micro Grid MR] REDIS HIT! Returning cached data for "${grid_name}"`);
            return res.json(cached);
        }

        console.log(`❌ [Micro Grid MR] REDIS MISS - Will query database and store in Redis`);

        // 直接查詢所需的MR數據和領先/落後數據
        const query = `
        SELECT
            id,
            grid_name,
            mr_nr_coverage_cmhk,
            mr_cband_coverage_cmhk,
            mr_lte_coverage_cmhk,
            mr_nr_coverage_3hk,
            mr_cband_coverage_3hk,
            mr_lte_coverage_3hk,
            mr_nr_coverage_hkt,
            mr_cband_coverage_hkt,
            mr_lte_coverage_hkt,
            mr_nr_coverage_smt,
            mr_cband_coverage_smt,
            mr_lte_coverage_smt,
            "競弱我弱 (%)" as comp_weak_we_weak,
            "競弱我強 (%)" as comp_weak_we_strong,
            "競強我弱 (%)" as comp_strong_we_weak,
            "競強我強 (%)" as comp_strong_we_strong,
            "領先/落後" as leading_status,
            "領先/落後%" as percentage,
            district,
            grid_name_eng
        FROM micro_grid.micro_gird_mr
        WHERE grid_name = $1`;

        console.log(`[DEBUG] Executing MR query for: "${grid_name}"`);
        console.log(`[DEBUG] SQL Query:`, query);

        const { rows } = await pool.query(query, [grid_name]);

        console.log(`[DEBUG] Query executed successfully. Rows returned: ${rows.length}`);

        if (rows.length === 0) {
            console.log(`[DEBUG] No MR data found for grid_name: "${grid_name}"`);
            return res.status(404).json({ error: 'MR data not found for this grid' });
        }

        const data = rows[0];

        // 🐛 DEBUG: Log raw database response
        console.log(`[DEBUG] Raw database data for "${grid_name}":`, {
            leading_status_raw: data.leading_status,
            percentage_raw: data.percentage,
            leading_status_type: typeof data.leading_status,
            percentage_type: typeof data.percentage,
            all_fields: Object.keys(data),
            sample_fields: {
                id: data.id,
                grid_name: data.grid_name,
                leading_status: data.leading_status,
                percentage: data.percentage
            }
        });

        // 構建響應數據，包含MR數據和領先落後數據
        const responseData = {
            id: data.id,
            grid_name: data.grid_name,
            mr_nr_coverage: data.mr_nr_coverage_cmhk,
            mr_cband_coverage: data.mr_cband_coverage_cmhk,
            mr_lte_coverage: data.mr_lte_coverage_cmhk,
            mr_nr_coverage_cmhk: data.mr_nr_coverage_cmhk,
            mr_cband_coverage_cmhk: data.mr_cband_coverage_cmhk,
            mr_lte_coverage_cmhk: data.mr_lte_coverage_cmhk,
            mr_nr_coverage_3hk: data.mr_nr_coverage_3hk,
            mr_cband_coverage_3hk: data.mr_cband_coverage_3hk,
            mr_lte_coverage_3hk: data.mr_lte_coverage_3hk,
            mr_nr_coverage_hkt: data.mr_nr_coverage_hkt,
            mr_cband_coverage_hkt: data.mr_cband_coverage_hkt,
            mr_lte_coverage_hkt: data.mr_lte_coverage_hkt,
            mr_nr_coverage_smt: data.mr_nr_coverage_smt,
            mr_cband_coverage_smt: data.mr_cband_coverage_smt,
            mr_lte_coverage_smt: data.mr_lte_coverage_smt,
            comp_weak_we_weak: data.comp_weak_we_weak,
            comp_weak_we_strong: data.comp_weak_we_strong,
            comp_strong_we_weak: data.comp_strong_we_weak,
            comp_strong_we_strong: data.comp_strong_we_strong,
            leading_status: data.leading_status,
            percentage: data.percentage,
            district: data.district,
            grid_name_eng: data.grid_name_eng
        };

        console.log(`[DEBUG] Successfully retrieved data for "${grid_name}":`, {
            leading_status: data.leading_status,
            percentage: data.percentage,
            mr_nr_coverage: data.mr_nr_coverage_cmhk
        });

        // Store in Redis with 300s TTL
        console.log(`💾 [Micro Grid MR] Storing data in Redis...`);
        const redisStored = await redisCache.set(cacheKey, responseData, 300);
        if (redisStored) {
            console.log(`✅ [Micro Grid MR] Successfully stored in Redis with 300s TTL`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(responseData);
    } catch (err) {
        console.error(`[ERROR] Failed to fetch micro grid MR data for "${req.params.grid_name}":`, err);
        console.error(`[ERROR] Error details:`, {
            message: err.message,
            code: err.code,
            detail: err.detail,
            where: err.where,
            position: err.position,
            routine: err.routine,
            file: err.file,
            line: err.line
        });
        res.status(500).json({ error: 'Failed to fetch micro grid MR data', details: err.message });
    }
});

// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
// Endpoint to get district-microgrid mapping (districts with their micro grid counts)
app.get('/districts_with_microgrids', async (req, res) => {
    try {
        // Generate cache key (no parameters, so simple key)
        const cacheKey = 'districts_with_microgrids_all';
        console.log(`🔍 [Districts With Microgrids] Checking Redis for key: ${cacheKey}`);

        // Check Redis cache
        const cached = await redisCache.get(cacheKey);

        if (cached) {
            res.setHeader('X-Cache', 'HIT-REDIS');
            console.log(`✅ [Districts With Microgrids] REDIS HIT! Returning cached data`);
            return res.json(cached);
        }

        console.log(`❌ [Districts With Microgrids] REDIS MISS - Will query database and store in Redis`);

        const query = `
        SELECT
            district as district_name,
            COUNT(id) as microgrid_count,
            json_agg(
                json_build_object(
                    'id', id,
                    'grid_name', grid_name,
                    'geom', ST_AsGeoJSON(geom)::json
                )
                ORDER BY id
            ) as microgrids
        FROM public.micro_grid
        WHERE district IS NOT NULL
        GROUP BY district
        ORDER BY district
        `;

        const { rows } = await pool.query(query);

        const responseData = {
            districts: rows.map(row => ({
                district_name: row.district_name,
                microgrid_count: parseInt(row.microgrid_count) || 0,
                microgrids: row.microgrids || []
            }))
        };

        // Store in Redis with 300s TTL
        console.log(`💾 [Districts With Microgrids] Storing data in Redis...`);
        const redisStored = await redisCache.set(cacheKey, responseData, 300);
        if (redisStored) {
            console.log(`✅ [Districts With Microgrids] Successfully stored in Redis with 300s TTL`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(responseData);
    } catch (err) {
        console.error('Error fetching district-microgrid mapping:', err.stack);
        res.status(500).json({ error: 'Failed to fetch district-microgrid mapping' });
    }
});

// 🚀 NEW: Endpoint to get MR data summary for selected micro grids
app.post('/api/selected-grids-mr-summary', async (req, res) => {
    try {
        const { gridIds } = req.body;

        console.log('[DEBUG] Fetching selected grids MR summary for:', gridIds);

        if (!gridIds || !Array.isArray(gridIds) || gridIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Grid IDs array is required'
            });
        }

        const query = `
        SELECT 
            AVG(mr_nr_coverage_cmhk) as mr_nr_coverage,
            AVG(mr_cband_coverage_cmhk) as mr_cband_coverage,
            AVG(mr_lte_coverage_cmhk) as mr_lte_coverage,
            AVG("競弱我弱 (%)") as comp_weak_we_weak,
            AVG("競弱我強 (%)") as comp_weak_we_strong,
            AVG("競強我弱 (%)") as comp_strong_we_weak,
            AVG("競強我強 (%)") as comp_strong_we_strong,
            COUNT(*) as selected_grids_count,
            array_agg(grid_name) as grid_names
        FROM micro_grid.micro_gird_mr mgmr
        JOIN public.micro_grid mg ON mgmr.grid_name = mg.grid_name
        WHERE mg.id = ANY($1)`;

        const { rows } = await pool.query(query, [gridIds]);

        if (rows.length === 0 || rows[0].selected_grids_count === 0) {
            return res.json({
                success: false,
                error: 'No MR data found for selected grids'
            });
        }

        res.json({
            success: true,
            data: {
                mr_nr_coverage: parseFloat(rows[0].mr_nr_coverage) || 0,
                mr_cband_coverage: parseFloat(rows[0].mr_cband_coverage) || 0,
                mr_lte_coverage: parseFloat(rows[0].mr_lte_coverage) || 0,
                comp_weak_we_weak: parseFloat(rows[0].comp_weak_we_weak) || 0,
                comp_weak_we_strong: parseFloat(rows[0].comp_weak_we_strong) || 0,
                comp_strong_we_weak: parseFloat(rows[0].comp_strong_we_weak) || 0,
                comp_strong_we_strong: parseFloat(rows[0].comp_strong_we_strong) || 0,
                selected_grids_count: parseInt(rows[0].selected_grids_count) || 0,
                grid_names: rows[0].grid_names || []
            }
        });
    } catch (err) {
        console.error('Error fetching selected grids MR summary:', err.stack);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch selected grids MR summary'
        });
    }
});

// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
// 🚀 NEW: Micro Grid Rankings API for dashboard visualization
app.get('/api/micro_grid_rankings', async (req, res) => {
    try {
        // Generate cache key (no parameters, so simple key)
        const cacheKey = 'micro_grid_rankings_all';
        console.log(`🔍 [Micro Grid Rankings] Checking Redis for key: ${cacheKey}`);

        // Check Redis cache
        const cached = await redisCache.get(cacheKey);

        if (cached) {
            res.setHeader('X-Cache', 'HIT-REDIS');
            console.log(`✅ [Micro Grid Rankings] REDIS HIT! Returning cached data`);
            return res.json(cached);
        }

        console.log(`❌ [Micro Grid Rankings] REDIS MISS - Will query database and store in Redis`);

        const query = `
            SELECT
                id,
                grid_name,
                grid_name_eng,
                district,
                "競弱我弱 (%)" as comp_weak_we_weak,
                "競弱我強 (%)" as comp_weak_we_strong,
                "競強我弱 (%)" as comp_strong_we_weak,
                "競強我強 (%)" as comp_strong_we_strong,
                "領先/落後" as comp_lead_behind,
                "領先/落後%" as comp_lead_behind_percent
            FROM micro_grid.micro_gird_mr
            WHERE "領先/落後" IS NOT NULL AND "領先/落後%" IS NOT NULL AND id!=170;
        `;

        const result = await pool.query(query);

        const responseData = {
            success: true,
            data: result.rows,
            total_records: result.rows.length,
            timestamp: new Date().toISOString()
        };

        // Store in Redis with 300s TTL
        console.log(`💾 [Micro Grid Rankings] Storing data in Redis...`);
        const redisStored = await redisCache.set(cacheKey, responseData, 300);
        if (redisStored) {
            console.log(`✅ [Micro Grid Rankings] Successfully stored in Redis with 300s TTL`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(responseData);

    } catch (error) {
        console.error('🚨 Error fetching micro grid rankings data:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
// 🚀 NEW: Whole Coverage API - Returns Hong Kong-wide coverage statistics
app.get('/api/whole_coverage', async (req, res) => {
    try {
        // Generate cache key (no parameters, so simple key)
        const cacheKey = 'whole_coverage_hongkong';
        console.log(`🔍 [Whole Coverage] Checking Redis for key: ${cacheKey}`);

        // Check Redis cache
        const cached = await redisCache.get(cacheKey);

        if (cached) {
            res.setHeader('X-Cache', 'HIT-REDIS');
            console.log(`✅ [Whole Coverage] REDIS HIT! Returning cached data`);
            return res.json(cached);
        }

        console.log(`❌ [Whole Coverage] REDIS MISS - Will query database and store in Redis`);

        const query = `
            SELECT
                mr_nr_coverage_cmhk,
                mr_cband_coverage_cmhk,
                mr_lte_coverage_cmhk,
                mr_nr_coverage_hkt,
                mr_cband_coverage_hkt,
                mr_lte_coverage_hkt,
                mr_nr_coverage_3hk,
                mr_cband_coverage_3hk,
                mr_lte_coverage_3hk,
                mr_nr_coverage_smt,
                mr_cband_coverage_smt,
                mr_lte_coverage_smt,
                "領先/落後%"
            FROM micro_grid.micro_gird_mr
            WHERE id = 170;
        `;

        const result = await pool.query(query);

        // Validate that we got the Hong Kong-wide record
        if (result.rows.length === 0) {
            console.warn('⚠️ No Hong Kong-wide coverage data found (id=170)');
            return res.status(404).json({
                success: false,
                error: 'Data not found',
                message: 'Hong Kong-wide coverage statistics not available'
            });
        }

        // Extract the first (and only) row
        const coverageRow = result.rows[0];

        // Return data in a structured format with proper field mapping
        const responseData = {
            success: true,
            data: {
                cmhk: {
                    nr: coverageRow.mr_nr_coverage_cmhk,
                    cband: coverageRow.mr_cband_coverage_cmhk,
                    lte: coverageRow.mr_lte_coverage_cmhk
                },
                hkt: {
                    nr: coverageRow.mr_nr_coverage_hkt,
                    cband: coverageRow.mr_cband_coverage_hkt,
                    lte: coverageRow.mr_lte_coverage_hkt
                },
                '3hk': {
                    nr: coverageRow.mr_nr_coverage_3hk,
                    cband: coverageRow.mr_cband_coverage_3hk,
                    lte: coverageRow.mr_lte_coverage_3hk
                },
                smt: {
                    nr: coverageRow.mr_nr_coverage_smt,
                    cband: coverageRow.mr_cband_coverage_smt,
                    lte: coverageRow.mr_lte_coverage_smt
                },
                leading_percentage: coverageRow['領先/落後%']
            },
            timestamp: new Date().toISOString()
        };

        // Store in Redis with 300s TTL
        console.log(`💾 [Whole Coverage] Storing data in Redis...`);
        const redisStored = await redisCache.set(cacheKey, responseData, 300);
        if (redisStored) {
            console.log(`✅ [Whole Coverage] Successfully stored in Redis with 300s TTL`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(responseData);

    } catch (error) {
        console.error('🚨 Error fetching whole coverage data:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// ********************************************************************* //
// 🚀 PERFORMANCE OPTIMIZATION: Enhanced Spatial Filtering for Regional Mode
// ********************************************************************* //

/**
 * 🚀 REDIS: Pre-fetch and cache micro grid union geometry
 * Uses Redis cache with 1-hour TTL for expensive PostGIS ST_Union results
 * This provides accurate spatial filtering using actual geometries instead of bounding boxes
 */
async function getMicroGridUnion(microGridIds) {
    if (!microGridIds || microGridIds.length === 0) {
        return null;
    }

    // Sort IDs for consistent cache key
    const sortedIds = [...microGridIds].sort((a, b) => a - b);
    const cacheKey = `spatial_microgrid_union_${sortedIds.join('_')}`;

    // Check Redis cache first
    let unionGeom = await redisCache.get(cacheKey);
    if (unionGeom) {
        console.log(`✅ [Micro Grid Union] Redis HIT: ${sortedIds.length} grids`);
        return unionGeom;
    }

    console.log(`❌ [Micro Grid Union] Redis MISS: ${sortedIds.length} grids - querying PostGIS`);

    try {
        // 🚀 FIX: Use ST_Union to get actual merged geometries instead of bounding box
        const placeholders = microGridIds.map((_, index) => `$${index + 1}`).join(',');
        const query = `
            SELECT ST_AsText(ST_Transform(ST_Union(geom), 4326)) as union_geom
            FROM public.micro_grid
            WHERE id IN (${placeholders})
            AND geom IS NOT NULL
        `;

        const result = await pool.query(query, microGridIds);

        if (result.rows.length > 0 && result.rows[0].union_geom) {
            unionGeom = {
                wkt: result.rows[0].union_geom
            };

            // Cache the result in Redis (1 hour TTL - micro grids rarely change)
            await redisCache.set(cacheKey, unionGeom, 3600);
            console.log(`💾 [Micro Grid Union] Stored in Redis: ${sortedIds.length} grids`);

            return unionGeom;
        }
    } catch (error) {
        console.error('🚨 Error fetching micro grid union:', error.message);
    }

    return null;
}


/**
 * 🚀 PERFORMANCE OPTIMIZATION: Enhanced spatial filter with pre-computed bounds
 * This version eliminates complex spatial queries during tile generation
 */
function generateOptimizedSpatialFilter(microGrids = []) {

    if (microGrids.length === 0) {
        return { whereClause: '', params: [], needsBounds: false };
    }

    // 🚀 OPTIMIZATION: Use simple ID-based filtering instead of complex spatial joins
    // This assumes the main tables have micro_grid_id or grid_id foreign keys
    let whereClause = '';
    let params = [];
    let paramIndex = 5; // Start from $5 since $1-$4 are used for bounds

    // Try to use direct ID filtering first (if available in the table)
    const microGridPlaceholders = microGrids.map((_, index) => `$${paramIndex + index}`).join(',');

    // 🚀 OPTION 1: Direct micro grid ID filtering (fastest)
    whereClause = `AND (t.micro_grid_id IN (${microGridPlaceholders}) OR t.grid_id IN (${microGridPlaceholders}))`;
    params = [...microGrids];


    return {
        whereClause,
        params,
        needsBounds: false,
        microGridIds: microGrids
    };
}

/**
 * 🚀 PERFORMANCE OPTIMIZATION: Bounds-based spatial filter for tables without direct ID links
 * Uses pre-computed union geometry for accurate filtering (not bounding box)
 * @param {Array} microGrids - Array of micro grid IDs
 * @param {String} geomColumn - Name of the geometry column (default: 'geom')
 */
async function generateBoundsBasedSpatialFilter(microGrids = [], geomColumn = 'geom') {

    if (microGrids.length === 0) {
        return { whereClause: '', params: [] };
    }

    // 🚀 FIX: Get pre-computed union geometry (not bounding box!)
    const unionGeom = await getMicroGridUnion(microGrids);
    if (!unionGeom || !unionGeom.wkt) {
        // 🚀 FALLBACK: Use simple spatial filter when union lookup fails
        // This prevents returning empty clause that would render ALL data instead of filtered data
        console.warn(`⚠️ [Spatial Filter] Union geometry lookup failed for microgrids: [${microGrids.join(', ')}]. Falling back to simple spatial filter.`);
        return generateSimpleSpatialFilter(microGrids, geomColumn);
    }

    // 🚀 FIX: Use actual union geometry for accurate spatial intersection
    // This ensures data is only rendered within selected microgrids, not the bounding box
    const whereClause = `
        AND ST_Intersects(
            CASE
                WHEN ST_SRID(t.${geomColumn}) = 2326 THEN ST_Transform(t.${geomColumn}, 4326)
                WHEN ST_SRID(t.${geomColumn}) = 3857 THEN ST_Transform(t.${geomColumn}, 4326)
                ELSE t.${geomColumn}
            END,
            ST_GeomFromText($5, 4326)
        )`;

    const params = [unionGeom.wkt];


    return { whereClause, params };
}

/**
 * 🚀 PERFORMANCE OPTIMIZATION: Smart spatial filter selection
 * Automatically chooses the best filtering strategy based on table structure
 */
async function generateSmartSpatialFilter(microGrids = [], tableName = '') {
    if (microGrids.length === 0) {
        return { whereClause: '', params: [] };
    }

    // 🚀 SMART DETECTION: Tables with direct micro grid relationships
    const directIdTables = [
        'cmhk_grid_problemdb',
        'cmhk_grid_discovery_four_quadrants_combined_after',
        'cmhk_grid_drive_test_four_quadrants_nr',
        'cmhk_grid_highload',
        'cmhk_grid_simulation_weak'
    ];

    // Check if this table likely has direct micro grid ID relationships
    const hasDirectIds = directIdTables.some(table => tableName.includes(table));

    if (hasDirectIds) {
        // Use direct ID filtering for maximum performance
        return generateOptimizedSpatialFilter(microGrids);
    } else {
        // Use bounds-based filtering for tables without direct relationships
        return await generateBoundsBasedSpatialFilter(microGrids);
    }
}

/**
 * 🚀 PERFORMANCE OPTIMIZATION: Hierarchical cache key generation
 * Creates stable cache keys that improve hit rates
 */
function generateHierarchicalCacheKey(baseKey, microGrids = [], zoom = 0) {
    if (microGrids.length === 0) {
        return baseKey;
    }

    // Sort micro grids for consistent cache keys
    const sortedGrids = [...microGrids].sort((a, b) => a - b);

    // 🚀 ZOOM-AWARE CACHING: Different cache strategies based on zoom level
    if (zoom <= 12) {
        // Low zoom: cache by micro grid groups (for regional overview)
        const gridGroups = Math.ceil(sortedGrids.length / 5); // Group every 5 micro grids
        return `${baseKey}_regional_${gridGroups}_${sortedGrids[0]}_${sortedGrids[sortedGrids.length - 1]}`;
    } else if (zoom <= 15) {
        // Medium zoom: cache by individual micro grids
        return `${baseKey}_detailed_${sortedGrids.join('_')}`;
    } else {
        // High zoom: cache includes full micro grid list
        return `${baseKey}_precise_${sortedGrids.join('_')}`;
    }
}

// ********************************************************************* //
// 地图数据 结束
// ********************************************************************* //

// ********************************************************************* //
// 🚀 NEW: 競對站點 () Data Endpoints
// ********************************************************************* //

const fs = require('fs');

// 🚀 PERFORMANCE: Lazy loading of GeoJSON files
let competitiveSitesData = {
    hkt4g_1800: null,
    hkt4g_900: null,
    hkt2025_sites: null,
    hut_sites: null,
    smt_sites: null,
    h3_sites: null
};

/**
 * 🚀 REDIS: Load GeoJSON file with error handling and caching
 * Uses Redis cache with 1-hour TTL to avoid repeated file I/O
 */
async function loadCompetitiveSiteData(filename) {
    const cacheKey = `geojson_${filename}`;

    // Check Redis cache first
    const cached = await redisCache.get(cacheKey);
    if (cached) {
        console.log(`✅ [Competitive Sites] Redis HIT: ${filename}`);
        return cached;
    }

    console.log(`❌ [Competitive Sites] Redis MISS: ${filename} - loading from disk`);

    try {
        // 🌐 Compatibility: Support both deployment structures
        let possiblePaths;

        // Special handling for H3 sites - different folder structure
        if (filename === 'h3_sites') {
            possiblePaths = [
                path.join(__dirname, 'H3 Sites', 'all_layers.geojson'),          // If H3 Sites is inside Backend
                path.join(__dirname, '..', 'H3 Sites', 'all_layers.geojson')    // Original path (sibling to Backend)             // Direct path in project root
            ];
        } else {
            possiblePaths = [
                path.join(__dirname, 'CompetitiveSites', `${filename}.geojson`),          // If CompetitiveSites is inside Backend
                path.join(__dirname, '..', 'CompetitiveSites', `${filename}.geojson`)     // Original path (sibling to Backend)
            ];
        }

        const filePath = possiblePaths.find(p => fs.existsSync(p));
        if (!filePath) {
            throw new Error(`GeoJSON file for ${filename} not found in expected locations`);
        }

        const rawData = fs.readFileSync(filePath, 'utf8');
        const geoData = JSON.parse(rawData);

        // Validate GeoJSON structure
        if (!geoData.type || geoData.type !== 'FeatureCollection' || !Array.isArray(geoData.features)) {
            throw new Error(`Invalid GeoJSON format in ${filename}`);
        }

        // Cache the data in Redis (1 hour TTL - files rarely change)
        await redisCache.set(cacheKey, geoData, 3600);
        console.log(`💾 [Competitive Sites] Stored in Redis: ${filename} (${geoData.features.length} features)`);

        return geoData;
    } catch (error) {
        console.error(`🚨 Error loading ${filename}:`, error.message);
        return {
            type: 'FeatureCollection',
            features: [],
            error: `Failed to load ${filename}: ${error.message}`
        };
    }
}

/**
 * 🚀 PERFORMANCE: Spatial filtering for competitive sites based on micro grids and districts
 */
async function filterCompetitiveSitesSpatially(features, microGrids = [], districts = []) {
    if (microGrids.length === 0 && districts.length === 0) {
        return features; // Return all if no spatial filter
    }

    try {
        // 🚀 FIX: Use ST_Intersects with actual micro grid geometry (same approach as planning_sites and live_sites)
        if (microGrids.length > 0) {
            console.log(`🔍 [filterCompetitiveSitesSpatially] Applying spatial filter for microgrids: ${microGrids.join(',')}`);

            // Parse micro grid IDs
            const microGridArray = microGrids.map(id => {
                const parsed = parseInt(id, 10);
                return isNaN(parsed) ? null : parsed;
            }).filter(id => id !== null);

            if (microGridArray.length === 0) {
                console.warn('⚠️ [filterCompetitiveSitesSpatially] No valid micro grid IDs');
                return features;
            }

            // STEP 1: Query actual geometries from cmhk_grid_data database (pool)
            const microGridPlaceholders = microGridArray.map((_, index) => `$${index + 1}`).join(',');
            const geomQuery = `
                SELECT ST_AsText(ST_Union(ST_Transform(geom, 4326))) as union_geom
                FROM public.micro_grid
                WHERE id IN (${microGridPlaceholders})
            `;
            const geomResult = await pool.query(geomQuery, microGridArray);

            if (geomResult.rows.length > 0 && geomResult.rows[0].union_geom) {
                const unionGeomWKT = geomResult.rows[0].union_geom;

                // STEP 2: Filter features using PostGIS ST_Intersects for accurate spatial filtering
                // 🚀 POLYGON FIX: Separate Point and Polygon features for proper handling

                // Separate features by geometry type
                const validFeatures = features.filter(f => f.geometry && f.geometry.coordinates);
                if (validFeatures.length === 0) {
                    return [];
                }

                const pointFeatures = [];
                const polygonFeatures = [];

                validFeatures.forEach((f, idx) => {
                    if (f.geometry.type === 'Point') {
                        pointFeatures.push({ feature: f, originalIndex: idx });
                    } else if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
                        polygonFeatures.push({ feature: f, originalIndex: idx });
                    }
                });

                const validIndices = new Set();

                // Process Point features (original logic)
                if (pointFeatures.length > 0) {
                    const pointValues = pointFeatures.map((item, idx) =>
                        `($${idx * 2 + 1}, $${idx * 2 + 2}, ${idx})`
                    ).join(', ');

                    const pointParams = pointFeatures.flatMap(item => [
                        item.feature.geometry.coordinates[0],
                        item.feature.geometry.coordinates[1]
                    ]);
                    pointParams.push(unionGeomWKT);

                    const batchIntersectQuery = `
                        WITH points AS (
                            SELECT
                                ST_SetSRID(ST_MakePoint(lon::double precision, lat::double precision), 4326) as geom,
                                idx::integer
                            FROM (VALUES ${pointValues}) AS v(lon, lat, idx)
                        )
                        SELECT idx
                        FROM points
                        WHERE ST_Intersects(geom, ST_GeomFromText($${pointParams.length}, 4326))
                    `;

                    const intersectResult = await pool.query(batchIntersectQuery, pointParams);
                    intersectResult.rows.forEach(row => {
                        const originalIdx = pointFeatures[row.idx].originalIndex;
                        validIndices.add(originalIdx);
                    });
                }

                // 🚀 NEW: Process Polygon features using ST_Intersects with polygon geometry
                if (polygonFeatures.length > 0) {
                    // Helper function to convert GeoJSON polygon coordinates to WKT
                    const coordsToWKT = (coords) => {
                        if (!coords || coords.length === 0) return null;
                        // For Polygon: coords is array of rings [[x,y], [x,y], ...]
                        // For MultiPolygon: coords is array of polygons [[[x,y], [x,y], ...], ...]
                        const rings = coords.map(ring => {
                            const points = ring.map(coord => `${coord[0]} ${coord[1]}`).join(', ');
                            return `(${points})`;
                        }).join(', ');
                        return `POLYGON(${rings})`;
                    };

                    // Check each polygon for intersection
                    for (const item of polygonFeatures) {
                        try {
                            let polygonWKT;
                            if (item.feature.geometry.type === 'Polygon') {
                                polygonWKT = coordsToWKT(item.feature.geometry.coordinates);
                            } else if (item.feature.geometry.type === 'MultiPolygon') {
                                // For MultiPolygon, check if any polygon intersects
                                // Convert to MULTIPOLYGON WKT
                                const polygons = item.feature.geometry.coordinates.map(coords => {
                                    const rings = coords.map(ring => {
                                        const points = ring.map(coord => `${coord[0]} ${coord[1]}`).join(', ');
                                        return `(${points})`;
                                    }).join(', ');
                                    return `(${rings})`;
                                }).join(', ');
                                polygonWKT = `MULTIPOLYGON(${polygons})`;
                            }

                            if (polygonWKT) {
                                const intersectQuery = `
                                    SELECT ST_Intersects(
                                        ST_GeomFromText($1, 4326),
                                        ST_GeomFromText($2, 4326)
                                    ) as intersects
                                `;
                                const result = await pool.query(intersectQuery, [polygonWKT, unionGeomWKT]);
                                if (result.rows[0].intersects) {
                                    validIndices.add(item.originalIndex);
                                }
                            }
                        } catch (err) {
                            console.warn(`⚠️ Error checking polygon intersection: ${err.message}`);
                        }
                    }
                }

                // Filter features based on results
                const filteredFeatures = validFeatures.filter((_, idx) => validIndices.has(idx));

                console.log(`✅ [filterCompetitiveSitesSpatially] Filtered from ${features.length} to ${filteredFeatures.length} sites (${pointFeatures.length} points, ${polygonFeatures.length} polygons)`);
                return filteredFeatures;
            } else {
                console.warn('⚠️ [filterCompetitiveSitesSpatially] No geometry found for micro grids');
                return features;
            }
        } else if (districts.length > 0) {
            // 🚀 FIX: Use ST_Intersects with actual district geometry (same approach as micro grids)
            console.log(`🔍 [filterCompetitiveSitesSpatially] Applying spatial filter for districts: ${districts.join(',')}`);

            // Get the union geometry for all selected districts
            const unionGeomWKT = await getDistrictUnion(districts);

            if (!unionGeomWKT) {
                console.warn('⚠️ [filterCompetitiveSitesSpatially] No geometry found for districts');
                return features;
            }

            // Filter features using PostGIS ST_Intersects for accurate spatial filtering
            // 🚀 POLYGON FIX: Separate Point and Polygon features for proper handling
            const validFeatures = features.filter(f => f.geometry && f.geometry.coordinates);
            if (validFeatures.length === 0) {
                return [];
            }

            const pointFeatures = [];
            const polygonFeatures = [];

            validFeatures.forEach((f, idx) => {
                if (f.geometry.type === 'Point') {
                    pointFeatures.push({ feature: f, originalIndex: idx });
                } else if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
                    polygonFeatures.push({ feature: f, originalIndex: idx });
                }
            });

            const validIndices = new Set();

            // Process Point features (original logic)
            if (pointFeatures.length > 0) {
                const pointValues = pointFeatures.map((item, idx) =>
                    `($${idx * 2 + 1}, $${idx * 2 + 2}, ${idx})`
                ).join(', ');

                const pointParams = pointFeatures.flatMap(item => [
                    item.feature.geometry.coordinates[0],
                    item.feature.geometry.coordinates[1]
                ]);
                pointParams.push(unionGeomWKT);

                const batchIntersectQuery = `
                    WITH points AS (
                        SELECT
                            ST_SetSRID(ST_MakePoint(lon::double precision, lat::double precision), 4326) as geom,
                            idx::integer
                        FROM (VALUES ${pointValues}) AS v(lon, lat, idx)
                    )
                    SELECT idx
                    FROM points
                    WHERE ST_Intersects(geom, ST_GeomFromText($${pointParams.length}, 4326))
                `;

                const intersectResult = await hkmapPool.query(batchIntersectQuery, pointParams);
                intersectResult.rows.forEach(row => {
                    const originalIdx = pointFeatures[row.idx].originalIndex;
                    validIndices.add(originalIdx);
                });
            }

            // 🚀 NEW: Process Polygon features using ST_Intersects with polygon geometry
            if (polygonFeatures.length > 0) {
                // Helper function to convert GeoJSON polygon coordinates to WKT
                const coordsToWKT = (coords) => {
                    if (!coords || coords.length === 0) return null;
                    const rings = coords.map(ring => {
                        const points = ring.map(coord => `${coord[0]} ${coord[1]}`).join(', ');
                        return `(${points})`;
                    }).join(', ');
                    return `POLYGON(${rings})`;
                };

                // Check each polygon for intersection
                for (const item of polygonFeatures) {
                    try {
                        let polygonWKT;
                        if (item.feature.geometry.type === 'Polygon') {
                            polygonWKT = coordsToWKT(item.feature.geometry.coordinates);
                        } else if (item.feature.geometry.type === 'MultiPolygon') {
                            const polygons = item.feature.geometry.coordinates.map(coords => {
                                const rings = coords.map(ring => {
                                    const points = ring.map(coord => `${coord[0]} ${coord[1]}`).join(', ');
                                    return `(${points})`;
                                }).join(', ');
                                return `(${rings})`;
                            }).join(', ');
                            polygonWKT = `MULTIPOLYGON(${polygons})`;
                        }

                        if (polygonWKT) {
                            const intersectQuery = `
                                SELECT ST_Intersects(
                                    ST_GeomFromText($1, 4326),
                                    ST_GeomFromText($2, 4326)
                                ) as intersects
                            `;
                            const result = await hkmapPool.query(intersectQuery, [polygonWKT, unionGeomWKT]);
                            if (result.rows[0].intersects) {
                                validIndices.add(item.originalIndex);
                            }
                        }
                    } catch (err) {
                        console.warn(`⚠️ Error checking polygon intersection: ${err.message}`);
                    }
                }
            }

            // Filter features based on results
            const filteredFeatures = validFeatures.filter((_, idx) => validIndices.has(idx));

            console.log(`✅ [filterCompetitiveSitesSpatially] Filtered from ${features.length} to ${filteredFeatures.length} sites (${pointFeatures.length} points, ${polygonFeatures.length} polygons, districts)`);
            return filteredFeatures;
        }

        return features;
    } catch (error) {
        console.error('🚨 Error in spatial filtering:', error.message);
        return features; // Return all features on error
    }
}

/**
 * 🚀 REDIS: Get district union geometry (actual geometry, not bounding box)
 * Uses Redis cache with 30-minute TTL for expensive PostGIS ST_Union results
 */
async function getDistrictUnion(districts) {
    if (!districts || districts.length === 0) {
        return null;
    }

    const cacheKey = `spatial_district_union_${districts.sort().join('_')}`;

    // Check Redis cache first
    const cached = await redisCache.get(cacheKey);
    if (cached) {
        console.log(`✅ [District Union] Redis HIT: ${cacheKey}`);
        return cached;
    }

    console.log(`❌ [District Union] Redis MISS: ${cacheKey} - querying PostGIS`);

    try {
        // Query district union geometry from hkmap database
        const districtPlaceholders = districts.map((_, index) => `$${index + 1}`).join(',');
        const query = `
            SELECT ST_AsText(ST_Union(geom)) as union_geom
            FROM hk_district_boundary
            WHERE name_en IN (${districtPlaceholders}) OR name_zh IN (${districtPlaceholders})
        `;

        const result = await hkmapPool.query(query, districts);

        if (result.rows.length > 0 && result.rows[0].union_geom) {
            const unionGeomWKT = result.rows[0].union_geom;

            // Cache the result in Redis (30 minutes TTL)
            await redisCache.set(cacheKey, unionGeomWKT, 1800);
            console.log(`💾 [District Union] Stored in Redis: ${cacheKey}`);
            return unionGeomWKT;
        }
    } catch (error) {
        console.error('🚨 Error fetching district union geometry:', error.message);
    }

    return null;
}


// 🚀 ENDPOINT: Competitive Sites Data - Single File (with indoor/outdoor filtering)
// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/competitive_sites/:filename', async (req, res) => {
    const { filename } = req.params;
    const { renderingMode = 'global', microGrids, districts, categories } = req.query;

    console.log(`🔍 [Competitive Sites Single] Request for ${filename}`);
    console.log(`🔍 [Competitive Sites Single] renderingMode: ${renderingMode}`);
    console.log(`🔍 [Competitive Sites Single] microGrids: ${microGrids || 'none'}`);
    console.log(`🔍 [Competitive Sites Single] districts: ${districts || 'none'}`);
    console.log(`🔍 [Competitive Sites Single] categories: ${categories || 'none'}`);

    // Validate filename
    const validFiles = ['hkt4g_1800', 'hkt4g_900', 'hkt2025_sites', 'hut_sites', 'smt_sites', 'h3_sites'];
    if (!validFiles.includes(filename)) {
        return res.status(400).json({
            error: 'Invalid filename',
            validFiles
        });
    }

    try {
        // Generate cache key based on all parameters
        const cacheKey = `competitive_sites_single_${filename}_${renderingMode}_${microGrids || 'none'}_${districts || 'none'}_${categories || 'none'}`;
        console.log(`🔍 [Competitive Sites Single] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);

        // Check Redis cache
        const cached = await redisCache.get(cacheKey);

        if (cached) {
            res.setHeader('X-Cache', 'HIT-REDIS');
            console.log(`✅ [Competitive Sites Single] REDIS HIT! Returning cached data for ${filename}`);
            return res.json(cached);
        }

        console.log(`❌ [Competitive Sites Single] REDIS MISS - Will process data and store in Redis`);

        // Load the data
        let geoData = await loadCompetitiveSiteData(filename);

        if (geoData.error) {
            return res.status(500).json(geoData);
        }

        let features = geoData.features || [];
        console.log(`🔍 [Competitive Sites Single] Loaded ${features.length} features from file`);

        // Apply spatial filtering if in spatial mode
        if (renderingMode === 'spatial') {
            const microGridArray = microGrids ? microGrids.split(',').filter(g => g.trim()) : [];
            const districtArray = districts ? districts.split(',').filter(d => d.trim()) : [];

            console.log(`🔍 [Competitive Sites Single] Applying spatial filtering with microGrids: [${microGridArray.join(', ')}]`);
            const beforeFilterCount = features.length;
            features = await filterCompetitiveSitesSpatially(features, microGridArray, districtArray);
            console.log(`✅ [Competitive Sites Single] After filtering: ${features.length} features (from ${beforeFilterCount})`);
        }

        // Apply category filtering (indoor/outdoor) if specified
        if (categories) {
            const categoryArray = categories.split(',').filter(c => c.trim()).map(c => c.toLowerCase());
            if (categoryArray.length > 0) {

                features = features.filter(feature => {
                    if (!feature.properties) return false;

                    let featureCategory;
                    if (filename === 'hkt2025_sites') {
                        // For hkt2025_sites, use "Site Type" property
                        featureCategory = feature.properties['Site Type'];
                    } else if (filename === 'smt_sites') {
                        // For smt_sites, use "TYPE" property
                        featureCategory = feature.properties['TYPE'];
                    } else if (filename === 'hut_sites') {
                        // For hut_sites, use "sitetype" property
                        featureCategory = feature.properties['sitetype'];
                    } else {
                        // For hkt4g_1800 and hkt4g_900, use "coveragetype" property
                        featureCategory = feature.properties['coveragetype'];
                    }

                    if (!featureCategory) return false;

                    return categoryArray.includes(featureCategory.toLowerCase());
                });

            }
        }

        // Generate response
        const response = {
            type: 'FeatureCollection',
            features,
            metadata: {
                filename,
                totalFeatures: features.length,
                renderingMode,
                timestamp: new Date().toISOString()
            }
        };

        // Store in Redis with 300s TTL
        console.log(`💾 [Competitive Sites Single] Storing data in Redis...`);
        const redisStored = await redisCache.set(cacheKey, response, 300);
        if (redisStored) {
            console.log(`✅ [Competitive Sites Single] Successfully stored in Redis with 300s TTL`);
        }

        // Set appropriate headers
        res.set({
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
            'X-Cache': 'MISS'
        });

        res.json(response);
    } catch (error) {
        console.error(`🚨 Error serving competitive sites ${filename}:`, error.message);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
// 🚀 ENDPOINT: All Competitive Sites Data - Combined
app.get('/competitive_sites', async (req, res) => {
    const { renderingMode = 'global', microGrids, districts, files, categories } = req.query;


    try {
        const requestedFiles = files ? files.split(',') : ['hkt4g_1800', 'hkt4g_900', 'hkt2025_sites', 'hut_sites', 'smt_sites', 'h3_sites'];
        const validFiles = ['hkt4g_1800', 'hkt4g_900', 'hkt2025_sites', 'hut_sites', 'smt_sites', 'h3_sites'];

        // Filter to only valid files
        const filesToLoad = requestedFiles.filter(f => validFiles.includes(f));

        if (filesToLoad.length === 0) {
            return res.status(400).json({
                error: 'No valid files specified',
                validFiles
            });
        }

        // Generate cache key based on all parameters
        const filesKey = filesToLoad.sort().join(','); // Sort to ensure consistent cache keys
        const cacheKey = `competitive_sites_combined_${filesKey}_${renderingMode}_${microGrids || 'none'}_${districts || 'none'}_${categories || 'none'}`;
        console.log(`🔍 [Competitive Sites Combined] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);

        // Check Redis cache
        const cached = await redisCache.get(cacheKey);

        if (cached) {
            res.setHeader('X-Cache', 'HIT-REDIS');
            console.log(`✅ [Competitive Sites Combined] REDIS HIT! Returning cached data`);
            return res.json(cached);
        }

        console.log(`❌ [Competitive Sites Combined] REDIS MISS - Will process data and store in Redis`);

        const combinedFeatures = [];
        const loadResults = {};

        // Load each file
        for (const filename of filesToLoad) {
            const geoData = await loadCompetitiveSiteData(filename);

            if (geoData.error) {
                loadResults[filename] = { error: geoData.error, features: 0 };
                continue;
            }

            let features = geoData.features || [];

            // Apply spatial filtering if in spatial mode
            if (renderingMode === 'spatial') {
                const microGridArray = microGrids ? microGrids.split(',').filter(g => g.trim()) : [];
                const districtArray = districts ? districts.split(',').filter(d => d.trim()) : [];

                features = await filterCompetitiveSitesSpatially(features, microGridArray, districtArray);
            }

            // Apply category filtering (indoor/outdoor) if specified
            if (categories) {
                const categoryArray = categories.split(',').filter(c => c.trim()).map(c => c.toLowerCase());
                if (categoryArray.length > 0) {

                    features = features.filter(feature => {
                        if (!feature.properties) return false;

                        let featureCategory;
                        if (filename === 'hkt2025_sites') {
                            // For hkt2025_sites, use "Site Type" property
                            featureCategory = feature.properties['Site Type'];
                        } else if (filename === 'smt_sites') {
                            // For smt_sites, use "TYPE" property
                            featureCategory = feature.properties['TYPE'];
                        } else if (filename === 'hut_sites') {
                            // For hut_sites, use "sitetype" property
                            featureCategory = feature.properties['sitetype'];
                        } else {
                            // For hkt4g_1800 and hkt4g_900, use "coveragetype" property
                            featureCategory = feature.properties['coveragetype'];
                        }

                        if (!featureCategory) return false;

                        return categoryArray.includes(featureCategory.toLowerCase());
                    });

                }
            }

            // Add source information to each feature
            features.forEach(feature => {
                feature.properties = {
                    ...feature.properties,
                    __source_file: filename,
                    __competitive_site: true
                };
            });

            combinedFeatures.push(...features);
            loadResults[filename] = { features: features.length };
        }

        // Generate response
        const response = {
            type: 'FeatureCollection',
            features: combinedFeatures,
            metadata: {
                totalFeatures: combinedFeatures.length,
                renderingMode,
                loadResults,
                timestamp: new Date().toISOString()
            }
        };

        // Store in Redis with 300s TTL
        console.log(`💾 [Competitive Sites Combined] Storing data in Redis...`);
        const redisStored = await redisCache.set(cacheKey, response, 300);
        if (redisStored) {
            console.log(`✅ [Competitive Sites Combined] Successfully stored in Redis with 300s TTL`);
        }

        // Set appropriate headers
        res.set({
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
            'X-Cache': 'MISS'
        });

        res.json(response);
    } catch (error) {
        console.error('🚨 Error serving combined competitive sites:', error.message);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

// 🚀 ENDPOINT: Competitive Sites Metadata
app.get('/competitive_sites_metadata', (req, res) => {
    const metadata = {
        availableFiles: [
            {
                id: 'hkt4g_1800',
                name: 'HKT LTE 1800MHz',
                description: 'HKT LTE sites on 1800MHz frequency (freq: 3)',
                properties: ['eNodeBName', 'freq', 'Site_Location', 'lat1', 'lon1', 'coveragetype']
            },
            {
                id: 'hkt4g_900',
                name: 'HKT LTE 900MHz',
                description: 'HKT LTE sites on 900MHz frequency (freq: 8)',
                properties: ['eNodeBName', 'freq', 'Site_Location', 'lat1', 'lon1', 'coveragetype']
            },
            {
                id: 'hkt2025_sites',
                name: 'HKT 2025 Sites',
                description: 'HKT sites with 2025 planning data including multiple frequency bands',
                properties: ['行标签', 'N78', 'N79', 'N1', 'lat1', 'lon1', 'Site Type']
            },
            {
                id: 'h3_sites',
                name: 'H3 Sites',
                description: 'H3 competitor sites with hexagonal grid representation and signal strength categorization',
                properties: ['name', 'description', 'color', 'tessellate', 'visibility']
            }
        ],
        renderingModes: [
            {
                mode: 'global',
                description: 'Render all sites across Hong Kong map'
            },
            {
                mode: 'spatial',
                description: 'Render sites only within selected micro grids or districts'
            }
        ],
        supportedFilters: ['microGrids', 'districts'],
        timestamp: new Date().toISOString()
    };

    res.json(metadata);
});

// ******************************************************************* //
// 競對站點 結束
// ******************************************************************* //

// ********************************************************************* //
// 投訴數據API端點 開始
// ********************************************************************* //

// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
// 🚀 NEW: Complaint Trend Data API for dashboard visualization
app.get('/api/complaint-trend', async (req, res) => {
    try {
        const { mode = 'hongkong', grid_id, grid_ids, grid_name, grid_names, detail_mode, data_source = 'weak_coverage' } = req.query;

        // Generate cache key based on all parameters including data_source
        const cacheKey = `complaint_trend_${mode}_${grid_id || 'none'}_${grid_ids || 'none'}_${grid_name || 'none'}_${grid_names || 'none'}_${detail_mode || 'none'}_${data_source}`;
        console.log(`🔍 [Complaint Trend] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);

        // Check Redis cache
        const cached = await redisCache.get(cacheKey);

        if (cached) {
            res.setHeader('X-Cache', 'HIT-REDIS');
            console.log(`✅ [Complaint Trend] REDIS HIT! Returning cached data`);
            return res.json(cached);
        }

        console.log(`❌ [Complaint Trend] REDIS MISS - Will query database and store in Redis`);

        // 🚀 Determine table and column names based on data_source
        const tableName = data_source === 'general' 
            ? 'micro_grid.micro_grid_gerenal_table' 
            : 'micro_grid.weak_coverage_complaint';
        
        const countColumn = data_source === 'general' 
            ? 'total_complaint' 
            : 'count';
        
        const idColumn = data_source === 'general' 
            ? 'id' 
            : 'micro_grid_id';

        console.log(`📊 [Complaint Trend] Using data source: ${data_source}, table: ${tableName}`);

        let query, params = [];

        if (mode === 'hongkong') {
            // 全港模式：按月份統計所有微網格的投訴總數
            query = `
                SELECT 
                    month,
                    SUM(${countColumn}) as total_count,
                    COUNT(DISTINCT ${idColumn}) as affected_grids
                FROM ${tableName}
                WHERE ${countColumn} > 0
                GROUP BY month 
                ORDER BY month
            `;
        } else if (mode === 'microgrid' && (grid_id || grid_name)) {
            // 單個微網格模式：顯示特定微網格的月度投訴數據
            if (grid_name) {
                query = `
                    SELECT 
                        month,
                        ${idColumn} as micro_grid_id,
                        grid_name,
                        ${countColumn} as count
                    FROM ${tableName}
                    WHERE grid_name = $1 
                        AND ${countColumn} > 0
                    ORDER BY month
                `;
                params = [grid_name];
            } else {
                query = `
                    SELECT 
                        month,
                        ${idColumn} as micro_grid_id,
                        grid_name,
                        ${countColumn} as count
                    FROM ${tableName}
                    WHERE ${idColumn} = $1 
                        AND ${countColumn} > 0
                    ORDER BY month
                `;
                params = [parseInt(grid_id)];
            }
        } else if (mode === 'selected' && (grid_ids || grid_names)) {
            // 🚀 NEW: 選定微網格模式：根據選定的微網格ID列表或名稱列表進行聚合
            if (grid_names) {
                // 使用網格名稱查詢
                const gridNameArray = grid_names.split(',').map(name => name.trim()).filter(name => name.length > 0);

                if (gridNameArray.length === 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid grid_names parameter',
                        message: 'No valid grid names provided'
                    });
                }

                if (gridNameArray.length === 1) {
                    // 單個微網格：顯示詳細數據
                    query = `
                        SELECT 
                            month,
                            ${idColumn} as micro_grid_id,
                            grid_name,
                            ${countColumn} as count,
                            'single' as aggregation_type
                        FROM ${tableName}
                        WHERE grid_name = $1 
                            AND ${countColumn} > 0
                        ORDER BY month
                    `;
                    params = [gridNameArray[0]];
                } else {
                    // 多個微網格：根據detail_mode決定是否聚合
                    const placeholders = gridNameArray.map((_, index) => `$${index + 1}`).join(',');

                    if (detail_mode === 'true' || detail_mode === '1') {
                        // 🚀 NEW: Detail mode - Return individual grid data (not aggregated)
                        query = `
                            SELECT
                                month,
                                ${idColumn} as micro_grid_id,
                                grid_name,
                                ${countColumn} as count,
                                'multiple_detail' as aggregation_type
                            FROM ${tableName}
                            WHERE grid_name IN (${placeholders})
                                AND ${countColumn} > 0
                            ORDER BY month, grid_name
                        `;
                    } else {
                        // Original: Aggregated mode - Sum complaints across all grids
                        query = `
                            SELECT
                                month,
                                SUM(${countColumn}) as total_count,
                                COUNT(DISTINCT ${idColumn}) as affected_grids,
                                COUNT(*) as total_records,
                                ARRAY_AGG(DISTINCT grid_name ORDER BY grid_name) as grid_names,
                                'multiple' as aggregation_type
                            FROM ${tableName}
                            WHERE grid_name IN (${placeholders})
                                AND ${countColumn} > 0
                            GROUP BY month
                            ORDER BY month
                        `;
                    }
                    params = gridNameArray;
                }
            } else if (grid_ids) {
                // 使用網格ID查詢（保持向後兼容）
                const gridIdArray = grid_ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

                if (gridIdArray.length === 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid grid_ids parameter',
                        message: 'No valid grid IDs provided'
                    });
                }

                if (gridIdArray.length === 1) {
                    // 單個微網格：顯示詳細數據
                    query = `
                        SELECT 
                            month,
                            ${idColumn} as micro_grid_id,
                            grid_name,
                            ${countColumn} as count,
                            'single' as aggregation_type
                        FROM ${tableName}
                        WHERE ${idColumn} = $1 
                            AND ${countColumn} > 0
                        ORDER BY month
                    `;
                    params = [gridIdArray[0]];
                } else {
                    // 多個微網格：根據detail_mode決定是否聚合
                    const placeholders = gridIdArray.map((_, index) => `$${index + 1}`).join(',');

                    if (detail_mode === 'true' || detail_mode === '1') {
                        // 🚀 NEW: Detail mode - Return individual grid data (not aggregated)
                        query = `
                            SELECT
                                month,
                                ${idColumn} as micro_grid_id,
                                grid_name,
                                ${countColumn} as count,
                                'multiple_detail' as aggregation_type
                            FROM ${tableName}
                            WHERE ${idColumn} IN (${placeholders})
                                AND ${countColumn} > 0
                            ORDER BY month, grid_name
                        `;
                    } else {
                        // Original: Aggregated mode - Sum complaints across all grids
                        query = `
                            SELECT
                                month,
                                SUM(${countColumn}) as total_count,
                                COUNT(DISTINCT ${idColumn}) as affected_grids,
                                COUNT(*) as total_records,
                                ARRAY_AGG(DISTINCT grid_name ORDER BY grid_name) as grid_names,
                                'multiple' as aggregation_type
                            FROM ${tableName}
                            WHERE ${idColumn} IN (${placeholders})
                                AND ${countColumn} > 0
                            GROUP BY month
                            ORDER BY month
                        `;
                    }
                    params = gridIdArray;
                }
            }
        } else {
            return res.status(400).json({
                success: false,
                error: 'Invalid parameters',
                message: 'Mode must be "hongkong", "microgrid" with grid_id/grid_name, or "selected" with grid_ids/grid_names'
            });
        }

        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return res.json({
                success: true,
                mode,
                data: [],
                message: 'No complaint data found for the specified criteria'
            });
        }

        // 格式化數據
        const formattedData = result.rows.map(row => {
            // 轉換月份格式 YYYYMM -> YYYY-MM with validation
            const monthStr = row.month.toString();

            // Validate month format
            if (monthStr.length !== 6 || isNaN(monthStr)) {
                console.warn(`⚠️ Invalid month format: ${monthStr}, skipping record`);
                return null; // Will be filtered out below
            }

            const year = monthStr.substring(0, 4);
            const month = monthStr.substring(4, 6);
            const formattedMonth = `${year}-${month}`;

            if (mode === 'hongkong') {
                return {
                    month: formattedMonth,
                    month_raw: row.month,
                    total_count: parseInt(row.total_count),
                    affected_grids: parseInt(row.affected_grids)
                };
            } else if (mode === 'selected' && row.aggregation_type === 'multiple') {
                return {
                    month: formattedMonth,
                    month_raw: row.month,
                    total_count: parseInt(row.total_count),
                    affected_grids: parseInt(row.affected_grids),
                    total_records: parseInt(row.total_records),
                    grid_names: row.grid_names,
                    aggregation_type: row.aggregation_type
                };
            } else {
                return {
                    month: formattedMonth,
                    month_raw: row.month,
                    micro_grid_id: row.micro_grid_id,
                    grid_name: row.grid_name,
                    count: parseInt(row.count),
                    aggregation_type: row.aggregation_type || 'single'
                };
            }
        }).filter(row => row !== null); // Filter out invalid records

        const responseData = {
            success: true,
            mode,
            grid_id: grid_id || null,
            grid_ids: grid_ids || null,
            grid_name: grid_name || null,
            grid_names: grid_names || null,
            data_source: data_source, // 🚀 NEW: Include data source in response
            data: formattedData,
            total_records: formattedData.length,
            timestamp: new Date().toISOString()
        };

        // Store in Redis with 300s TTL
        console.log(`💾 [Complaint Trend] Storing data in Redis...`);
        const redisStored = await redisCache.set(cacheKey, responseData, 300);
        if (redisStored) {
            console.log(`✅ [Complaint Trend] Successfully stored in Redis with 300s TTL`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(responseData);

    } catch (error) {
        console.error('🚨 Error fetching complaint trend data:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// ********************************************************************* //
// 投訴數據API端點 結束
// ********************************************************************* //




// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
app.get('/api/vol-trend', async (req, res) => {
    try {
        const { mode = 'hongkong', grid_id, grid_ids, grid_name, grid_names } = req.query;

        // Generate cache key based on all parameters
        const cacheKey = `vol_trend_${mode}_${grid_id || 'none'}_${grid_ids || 'none'}_${grid_name || 'none'}_${grid_names || 'none'}`;
        console.log(`🔍 [Vol Trend] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);

        // Check Redis cache
        const cached = await redisCache.get(cacheKey);

        if (cached) {
            res.setHeader('X-Cache', 'HIT-REDIS');
            console.log(`✅ [Vol Trend] REDIS HIT! Returning cached data`);
            return res.json(cached);
        }

        console.log(`❌ [Vol Trend] REDIS MISS - Will query database and store in Redis`);

        const currentDate = new Date();
        const lastYear = currentDate.getFullYear() - 1;
        let query, params = [`${lastYear}-01-01`];

        if (mode === 'hongkong') {
            // 全港模式：按月份統計所有微網格的投訴總數
            query = `
                SELECT 
                    TO_CHAR(month, 'YYYY-MM') as month,
                    SUM(lte_vol_gb) as lte_vol_gb,
                    SUM(nr_vol_gb) as nr_vol_gb,
                    SUM(nr_vol_gb)/(SUM(nr_vol_gb)+SUM(lte_vol_gb)) as nr_lte_ratio,
                    COUNT(DISTINCT grid_oldid) as affected_grids
                FROM micro_grid.micro_grid_monthly_vol
                WHERE month > $1
                GROUP BY month 
                ORDER BY month
            `;
        } else if (mode === 'microgrid' && (grid_id || grid_name)) {
            // 單個微網格模式：顯示特定微網格的月度投訴數據
            if (grid_name) {
                query = `
                    SELECT 
                        TO_CHAR(month, 'YYYY-MM') as month,
                        grid_oldid,
                        grid_name,
                        lte_vol_gb,
                        nr_vol_gb,
                        nr_lte_ratio
                    FROM micro_grid.micro_grid_monthly_vol 
                    WHERE grid_name = $1 and month > $2
                    ORDER BY month
                `;
                params.push(grid_name);
            } else {
                query = `
                    SELECT 
                        TO_CHAR(month, 'YYYY-MM') as month,
                        grid_oldid,
                        grid_name,
                        lte_vol_gb,
                        nr_vol_gb,
                        nr_lte_ratio
                    FROM micro_grid.micro_grid_monthly_vol 
                    WHERE grid_oldid = $2 and month > $1
                    ORDER BY month
                `;
                params.push(parseInt(grid_id));
            }
        } else if (mode === 'selected' && (grid_ids || grid_names)) {
            // 🚀 NEW: 選定微網格模式：根據選定的微網格ID列表或名稱列表進行聚合
            if (grid_names) {
                // 使用網格名稱查詢
                const gridNameArray = grid_names.split(',').map(name => name.trim()).filter(name => name.length > 0);

                if (gridNameArray.length === 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid grid_names parameter',
                        message: 'No valid grid names provided'
                    });
                }

                if (gridNameArray.length === 1) {
                    // 單個微網格：顯示詳細數據
                    query = `
                        SELECT 
                            TO_CHAR(month, 'YYYY-MM') as month,
                            grid_oldid,
                            grid_name,
                            SUM(lte_vol_gb) as lte_vol_gb,
                            SUM(nr_vol_gb) as nr_vol_gb,
                            SUM(nr_vol_gb)/(SUM(nr_vol_gb)+SUM(lte_vol_gb)) as nr_lte_ratio,
                            'single' as aggregation_type
                        FROM micro_grid.micro_grid_monthly_vol 
                        WHERE grid_name = $2 and month > $1
                        ORDER BY month
                    `;
                    params.push(gridNameArray[0]);
                } else {
                    // 多個微網格：按月份聚合投訴總數
                    const placeholders = gridNameArray.map((_, index) => `$${index + 1}`).join(',');
                    query = `
                        SELECT 
                            TO_CHAR(month, 'YYYY-MM') as month,
                            SUM(lte_vol_gb) as lte_vol_gb,
                            SUM(nr_vol_gb) as nr_vol_gb,
                            SUM(nr_vol_gb)/(SUM(nr_vol_gb)+SUM(lte_vol_gb)) as nr_lte_ratio,
                            COUNT(DISTINCT grid_oldid) as affected_grids,
                            COUNT(*) as total_records,
                            ARRAY_AGG(DISTINCT grid_name ORDER BY grid_name) as grid_names,
                            'multiple' as aggregation_type
                        FROM micro_grid.micro_grid_monthly_vol 
                        WHERE grid_name IN (${placeholders}) and month > $1
                        GROUP BY month 
                        ORDER BY month
                    `;
                }
            } else if (grid_ids) {
                // 使用網格ID查詢（保持向後兼容）
                const gridIdArray = grid_ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

                if (gridIdArray.length === 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid grid_ids parameter',
                        message: 'No valid grid IDs provided'
                    });
                }

                if (gridIdArray.length === 1) {
                    // 單個微網格：顯示詳細數據
                    query = `
                        SELECT 
                            TO_CHAR(month, 'YYYY-MM') as month,
                            grid_oldid,
                            grid_name,
                            SUM(lte_vol_gb) as lte_vol_gb,
                            SUM(nr_vol_gb) as nr_vol_gb,
                            SUM(nr_vol_gb)/(SUM(nr_vol_gb)+SUM(lte_vol_gb)) as nr_lte_ratio,
                            'single' as aggregation_type
                        FROM micro_grid.micro_grid_monthly_vol 
                        WHERE grid_oldid = $2 and month > $1
                            AND count > 0
                        ORDER BY month
                    `;
                    params.push(gridIdArray[0]);
                } else {
                    // 多個微網格：按月份聚合投訴總數
                    const placeholders = gridIdArray.map((_, index) => `$${index + 2}`).join(',');
                    query = `
                        SELECT 
                            TO_CHAR(month, 'YYYY-MM') as month,
                            SUM(lte_vol_gb) as lte_vol_gb,
                            SUM(nr_vol_gb) as nr_vol_gb,
                            SUM(nr_vol_gb)/(SUM(nr_vol_gb)+SUM(lte_vol_gb)) as nr_lte_ratio,
                            COUNT(DISTINCT grid_oldid) as affected_grids,
                            COUNT(*) as total_records,
                            ARRAY_AGG(DISTINCT grid_name ORDER BY grid_name) as grid_names,
                            'multiple' as aggregation_type
                        FROM micro_grid.micro_grid_monthly_vol 
                        WHERE grid_oldid IN (${placeholders}) and month > $1
                        GROUP BY month 
                        ORDER BY month
                    `;
                    params = params.concat(gridIdArray);
                }
            }
        } else {
            return res.status(400).json({
                success: false,
                error: 'Invalid parameters',
                message: 'Mode must be "hongkong", "microgrid" with grid_id/grid_name, or "selected" with grid_ids/grid_names'
            });
        }
        
        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return res.json({
                success: true,
                mode,
                data: [],
                message: 'No complaint data found for the specified criteria'
            });
        }

        // 格式化數據
        const formattedData = result.rows.map(row => {
            if (mode === 'hongkong') {
                return {
                    month: row.month,
                    lte_vol_gb: parseInt(row.lte_vol_gb),
                    nr_vol_gb: parseInt(row.nr_vol_gb),
                    nr_lte_ratio: parseInt(row.nr_lte_ratio*100),
                    affected_grids: parseInt(row.affected_grids)
                };
            } else if (mode === 'selected' && row.aggregation_type === 'multiple') {
                return {
                    month: row.month,
                    lte_vol_gb: parseInt(row.lte_vol_gb),
                    nr_vol_gb: parseInt(row.nr_vol_gb),
                    nr_lte_ratio: parseInt(row.nr_lte_ratio*100),
                    affected_grids: parseInt(row.affected_grids),
                    total_records: parseInt(row.total_records),
                    grid_names: row.grid_names,
                    aggregation_type: row.aggregation_type
                };
            } else {
                return {
                    month: row.month,
                    micro_grid_id: row.grid_oldid,
                    grid_name: row.grid_name,
                    lte_vol_gb: parseInt(row.lte_vol_gb),
                    nr_vol_gb: parseInt(row.nr_vol_gb),
                    nr_lte_ratio: parseInt(row.nr_lte_ratio*100),
                    aggregation_type: row.aggregation_type || 'single'
                };
            }
        }).filter(row => row !== null); // Filter out invalid records

        const responseData = {
            success: true,
            mode,
            grid_id: grid_id || null,
            grid_ids: grid_ids || null,
            grid_name: grid_name || null,
            grid_names: grid_names || null,
            data: formattedData,
            total_records: formattedData.length,
            timestamp: new Date().toISOString()
        };

        // Store in Redis with 300s TTL
        console.log(`💾 [Vol Trend] Storing data in Redis...`);
        const redisStored = await redisCache.set(cacheKey, responseData, 300);
        if (redisStored) {
            console.log(`✅ [Vol Trend] Successfully stored in Redis with 300s TTL`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(responseData);

    } catch (error) {
        console.error('🚨 Error fetching complaint trend data:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});




// ========================================================================
// 🚀 NEW: DBSCAN Clustering Analysis for Live Sites
// ========================================================================
const DBSCAN = require('density-clustering').DBSCAN;
const geolib = require('geolib');

// Manual DBSCAN implementation for geographic coordinates
function manualDBSCAN(coordinates, epsilon, minPoints) {
    const clusters = [];
    const visited = new Set();
    const clustered = new Set();

    for (let i = 0; i < coordinates.length; i++) {
        if (visited.has(i)) continue;

        visited.add(i);
        const neighbors = getNeighbors(coordinates, i, epsilon);

        // Include the core point itself in the count (neighbors + 1)
        if (neighbors.length + 1 < minPoints) {
            // Point is noise (will be handled later)
            continue;
        }

        // Start new cluster
        const cluster = [];
        expandCluster(coordinates, i, neighbors, cluster, clustered, visited, epsilon, minPoints);

        if (cluster.length >= minPoints) {
            clusters.push(cluster);
        }
    }

    return clusters;
}

function getNeighbors(coordinates, pointIndex, epsilon) {
    const neighbors = [];
    const point = coordinates[pointIndex];

    for (let i = 0; i < coordinates.length; i++) {
        if (i === pointIndex) continue;

        const distance = geolib.getDistance(
            { latitude: point[0], longitude: point[1] },
            { latitude: coordinates[i][0], longitude: coordinates[i][1] }
        );

        if (distance <= epsilon) {
            neighbors.push(i);
        }
    }

    return neighbors;
}

function expandCluster(coordinates, pointIndex, neighbors, cluster, clustered, visited, epsilon, minPoints) {
    cluster.push(pointIndex);
    clustered.add(pointIndex);

    for (let i = 0; i < neighbors.length; i++) {
        const neighborIndex = neighbors[i];

        if (!visited.has(neighborIndex)) {
            visited.add(neighborIndex);
            const neighborNeighbors = getNeighbors(coordinates, neighborIndex, epsilon);

            if (neighborNeighbors.length + 1 >= minPoints) {
                neighbors.push(...neighborNeighbors.filter(n => !neighbors.includes(n)));
            }
        }

        if (!clustered.has(neighborIndex)) {
            cluster.push(neighborIndex);
            clustered.add(neighborIndex);
        }
    }
}

// 🚀 REDIS ONLY: This endpoint uses Redis cache exclusively (no node-cache fallback)
// 🚀 DBSCAN Clustering Endpoint for Live Sites
app.get('/live_sites_clustering', async (req, res) => {
    const {
        site_types,
        districts,
        microGrids,
        epsilon = 600,         // Default: 800m radius for HK urban macro cell analysis
        min_points = 5,        // Default: minimum 4 points for high-density cluster identification
        distance_unit = 'meter' // Default: meter
    } = req.query;

    // Validate required parameters
    if (!site_types) {
        return res.status(400).json({
            error: 'site_types parameter is required for clustering analysis'
        });
    }

    try {
        // Generate cache key based on all parameters
        const cacheKey = `live_sites_clustering_${site_types}_${districts || 'none'}_${microGrids || 'none'}_${epsilon}_${min_points}_${distance_unit}`;
        console.log(`🔍 [Live Sites Clustering] Checking Redis for key: ${cacheKey.substring(0, 60)}...`);

        // Check Redis cache
        const cached = await redisCache.get(cacheKey);

        if (cached) {
            res.setHeader('X-Cache', 'HIT-REDIS');
            console.log(`✅ [Live Sites Clustering] REDIS HIT! Returning cached data`);
            return res.json(cached);
        }

        console.log(`❌ [Live Sites Clustering] REDIS MISS - Will query database and perform clustering`);

        // 🚀 STEP 1: Get live sites data using existing logic
        const siteTypeArray = site_types.split(',');
        const siteTypeMapping = {
            'Outdoor Site': ['Outdoor']
        };

        const dbSiteTypes = [];
        siteTypeArray.forEach(frontendType => {
            const dbTypes = siteTypeMapping[frontendType];
            if (dbTypes) {
                dbSiteTypes.push(...dbTypes);
            } else {
                dbSiteTypes.push(frontendType);
            }
        });

        // Parse spatial filter parameters
        const microGridArray = microGrids ? microGrids.split(',').map(id => parseInt(id, 10)) : [];
        const districtArray = districts ? districts.split(',').filter(d => d.trim()) : [];

        // Build spatial filter (simplified version)
        let spatialWhereClause = '';
        let queryParams = [...dbSiteTypes];
        let paramIndex = dbSiteTypes.length + 1;

        if (microGridArray.length > 0 || districtArray.length > 0) {
            let spatialConditions = [];

            if (districtArray.length > 0) {
                const districtPlaceholders = districtArray.map(() => `$${paramIndex++}`).join(',');
                spatialConditions.push(`district IN (${districtPlaceholders})`);
                queryParams.push(...districtArray);
            }

            if (spatialConditions.length > 0) {
                spatialWhereClause = ` AND (${spatialConditions.join(' OR ')})`;
            }
        }

        const placeholders = dbSiteTypes.map((_, index) => `$${index + 1}`).join(',');

        const query = `
            SELECT master_idx, live_site_id, plan_site_name, site_type, 
                   district, district_chinese, building_height, objective,
                   coverage_objective, coverage_objective_chinese,
                   address, site_ownership, indoor_category,
                   ST_X(ST_Transform(geom, 4326)) as longitude,
                   ST_Y(ST_Transform(geom, 4326)) as latitude,
                   ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geometry
            FROM public.cmhk_livesite
            WHERE geom IS NOT NULL AND site_type IN (${placeholders})
            ${spatialWhereClause}
            ORDER BY live_site_id;
        `;

        const { rows } = await siteDbPool.query(query, queryParams);

        if (rows.length === 0) {
            return res.json({
                type: 'FeatureCollection',
                features: [],
                clustering: {
                    total_sites: 0,
                    clusters: [],
                    noise_points: [],
                    parameters: { epsilon, min_points, distance_unit }
                }
            });
        }

        // 🚀 STEP 2: Prepare data for DBSCAN clustering
        const sites = rows.map(row => ({
            id: row.live_site_id,
            latitude: row.latitude,
            longitude: row.longitude,
            properties: {
                master_idx: row.master_idx,
                live_site_id: row.live_site_id,
                plan_site_name: row.plan_site_name,
                site_type: row.site_type,
                district: row.district,
                district_chinese: row.district_chinese,
                building_height: row.building_height,
                objective: row.objective,
                coverage_objective: row.coverage_objective,
                coverage_objective_chinese: row.coverage_objective_chinese,
                address: row.address,
                site_ownership: row.site_ownership,
                indoor_category: row.indoor_category
            },
            geometry: row.geometry
        }));

        // 🚀 STEP 3: Prepare coordinates for DBSCAN
        const coordinates = sites.map(site => [site.latitude, site.longitude]);


        // 🚀 STEP 4: Apply DBSCAN clustering with custom distance function
        const dbscan = new DBSCAN();

        // Define custom distance function for geographic coordinates
        const customDistance = (pointA, pointB) => {
            const distance = geolib.getDistance(
                { latitude: pointA[0], longitude: pointA[1] },
                { latitude: pointB[0], longitude: pointB[1] }
            );
            return distance;
        };

        // Try DBSCAN with custom distance function, fallback to manual implementation
        let clusters;
        try {
            clusters = dbscan.run(coordinates, parseFloat(epsilon), parseInt(min_points), customDistance);
        } catch (error) {
            clusters = manualDBSCAN(coordinates, parseFloat(epsilon), parseInt(min_points));
        }


        // 🚀 STEP 5: Process clustering results
        const clusterResults = [];
        const noise_points = [];
        const clusteredSites = new Set();

        // Process actual clusters
        clusters.forEach((cluster, clusterIndex) => {
            const clusterSites = cluster.map(siteIndex => {
                clusteredSites.add(siteIndex);
                const site = sites[siteIndex];
                return {
                    type: 'Feature',
                    properties: {
                        ...site.properties,
                        cluster_id: clusterIndex,
                        cluster_size: cluster.length,
                        is_noise: false
                    },
                    geometry: site.geometry
                };
            });

            // Calculate cluster centroid
            const centerLatitudes = cluster.map(idx => sites[idx].latitude);
            const centerLongitudes = cluster.map(idx => sites[idx].longitude);
            const centroid = {
                latitude: centerLatitudes.reduce((a, b) => a + b, 0) / centerLatitudes.length,
                longitude: centerLongitudes.reduce((a, b) => a + b, 0) / centerLongitudes.length
            };

            clusterResults.push({
                cluster_id: clusterIndex,
                size: cluster.length,
                centroid,
                sites: clusterSites,
                // Additional cluster statistics
                districts: [...new Set(clusterSites.map(s => s.properties.district))],
                site_types: [...new Set(clusterSites.map(s => s.properties.site_type))]
            });
        });

        // Process noise points (outliers)
        sites.forEach((site, index) => {
            if (!clusteredSites.has(index)) {
                noise_points.push({
                    type: 'Feature',
                    properties: {
                        ...site.properties,
                        cluster_id: -1,
                        cluster_size: 1,
                        is_noise: true
                    },
                    geometry: site.geometry
                });
            }
        });


        // 🚀 STEP 6: Prepare response
        const allFeatures = [
            ...clusterResults.flatMap(cluster => cluster.sites),
            ...noise_points
        ];

        const clusteringSummary = {
            total_sites: sites.length,
            total_clusters: clusterResults.length,
            noise_points_count: noise_points.length,
            clustered_sites_count: sites.length - noise_points.length,
            parameters: {
                epsilon: parseFloat(epsilon),
                min_points: parseInt(min_points),
                distance_unit
            },
            clusters: clusterResults.map(cluster => ({
                cluster_id: cluster.cluster_id,
                size: cluster.size,
                centroid: cluster.centroid,
                districts: cluster.districts,
                site_types: cluster.site_types
            })),
            statistics: {
                avg_cluster_size: clusterResults.length > 0
                    ? (sites.length - noise_points.length) / clusterResults.length
                    : 0,
                largest_cluster: clusterResults.length > 0
                    ? Math.max(...clusterResults.map(c => c.size))
                    : 0,
                smallest_cluster: clusterResults.length > 0
                    ? Math.min(...clusterResults.map(c => c.size))
                    : 0
            }
        };

        const responseData = {
            type: 'FeatureCollection',
            features: allFeatures,
            clustering: clusteringSummary
        };

        // Store in Redis with 300s TTL
        console.log(`💾 [Live Sites Clustering] Storing data in Redis...`);
        const redisStored = await redisCache.set(cacheKey, responseData, 300);
        if (redisStored) {
            console.log(`✅ [Live Sites Clustering] Successfully stored in Redis with 300s TTL`);
        }

        res.setHeader('X-Cache', 'MISS');
        res.json(responseData);

    } catch (err) {
        console.error('Error in live sites clustering:', err.stack);
        res.status(500).json({
            error: 'Server Error during clustering analysis',
            message: err.message
        });
    }
});

// 🗺️ LOCAL BASE MAP TILES: Serve Hong Kong base map tiles from MBTiles file
// This replaces external tile dependencies (OSM/CartoDB) with local tiles for isolated environment
let mbtilesInstance = null;
const mbtilesPath = process.env.MBTILES_PATH || path.join(__dirname, 'base-tiles', 'hong-kong.mbtiles');

app.get('/base-tiles/:z/:x/:y.pbf', async (req, res) => {
    const { z, x, y } = req.params;
    const zi = parseInt(z);
    const xi = parseInt(x);
    const yi = parseInt(y);

    // Validate tile coordinates
    if (isNaN(zi) || isNaN(xi) || isNaN(yi)) {
        return res.status(400).json({ error: 'Invalid tile coordinates' });
    }

    // Check zoom level limits (typical for HK area: zoom 5-18)
    if (zi < 5 || zi > 18) {
        return res.status(404).send('Tile not found (zoom out of range)');
    }

    // Create cache key for Redis
    const cacheKey = `base_tiles_${zi}_${xi}_${yi}`;

    try {
        // Check Redis cache first (silent)
        const cached = await redisCache.get(cacheKey);

        if (cached) {
            // Parse cached data (includes both tile data and headers metadata)
            let tileData, contentEncoding;
            
            // 🐛 FIX: redisCacheHelper already parses JSON for non-_mvt_ keys
            // So cached is already an object, not a string
            if (typeof cached === 'object' && cached.data) {
                // New format: object with data and contentEncoding
                tileData = Buffer.from(cached.data, 'base64');
                contentEncoding = cached.contentEncoding;
                console.log(`✅ [Base Tiles] REDIS HIT! Returning cached tile (${tileData.length} bytes)`);
            } else if (Buffer.isBuffer(cached)) {
                // Legacy format: raw buffer
                tileData = cached;
                console.log(`✅ [Base Tiles] REDIS HIT! Returning cached tile (legacy format, ${tileData.length} bytes)`);
            } else {
                // Unknown format - log and skip cache
                console.error(`❌ [Base Tiles] Invalid cached data format for ${zi}/${xi}/${yi}`);
                // Fall through to fetch from MBTiles
            }
            
            if (tileData) {
                res.setHeader('Content-Type', 'application/x-protobuf');
                if (contentEncoding) {
                    res.setHeader('Content-Encoding', contentEncoding);
                }
                res.setHeader('X-Cache', 'HIT');
                return res.send(tileData);
            }
        }

        // Initialize MBTiles instance if not already done (lazy loading)
        if (!mbtilesInstance) {
            console.log(`[Base Tiles] Opening MBTiles file: ${mbtilesPath}`);
            mbtilesInstance = await new Promise((resolve, reject) => {
                new MBTiles(mbtilesPath, (err, mbtiles) => {
                    if (err) {
                        console.error(`[Base Tiles] Failed to open MBTiles:`, err.message);
                        reject(err);
                    } else {
                        console.log(`[Base Tiles] MBTiles file opened successfully`);
                        resolve(mbtiles);
                    }
                });
            });
        }

        // Get tile from MBTiles
        const tile = await new Promise((resolve, reject) => {
            mbtilesInstance.getTile(zi, xi, yi, (err, tileData, headers) => {
                if (err) {
                    if (err.message && err.message.includes('Tile does not exist')) {
                        resolve(null); // Tile doesn't exist (common for sparse tilesets)
                    } else {
                        console.error(`[Base Tiles] Error reading tile ${zi}/${xi}/${yi}:`, err.message);
                        reject(err);
                    }
                } else {
                    resolve({ data: tileData, headers });
                }
            });
        });

        if (!tile) {
            // Return empty tile (204 No Content) instead of 404 for missing tiles
            return res.status(204).send();
        }

        // Store in Redis with metadata (24-hour TTL - base tiles don't change)
        // 🐛 FIX: Store as object, redisCacheHelper will JSON.stringify it
        const cacheData = {
            data: tile.data.toString('base64'),
            contentEncoding: tile.headers['Content-Encoding'] || null
        };
        await redisCache.set(cacheKey, cacheData, 86400); // 24 hours
        console.log(`💾 [Base Tiles] Stored tile ${zi}/${xi}/${yi} in Redis (${tile.data.length} bytes)`);

        // Send tile to client
        res.setHeader('Content-Type', tile.headers['Content-Type'] || 'application/x-protobuf');
        if (tile.headers['Content-Encoding']) {
            res.setHeader('Content-Encoding', tile.headers['Content-Encoding']);
        }
        res.setHeader('X-Cache', 'MISS');
        res.send(tile.data);

    } catch (err) {
        console.error(`[Base Tiles] Error serving tile ${zi}/${xi}/${yi}:`, err.message);

        res.status(500).json({
            error: 'Error serving base tile',
            message: err.message
        });
    }
});

const server = app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    
    // 🚀 PM2 Ready Signal: Tell PM2 the app is ready to accept requests
    if (process.send) {
        process.send('ready');
        console.log('✅ PM2 ready signal sent');
    }
});

// 🚀 CONNECTION FIX: Graceful shutdown handling to prevent connection leaks
const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);

    // Stop accepting new requests
    server.close(async () => {
        console.log('✅ HTTP server closed (no new connections accepted)');

        try {
            // 1. Close all database connection pools (5 pools total)
            console.log('⏳ Closing database connection pools...');
            await Promise.all([
                pool.end(),
                hkmapPool.end(),
                newPool.end(),
                siteDbPool.end(),
                complaintDbPool.end()
            ]);
            console.log('✅ All 5 database pools closed successfully');

            // 2. Close Redis connection
            console.log('⏳ Closing Redis connection...');
            await redisClient.closeGracefully();

            // 3. Note: No node-cache instances to clear (Redis-only architecture)
            // 4. Note: MBTiles are opened per-request and closed automatically
            // No global MBTiles connection to close

            console.log('✅ Graceful shutdown completed successfully');
            console.log('ℹ️  Redis-only architecture - all caches managed externally');
            process.exit(0);
        } catch (err) {
            console.error('❌ Error during graceful shutdown:', err);
            process.exit(1);
        }
    });

    // Force shutdown after 30 seconds if graceful shutdown hangs
    setTimeout(() => {
        console.error('❌ Graceful shutdown timeout - forcing immediate exit');
        process.exit(1);
    }, 30000);
};

// Handle shutdown signals
// SIGTERM: Sent by process managers like PM2, Docker, Kubernetes
// SIGINT: Sent by Ctrl+C in terminal
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});
