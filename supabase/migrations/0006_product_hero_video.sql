-- Phase 2: Per-product cinematic hero video.
--
-- Generated via Fal.ai Seedance (image-to-video) from the white-background
-- source image. ~5s cinematic turn used as a scroll-scrubbed hero on the
-- storefront and product page, WISA-style.
alter table public.products
  add column if not exists hero_video_url text;
