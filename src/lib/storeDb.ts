// Marketplace DB client.
//
// All Supabase queries for creators / products / orders live here.
// Components never call .from() directly — keeps the schema swap-able
// and the call sites readable.

import { getSupabase } from "./supabase";
import type {
  Creator,
  Order,
  Palette,
  Product,
  ThemeId,
  TypographyId,
} from "./marketplace";
import type { FurnitureSpec } from "./spec";
import type { CadBundleSummary } from "./api";

// ── Creators ───────────────────────────────────────────────────────────
/** Returns ALL stores belonging to this user (most recently created first).
 *  Phase 1.7: a user may own multiple. Caller picks one as "active". */
export async function listCreatorsByUserId(userId: string): Promise<Creator[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("creators")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Creator[]) ?? [];
}

/** Backwards-compatible single-store getter. Returns the most recently
 *  created store. Most callers should use listCreatorsByUserId() now
 *  and let resolveActiveStore() pick. */
export async function getCreatorByUserId(userId: string): Promise<Creator | null> {
  const stores = await listCreatorsByUserId(userId);
  return stores[0] ?? null;
}

/** Fetch a single creator by its id (for "open this specific store" flows). */
export async function getCreatorById(id: string): Promise<Creator | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("creators")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Creator) ?? null;
}

export async function getCreatorBySlug(slug: string): Promise<Creator | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("creators")
    .select("*")
    .eq("store_slug", slug)
    .maybeSingle();
  if (error) throw error;
  return (data as Creator) ?? null;
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  const sb = getSupabase();
  const { count, error } = await sb
    .from("creators")
    .select("id", { count: "exact", head: true })
    .eq("store_slug", slug);
  if (error) throw error;
  return (count ?? 0) === 0;
}

export interface CreateCreatorInput {
  user_id: string;
  store_slug: string;
  store_name: string;
  tagline?: string;
  about?: string;
  logo_url?: string;
  theme_id: ThemeId;
  palette: Palette;
  typography: TypographyId;
}

export async function createCreator(input: CreateCreatorInput): Promise<Creator> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("creators")
    .insert({
      user_id: input.user_id,
      store_slug: input.store_slug,
      store_name: input.store_name,
      tagline: input.tagline ?? null,
      about: input.about ?? null,
      logo_url: input.logo_url ?? null,
      theme_id: input.theme_id,
      palette: input.palette,
      typography: input.typography,
      status: "published", // ship visible immediately
    })
    .select()
    .single();
  if (error) throw error;
  return data as Creator;
}

export async function updateCreator(
  id: string,
  patch: Partial<Omit<Creator, "id" | "user_id" | "created_at" | "updated_at">>
): Promise<Creator> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("creators")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Creator;
}

// ── Products ───────────────────────────────────────────────────────────
export async function getProductsByCreator(creatorId: string): Promise<Product[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("products")
    .select("*")
    .eq("creator_id", creatorId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Product[]) ?? [];
}

export async function getProductBySlug(
  creatorId: string,
  productSlug: string
): Promise<Product | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("products")
    .select("*")
    .eq("creator_id", creatorId)
    .eq("slug", productSlug)
    .maybeSingle();
  if (error) throw error;
  return (data as Product) ?? null;
}

export interface CreateProductInput {
  creator_id: string;
  slug: string;
  title: string;
  description?: string;
  price_cents: number;
  currency?: string;
  mesh_url: string;
  cad_zip_url: string;
  spec_json: FurnitureSpec;
  cad_summary_json?: CadBundleSummary;
  hero_image_url?: string;
  gallery_urls?: string[];
  /** White-background source image from Hunyuan — feeds the AI lifestyle
   *  photo generator so photos depict THIS exact piece, not a fictional one. */
  source_image_url?: string;
  /** Per-product cinematic video (~5s MP4) — used as scroll-scrub hero. */
  hero_video_url?: string;
}

export async function updateProduct(
  id: string,
  patch: Partial<Omit<Product, "id" | "creator_id" | "created_at" | "updated_at">>
): Promise<Product> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("products")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Product;
}

export async function createProduct(input: CreateProductInput): Promise<Product> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("products")
    .insert({
      creator_id: input.creator_id,
      slug: input.slug,
      title: input.title,
      description: input.description ?? null,
      price_cents: input.price_cents,
      currency: input.currency ?? "USD",
      mesh_url: input.mesh_url,
      cad_zip_url: input.cad_zip_url,
      spec_json: input.spec_json,
      cad_summary_json: input.cad_summary_json ?? null,
      hero_image_url: input.hero_image_url ?? null,
      gallery_urls: input.gallery_urls ?? [],
      source_image_url: input.source_image_url ?? null,
      hero_video_url: input.hero_video_url ?? null,
      status: "published",
    })
    .select()
    .single();
  if (error) throw error;
  return data as Product;
}

// ── Marketplace browse ─────────────────────────────────────────────────
export interface MarketplaceListing {
  product: Product;
  creator: Pick<Creator, "id" | "store_slug" | "store_name" | "logo_url">;
}

/** Top-level marketplace feed: published products across all stores. */
export async function listMarketplace(
  limit = 60
): Promise<MarketplaceListing[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("products")
    .select(
      "*, creators!inner(id, store_slug, store_name, logo_url, status)"
    )
    .eq("status", "published")
    .eq("creators.status", "published")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data as (Product & { creators: Creator })[]) ?? []).map((row) => ({
    product: row,
    creator: {
      id: row.creators.id,
      store_slug: row.creators.store_slug,
      store_name: row.creators.store_name,
      logo_url: row.creators.logo_url,
    },
  }));
}

/** List all published creators (for store-spotlight sections). */
export async function listFeaturedCreators(
  limit = 6
): Promise<Creator[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("creators")
    .select("*")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as Creator[]) ?? [];
}

// ── Orders (creator dashboard) ────────────────────────────────────────
export async function getOrdersByCreator(creatorId: string): Promise<Order[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("orders")
    .select("*")
    .eq("creator_id", creatorId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Order[]) ?? [];
}
