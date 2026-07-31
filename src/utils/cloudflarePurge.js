const CF_API = 'https://api.cloudflare.com/client/v4';

async function purgeUrls(urls) {
  const token = process.env.CF_API_TOKEN;
  const zone  = process.env.CF_ZONE_ID;

  if (!token || !zone) {
    console.warn('[CF Purge] CF_API_TOKEN or CF_ZONE_ID not set — skipping');
    return;
  }

  try {
    const res = await fetch(`${CF_API}/zones/${zone}/purge_cache`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: urls }),
    });
    const data = await res.json();
    if (data.success) {
      console.log(`[CF Purge] Purged ${urls.length} URL(s):`, urls);
    } else {
      console.error('[CF Purge] Failed:', JSON.stringify(data.errors));
    }
  } catch (err) {
    console.error('[CF Purge] Error:', err.message);
  }
}

async function purgeArticle(article) {
  const base = process.env.SITE_URL || 'https://assamtimes.org';
  const urls = [
    `${base}/`,
    `${base}/article/${article.slug}`,
  ];
  if (article.category) {
    urls.push(`${base}/category/${encodeURIComponent(article.category)}`);
  }
  await purgeUrls(urls);
}

async function purgeEverything() {
  const token = process.env.CF_API_TOKEN;
  const zone  = process.env.CF_ZONE_ID;

  if (!token || !zone) {
    console.warn('[CF Purge] CF_API_TOKEN or CF_ZONE_ID not set — skipping');
    return;
  }

  try {
    const res = await fetch(`${CF_API}/zones/${zone}/purge_cache`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ purge_everything: true }),
    });
    const data = await res.json();
    console.log('[CF Purge] purge_everything:', data.success, data.errors || '');
    return data.success;
  } catch (err) {
    console.error('[CF Purge] Error:', err.message);
    return false;
  }
}

module.exports = { purgeUrls, purgeArticle, purgeEverything };
