// PM2 Ecosystem Configuration for Grid Data Display Project
// 🚀 Production-ready configuration for Redis-only architecture

module.exports = {
  apps: [
    {
      // ============================================================================
      // APPLICATION SETTINGS
      // ============================================================================
      name: 'MICRO-GRID-NETWORK-OPTIMIZATION-PLATFORM',
      script: './server.js',
      cwd: '/xxxxxxxxxx/xxxxxxxxx/Grid Data Display/Backend',  // Update this to your actual path

      // ============================================================================
      // CLUSTER MODE - Utilize all CPU cores for maximum performance
      // ============================================================================
      instances: 2,          // Running 2 instances for resource optimization
      exec_mode: 'cluster',  // Cluster mode enables load balancing across instances

      // ============================================================================
      // NODE.JS ARGUMENTS
      // ============================================================================
      node_args: '--expose-gc',  // Enable manual GC for /clear-all-caches endpoint

      // ============================================================================
      // RESTART STRATEGIES
      // ============================================================================
      autorestart: true,          // Auto-restart on crash
      max_restarts: 10,            // Max 10 restarts within min_uptime window
      min_uptime: '10s',           // App must run 10s to be considered stable
      max_memory_restart: '1G',    // Restart if memory exceeds 1GB

      // 🔄 OPTIONAL: Scheduled restart (daily at 3 AM to clear any memory leaks)
      // cron_restart: '0 3 * * *',  // Uncomment if you want daily restarts

      // ============================================================================
      // GRACEFUL SHUTDOWN - Works with your gracefulShutdown() function
      // ============================================================================
      kill_timeout: 30000,   // Wait 30 seconds for graceful shutdown
      listen_timeout: 10000,  // Wait 10 seconds for app to bind to port
      wait_ready: true,       // Wait for 'ready' signal

      // ============================================================================
      // FILE WATCHING (Disable in production!)
      // ============================================================================
      watch: false,  // Never enable watch in production - causes unnecessary restarts
      ignore_watch: [
        'node_modules',
        'logs',
        '*.log',
        '.git',
        'CompetitiveSites',
        'H3 Sites',
        'simulation-raw-data',
        'base-tiles'
      ],

      // ============================================================================
      // LOGGING CONFIGURATION
      // ============================================================================
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,           // Merge logs from all instances
      log_type: 'json',           // JSON format for easier parsing (optional)

      // ============================================================================
      // ENVIRONMENT VARIABLES - PRODUCTION
      // ============================================================================
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,

        // 🚀 Redis Configuration (Only Redis needs env vars - DB credentials are in server.js)
        REDIS_HOST: 'localhost',
        REDIS_PORT: 6379,
        REDIS_DB: 0,
        // REDIS_PASSWORD: 'your-redis-password',  // Uncomment if Redis has password

        // 🎯 Performance Settings
        UV_THREADPOOL_SIZE: 128  // Increase thread pool for better I/O performance
      },

      // ============================================================================
      // ENVIRONMENT VARIABLES - DEVELOPMENT (Optional)
      // ============================================================================
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,

        // DB credentials use fallback values in server.js
        REDIS_HOST: 'localhost',
        REDIS_PORT: 6379
      },

      // ============================================================================
      // ADVANCED CONFIGURATION
      // ============================================================================
      instance_var: 'INSTANCE_ID',  // Available as process.env.INSTANCE_ID

      // 🔧 Source map support (helpful for debugging)
      source_map_support: true,

      // 📊 PM2 Plus integration (optional - for monitoring dashboard)
      // pmx: true,

      // 🛡️ Graceful shutdown on SIGINT/SIGTERM
      // Your server.js already handles this, but PM2 will trigger it
      shutdown_with_message: true
    }
  ],
};
