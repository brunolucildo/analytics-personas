import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createAppRouter } from "./router";
import "./index.css";

const queryClient = new QueryClient();
const router = createAppRouter();

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
