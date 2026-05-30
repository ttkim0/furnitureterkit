// Per-product image manager — used on the product page when the owner
// is viewing. Lets them upload a photo OR AI-generate one. Saves the
// chosen URL as `hero_image_url` on the product row.
//
// Three modes:
//   - No hero image yet: shows two big buttons (Upload / Generate AI).
//   - Hero image set + owner: shows the image with replace/regenerate
//     controls underneath.
//   - Not owner: this component renders nothing (the parent decides).

import { useRef, useState } from "react";
import {
  generateProductPhotoApi,
  uploadProductImage,
} from "../lib/api";
import type { Product } from "../lib/marketplace";

interface ProductImageManagerProps {
  product: Product;
  /** Called with the new image URL after upload/generate succeeds. The
   *  parent persists this to the products table. */
  onChange: (newHeroUrl: string) => Promise<void>;
}

export function ProductImageManager({ product, onChange }: ProductImageManagerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"idle" | "uploading" | "generating">("idle");
  const [error, setError] = useState<string | null>(null);
  const [aiStyle, setAiStyle] = useState<"lifestyle" | "studio" | "lifestyle-warm">("lifestyle");

  async function handleUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("File must be an image.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("Image must be under 12 MB.");
      return;
    }
    setBusy("uploading");
    setError(null);
    try {
      const result = await uploadProductImage(file);
      await onChange(result.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy("idle");
    }
  }

  async function handleAiGenerate() {
    setBusy("generating");
    setError(null);
    try {
      const result = await generateProductPhotoApi({
        title: product.title,
        description: product.description ?? "",
        category: product.spec_json.category,
        material: product.spec_json.primary_material,
        style: aiStyle,
      });
      await onChange(result.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "generation failed");
    } finally {
      setBusy("idle");
    }
  }

  return (
    <div className="product-image-manager">
      {product.hero_image_url ? (
        <div className="product-image-manager-current">
          <span className="product-image-manager-label">Current photo · owner controls</span>
        </div>
      ) : (
        <div className="product-image-manager-empty">
          <div className="product-image-manager-headline">
            <h3>This piece needs a photo</h3>
            <p>Upload one you took, or have us generate one with AI.</p>
          </div>
        </div>
      )}

      <div className="product-image-manager-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUpload(f);
            e.target.value = ""; // allow re-selecting same file
          }}
        />
        <button
          className="flow-btn flow-btn-ghost"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy !== "idle"}
        >
          {busy === "uploading" ? "Uploading…" : product.hero_image_url ? "Replace photo" : "Upload photo"}
        </button>

        <div className="product-image-manager-ai">
          <select
            value={aiStyle}
            onChange={(e) => setAiStyle(e.target.value as "lifestyle" | "studio" | "lifestyle-warm")}
            disabled={busy !== "idle"}
          >
            <option value="lifestyle">Lifestyle</option>
            <option value="studio">Studio</option>
            <option value="lifestyle-warm">Lifestyle (warm)</option>
          </select>
          <button
            className="flow-btn flow-btn-primary"
            onClick={handleAiGenerate}
            disabled={busy !== "idle"}
          >
            {busy === "generating" ? "Generating…" : product.hero_image_url ? "Regenerate with AI" : "Generate with AI"}
          </button>
        </div>
      </div>

      {error && <div className="flow-error product-image-manager-error">{error}</div>}
    </div>
  );
}
