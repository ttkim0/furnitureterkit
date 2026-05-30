// "Active store" tracking — for users who own multiple creators.
//
// We persist the currently-selected creator_id in localStorage so the
// user's choice survives page reloads + tabs. All multi-store-aware pages
// (Dashboard, Settings, AddProduct, Designer) read this.

import type { Creator } from "./marketplace";

const KEY = "ariadne:active-creator-id";

export function getActiveStoreId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setActiveStoreId(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore — private mode */
  }
}

/** Pick which creator should be "active" for the current user.
 *  - If the saved active id matches one they own, use it.
 *  - Otherwise the first (most recently created) one.
 *  - Returns null if they own none.
 *  Side effect: stores the chosen id back to localStorage so subsequent
 *  reads are stable. */
export function resolveActiveStore(stores: Creator[]): Creator | null {
  if (stores.length === 0) {
    setActiveStoreId(null);
    return null;
  }
  const saved = getActiveStoreId();
  const match = saved ? stores.find((s) => s.id === saved) : null;
  const picked = match ?? stores[0];
  if (saved !== picked.id) setActiveStoreId(picked.id);
  return picked;
}
