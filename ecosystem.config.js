module.exports = {
  apps: [
    {
      name: 'assamtimes',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      time: true,
    },
  ],
};
