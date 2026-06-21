const menuItemsModel = require('../models/menuItems');
const pagesModel = require('../models/pages');

async function listMenuItems(req, res, next) {
  try {
    const items = await menuItemsModel.getAllForAdmin();
    res.locals.layout = 'admin/layout';
    res.render('admin/menu/list', {
      title: 'Menu — Admin',
      authorName: req.session.authorName,
      items,
    });
  } catch (err) {
    next(err);
  }
}

async function newMenuItemForm(req, res, next) {
  try {
    const [pages, items] = await Promise.all([
      pagesModel.getAllForAdmin(),
      menuItemsModel.getAllForAdmin(),
    ]);
    res.locals.layout = 'admin/layout';
    res.render('admin/menu/form', {
      title: 'New Menu Item — Admin',
      authorName: req.session.authorName,
      pages,
      items,
      item: null,
      errors: [],
    });
  } catch (err) {
    next(err);
  }
}

async function editMenuItemForm(req, res, next) {
  try {
    const item = await menuItemsModel.getById(req.params.id);
    if (!item) {
      return res.status(404).send('Menu item not found');
    }
    const [pages, items] = await Promise.all([
      pagesModel.getAllForAdmin(),
      menuItemsModel.getAllForAdmin(),
    ]);
    res.locals.layout = 'admin/layout';
    res.render('admin/menu/form', {
      title: `Edit: ${item.label} — Admin`,
      authorName: req.session.authorName,
      pages,
      items: items.filter((i) => i.id !== item.id),
      item,
      errors: [],
    });
  } catch (err) {
    next(err);
  }
}

function parseMenuItemBody(body) {
  const pageId = body.page_id ? Number(body.page_id) : null;
  return {
    label: (body.label || '').trim(),
    pageId: Number.isInteger(pageId) && pageId > 0 ? pageId : null,
    customUrl: pageId ? null : (body.custom_url || '').trim() || null,
    sortOrder: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    parentId: body.parent_id ? Number(body.parent_id) : null,
    isActive: body.is_active === 'on' || body.is_active === '1',
  };
}

async function createMenuItem(req, res, next) {
  try {
    const data = parseMenuItemBody(req.body);
    if (!data.label) {
      const [pages, items] = await Promise.all([
        pagesModel.getAllForAdmin(),
        menuItemsModel.getAllForAdmin(),
      ]);
      res.locals.layout = 'admin/layout';
      return res.status(400).render('admin/menu/form', {
        title: 'New Menu Item — Admin',
        authorName: req.session.authorName,
        pages,
        items,
        item: req.body,
        errors: ['Label is required.'],
      });
    }

    await menuItemsModel.create(data);
    res.redirect('/admin/menu');
  } catch (err) {
    next(err);
  }
}

async function updateMenuItem(req, res, next) {
  try {
    const item = await menuItemsModel.getById(req.params.id);
    if (!item) {
      return res.status(404).send('Menu item not found');
    }

    const data = parseMenuItemBody(req.body);
    if (!data.label) {
      const [pages, items] = await Promise.all([
        pagesModel.getAllForAdmin(),
        menuItemsModel.getAllForAdmin(),
      ]);
      res.locals.layout = 'admin/layout';
      return res.status(400).render('admin/menu/form', {
        title: `Edit: ${item.label} — Admin`,
        authorName: req.session.authorName,
        pages,
        items: items.filter((i) => i.id !== item.id),
        item: { ...item, ...req.body },
        errors: ['Label is required.'],
      });
    }

    await menuItemsModel.update(item.id, data);
    res.redirect('/admin/menu');
  } catch (err) {
    next(err);
  }
}

async function deleteMenuItem(req, res, next) {
  try {
    await menuItemsModel.remove(req.params.id);
    res.redirect('/admin/menu');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listMenuItems,
  newMenuItemForm,
  editMenuItemForm,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
};
