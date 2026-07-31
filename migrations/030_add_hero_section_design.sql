-- Homepage Hero section design switcher, same pattern as
-- design_latest_news/design_features/design_editors_picks (028_section_designs.sql).
-- 'A' = existing top-of-homepage section (today: Latest News, in whichever
-- of its own A/B designs is currently selected) — untouched.
-- 'B' = new Straits Times-style 75/25 hero layout, which replaces the
-- Latest News section entirely when selected (see views/public/home.ejs).
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS design_hero TEXT NOT NULL DEFAULT 'A';
