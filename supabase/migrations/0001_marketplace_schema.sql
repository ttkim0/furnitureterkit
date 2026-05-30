-- Ariadne marketplace schema (Phase 1)
--
-- Run this once in your Supabase project:
--   1. Go to https://app.supabase.com → your project → SQL Editor
--   2. Paste this entire file → Run
--   3. Verify in Table Editor that creators / products / orders / analytics_events exist
--
-- Idempotent (safe to re-run). All tables use RLS so:
--   - Anyone can read PUBLISHED creators + products (public storefront browse)
--   - Logged-in users can manage their own creator row + products
--   - Buyers can place orders without auth (guest checkout)
--   - Creators see only their own orders and analytics

-- ── creators ────────────────────────────────────────────────────────────
-- One row per user who's set up a storefront. Not every Supabase user has
-- one — only those who clicked "Open store builder" after their first
-- finished piece.
create table if not exists public.creators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  store_slug text unique not null check (store_slug ~ '^[a-z0-9][a-z0-9-]{2,30}$'),
  store_name text not null,
  tagline text,
  about text,
  logo_url text,
  hero_image_url text,
  theme_id text not null default 'minimal-dark',
  palette jsonb not null default '{"primary":"#06070d","accent":"#ffc88c","text":"#fff7e6","muted":"#a89b85"}'::jsonb,
  typography text not null default 'serif-italic',
  status text not null default 'draft' check (status in ('draft','published','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── products ───────────────────────────────────────────────────────────
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references public.creators(id) on delete cascade not null,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,60}$'),
  title text not null,
  description text,
  price_cents int not null check (price_cents > 0),
  currency text not null default 'USD',
  mesh_url text not null,
  cad_zip_url text not null,
  spec_json jsonb not null,
  cad_summary_json jsonb,
  hero_image_url text,
  gallery_urls jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','published','sold_out','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(creator_id, slug)
);

-- ── orders ─────────────────────────────────────────────────────────────
-- Buyer's purchase of a creator's product. Mock-paid in Phase 0; real
-- Stripe Connect comes in Phase 4.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  product_id uuid references public.products(id) on delete restrict not null,
  creator_id uuid references public.creators(id) on delete restrict not null,
  buyer_email text not null,
  buyer_name text,
  amount_cents int not null check (amount_cents > 0),
  currency text not null default 'USD',
  status text not null default 'pending' check (status in ('pending','paid','shipped','delivered','refunded','cancelled')),
  payment_method text not null default 'mock-test',
  paid_at timestamptz,
  shipping_address jsonb,
  notes text,
  created_at timestamptz not null default now()
);

-- ── analytics_events ───────────────────────────────────────────────────
-- One row per visit / view / conversion. IP is HASHED before insert (in
-- the Node API layer); we keep country + city from geo lookup. Privacy:
-- no raw IPs, no PII beyond the buyer email already in orders.
create table if not exists public.analytics_events (
  id bigserial primary key,
  store_slug text not null,
  product_id uuid references public.products(id) on delete cascade,
  event_type text not null check (event_type in (
    'store_view','product_view','add_to_cart','checkout_started','purchase_complete'
  )),
  country text,
  country_name text,
  city text,
  region text,
  referrer text,
  user_agent text,
  ip_hash text,
  session_id text,
  created_at timestamptz not null default now()
);

-- ── Indexes ────────────────────────────────────────────────────────────
create index if not exists idx_products_creator   on public.products(creator_id);
create index if not exists idx_products_status    on public.products(status);
create index if not exists idx_orders_creator     on public.orders(creator_id);
create index if not exists idx_orders_product     on public.orders(product_id);
create index if not exists idx_orders_number      on public.orders(order_number);
create index if not exists idx_events_store_time  on public.analytics_events(store_slug, created_at desc);
create index if not exists idx_events_product     on public.analytics_events(product_id, created_at desc);
create index if not exists idx_events_country     on public.analytics_events(country);

-- ── updated_at triggers ────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_creators_touch on public.creators;
create trigger trg_creators_touch before update on public.creators
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_products_touch on public.products;
create trigger trg_products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ── Row-Level Security ─────────────────────────────────────────────────
alter table public.creators           enable row level security;
alter table public.products           enable row level security;
alter table public.orders             enable row level security;
alter table public.analytics_events   enable row level security;

-- creators: published rows are publicly readable; owners can read/write own
drop policy if exists "public can read published creators" on public.creators;
create policy "public can read published creators" on public.creators
  for select using (status = 'published');
drop policy if exists "owner manages own creator" on public.creators;
create policy "owner manages own creator" on public.creators
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- products: published rows publicly readable; owners can manage their own
drop policy if exists "public can read published products" on public.products;
create policy "public can read published products" on public.products
  for select using (status = 'published');
drop policy if exists "owner manages own products" on public.products;
create policy "owner manages own products" on public.products
  for all using (
    exists (select 1 from public.creators c
            where c.id = products.creator_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.creators c
            where c.id = products.creator_id and c.user_id = auth.uid())
  );

-- orders: creators see their orders; buyers can lookup by order_number anonymously (handled in API, not RLS)
drop policy if exists "creator reads own orders" on public.orders;
create policy "creator reads own orders" on public.orders
  for select using (
    exists (select 1 from public.creators c
            where c.id = orders.creator_id and c.user_id = auth.uid())
  );
drop policy if exists "anyone inserts orders" on public.orders;
create policy "anyone inserts orders" on public.orders
  for insert with check (true);

-- analytics: anyone can write events (tracking endpoint); creators read own
drop policy if exists "anyone inserts events" on public.analytics_events;
create policy "anyone inserts events" on public.analytics_events
  for insert with check (true);
drop policy if exists "creator reads own events" on public.analytics_events;
create policy "creator reads own events" on public.analytics_events
  for select using (
    exists (select 1 from public.creators c
            where c.store_slug = analytics_events.store_slug and c.user_id = auth.uid())
  );

-- ── Public order lookup function (Phase 4 buyer flow) ─────────────────
-- Buyers need to see their order confirmation page after checkout, but
-- the RLS on `orders` only allows the creator to read. We expose a
-- SECURITY DEFINER function that returns a single order by its
-- unguessable order_number. The function bypasses RLS but only ever
-- returns one row matching the exact number — which only the buyer
-- (and the creator) ever sees.
create or replace function public.get_order_by_number(p_order_number text)
returns table (
  id uuid, order_number text, product_id uuid, creator_id uuid,
  buyer_email text, buyer_name text, amount_cents int, currency text,
  status text, payment_method text, paid_at timestamptz,
  shipping_address jsonb, notes text, created_at timestamptz
) language sql security definer set search_path = public as $$
  select id, order_number, product_id, creator_id, buyer_email, buyer_name,
         amount_cents, currency, status, payment_method, paid_at,
         shipping_address, notes, created_at
  from public.orders
  where order_number = p_order_number
  limit 1
$$;
grant execute on function public.get_order_by_number(text) to anon, authenticated;
