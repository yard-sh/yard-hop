# Hop

<p align="center">
<a href="https://dash.yard.sh/projects?action=create&repo=https%3A%2F%2Fgithub.com%2Fyard-sh%2Fyard-hop"><img src="https://yard.sh/create-in-yard.png" width="200" alt="Create in Yard" /></a>
</p>

A small link shortener built on Yard. Paste a long link, get a short one like
`alice.yard.sh/hop/s/k3x9pq`. You can also pick your own alias
(`…/s/launch`), see how many times each link was clicked, and download a
QR code for any link.

The shortener runs right on the project's landing page. There is no separate
app to open, no build step, and no dependencies.

## Run it

```sh
yard dev              # landing page:  http://localhost:9875/hop/
                      # short links:   http://localhost:9875/hop/s/<code>
```

Anyone can follow a short link. Making links needs a sign-in, and Yard Auth
handles it: there is no login code in this repo. Locally, a **persona**
stands in for Yard Auth. Click **Sign in** on the page and pick one
(`signed-in`, `trial`, `member`, …). Each persona is a different person with
their own links. `yard dev --reset-db` gives you an empty database.

## How it fits together

```
.yard/settings.json              one service "links" at /s: access=public, database_access=true;
                                 landing_page=custom; a single free Base tier
.yard/migrations/0001_init.sql   the links table
.yard/landing-page/              the page, which is also the whole app
  index.html · styles.css        markup and design (light and dark)
  app.js                         talks to the service, renders your links, draws QR codes
  qrcode.js                      QR encoder (vendored, MIT, Kazuhiko Arase)
  favicon.svg
links/_service.js                the backend: the links API plus the redirects
```

**The landing page is the app.** Landing pages are static, so storing links
takes a small service. It is mounted at `/s`, next to the page, and the page
calls it with relative URLs (`s/api/links`). That keeps the same bundle
working at `<team>.yard.sh/hop/`, inside a `/@sandbox/`, and on a custom
domain.

**One service does two jobs.** `links/_service.js` is a single fetch
handler:

| Request                     | What it does                               |
| --------------------------- | ------------------------------------------ |
| `GET s/<code>`              | 302 to the destination and count the click |
| `GET s/api/links`           | your links, newest first                   |
| `POST s/api/links`          | `{ url, alias? }` → the new link           |
| `DELETE s/api/links/<code>` | delete one of your links                   |
| `GET s/`                    | back to the landing page                   |

The service is `public` because short links have to work for everyone. The
API still knows who is asking: when a visitor is signed in, the Yard edge adds
a trusted `X-Yard-User-Id` header (and strips any the client sends). No header
means 401, and every query is scoped to that user id. So you only ever see or
delete your own links.

**Signing in.** Yard Auth answers at the project root too, so the page uses it
directly: it asks `__yard/auth/me` whether someone is signed in, and **Sign
in** and **Sign out** link to `__yard/auth/login?return=/` and
`__yard/auth/logout?return=/`. At the project root `return=/` is the page
itself, and one session covers the page and the service. If a signed-out
visitor presses **Shorten**, the page saves what they typed in
`sessionStorage`, sends them through sign-in, and creates the link once they
are back.

**One table.** `links (code, url, owner_id, clicks, created_at)`, with `code`
as the primary key. Following a link runs a single statement,
`UPDATE … SET clicks = clicks + 1 … RETURNING url`, which counts the click
and finds the destination at once.

**Codes.** Generated codes are six characters from an alphabet without `l`,
`o`, `0` or `1`, so they survive being read aloud. Aliases are 2–32 lowercase
letters, digits and dashes. Codes are case-insensitive (`s/Launch` works), and
`api` is reserved. An insert uses `ON CONFLICT DO NOTHING`, so a taken alias
comes back as a clean 409, never an error.

**Safe destinations.** The service only stores `http` and `https` links, so a
short link can never point at `javascript:` or `data:`. `example.com/page`
becomes `https://example.com/page`. The create endpoint only accepts JSON,
which a cross-site form can't send without a CORS preflight.

**QR codes.** `qrcode.js` encodes the short link, and `app.js` draws it: as an
SVG on the page and as a PNG for **Download**. Both are drawn on a white
background so every phone can scan them, in light mode and dark mode alike.

## Make it yours

- **Branding.** Name, headline and copy are in `index.html`. Colors and fonts
  (Geist, Geist Mono) are tokens at the top of `styles.css`, and dark mode
  just swaps those tokens.
- **A different path.** Change the service's `url` in `.yard/settings.json`
  and the `"s/"` in `app.js` (`SERVICE`) to match.
- **Limits.** `MAX_LINKS_PER_USER`, `MAX_URL_LENGTH` and `CODE_LENGTH` are at
  the top of `links/_service.js`.
- **Make it paid.** Keep the service `public` so short links still open for
  everyone. Then only allow buyers to create links: in `handleAPI`, reject
  requests where `X-Yard-Entitlement` is `none`. Finally, set a price on the
  tier in `.yard/settings.json`.
- **Schema changes.** Add a new numbered file (`0002_….sql`) to
  `.yard/migrations/`. Never edit a migration that has already been applied.

## Ship it

```sh
yard service check              # validate the bundle offline
yard push                       # upload page, service and migrations into a draft release
yard releases publish v0.1.0    # go live; migrations run before the new service deploys
```

Nothing serves a draft; publishing is the deploy. To try a release before
anyone else sees it, run `yard sandbox create preview`, publish, then
`yard sandbox pin v0.1.0 --sandbox preview`. A sandbox has its own
database, so test links never reach the real one. Use `yard db query "select *
from links"` to look at the data, and `yard service logs` to read the service's logs.

Hop needs a custom landing page and a hosted service (both Pro), plus Yard
Auth for sign-in (Basic and Pro). Check what your team has with
`yard me --json` → `.team_permissions`.
