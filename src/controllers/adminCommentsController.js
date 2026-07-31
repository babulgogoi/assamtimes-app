const commentsModel = require('../models/comments');

const ADMIN_PAGE_SIZE = 20;

async function listComments(req, res, next) {
  try {
    const status = ['pending', 'approved', 'spam', 'all'].includes(req.query.status)
      ? req.query.status
      : 'pending';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * ADMIN_PAGE_SIZE;

    const [comments, total] = await Promise.all([
      commentsModel.listForAdmin({ status, limit: ADMIN_PAGE_SIZE, offset }),
      commentsModel.countForAdmin({ status }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));

    res.locals.layout = 'admin/layout';
    res.render('admin/comments/list', {
      title: 'Comments — Admin',
      authorName: req.session.authorName,
      comments,
      status,
      page,
      totalPages,
    });
  } catch (err) {
    next(err);
  }
}

async function approveComment(req, res, next) {
  try {
    await commentsModel.updateStatus(req.params.id, 'approved');
    res.redirect(req.get('Referer') || '/admin/comments');
  } catch (err) {
    next(err);
  }
}

async function markSpam(req, res, next) {
  try {
    await commentsModel.updateStatus(req.params.id, 'spam');
    res.redirect(req.get('Referer') || '/admin/comments');
  } catch (err) {
    next(err);
  }
}

async function deleteComment(req, res, next) {
  try {
    await commentsModel.remove(req.params.id);
    res.redirect(req.get('Referer') || '/admin/comments');
  } catch (err) {
    next(err);
  }
}

async function bulkApprovePending(req, res, next) {
  try {
    await commentsModel.approveAllPending();
    res.redirect('/admin/comments?status=pending');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listComments,
  approveComment,
  markSpam,
  deleteComment,
  bulkApprovePending,
};
