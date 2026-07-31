const newsletterModel = require('../models/newsletterSubscribers');
const d7StagingModel = require('../models/d7NewsletterStaging');

const ADMIN_PAGE_SIZE = 50;

async function listSubscribers(req, res, next) {
  try {
    const search = (req.query.q || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * ADMIN_PAGE_SIZE;

    const [subscribers, total, stats, d7Stats] = await Promise.all([
      newsletterModel.listForAdmin({ search, limit: ADMIN_PAGE_SIZE, offset }),
      newsletterModel.countForAdmin({ search }),
      newsletterModel.getStats(),
      d7StagingModel.getImportStats(),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));

    res.locals.layout = 'admin/layout';
    res.render('admin/newsletter/list', {
      title: 'Newsletter — Admin',
      authorName: req.session.authorName,
      subscribers,
      search,
      page,
      totalPages,
      total,
      stats,
      d7Stats,
    });
  } catch (err) {
    next(err);
  }
}

async function deleteSubscriber(req, res, next) {
  try {
    await newsletterModel.remove(req.params.id);
    res.redirect('/admin/newsletter');
  } catch (err) {
    next(err);
  }
}

function csvEscape(value) {
  const str = String(value == null ? '' : value);
  return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

async function exportCsv(req, res, next) {
  try {
    const search = (req.query.q || '').trim();
    const subscribers = await newsletterModel.listAllForExport({ search });

    const lines = [['Name', 'Email', 'Status', 'Source', 'Subscribed At'].join(',')];
    subscribers.forEach((s) => {
      lines.push(
        [
          csvEscape(s.name),
          csvEscape(s.email),
          csvEscape(s.status),
          csvEscape(s.source),
          csvEscape(s.subscribed_at ? new Date(s.subscribed_at).toISOString() : ''),
        ].join(',')
      );
    });

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="newsletter-subscribers.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    next(err);
  }
}

module.exports = { listSubscribers, exportCsv, deleteSubscriber };
