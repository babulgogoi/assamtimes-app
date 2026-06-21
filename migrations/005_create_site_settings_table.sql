-- Singleton row holding site-wide settings. Starts with just footer_html;
-- the admin pastes raw HTML (Bootstrap columns, links, whatever) and it's
-- rendered unescaped at the bottom of the public layout.
CREATE TABLE IF NOT EXISTS site_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  footer_html TEXT
);

INSERT INTO site_settings (id, footer_html)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;
