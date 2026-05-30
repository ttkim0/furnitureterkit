// Route guard: if not authed, redirect to /auth. While the auth check is in
// flight, render a small loading state in the aurora palette.

import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { ready, authed } = useAuth();
  if (!ready) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#06070d",
          color: "rgba(241, 235, 222, 0.65)",
          fontFamily: "EB Garamond, serif",
          fontStyle: "italic",
          fontSize: 18,
        }}
      >
        Spinning the thread…
      </div>
    );
  }
  if (!authed) {
    return <Navigate to="/auth" replace />;
  }
  return <>{children}</>;
}
