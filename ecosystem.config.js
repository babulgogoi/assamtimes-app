module.exports = {
  apps: [
    {
      name: 'assamtimes',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      // PM2's own default kill_timeout (~1.6s) SIGKILLs the whole worker
      // well before server.js's graceful shutdown() can run to
      // completion — confirmed directly: the old worker's PID was
      // already gone ~1.7s after a reload, every time, regardless of
      // what shutdown() itself was doing. Without this, server.js's
      // closeBrowser()/closeIdleConnections()/closeAllConnections()
      // sequence is effectively dead code during a real pm2 reload —
      // any Chrome process that happens to die along with it does so
      // via its own unrelated parent-death behavior, not because of
      // anything this app's shutdown logic did. Set comfortably above
      // shutdown()'s own 10s hard backstop so that backstop — not PM2's
      // separate enforcement — is what actually gates the worst case.
      kill_timeout: 12000,
      env: {
        NODE_ENV: 'production',
        PORT: 3008,
      },
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      time: true,
    },
  ],
};
