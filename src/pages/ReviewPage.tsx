// Review page — first stop after CAD finalization.
//
// Shows: the generated mesh in a clean R3F canvas, the CAD bundle summary,
// and a draft listing form (title, price, description). User reviews
// everything and proceeds to mock checkout.

import { Suspense, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Canvas } from "@react-three/fiber";
import { Bounds, Environment, OrbitControls, useGLTF } from "@react-three/drei";
import {
  getCheckoutSession,
  updateCheckoutSession,
  suggestPriceUsd,
  suggestTitle,
} from "../lib/checkoutSession";

export function ReviewPage() {
  const navigate = useNavigate();
  const session = getCheckoutSession();

  // Form draft state — initialized from session, persisted on every keystroke.
  const initial = useMemo(() => {
    if (!session) return null;
    return {
      title: session.proposedTitle ?? suggestTitle(session.spec, session.modelPrompt),
      price: session.proposedPriceUsd ?? suggestPriceUsd(session.spec),
      description: session.proposedDescription ?? defaultDescription(session.spec, session.modelPrompt),
    };
  }, [session?.modelId]);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [price, setPrice] = useState<number>(initial?.price ?? 0);
  const [description, setDescription] = useState(initial?.description ?? "");

  // No session = user landed here without going through the flow.
  if (!session || !initial) {
    return (
      <main className="flow-page flow-empty">
        <div className="flow-empty-inner">
          <h1>Nothing to review</h1>
          <p>This page shows your latest finalized piece. Go design one first.</p>
          <Link className="flow-btn flow-btn-primary" to="/app">
            Open editor
          </Link>
        </div>
      </main>
    );
  }

  function handleContinue() {
    updateCheckoutSession({
      proposedTitle: title.trim() || "Untitled piece",
      proposedPriceUsd: Math.max(1, Math.round(price)),
      proposedDescription: description.trim(),
    });
    navigate("/app/checkout");
  }

  return (
    <main className="flow-page">
      <div className="flow-stepper">
        <span className="flow-step flow-step-active">Review</span>
        <span className="flow-step-divider" />
        <span className="flow-step">Checkout</span>
        <span className="flow-step-divider" />
        <span className="flow-step">Publish</span>
      </div>

      <header className="flow-header">
        <h1>Your piece is ready</h1>
        <p className="flow-sub">
          Confirm the details. Manufacturing files are downloaded; this
          listing will go live on your storefront after checkout.
        </p>
      </header>

      <section className="flow-card flow-mesh">
        <Canvas
          camera={{ position: [2.4, 1.8, 2.6], fov: 35 }}
          dpr={[1, 2]}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
        >
          <ambientLight intensity={0.4} />
          <directionalLight position={[5, 10, 5]} intensity={1.1} />
          <Suspense fallback={null}>
            <Bounds fit clip observe margin={1.15}>
              <MeshFromUrl url={session.meshUrl} />
            </Bounds>
            <Environment preset="studio" />
          </Suspense>
          <OrbitControls
            makeDefault
            enablePan={false}
            minDistance={1.2}
            maxDistance={6}
          />
        </Canvas>
      </section>

      <section className="flow-card flow-cad-summary">
        <div className="flow-cad-row">
          <span className="flow-cad-label">CAD bundle</span>
          <a
            className="flow-cad-link"
            href={session.cadZipUrl}
            download={`${session.spec.category}-${session.modelId.slice(-8)}-cad.zip`}
          >
            Download again ↓
          </a>
        </div>
        <div className="flow-cad-stats">
          <Stat n={session.cadSummary.part_count} label="parts" />
          <Stat n={session.cadSummary.cutlist_rows} label="cutlist rows" />
          <Stat
            n={Object.keys(session.cadSummary.files.parts_dxf).length}
            label="DXF panels"
          />
          <Stat n={session.cadSummary.bom_rows} label="BOM items" />
        </div>
        <p className="flow-cad-formats">
          STEP (assembled + per-part) · DXF for CNC · cutlist.csv · bom.json
        </p>
      </section>

      <section className="flow-card flow-listing">
        <h2>Listing draft</h2>
        <p className="flow-help">
          This is what buyers will see in your store. Edit anytime later.
        </p>

        <label className="flow-field">
          <span>Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Walnut Lounge Chair"
            maxLength={80}
          />
        </label>

        <label className="flow-field">
          <span>Price (USD)</span>
          <div className="flow-price-input">
            <span className="flow-currency">$</span>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(Number(e.target.value) || 0)}
              min={1}
              step={10}
            />
          </div>
          <span className="flow-field-hint">
            Suggested ${suggestPriceUsd(session.spec)} based on size & category.
          </span>
        </label>

        <label className="flow-field">
          <span>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="What makes this piece special? Materials, build, story…"
            maxLength={500}
          />
        </label>
      </section>

      <footer className="flow-footer">
        <Link className="flow-btn flow-btn-ghost" to="/app">
          ‹ Back to editor
        </Link>
        <button
          className="flow-btn flow-btn-primary"
          onClick={handleContinue}
          disabled={!title.trim() || price < 1}
        >
          Continue to checkout →
        </button>
      </footer>
    </main>
  );
}

function MeshFromUrl({ url }: { url: string }) {
  const gltf = useGLTF(url);
  return <primitive object={gltf.scene} />;
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flow-stat">
      <span className="flow-stat-n">{n}</span>
      <span className="flow-stat-label">{label}</span>
    </div>
  );
}

function defaultDescription(
  spec: { category: string; primary_material: string },
  prompt: string
): string {
  return (
    `${prompt}.\n\n` +
    `Made from ${spec.primary_material.toLowerCase()}. Manufacturing-ready ` +
    `STEP and DXF files are included with every order so you can build, ` +
    `tweak, or commission this piece anywhere.`
  );
}
