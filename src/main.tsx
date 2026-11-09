import './lib/zodConfig';
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App.tsx";
import "./styles/globals.css";
import { AuthProvider } from "./contexts/AuthProvider";
import { ErrorFallback } from "./components/ErrorFallback";
import { queryClient } from "./lib/queryClient";
import { scrubEvent } from "../supabase/functions/_shared/sentryScrub";

// Error monitoring — no-op unless VITE_SENTRY_DSN is set (dev/test unaffected)
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    release: `gigwrangler@${__BUILD_TIMESTAMP__}`,
    sendDefaultPii: false,
    // Email addresses and tokens never leave the browser in an error report.
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubEvent,
  });
}

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </Sentry.ErrorBoundary>
);
