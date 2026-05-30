-- Terkit AI waitlist — accepts public email signups from the landing page.
--
-- Anyone can INSERT their own email. No one (anon) can read the list —
-- you read it server-side or via the Supabase dashboard. Soft-uniqueness
-- via a unique index on lower(email) so 'a@b.com' and 'A@B.com' don't
-- both get in.
--
-- Idempotent. Safe to re-run.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'terkit-landing',
  referrer text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_email_lower_uidx
  on public.waitlist (lower(email));

create index if not exists waitlist_created_at_idx
  on public.waitlist (created_at desc);

alter table public.waitlist enable row level security;

-- Anyone (anon) can drop their email in.
drop policy if exists "anyone can join waitlist" on public.waitlist;
create policy "anyone can join waitlist" on public.waitlist
  for insert with check (true);

-- Nobody (anon) can read it. Admins use the service role / dashboard.
-- (No SELECT policy = no SELECT allowed under RLS.)
