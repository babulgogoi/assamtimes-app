const REQUIRED_VARS = [
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
  'SESSION_SECRET', 'SITE_URL',
  'UPLOADS_ARTICLES_DIR', 'UPLOADS_AUDIO_DIR', 'UPLOADS_DOCUMENTS_DIR',
  'UPLOADS_DEFAULTS_DIR', 'UPLOADS_BRANDING_DIR', 'UPLOADS_AUTHORS_DIR',
];

const PLACEHOLDER_VALUES = new Set(['changeme']);

function validateEnv() {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key] || process.env[key].trim() === '');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (process.env.NODE_ENV === 'production') {
    const placeholders = REQUIRED_VARS.filter((key) => PLACEHOLDER_VALUES.has(process.env[key]));
    if (placeholders.length) {
      throw new Error(
        `Refusing to start in production with placeholder values for: ${placeholders.join(', ')}. Set real values in .env.`
      );
    }
  }
}

module.exports = validateEnv;
