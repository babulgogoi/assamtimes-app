-- Admin-controlled homepage embed widget (charts/maps/etc via raw iframe
-- HTML), rendered between the Features and Editor's Picks sections when
-- enabled. No sanitisation — admin-only input, same trust level as
-- footer_html (see site_settings.footer_html) and article bodies.
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS homepage_embed_html TEXT;
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS homepage_embed_enabled BOOLEAN NOT NULL DEFAULT false;
