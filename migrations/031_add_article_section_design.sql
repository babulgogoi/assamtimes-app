-- Article page design switcher, same pattern as design_hero
-- (030_add_hero_section_design.sql). 'A' = existing article layout with
-- sidebar (untouched). 'B' = new no-sidebar, centered 620px column,
-- 700px bleed image, Straits Times-style layout (see views/public/article.ejs).
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS design_article TEXT NOT NULL DEFAULT 'A';
