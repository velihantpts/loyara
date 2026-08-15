import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import {
  Link,
  Outlet,
  useLoaderData,
  useRouteError,
  isRouteErrorResponse,
} from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/members">Members</Link>
        <Link to="/app/settings">Settings</Link>
        <Link to="/app/migrate">Import points</Link>
        <Link to="/app/guide">Guide</Link>
        <Link to="/app/upgrade">Plans</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Thrown Responses (auth redirects, loader 4xx/5xx) MUST go through Shopify's
// boundary so their headers propagate. For an uncaught JS error — which would
// otherwise show Shopify's raw error frame — render a small branded retry
// instead. Plain HTML so a missing AppProvider context can't error-in-error.
export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) return boundary.error(error);
  return (
    <div
      style={{
        maxWidth: 460,
        margin: "80px auto",
        padding: 24,
        textAlign: "center",
        fontFamily:
          "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
        color: "#1a1a1a",
      }}
    >
      <h1 style={{ fontSize: 18, margin: "0 0 6px" }}>Something went wrong</h1>
      <p style={{ color: "#616161", margin: "0 0 16px" }}>
        This page hit an unexpected error. Your data is safe — reload to try
        again.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: "8px 16px",
          borderRadius: 8,
          border: "1px solid #008060",
          background: "#008060",
          color: "#fff",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Reload
      </button>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
