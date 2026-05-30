import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import { LandingPage } from "./pages/LandingPage";
import { TerkitLandingPage } from "./pages/TerkitLandingPage";
import { AuthPage } from "./pages/AuthPage";
import { ReviewPage } from "./pages/ReviewPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { PublishedPage } from "./pages/PublishedPage";
import { StoreBuilderPage } from "./pages/StoreBuilderPage";
import { StoreDesignerPage } from "./pages/StoreDesignerPage";
import { StoreSettingsPage } from "./pages/StoreSettingsPage";
import { StoresPage } from "./pages/StoresPage";
import { AddProductPage } from "./pages/AddProductPage";
import { DashboardPage } from "./pages/DashboardPage";
import { MarketplacePage } from "./pages/MarketplacePage";
import { StorefrontPage } from "./pages/StorefrontPage";
import { ProductPage } from "./pages/ProductPage";
import { BuyerCheckoutPage } from "./pages/BuyerCheckoutPage";
import { OrderConfirmationPage } from "./pages/OrderConfirmationPage";
import { RequireAuth } from "./components/RequireAuth";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Public marketing landing (Terkit AI waitlist). The old landing
            is kept at /old-landing in case we want to compare. */}
        <Route path="/" element={<TerkitLandingPage />} />
        <Route path="/old-landing" element={<LandingPage />} />
        <Route path="/terkit" element={<TerkitLandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <App />
            </RequireAuth>
          }
        />
        {/* Post-CAD flow — review → mock checkout → published */}
        <Route
          path="/app/review"
          element={
            <RequireAuth>
              <ReviewPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/checkout"
          element={
            <RequireAuth>
              <CheckoutPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/published"
          element={
            <RequireAuth>
              <PublishedPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/store-builder"
          element={
            <RequireAuth>
              <StoreBuilderPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/store-designer"
          element={
            <RequireAuth>
              <StoreDesignerPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/store-settings"
          element={
            <RequireAuth>
              <StoreSettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/add-product"
          element={
            <RequireAuth>
              <AddProductPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/stores"
          element={
            <RequireAuth>
              <StoresPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/dashboard"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />
        {/* Public marketplace + storefronts — no auth required */}
        <Route path="/shop" element={<MarketplacePage />} />
        <Route path="/shop/:slug" element={<StorefrontPage />} />
        <Route path="/shop/:slug/:productSlug" element={<ProductPage />} />
        <Route path="/shop/:slug/:productSlug/checkout" element={<BuyerCheckoutPage />} />
        <Route path="/shop/:slug/order/:orderNumber" element={<OrderConfirmationPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
