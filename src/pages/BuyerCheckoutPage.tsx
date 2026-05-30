// Buyer checkout — /shop/:slug/:productSlug/checkout
//
// What a real customer sees when they click "Purchase" on a product page.
// Same minimalist 3-section layout as the creator-side checkout, but the
// money flows to the creator (mock-recorded in `orders` table for now;
// Phase 4.1 will swap to Stripe Connect).

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  getCreatorBySlug,
  getProductBySlug,
} from "../lib/storeDb";
import { placeOrder } from "../lib/orderDb";
import {
  formatPrice,
  TYPOGRAPHY_FONTS,
  type Creator,
  type Product,
} from "../lib/marketplace";
import { track } from "../lib/analytics";

export function BuyerCheckoutPage() {
  const { slug, productSlug } = useParams<{ slug: string; productSlug: string }>();
  const navigate = useNavigate();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "notfound">("loading");

  // Form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postal, setPostal] = useState("");
  const [country, setCountry] = useState("US");
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [expiry, setExpiry] = useState("12/29");
  const [cvv, setCvv] = useState("123");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug || !productSlug) return;
    (async () => {
      try {
        const c = await getCreatorBySlug(slug);
        if (!c) return setLoad("notfound");
        const p = await getProductBySlug(c.id, productSlug);
        if (!p) return setLoad("notfound");
        setCreator(c);
        setProduct(p);
        setLoad("ready");
        track(slug, "checkout_started", p.id);
      } catch {
        setLoad("notfound");
      }
    })();
  }, [slug, productSlug]);

  if (load === "loading") return <main className="store-page store-loading">Loading…</main>;
  if (load === "notfound" || !creator || !product) {
    return (
      <main className="store-page store-notfound">
        <div>
          <h1>Not found</h1>
          <Link to={`/shop/${slug ?? ""}`}>← Back to store</Link>
        </div>
      </main>
    );
  }

  const fonts = TYPOGRAPHY_FONTS[creator.typography];
  const themeStyles = {
    "--store-bg": creator.palette.primary,
    "--store-accent": creator.palette.accent,
    "--store-text": creator.palette.text,
    "--store-muted": creator.palette.muted,
    "--store-display-font": fonts.display,
    "--store-body-font": fonts.body,
  } as React.CSSProperties;

  // 10% platform fee, paid by buyer on top of list price (transparent here).
  const subtotal = product.price_cents;
  const fee = Math.round(subtotal * 0.10);
  const shipping = 0; // Free shipping for now — Phase 4.2 = shipping zones
  const total = subtotal + fee + shipping;

  async function handlePay() {
    setError(null);
    if (!name.trim() || !email.trim() || !street.trim() || !city.trim() || !postal.trim()) {
      setError("Please fill in name, email, and shipping address.");
      return;
    }
    if (!email.includes("@")) {
      setError("That email looks off.");
      return;
    }
    setProcessing(true);
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const order = await placeOrder({
        product: product!,
        creator_id: creator!.id,
        buyer_email: email.trim(),
        buyer_name: name.trim() || undefined,
        shipping_address: {
          street: street.trim(),
          city: city.trim(),
          region: region.trim(),
          postal_code: postal.trim(),
          country,
        },
      });
      track(creator!.store_slug, "purchase_complete", product!.id);
      navigate(`/shop/${creator!.store_slug}/order/${order.order_number}`);
    } catch (e) {
      setProcessing(false);
      setError(e instanceof Error ? e.message : "Order failed.");
    }
  }

  return (
    <main className="store-page buyer-checkout-page" style={themeStyles}>
      <Link to={`/shop/${creator.store_slug}/${product.slug}`} className="store-back-link">
        ← Back to piece
      </Link>

      <div className="buyer-checkout-layout">
        <section className="buyer-summary">
          <h2>Order summary</h2>
          <div className="buyer-line">
            <span>{product.title}</span>
            <span>{formatPrice(subtotal, product.currency)}</span>
          </div>
          <div className="buyer-line buyer-line-muted">
            <span>Platform fee (10%)</span>
            <span>{formatPrice(fee, product.currency)}</span>
          </div>
          <div className="buyer-line buyer-line-muted">
            <span>Shipping</span>
            <span>{shipping === 0 ? "Free" : formatPrice(shipping, product.currency)}</span>
          </div>
          <div className="buyer-divider" />
          <div className="buyer-line buyer-line-total">
            <span>Total</span>
            <span>{formatPrice(total, product.currency)}</span>
          </div>

          <div className="buyer-seller">
            <span>Sold by</span>
            <Link to={`/shop/${creator.store_slug}`} className="buyer-seller-link">
              {creator.store_name}
            </Link>
          </div>
        </section>

        <section className="buyer-form">
          <div className="flow-test-mode">
            <strong>Test mode</strong> — no real charge. Real Stripe Connect ships in a follow-up.
          </div>

          <h3>Contact</h3>
          <label className="flow-field">
            <span>Full name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flow-field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>

          <h3>Shipping</h3>
          <label className="flow-field">
            <span>Street address</span>
            <input type="text" value={street} onChange={(e) => setStreet(e.target.value)} />
          </label>
          <div className="flow-field-row">
            <label className="flow-field flow-field-half">
              <span>City</span>
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} />
            </label>
            <label className="flow-field flow-field-half">
              <span>State / Region</span>
              <input type="text" value={region} onChange={(e) => setRegion(e.target.value)} />
            </label>
          </div>
          <div className="flow-field-row">
            <label className="flow-field flow-field-half">
              <span>Postal code</span>
              <input type="text" value={postal} onChange={(e) => setPostal(e.target.value)} />
            </label>
            <label className="flow-field flow-field-half">
              <span>Country</span>
              <select value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="US">United States</option>
                <option value="CA">Canada</option>
                <option value="GB">United Kingdom</option>
                <option value="AU">Australia</option>
                <option value="DE">Germany</option>
                <option value="FR">France</option>
                <option value="JP">Japan</option>
                <option value="KR">Korea</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
          </div>

          <h3>Payment</h3>
          <label className="flow-field">
            <span>Card number</span>
            <input type="text" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} />
          </label>
          <div className="flow-field-row">
            <label className="flow-field flow-field-half">
              <span>Expiry</span>
              <input type="text" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </label>
            <label className="flow-field flow-field-half">
              <span>CVV</span>
              <input type="text" value={cvv} onChange={(e) => setCvv(e.target.value)} maxLength={4} />
            </label>
          </div>

          {error && <div className="flow-error">{error}</div>}

          <button className="product-buy-btn buyer-pay-btn" onClick={handlePay} disabled={processing}>
            {processing ? "Processing…" : `Pay ${formatPrice(total, product.currency)}`}
          </button>
        </section>
      </div>
    </main>
  );
}
