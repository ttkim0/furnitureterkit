-- Phase 1.5: Lovable-style custom site generation.
--
-- Adds columns for the creator's design brief, inspiration assets, and the
-- generated HTML/CSS. When `custom_homepage_html` is non-null, the public
-- storefront renders that custom design instead of the theme-based layout.
--
-- Idempotent. Safe to re-run.

alter table public.creators
  add column if not exists design_brief text,
  add column if not exists reference_urls jsonb not null default '[]'::jsonb,
  add column if not exists inspiration_image_urls jsonb not null default '[]'::jsonb,
  add column if not exists custom_homepage_html text,
  add column if not exists custom_homepage_css text,
  add column if not exists design_iteration_count int not null default 0,
  add column if not exists last_designed_at timestamptz;

-- Store the chat history for iterative design refinement (Phase 1.6+).
create table if not exists public.design_messages (
  id bigserial primary key,
  creator_id uuid references public.creators(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  generated_html text,
  generated_css text,
  created_at timestamptz not null default now()
);
create index if not exists idx_design_messages_creator
  on public.design_messages(creator_id, created_at desc);

alter table public.design_messages enable row level security;

drop policy if exists "owner manages own design messages" on public.design_messages;
create policy "owner manages own design messages" on public.design_messages
  for all using (
    exists (select 1 from public.creators c
            where c.id = design_messages.creator_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.creators c
            where c.id = design_messages.creator_id and c.user_id = auth.uid())
  );
