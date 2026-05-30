-- Phase 1.8: Persist the source image (gpt-image-1 white-background photo
-- that was fed to Hunyuan) on each product row, so the auto-photo
-- generator can use the ACTUAL piece as gpt-image-1.edit() input
-- instead of generating fictional lifestyle photos from text.
alter table public.products
  add column if not exists source_image_url text;
