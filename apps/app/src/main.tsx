import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createQueryClient } from "./lib/query-client";
import { createAppRouter, redirectToSignIn } from "./router";
import "./index.css";

const router = createAppRouter();
// A 401 from the API means the session is gone: the API client already cleared the token.
const queryClient = createQueryClient(() => redirectToSignIn(router));

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Element #root not found in index.html.");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
