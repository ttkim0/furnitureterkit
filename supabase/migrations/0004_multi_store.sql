-- Phase 1.7: Multiple stores per user.
--
-- Drops the one-store-per-user constraint. store_slug remains globally
-- unique (URLs must not collide). RLS policies already use auth.uid()
-- against creators.user_id, which still works fine when a user owns
-- multiple creator rows.

alter table public.creators
  drop constraint if exists creators_user_id_key;
