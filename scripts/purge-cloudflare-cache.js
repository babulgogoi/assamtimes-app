// Purges the Cloudflare cache fronting assamtimes.org — needed after any
// deploy that changes rendered HTML, since pm2 reload only clears the app's
// own in-memory page cache, not Cloudflare's edge cache (see CLAUDE.md).
// Usage:
//   node scripts/purge-cloudflare-cache.js              -> purge everything
//   node scripts/purge-cloudflare-cache.js URL [URL...] -> purge just these URLs
require('dotenv').config();

const token = process.env.CF_API_TOKEN;
const zoneId = process.env.CF_ZONE_ID;

if (!token || !zoneId) {
  console.error('CF_API_TOKEN and CF_ZONE_ID must be set in .env');
  process.exit(1);
}

const urls = process.argv.slice(2);
const body = urls.length ? { files: urls } : { purge_everything: true };

fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
})
  .then((res) => res.json())
  .then((data) => {
    if (!data.success) {
      console.error('Purge failed:', JSON.stringify(data.errors));
      process.exitCode = 1;
      return;
    }
    console.log(urls.length ? `Purged ${urls.length} URL(s).` : 'Purged everything.');
  })
  .catch((err) => {
    console.error('Request failed:', err.message);
    process.exitCode = 1;
  });
