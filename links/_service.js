// Hop backend: stores short links and follows them.
//
// No ports, no listen(): Yard runs this file as a fetch handler, mounted at /s
// (see .yard/settings.json). Paths arrive rooted at "/", so a visit to
// …/hop/s/launch reaches this file as "/launch".
//
// The service is public because anyone may follow a short link. Making and
// managing links needs a Yard Auth sign-in: for a signed-in visitor the edge
// adds a trusted X-Yard-User-Id header, and it strips any the client sends.
// There is deliberately no login code anywhere in this project.
//
//   GET    /                  back to the landing page (where sign-in lands)
//   GET    /api/links         your links, newest first
//   POST   /api/links         { url, alias? } -> the new link
//   DELETE /api/links/<code>  delete one of your links
//   GET    /<code>            302 to the destination, counting the click

const MAX_URL_LENGTH = 2048;
const MAX_LINKS_PER_USER = 500;

// Generated codes skip l, o, 0 and 1 so they survive being read aloud. 32
// letters divide 256 evenly, so every random byte maps to a letter unbiased.
const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 6;

// Any code, generated or picked as an alias: 2-32 lowercase letters, digits
// and dashes, starting with a letter or digit.
const CODE_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const RESERVED = new Set(["api"]);

export default {
  async fetch(request, env) {
    // Directory URLs arrive as their index.html: ".../s/" is "/index.html".
    const path = new URL(request.url).pathname.replace(/\/index\.html$/, "/");

    // Yard Auth's login and logout return here; send people back to the page.
    if (path === "/") return redirect("../");

    if (path === "/api/links" || path.startsWith("/api/links/")) {
      try {
        return await handleAPI(request, env, path);
      } catch (err) {
        console.error(`[hop] ${request.method} ${path} failed`, err && err.stack);
        return json({ error: "Something went wrong on our end." }, 500);
      }
    }

    return follow(env, path.slice(1).replace(/\/$/, ""));
  },
};

async function handleAPI(request, env, path) {
  const user = request.headers.get("X-Yard-User-Id");
  if (!user) return json({ error: "Sign in to make short links." }, 401);

  if (path === "/api/links") {
    if (request.method === "GET") return listLinks(env, user);
    if (request.method === "POST") return createLink(request, env, user);
  } else if (request.method === "DELETE") {
    return deleteLink(env, user, path.slice("/api/links/".length));
  }
  return json({ error: "Not found." }, 404);
}

async function listLinks(env, user) {
  const { results } = await env.DB.prepare(
    "SELECT code, url, clicks, created_at FROM links WHERE owner_id = ?1 ORDER BY created_at DESC",
  )
    .bind(user)
    .all();
  return json(results);
}

async function createLink(request, env, user) {
  // Requiring JSON means a cross-site form can't post here: browsers preflight
  // a cross-origin application/json request, and this service never allows it.
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    return json({ error: "Send the link as JSON." }, 415);
  }
  const body = await request.json().catch(() => ({}));

  const url = normalizeUrl(body.url);
  if (!url) return json({ error: "That doesn't look like a web link." }, 400);

  const alias = String(body.alias ?? "").trim().toLowerCase();
  if (alias && (!CODE_RE.test(alias) || RESERVED.has(alias))) {
    return json({ error: "Aliases are 2-32 letters, numbers or dashes." }, 400);
  }

  const { count } = await env.DB.prepare("SELECT COUNT(*) AS count FROM links WHERE owner_id = ?1")
    .bind(user)
    .first();
  if (count >= MAX_LINKS_PER_USER) {
    return json({ error: `You can keep up to ${MAX_LINKS_PER_USER} links. Delete a few first.` }, 403);
  }

  // A chosen alias gets one try. A generated code retries on the rare clash.
  for (let attempt = 0; attempt < (alias ? 1 : 5); attempt++) {
    const link = await env.DB.prepare(
      `INSERT INTO links (code, url, owner_id) VALUES (?1, ?2, ?3)
       ON CONFLICT (code) DO NOTHING
       RETURNING code, url, clicks, created_at`,
    )
      .bind(alias || randomCode(), url, user)
      .first();
    if (link) return json(link, 201);
  }
  return json({ error: alias ? "That alias is taken. Try another." : "Please try again." }, 409);
}

async function deleteLink(env, user, code) {
  const { meta } = await env.DB.prepare("DELETE FROM links WHERE code = ?1 AND owner_id = ?2")
    .bind(code.toLowerCase(), user)
    .run();
  return meta.changes ? new Response(null, { status: 204 }) : json({ error: "Link not found." }, 404);
}

async function follow(env, code) {
  code = code.toLowerCase();
  if (!CODE_RE.test(code)) return notFound();

  // One statement both counts the click and finds where to go.
  const link = await env.DB.prepare("UPDATE links SET clicks = clicks + 1 WHERE code = ?1 RETURNING url")
    .bind(code)
    .first();
  return link ? Response.redirect(link.url, 302) : notFound();
}

// Accepts "example.com/page" as well as full links, and only ever returns an
// http(s) URL, so a short link can never point at javascript: or data:.
function normalizeUrl(input) {
  let text = String(input ?? "").trim();
  if (!text || text.length > MAX_URL_LENGTH) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    const web = url.protocol === "https:" || url.protocol === "http:";
    return web && url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Relative, so it resolves against wherever the service is mounted.
function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function notFound() {
  return new Response(NOT_FOUND_PAGE, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const NOT_FOUND_PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link not found · Hop</title>
<style>
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; text-align: center; padding: 24px; }
  h1 { font-size: 28px; letter-spacing: -0.02em; margin: 0 0 8px; }
  p { margin: 0 0 24px; opacity: 0.65; }
  a { display: inline-block; padding: 12px 20px; border-radius: 12px; background: #5b4cff; color: #fff; text-decoration: none; font-weight: 600; }
</style>
<main>
  <h1>This short link doesn't exist</h1>
  <p>It may have been deleted, or there's a typo in the address.</p>
  <a href="../">Make your own short link</a>
</main>
</html>
`;
