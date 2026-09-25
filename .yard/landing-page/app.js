// Hop landing page. The whole link shortener runs here.
//
// The page talks to one service, mounted at s/ (see .yard/settings.json):
//   s/api/links       list, create and delete your links
//   s/<code>          a short link; the service redirects and counts the click
// and to Yard Auth at the project root, beside this page:
//   __yard/auth/*     me, login and logout (no auth code here)
// Every URL is relative, so the page works at <team>.yard.sh/hop/, inside a
// /@sandbox/, and on a custom domain.
(() => {
  "use strict";

  // Resolve against the page's directory even when the URL arrives without
  // its trailing slash (/hop rather than /hop/).
  let base = location.href.split(/[?#]/)[0];
  if (!base.endsWith("/") && !base.endsWith(".html")) base += "/";
  const SERVICE = new URL("s/", base);

  // At the project root, return=/ is this page, so sign-in and sign-out both
  // come straight back here. One session covers the page and the service.
  const LOGIN = new URL("__yard/auth/login?return=/", base).href;
  const LOGOUT = new URL("__yard/auth/logout?return=/", base).href;

  // What a signed-out visitor typed, kept across the trip through sign-in.
  const PENDING = "hop:pending";

  const $ = (id) => document.getElementById(id);
  const form = $("form");
  const urlInput = $("url");
  const aliasInput = $("alias");

  let signedIn = false;
  let links = [];
  let resultCode = null; // the link shown in the "ready" card

  /* ---------------------------------------------------------------- start */

  $("prefix").textContent = prefix();
  start();

  async function start() {
    const me = await fetch(new URL("__yard/auth/me", base))
      .then((res) => res.json())
      .catch(() => null);
    signedIn = Boolean(me?.authenticated);
    renderAccount(me);
    if (!signedIn) return;

    $("note").hidden = true;
    await refresh();
    resumePending();
  }

  async function refresh() {
    try {
      links = await call("GET", "api/links");
      renderLinks();
    } catch (err) {
      showError(err.message);
    }
  }

  // Click counts change while the tab is in the background.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && signedIn) refresh();
  });

  /* -------------------------------------------------------------- shorten */

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = urlInput.value.trim();
    const alias = aliasInput.value.trim();
    if (!url) return showError("Paste a link to shorten.");

    if (!signedIn) {
      store(PENDING, JSON.stringify({ url, alias }));
      location.href = LOGIN;
      return;
    }
    shorten(url, alias);
  });

  aliasInput.addEventListener("input", () => {
    aliasInput.value = aliasInput.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
  });

  async function shorten(url, alias) {
    showError("");
    $("submit").disabled = true;
    try {
      const link = await call("POST", "api/links", { url, alias });
      links.unshift(link);
      renderLinks(link.code);
      showResult(link);
      form.reset();
    } catch (err) {
      showError(err.message);
    } finally {
      $("submit").disabled = false;
    }
  }

  function resumePending() {
    const pending = store(PENDING);
    if (!pending) return;
    store(PENDING, null);
    const { url, alias } = JSON.parse(pending);
    urlInput.value = url;
    aliasInput.value = alias;
    shorten(url, alias);
  }

  function showResult(link) {
    resultCode = link.code;
    const short = shortUrl(link.code);
    $("result-link").href = short;
    showShort($("result-link"), link.code);
    $("result-dest").textContent = `→ ${bare(link.url)}`;
    $("result-qr").innerHTML = qrSvg(short);
    $("result-qr").onclick = () => openQr(link.code);
    $("result-copy").onclick = () => copy(short);

    const result = $("result");
    result.hidden = false;
    result.classList.remove("pop");
    void result.offsetWidth; // restart the entrance animation
    result.classList.add("pop");
  }

  /* ------------------------------------------------------------ your links */

  function renderLinks(freshCode) {
    const list = $("list");
    list.replaceChildren(...links.map((link) => row(link, link.code === freshCode)));
    $("links").hidden = false;
    $("empty").hidden = links.length > 0;
    $("count").textContent = links.length ? String(links.length) : "";
  }

  function row(link, fresh) {
    const item = $("row").content.firstElementChild.cloneNode(true);
    const short = shortUrl(link.code);
    const anchor = item.querySelector(".short");
    anchor.href = short;
    showShort(anchor, link.code);
    item.querySelector(".dest").textContent = `${bare(link.url)} · ${ago(link.created_at)}`;
    item.querySelector(".dest").title = link.url;
    item.querySelector(".clicks").textContent =
      `${link.clicks.toLocaleString()} ${link.clicks === 1 ? "click" : "clicks"}`;
    if (fresh) item.classList.add("fresh");

    item.querySelector('[data-act="copy"]').onclick = () => copy(short);
    item.querySelector('[data-act="qr"]').onclick = () => openQr(link.code);
    item.querySelector('[data-act="delete"]').onclick = (event) => remove(link, event.currentTarget);
    return item;
  }

  // Deleting takes two clicks: the first arms the button for a few seconds.
  async function remove(link, button) {
    if (!button.classList.contains("armed")) {
      button.classList.add("armed");
      button.title = "Click again to delete";
      setTimeout(() => button.classList.remove("armed"), 3000);
      return;
    }
    try {
      await call("DELETE", `api/links/${link.code}`);
      links = links.filter((l) => l !== link);
      renderLinks();
      if (link.code === resultCode) $("result").hidden = true;
      toast("Link deleted");
    } catch (err) {
      toast(err.message);
    }
  }

  /* -------------------------------------------------------------- account */

  function renderAccount(me) {
    const slot = $("account");
    if (!me?.authenticated) {
      slot.replaceChildren(link("Sign in", LOGIN, "btn"));
      return;
    }
    const who = me.email || "Signed in";
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = who.charAt(0).toUpperCase();
    const name = document.createElement("span");
    name.className = "who";
    name.textContent = who;
    slot.replaceChildren(avatar, name, link("Sign out", LOGOUT, "btn ghost"));
  }

  function link(text, href, className) {
    const a = document.createElement("a");
    a.textContent = text;
    a.href = href;
    a.className = className;
    return a;
  }

  /* ------------------------------------------------------------------ QR */

  const dialog = $("qr");
  let qrCode = null;

  function openQr(code) {
    qrCode = code;
    $("qr-code").innerHTML = qrSvg(shortUrl(code));
    showShort($("qr-link"), code);
    dialog.showModal();
  }

  $("qr-close").onclick = () => dialog.close();
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close(); // a click on the backdrop
  });

  $("qr-download").onclick = () => {
    const qr = makeQr(shortUrl(qrCode));
    const cell = 16;
    const size = (qr.getModuleCount() + 8) * cell; // 4-module quiet zone
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000";
    eachDark(qr, (x, y) => ctx.fillRect(x * cell, y * cell, cell, cell));

    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `hop-${qrCode}.png`;
    a.click();
  };

  // qrcode.js (vendored, MIT) does the encoding; drawing is ours so the code
  // stays crisp at any size.
  function makeQr(text) {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr;
  }

  function eachDark(qr, draw) {
    const n = qr.getModuleCount();
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) if (qr.isDark(row, col)) draw(col + 4, row + 4);
    }
  }

  function qrSvg(text) {
    const qr = makeQr(text);
    const size = qr.getModuleCount() + 8;
    let path = "";
    eachDark(qr, (x, y) => (path += `M${x} ${y}h1v1h-1z`));
    return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true">
      <rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  }

  /* -------------------------------------------------------------- helpers */

  async function call(method, path, body) {
    const res = await fetch(new URL(path, SERVICE), {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "Something went wrong. Please try again.");
    return data;
  }

  function shortUrl(code) {
    return new URL(code, SERVICE).href;
  }

  // The short link's fixed part, e.g. "alice.yard.sh/hop/s/". It is cut from
  // the left when space runs out (see .base), and the trailing left-to-right
  // mark keeps its final slash in place under that right-to-left trick.
  function prefix() {
    return `${bare(SERVICE.href)}/\u200E`;
  }

  // A short link as a muted prefix and a bold code, so the code is never cut.
  function showShort(el, code) {
    const base = document.createElement("span");
    base.className = "base";
    base.textContent = prefix();
    const strong = document.createElement("b");
    strong.textContent = code;
    el.replaceChildren(base, strong);
  }

  // "https://example.com/page/" -> "example.com/page"
  function bare(url) {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  function ago(iso) {
    const seconds = (Date.now() - Date.parse(iso)) / 1000;
    const units = [
      ["year", 31536000],
      ["month", 2592000],
      ["week", 604800],
      ["day", 86400],
      ["hour", 3600],
      ["minute", 60],
    ];
    const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    for (const [unit, size] of units) {
      if (seconds >= size) return format.format(-Math.floor(seconds / size), unit);
    }
    return "just now";
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard");
    } catch {
      toast("Couldn't copy. Select the link and copy it yourself.");
    }
  }

  function showError(message) {
    $("error").textContent = message;
    $("error").hidden = !message;
  }

  let toastTimer;
  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  // sessionStorage can throw (private modes, blocked storage): treat that as empty.
  function store(key, value) {
    try {
      if (value === undefined) return sessionStorage.getItem(key);
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch {
      return null;
    }
  }
})();
