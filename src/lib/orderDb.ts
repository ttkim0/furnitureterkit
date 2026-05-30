// Order placement + lookup. Splits from storeDb because creator-side and
// buyer-side queries have different access patterns and RLS implications.

import { getSupabase } from "./supabase";
import type { Order, Product } from "./marketplace";

export interface PlaceOrderInput {
  product: Product;
  creator_id: string;
  buyer_email: string;
  buyer_name?: string;
  shipping_address?: Record<string, unknown>;
  notes?: string;
}

/** Insert a paid order via the buyer-side flow.
 *  The RLS policy "anyone inserts orders" allows this without auth. */
export async function placeOrder(input: PlaceOrderInput): Promise<Order> {
  const sb = getSupabase();
  const order_number = generateOrderNumber();
  const { data, error } = await sb
    .from("orders")
    .insert({
      order_number,
      product_id: input.product.id,
      creator_id: input.creator_id,
      buyer_email: input.buyer_email,
      buyer_name: input.buyer_name ?? null,
      amount_cents: input.product.price_cents,
      currency: input.product.currency,
      status: "paid",
      payment_method: "mock-test",
      paid_at: new Date().toISOString(),
      shipping_address: input.shipping_address ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Order;
}

/** Public order lookup by unguessable order_number — calls the SECURITY
 *  DEFINER RPC `get_order_by_number` which bypasses RLS for this single
 *  query. */
export async function getOrderByNumber(orderNumber: string): Promise<Order | null> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("get_order_by_number", {
    p_order_number: orderNumber,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as Order) ?? null;
}

function generateOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ORD-${ts}-${rnd}`;
}
