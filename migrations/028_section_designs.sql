-- Per-section homepage design switcher. site_settings is a single fixed-row
-- table (id=1), NOT a key/value store, so these are plain columns like
-- footer_html/featured_category — not a generic settings key/value scheme.
-- design_editors_picks is added for future use (no Design B exists for
-- Editor's Picks yet — it stays untouched, see adminSettingsController.js).
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS design_latest_news TEXT NOT NULL DEFAULT 'A',
  ADD COLUMN IF NOT EXISTS design_features TEXT NOT NULL DEFAULT 'A',
  ADD COLUMN IF NOT EXISTS design_editors_picks TEXT NOT NULL DEFAULT 'A',
  ADD COLUMN IF NOT EXISTS latestnews_tabs TEXT NOT NULL DEFAULT 'All,Latest News,Politics,Society,Development,Sports,Business';
