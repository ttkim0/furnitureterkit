// Checkout page — minimalist mock payment.
//
// NOT a real payment gateway — Stripe Connect comes in a later phase.
// For now: validates the form shape, simulates a 2s "processing" state,
// generates a fake order ID, and navigates to /app/published.
//
// Any input is accepted (clearly labeled as test mode) so testing the
// flow is fast and friction-free.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getCheckoutSession,
  updateCheckoutSession,
} from "../lib/checkoutSession";

export function CheckoutPage() {
  const navigate = useNavigate();
  const session = getCheckoutSession();

  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [expiry, setExpiry] = useState("12/29");
  const [cvv, setCvv] = useState("123");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) {
    return (
      <main className="flow-page flow-empty">
        <div className="flow-empty-inner">
          <h1>Nothing in your cart</h1>
          <p>Finalize a piece first to start checkout.</p>
          <Link className="flow-btn flow-btn-primary" to="/app">
            Open editor
          </Link>
        </div>
      </main>
    );
  }

  async function handlePay() {
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required (we'll send your receipt there).");
      return;
    }
    if (!email.includes("@")) {
      setError("That email looks off — double-check it.");
      return;
    }
    setProcessing(true);
    // Mock the gateway latency so the UX feels real.
    await new Promise((r) => setTimeout(r, 1800));
    const orderId = "ORD-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    updateCheckoutSession({ orderId, paidAt: Date.now() });
    navigate("/app/published");
  }

  const price = session.proposedPriceUsd ?? 0;
  const platformFee = Math.round(price * 0.05 * 100) / 100; // 5%
  const total = price + platformFee;

  return (
    <main className="flow-page">
      <div className="flow-stepper">
        <Link className="flow-step" to="/app/review">
          Review
        </Link>
        <span className="flow-step-divider" />
        <span className="flow-step flow-step-active">Checkout</span>
        <span className="flow-step-divider" />
        <span className="flow-step">Publish</span>
      </div>

      <header className="flow-header">
        <h1>Confirm and publish</h1>
        <p className="flow-sub">
          One-time listing fee to put this piece on your storefront. You'll
          earn the full sale price (minus payment processing) on every order.
        </p>
      </header>

      <section className="flow-card flow-order-summary">
        <h2>Order summary</h2>
        <div className="flow-summary-line">
          <span>{session.proposedTitle ?? "Untitled piece"}</span>
          <span>${price.toFixed(2)}</span>
        </div>
        <div className="flow-summary-line flow-summary-sub">
          <span>Platform listing fee (5%)</span>
          <span>${platformFee.toFixed(2)}</span>
        </div>
        <div className="flow-summary-divider" />
        <div className="flow-summary-line flow-summary-total">
          <span>Total today</span>
          <span>${total.toFixed(2)}</span>
        </div>
      </section>

      <section className="flow-card flow-payment">
        <div className="flow-test-mode">
          <strong>Test mode</strong> — no real charges. Pre-filled values
          accept any input. Real Stripe Connect ships later.
        </div>

        <label className="flow-field">
          <span>Cardholder name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="As shown on card"
            autoComplete="cc-name"
          />
        </label>

        <label className="flow-field">
          <span>Email for receipt</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>

        <label className="flow-field">
          <span>Card number</span>
          <input
            type="text"
            value={cardNumber}
            onChange={(e) => setCardNumber(e.target.value)}
            inputMode="numeric"
            autoComplete="cc-number"
          />
        </label>

        <div className="flow-field-row">
          <label className="flow-field flow-field-half">
            <span>Expiry</span>
            <input
              type="text"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              placeholder="MM/YY"
              autoComplete="cc-exp"
            />
          </label>
          <label className="flow-field flow-field-half">
            <span>CVV</span>
            <input
              type="text"
              value={cvv}
              onChange={(e) => setCvv(e.target.value)}
              maxLength={4}
              inputMode="numeric"
              autoComplete="cc-csc"
            />
          </label>
        </div>

        {error && <div className="flow-error">{error}</div>}
      </section>

      <footer className="flow-footer">
        <Link className="flow-btn flow-btn-ghost" to="/app/review">
          ‹ Back to review
        </Link>
        <button
          className="flow-btn flow-btn-primary"
          onClick={handlePay}
          disabled={processing}
        >
          {processing ? "Processing…" : `Pay $${total.toFixed(2)} →`}
        </button>
      </footer>
    </main>
  );
}
