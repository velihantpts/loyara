import { ORIGIN } from "../config";

// Minimal robots.txt: allow crawling the public marketing pages + point to the
// sitemap. Embedded /app/* routes need Shopify auth and aren't crawlable anyway.
export const loader = () => {
  const body = `User-agent: *
Allow: /
Sitemap: ${ORIGIN}/sitemap.xml
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=86400",
    },
  });
};
