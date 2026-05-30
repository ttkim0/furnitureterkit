-- Waitlist signup now captures the person's idea too — not just their email.
-- Required at the application level (the form makes it mandatory), but
-- nullable in the schema so existing rows from migration 0007 stay valid.
alter table public.waitlist
  add column if not exists idea text;
