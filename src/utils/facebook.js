function toBoldUnicode(str) {
  return [...str].map(ch => {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90)  return String.fromCodePoint(0x1D400 + c - 65); // A-Z
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x1D41A + c - 97); // a-z
    if (c >= 48 && c <= 57)  return String.fromCodePoint(0x1D7CE + c - 48); // 0-9
    return ch;
  }).join('');
}

// Auto-posts a newly-published article to the Facebook Page. Failures are
// logged and never propagate — a Facebook outage must never block saving
// an article.
async function postArticleToFacebook(article) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageId || !accessToken) {
    console.error('Facebook auto-post skipped: FACEBOOK_PAGE_ID/FACEBOOK_PAGE_ACCESS_TOKEN not configured.');
    return false;
  }

  const boldTitle = toBoldUnicode(article.title);
  const message = article.subheadline
    ? `${boldTitle}\n\n${article.subheadline}`
    : boldTitle;
  const link = `${process.env.SITE_URL}/article/${article.slug}`;

  try {
    const res = await fetch(`https://graph.facebook.com/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message, link, access_token: accessToken }).toString(),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      console.error('Facebook auto-post failed for article', article.id, ':', data.error || data);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Facebook auto-post failed for article', article.id, ':', err);
    return false;
  }
}

module.exports = { postArticleToFacebook };
