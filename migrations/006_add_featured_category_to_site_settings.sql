-- Category used for the homepage "Featured Articles" sidebar block,
-- configurable from /admin/settings instead of hardcoded.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS featured_category TEXT NOT NULL DEFAULT 'Features';
