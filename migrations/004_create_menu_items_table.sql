-- Drives the site header nav. Each item links to either a static page
-- (page_id) or a custom URL (custom_url, e.g. a category page) — never both
-- in practice, but not constrained at the DB level since either can be blank
-- while an item is still being set up.
CREATE TABLE IF NOT EXISTS menu_items (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  page_id INT REFERENCES pages(id) ON DELETE SET NULL,
  custom_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  parent_id INT REFERENCES menu_items(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_menu_items_sort_order ON menu_items(sort_order);

INSERT INTO menu_items (label, custom_url, sort_order, is_active)
SELECT 'Home', '/', 1, true
WHERE NOT EXISTS (SELECT 1 FROM menu_items);

-- Placeholders: inactive until you create the corresponding page in /admin/pages
-- and link it here (or set a custom_url) via /admin/menu.
INSERT INTO menu_items (label, sort_order, is_active)
SELECT v.label, v.sort_order, false
FROM (VALUES ('About Us', 2), ('Contact', 3)) AS v(label, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE menu_items.label = v.label);
