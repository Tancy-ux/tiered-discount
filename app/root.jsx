import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLocation,
  useRouteError,
} from "react-router";

// Errors outside the admin pages (such as an unknown address at the top
// level): a plain, readable page with a way back instead of bare text.
export function ErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  // Keep the shop/host query so, inside Shopify admin, the link opens the app
  // instead of the login page.
  const { search } = useLocation();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{notFound ? "Page not found" : "Something went wrong"}</title>
        <Meta />
        <Links />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily:
            "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background: "#f1f1f1",
          color: "#303030",
        }}
      >
        <main
          style={{
            background: "#fff",
            borderRadius: 12,
            padding: "32px 40px",
            maxWidth: 420,
            textAlign: "center",
            boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
          }}
        >
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>
            {notFound ? "Page not found" : "Something went wrong"}
          </h1>
          <p style={{ margin: "0 0 20px", color: "#616161" }}>
            {notFound
              ? "This page doesn't exist. The link may be old or mistyped."
              : "Please try again in a moment."}
          </p>
          {import.meta.env.DEV && !notFound && error instanceof Error && (
            <pre
              style={{
                textAlign: "left",
                whiteSpace: "pre-wrap",
                fontSize: 12,
                margin: "0 0 20px",
              }}
            >
              {error.stack ?? error.message}
            </pre>
          )}
          <a
            href={`/app${search}`}
            style={{ color: "#005bd3", fontWeight: 600 }}
          >
            Go to the app
          </a>
        </main>
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
