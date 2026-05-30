-- Phase 1.6: Onlook-style visual editing.
--
-- Stores per-element text + style overrides keyed by stable element IDs
-- assigned by the iframe preload script. Shape:
--   {
--     "text":  { "<aid>": "new text content", ... },
--     "style": { "<aid>": { "color": "#abc", "font-size": "24px" }, ... }
--   }
-- Idempotent.

alter table public.creators
  add column if not exists custom_overrides jsonb not null default '{}'::jsonb;
