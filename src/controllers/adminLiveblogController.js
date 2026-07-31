const liveblogEntriesModel = require('../models/liveblogEntries');
const { renderEntryContent } = require('../utils/liveblogMarkdown');

function withHtml(entry) {
  return { ...entry, content_html: renderEntryContent(entry.content) };
}

async function listEntries(req, res, next) {
  try {
    const entries = await liveblogEntriesModel.listByArticleId(req.params.articleId, 50);
    res.json({ entries: entries.map(withHtml) });
  } catch (err) {
    next(err);
  }
}

async function createEntry(req, res, next) {
  try {
    const content = (req.body.content || '').trim();
    if (!content) {
      return res.status(400).json({ success: false, error: 'Content required' });
    }

    const entry = await liveblogEntriesModel.create({
      articleId: req.params.articleId,
      content,
      // Real session field is req.session.authorId — this app has no
      // separate "admin" concept, the authors table is the user table for
      // both bylines and admin login.
      authorId: req.session.authorId,
      isKeyEvent: req.body.is_key_event,
      isPinned: req.body.is_pinned,
    });

    res.json({ success: true, entry: withHtml(entry) });
  } catch (err) {
    next(err);
  }
}

async function deleteEntry(req, res, next) {
  try {
    await liveblogEntriesModel.remove(req.params.entryId, req.params.articleId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { listEntries, createEntry, deleteEntry };
