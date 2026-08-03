/**
 * PM2 Ecosystem Config — Rey de la Chelada
 * Windows Self-Hosted (RESTAURANT profile)
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save
 *   pm2 startup
 *   pm2 monit
 */
module.exports = {
  apps: [{
    name: process.env.APP_NAME || 'rey-de-la-chelada',
    script: './server/index.js',

    // Clustering
    // IMPORTANT: WebSockets (KDS real-time) require a SINGLE process —
    // cluster mode would split WS clients across processes and break
    // the broadcaster. Use fork mode with 1 instance.
    instances: 1,
    exec_mode: 'fork',

    // Environment
    env: {
      NODE_ENV: 'development',
      PORT: 3002,
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: process.env.PORT || 3002,
    },

    // Health & Restart
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 4000,
    max_memory_restart: '1G',

    // Graceful Shutdown
    kill_timeout: 5000,
    listen_timeout: 10000,

    // Logging
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    time: true,

    // Watch (dev only)
    watch: process.env.NODE_ENV === 'development',
    ignore_watch: ['node_modules', 'logs', '.git', 'data'],
  }]
};
