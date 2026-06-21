-- gallery_images was a flat TEXT[] of URLs. Move to JSONB so each image
-- can carry an optional caption: [{ "url": "...", "caption": "" }, ...].
ALTER TABLE articles ADD COLUMN IF NOT EXISTS gallery_images_jsonb JSONB;

UPDATE articles a
SET gallery_images_jsonb = COALESCE(
  (SELECT jsonb_agg(jsonb_build_object('url', url, 'caption', ''))
   FROM unnest(a.gallery_images) AS url),
  '[]'::jsonb
)
WHERE gallery_images_jsonb IS NULL;

ALTER TABLE articles DROP COLUMN gallery_images;
ALTER TABLE articles RENAME COLUMN gallery_images_jsonb TO gallery_images;
ALTER TABLE articles ALTER COLUMN gallery_images SET DEFAULT '[]'::jsonb;
