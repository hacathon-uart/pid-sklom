// Real browser + Supabase SDK against loopback-only fake OAuth/provider endpoints.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = process.env.CHROME_PATH ?? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
assert(chromePath, "Chrome is required; set CHROME_PATH");
const workspace = mkdtempSync(join(root, ".auth-browser-"));
const profile = join(workspace, "chrome");
const dist = join(workspace, "dist");
let chrome;
let socket;
let closeBrowser;
let origin;
const userId = "11111111-1111-4111-8111-111111111111";
const state = { used: 0, calls: 0, exchanges: 0, saves: 0, updates: 0, cancelNext: false,
  holdNextSave: false, releaseSave: null, failNextSaveResponse: false, saveRequests: 0,
  holdNextArtwork: false, releaseArtwork: null,
  lastExclude: [], authPrompts: [], results: new Map(), memes: new Map(),
  exports: new Map(), exportReservations: 0, exportCancellations: 0, lastRejectedExport: null,
  holdNextExport: false, releaseExport: null };
const exportsRemaining = () => 3 - [...state.exports.values()].filter((item) => item.state !== "failed").length;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=", "base64");
const artist = { id: 1, slug: "artist", name: "Artist", birth_year: 1800, death_year: 1900, portrait_url: null };
const art = (id = 1) => ({
  id, slug: `artwork-${id}`, title: `Test painting ${id}`, year: 1850, genre: "everyday",
  image_url: `${origin}/painting-${id}.png`, thumb_url: `${origin}/painting-${id}.png`, artist,
});
const story = { about_artwork: "Reviewed painting description", museum: null, artwork_fact: null, artist_fact: null };
const user = { id: userId, aud: "authenticated", role: "authenticated", email: "browser@example.test",
  user_metadata: { full_name: "Browser User" }, app_metadata: { provider: "google" }, created_at: new Date().toISOString() };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const signedIn = Boolean(req.headers.authorization?.startsWith("Bearer ey"));
  const json = (value, status = 200, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(value));
  };
  if (url.pathname === "/auth/v1/authorize") {
    state.authPrompts.push(url.searchParams.get("prompt"));
    const query = state.cancelNext ? "error=access_denied" : `code=${randomUUID()}`;
    state.cancelNext = false;
    res.writeHead(302, { Location: `${origin}/auth/callback?${query}` }).end();
    return;
  }
  if (url.pathname === "/auth/v1/token") {
    state.exchanges++;
    const encoded = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const access_token = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({
      sub: userId, aud: "authenticated", role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600, iss: `${origin}/auth/v1`,
    })}.synthetic-signature`;
    return json({ access_token, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, user });
  }
  if (url.pathname === "/auth/v1/user") return json(user);
  if (url.pathname === "/auth/v1/logout") { res.writeHead(204).end(); return; }
  if (url.pathname === "/api/guest") return json({
    enabled: true, token: "browser-guest", remaining: 3 - state.used, exports_remaining: exportsRemaining(),
  });
  if (url.pathname === "/api/exports") {
    if (state.holdNextExport) {
      state.holdNextExport = false;
      await new Promise((done) => { state.releaseExport = done; });
    }
    if (signedIn) return json({ enabled: false, remaining: null });
    assert.equal(req.headers["x-guest-token"], "browser-guest");
    const fingerprint = createHash("sha256").update(`${body.artwork_id}:${body.image_data_url}`).digest("hex");
    const existing = state.exports.get(fingerprint);
    if (existing?.state === "pending") return json({ detail: { code: "operation_pending", message: "Pending" } }, 409);
    if (existing?.state !== "complete") {
      if (exportsRemaining() === 0) {
        state.lastRejectedExport = body.image_data_url;
        return json({ detail: { code: "guest_export_limit_exceeded", message: "Sign in to export" } }, 403);
      }
      state.exports.set(fingerprint, { state: "pending", lease: randomUUID() });
      state.exportReservations++;
    }
    return json({
      enabled: true, fingerprint, lease: existing?.state === "complete" ? null : state.exports.get(fingerprint).lease,
      remaining: exportsRemaining(),
    }, 200, { "X-Guest-Exports-Remaining": String(exportsRemaining()) });
  }
  if (url.pathname === "/api/exports/finish") {
    assert.equal(req.headers["x-guest-token"], "browser-guest");
    const existing = state.exports.get(body.fingerprint);
    assert.equal(existing?.lease, body.lease);
    assert.equal(existing?.state, "pending");
    existing.state = body.success ? "complete" : "failed";
    if (!body.success) state.exportCancellations++;
    return json({ remaining: exportsRemaining() }, 200, { "X-Guest-Exports-Remaining": String(exportsRemaining()) });
  }
  if (/^\/api\/artworks\/[12]$/.test(url.pathname)) {
    if (state.holdNextArtwork) {
      state.holdNextArtwork = false;
      await new Promise((done) => { state.releaseArtwork = done; });
    }
    return json({ ...art(Number(url.pathname.split("/").at(-1))), about: "Description", tags: [], facts: [], artist_facts: [], story });
  }
  if (url.pathname === "/api/artworks") return json({ items: [art(), art(2)], total: 2 });
  if (url.pathname === "/api/artists/artist") return json({ ...artist, short_bio: "", long_bio: "", artworks: [art()], facts: [], sources: [] });
  if (url.pathname === "/api/matches" || /\/api\/artworks\/1\/captions/.test(url.pathname)) {
    const key = `${signedIn ? "user" : "guest"}:${req.headers["idempotency-key"]}`;
    if (!signedIn && !state.results.has(key) && state.used >= 3) {
      return json({ detail: { code: "guest_limit_exceeded", message: "Sign in to continue" } }, 403);
    }
    if (!state.results.has(key)) {
      if (url.pathname.endsWith("/captions")) state.lastExclude = body.exclude;
      state.calls++;
      if (!signedIn) state.used++;
      state.results.set(key, url.pathname === "/api/matches"
        ? { artwork: art(), story, caption: body.phrase, position: "bottom", reason: "match",
          alternatives: [{ artwork: art(), score: 1 }, { artwork: art(2), score: 0.9 }], source: "fallback" }
        : { artwork_id: 1, source: "fallback", captions: [
          { text: `Caption ${state.calls}`, kind: "everyday" }, { text: "Work", kind: "work" }, { text: "Story", kind: "story" },
        ] });
    }
    return json(state.results.get(key), 201, signedIn ? {} : { "X-Guest-Remaining": String(3 - state.used) });
  }
  if (url.pathname === "/api/memes" && req.method === "POST") {
    assert(signedIn, "No save before authentication");
    state.saveRequests++;
    const key = `save:${req.headers["idempotency-key"]}`;
    if (!state.results.has(key)) {
      state.saves++;
      assert(body.image_data_url.startsWith("data:image/png;base64,"));
      const meme = { id: randomUUID(), artwork: art(body.artwork_id), caption: body.style.blocks[0].text, style: body.style,
        image_url: `${origin}/painting.png`, is_favorite: false, created_at: new Date().toISOString(), can_edit: true };
      state.memes.set(meme.id, meme);
      state.results.set(key, meme);
    }
    if (state.holdNextSave) {
      state.holdNextSave = false;
      await new Promise((done) => { state.releaseSave = done; });
    }
    if (state.failNextSaveResponse) {
      state.failNextSaveResponse = false;
      return json({ detail: "Synthetic save response failure" }, 503);
    }
    return json(state.results.get(key), 201);
  }
  if (url.pathname === "/api/memes") return json([...state.memes.values()]);
  if (url.pathname.startsWith("/api/memes/")) {
    const id = url.pathname.split("/").at(-1);
    const meme = state.memes.get(id);
    if (!meme) return json({ detail: "Not found" }, 404);
    if (req.method === "DELETE") { state.memes.delete(id); res.writeHead(204).end(); return; }
    if (req.method === "PATCH") {
      state.updates++;
      Object.assign(meme, body);
      if (body.style) meme.caption = body.style.blocks[0].text;
    }
    return json({ ...meme, can_edit: signedIn });
  }
  if (/^\/painting(?:-[12])?\.png$/.test(url.pathname)) { res.writeHead(200, { "Content-Type": "image/png" }).end(png); return; }
  const requested = join(dist, decodeURIComponent(url.pathname));
  if (!requested.startsWith(dist + "/") && requested !== dist) {
    res.writeHead(404).end();
    return;
  }
  const file = existsSync(requested) && extname(requested) ? requested : join(dist, "index.html");
  const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff" };
  res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});

try {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  const typecheck = spawnSync("npm", ["run", "typecheck"], {
    cwd: join(root, "frontend"), encoding: "utf8",
  });
  assert.equal(typecheck.status, 0, typecheck.stdout + typecheck.stderr);
  const build = spawnSync(process.execPath, ["--input-type=module", "--eval",
    `import { build } from "vite"; await build({
      envFile: false, build: { outDir: ${JSON.stringify(dist)}, emptyOutDir: true }
    });`], {
    cwd: join(root, "frontend"), encoding: "utf8",
    env: { ...process.env, VITE_AUTH_MODE: "supabase", VITE_API_URL: origin,
      VITE_SUPABASE_URL: origin, VITE_SUPABASE_ANON_KEY: "synthetic-public-key" },
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  chrome = spawn(chromePath, [
    "--headless=new", "--no-sandbox", "--disable-background-networking", "--disable-sync",
    "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "about:blank",
  ], { stdio: "ignore" });
  const delay = (ms) => new Promise((done) => setTimeout(done, ms));
  const deadline = Date.now() + 20000;
  while (!existsSync(join(profile, "DevToolsActivePort"))) {
    assert(Date.now() < deadline, "Chrome did not start");
    await delay(100);
  }
  const debugPort = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((done) => socket.addEventListener("open", done, { once: true }));
  let sequence = 0;
  let acceptDialog = true;
  const browserDialogs = [];
  const popupWindows = [];
  const requests = new Map();
  const exceptions = [];
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    requests.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  closeBrowser = () => command("Browser.close");
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = requests.get(message.id);
      requests.delete(message.id);
      if (message.error) request?.reject(new Error(message.error.message));
      else request?.resolve(message.result);
    }
    if (message.method === "Page.javascriptDialogOpening") {
      browserDialogs.push(message.params);
      void command("Page.handleJavaScriptDialog", { accept: acceptDialog });
    }
    if (message.method === "Page.windowOpen") popupWindows.push(message.params);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
  });
  await command("Runtime.enable");
  await command("Page.enable");
  if (process.env.BROWSER_WIDTH !== undefined) {
    const width = Number(process.env.BROWSER_WIDTH);
    assert(Number.isInteger(width) && width > 0, "BROWSER_WIDTH must be a positive integer");
    await command("Emulation.setDeviceMetricsOverride", {
      width, height: 844, deviceScaleFactor: 1, mobile: true,
    });
  }
  await command("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.exportedPNGs = [];
    window.sharedLinks = [];
    window.openedDialogs = 0;
    const showModal = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function () {
      window.openedDialogs++;
      return showModal.call(this);
    };
    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.href.startsWith("data:image/png")) { window.exportedPNGs.push(this.href); return; }
      return anchorClick.call(this);
    };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value) => {
        if (window.denyCopy) throw new DOMException("Clipboard denied", "NotAllowedError");
        window.sharedLinks.push(value);
      },
    } });
  ` });
  const evaluate = async (expression, userGesture = false) => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      try { if (await evaluate(`document.body && (${expression})`)) return; } catch (error) {
        if (!/context|navigation/i.test(error.message)) throw error;
      }
      await delay(100);
    }
    throw new Error(`Browser assertion timed out: ${expression}\n${await evaluate("document.body.innerText")}`);
  };
  const navigate = async (path) => { await command("Page.navigate", { url: origin + path }); };
  await command("Page.navigate", { url: "about:blank" });
  await until("document.body !== null");
  await evaluate(`document.body.remove();
    setTimeout(() => {
      const body = document.createElement('body');
      body.textContent = 'poll-ready';
      document.documentElement.appendChild(body);
    }, 500);`);
  await until("document.body.innerText.includes('poll-ready')");
  const click = async (text) => {
    await until(`[...document.querySelectorAll('button,a')].some((item) =>
      item.textContent.includes(${JSON.stringify(text)}) && !item.disabled)`);
    return evaluate(`(() => {
    const button = [...document.querySelectorAll('button,a')].find((item) => item.textContent.includes(${JSON.stringify(text)}));
    if (!button) throw new Error('Missing button: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  };
  const logout = async () => {
    await navigate("/me");
    await until("document.body.innerText.includes('Вийти')");
    await click("Вийти");
    await until("location.pathname === '/' && document.body.innerText.includes('Увійти з Google')");
  };
  const editCaption = async (text) => {
    await until("document.querySelector('input[maxlength=\"200\"]') !== null");
    await evaluate(`(() => {
      const input = document.querySelector('input[maxlength="200"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await delay(100);
  };
  const exportImage = async (publicView = false) => {
    const control = `document.querySelector('[aria-label="${publicView ? "Завантажити" : "Завантажити PNG"}"]')`;
    await until(`(${control}) && !(${control}).disabled`);
    return evaluate(`(${control}).click()`, true);
  };
  const editorFields = async () => {
    const fields = await evaluate(`({
    caption: document.querySelector('input[maxlength="200"]').value,
    font: document.querySelector('select').value,
    size: document.querySelector('input[type="range"]').value,
    outline: document.querySelector('[role="switch"]').getAttribute('aria-checked'),
    color: [...document.querySelectorAll('button[aria-label^="Колір #"][aria-pressed="true"]')].map((item) =>
      item.getAttribute('aria-label')),
    position: [...document.querySelectorAll('button')].find((item) =>
      item.className.includes('bg-surface shadow-sm'))?.textContent,
    frame: [...document.querySelectorAll('[role="group"][aria-label="Рамка"] button[aria-pressed="true"]')].map((item) => item.title),
    withFrame: document.querySelector('input[type="checkbox"]').checked,
  })`);
    assert.equal(fields.color.length, 1, "Exactly one caption color must be selected");
    assert.match(fields.color[0], /^Колір #[0-9a-f]{6}$/i, "Selected color must have its accessible label");
    assert.equal(fields.frame.length, 1, "Exactly one frame toggle must be pressed");
    assert(fields.frame[0], "Selected frame must have its label");
    return fields;
  };
  const saveEditor = async (clicks = 1, mutations = 1) => {
    await evaluate("document.fonts.ready");
    const before = state.saves + state.updates;
    const beforeRequests = state.saveRequests + state.updates;
    const dialogs = browserDialogs.length;
    const popups = popupWindows.length;
    const modals = await evaluate("window.openedDialogs");
    assert(await evaluate(`(() => {
      const save = document.querySelector('[aria-label="Зберегти зміни"], [aria-label="Зберегти в «Мої меми»"]');
      const disclosure = [...document.querySelectorAll('p')].find((item) =>
        item.textContent === 'Збережені меми та PNG доступні всім, хто має посилання.');
      return disclosure && disclosure.getBoundingClientRect().height > 0 &&
        getComputedStyle(disclosure).visibility === 'visible' &&
        Boolean(disclosure.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING);
    })()`), "Public-by-link disclosure must be visible inline before Save");
    await evaluate(`(() => {
      const save = document.querySelector('[aria-label="Зберегти зміни"], [aria-label="Зберегти в «Мої меми»"]');
      for (let n = 0; n < ${clicks}; n++) save.click();
    })()`);
    const deadline = Date.now() + 10000;
    while (state.saveRequests + state.updates === beforeRequests && Date.now() < deadline) await delay(50);
    assert.equal(state.saveRequests + state.updates, beforeRequests + 1, "Rapid Save clicks must make exactly one request");
    assert.equal(state.saves + state.updates, before + mutations, "Save must create or update only its intended meme");
    await delay(100);
    assert.equal(browserDialogs.length, dialogs, "Signed-in Save must not open a browser confirmation");
    assert.equal(popupWindows.length, popups, "Signed-in Save must not open a popup");
    assert.equal(await evaluate("window.openedDialogs"), modals, "Signed-in Save must not open a modal");
    assert.equal(await evaluate("document.querySelector('dialog[open], [role=\"dialog\"]')"), null);
  };
  if (process.env.AUTH_BROWSER_CASE === "share-link") {
    await navigate("/create/painting/1/own");
    await editCaption("Link-only sharing");
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Поділитися посиланням\"]')"), null,
      "Guests must not see Share in the editor");
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Завантажити PNG\"]') !== null"), true);
    await navigate("/me");
    await click("Продовжити через Google");
    await until("location.pathname === '/me' && document.body.innerText.includes('Вийти')");
    await navigate("/create/painting/1/own");
    await editCaption("Link-only sharing");
    await evaluate("document.fonts.ready");
    await exportImage();
    await until("window.exportedPNGs.length === 1");
    assert.equal(state.saves, 0, "Download must not save the meme");
    await evaluate("document.querySelector('[aria-label=\"Поділитися посиланням\"]').click()", true);
    await until("window.sharedLinks.length === 1");
    const saved = [...state.memes.values()][0];
    assert(saved && saved.is_favorite, "Sharing must save and favourite the meme");
    assert.equal(await evaluate("window.sharedLinks[0]"), `${origin}/m/${saved.id}`);
    assert(await evaluate("[...document.querySelectorAll('[role=\"status\"]')].some((item) => item.textContent.includes('Посилання скопійовано') && item.textContent.includes('Мем додано до «Улюблених»'))"));
    await editCaption("Updated through sharing");
    await evaluate("window.denyCopy = true; document.querySelector('[aria-label=\"Поділитися посиланням\"]').click()", true);
    await until("[...document.querySelectorAll('[role=\"status\"]')].some((item) => item.textContent.includes('Браузер не дозволив копіювання'))");
    assert.equal(saved.caption, "Updated through sharing", "Sharing an edited meme must publish the current draft");
    assert.equal(state.saves, 1, "Sharing an edit must reuse the saved meme");
    assert(await evaluate(`document.querySelector('[href="${origin}/m/${saved.id}"]') !== null`));
    await evaluate("window.denyCopy = false; [...document.querySelectorAll('button')].find((item) => item.textContent === 'Копіювати посилання').click()", true);
    await until("window.sharedLinks.length === 2");
    await navigate(`/me/memes/${saved.id}`);
    await until("document.querySelector('[aria-label=\"Завантажити\"]') !== null");
    await evaluate("document.querySelector('[aria-label=\"Прибрати з улюблених\"]').click()", true);
    await until("document.querySelector('[aria-label^=\"Додати до улюблених\"]') !== null");
    await click("Поділитися посиланням");
    await until("window.sharedLinks.length === 1");
    assert(saved.is_favorite, "Sharing an existing saved meme must re-add it to favourites");
    await logout();
    await navigate(`/m/${saved.id}`);
    await until("document.querySelector('[aria-label=\"Завантажити\"]') !== null");
    assert.equal(await evaluate("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Поділитися посиланням'))"), false,
      "Public visitors must not see Share");
    console.log("PASS: guest download only; member share saves, favourites, copies and shows public link; public visitor cannot share");
  } else if (process.env.AUTH_BROWSER_CASE === "export-switch") {
    await navigate("/create/result?q=export-switch");
    await until("document.querySelector('[aria-label=\"Завантажити PNG\"]') !== null");
    await evaluate("document.fonts.ready");
    await delay(200);
    state.holdNextExport = true;
    await exportImage();
    const deadline = Date.now() + 10000;
    while (!state.releaseExport && Date.now() < deadline) await delay(50);
    assert(state.releaseExport, "The export request should be awaiting authorization");
    await click("Інша картина");
    await until("document.body.innerText.includes('Test painting 2')");
    state.releaseExport();
    state.releaseExport = null;
    await delay(500);
    assert.equal(exportsRemaining(), 3, "Switching artwork must release the old export slot");
    assert.equal(await evaluate("window.exportedPNGs.length"), 0, "A late response must not export the previous artwork");
    console.log("PASS: artwork switch during authorization never downloads the old PNG and releases its reservation");
  } else {
  {
    await navigate("/");
    await until("document.body.innerText.includes('Увійти з Google')");
    await navigate("/create/painting/1/own");
    await editCaption("Direct-entry tab draft");
    await evaluate("document.querySelector('select').value = 'Rubik'; document.querySelector('select').dispatchEvent(new Event('change', {bubbles:true}))");
    await evaluate("document.querySelector('[role=\"group\"][aria-label=\"Рамка\"] button:last-child').click()");
    const draft = await editorFields();
    const mutations = state.saves + state.updates;
    const generations = state.calls;
    const exports = exportsRemaining();
    await click("До вибору картини");
    await until("location.pathname === '/create/painting' && location.search === '?artwork=1' && document.body.innerText.includes('Написати свій підпис')");
    await click("Написати свій підпис");
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Direct-entry tab draft'");
    assert.deepEqual(await editorFields(), draft, "Returning through artwork selection must restore the exact tab draft");
    assert.equal(state.saves + state.updates, mutations, "Leaving and restoring a creation draft must not save");
    assert.equal(state.calls, generations, "Leaving a manual draft must not generate or refund generations");
    assert.equal(exportsRemaining(), exports, "Leaving a draft must not change the PNG allowance");
    console.log("PASS: direct-entry creation exit selects the artwork and restores the tab draft without saving");
  }
  for (let n = 1; n <= 3; n++) {
    await navigate(`/create/result?q=guest-${n}`);
    await until(`document.querySelector('input[maxlength="200"]')?.value === 'guest-${n}' && document.querySelector('canvas') !== null`);
  }
  assert.equal(state.used, 3);
  await navigate("/create/result?q=fourth");
  await until("document.body.innerText.includes('Увійти через Google і продовжити')");
  assert.equal(state.calls, 3, "Blocked fourth request must not reach provider");
  await click("Увійти через Google і продовжити");
  await until("location.pathname === '/create/result' && document.querySelector('input[maxlength=\"200\"]')?.value === 'fourth'");
  assert.equal(state.calls, 4);
  assert.equal(state.exchanges, 1, "PKCE exchange must survive StrictMode without duplication");
  assert.deepEqual(state.authPrompts, ["select_account"], "Google login must explicitly request account selection");
  assert.equal(state.used, 3);
  await logout();
  await navigate("/create/painting/1/ai");
  await until("document.body.innerText.includes('Увійти через Google і продовжити')");
  await click("Увійти через Google і продовжити");
  await until("document.body.innerText.includes('Caption 5')");
  await click("Ще варіанти");
  await until("document.body.innerText.includes('Caption 6')");
  assert(state.lastExclude.includes("Caption 5"), "More variants must send previous suggestions");
  assert.equal(state.exchanges, 2);
  await logout();
  await navigate("/create/painting/1/own");
  await editCaption("Preserved through OAuth");
  await evaluate("document.querySelector('select').value = 'Oswald'; document.querySelector('select').dispatchEvent(new Event('change', {bubbles:true}))");
  await evaluate(`(() => {
    const save = document.querySelector('[aria-label="Зберегти в «Мої меми»"]');
    save.focus();
    save.click();
  })()`);
  await until("document.querySelector('dialog[open]')?.textContent.includes('Увійти через Google і зберегти')");
  assert.equal(state.exchanges, 2, "Opening the save dialog must not start Google login");
  assert.equal(state.saves, 0, "Opening the save dialog must not create a meme");
  assert(await evaluate("document.querySelector('dialog').textContent.includes('доступні всім, хто має посилання')"));
  await click("Продовжити редагування");
  await until("document.querySelector('dialog[open]') === null");
  assert.equal(await evaluate("document.querySelector('input[maxlength=\"200\"]').value"), "Preserved through OAuth");
  assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label')"), "Зберегти в «Мої меми»",
    "Cancelling the dialog must return focus to Save");
  await evaluate("document.querySelector('[aria-label=\"Зберегти в «Мої меми»\"]').click()");
  await until("document.querySelector('dialog[open]') !== null");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until("document.querySelector('dialog[open]') === null");
  assert.equal(state.exchanges, 2, "Cancel and Escape must not start OAuth");
  assert.equal(state.used, 3, "Guest bookmark attempts must not consume generations");
  assert.equal(state.exports.size, 0, "Guest bookmark attempts must not consume PNG exports");
  await evaluate("document.querySelector('[aria-label=\"Зберегти в «Мої меми»\"]').click()");
  await until("document.querySelector('dialog[open]') !== null");
  await click("Увійти через Google і зберегти");
  await until("document.body.innerText.includes('Додано до колекції')");
  assert.equal(state.saves, 1, "Save after Google callback happens exactly once");
  assert.equal([...state.memes.values()][0].style.blocks[0].text, "Preserved through OAuth");
  assert.equal(state.exchanges, 3);
  await command("Page.reload");
  await until("document.querySelector('[aria-label=\"Зберегти зміни\"]') !== null");
  assert.equal(state.saves, 1, "Reload must not create another saved meme");
  await editCaption("Updated after OAuth");
  await saveEditor();
  await command("Page.reload");
  await until("document.querySelector('input[maxlength=\"200\"]') !== null");
  assert.equal(await evaluate("document.querySelector('input[maxlength=\"200\"]').value"), "Updated after OAuth",
    "Reload must not restore the older pre-login caption after a later save");
  const savedId = [...state.memes.keys()][0];
  await navigate(`/me/memes/${savedId}`);
  const removeSaved = `[aria-label="Прибрати з «Моїх мемів»"]`;
  await until(`document.querySelector(${JSON.stringify(removeSaved)}) !== null`);
  acceptDialog = false;
  await evaluate(`document.querySelector(${JSON.stringify(removeSaved)}).click()`);
  await delay(200);
  assert.equal(state.memes.size, 1, "Cancelled deletion must do nothing");
  acceptDialog = true;
  await evaluate(`document.querySelector(${JSON.stringify(removeSaved)}).click()`);
  await until("location.pathname === '/me'");
  assert.equal(state.memes.size, 0);
  await logout();
  await navigate("/create/painting/1/own");
  await editCaption("Keep after cancelled login");
  state.cancelNext = true;
  await evaluate("document.querySelector('[aria-label=\"Зберегти в «Мої меми»\"]').click()");
  await until("document.querySelector('dialog[open]') !== null");
  await click("Увійти через Google і зберегти");
  await until("document.body.innerText.includes('Вхід скасовано')");
  await click("Повернутися до чернетки");
  await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Keep after cancelled login'");
  assert.equal(state.saves, 1);
  await navigate("/create/result?q=still-limited");
  await until("document.body.innerText.includes('Увійти через Google і продовжити')");
  assert.equal(state.calls, 6, "Logout must not reset guest allowance");
  await click("Увійти через Google і продовжити");
  await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'still-limited'");

  {
    const before = state.saves;
    await editCaption("Artwork A draft");
    await evaluate("document.querySelector('[role=\"group\"][aria-label=\"Рамка\"] button:nth-child(2)').click()");
    await saveEditor();
    const first = [...state.memes.values()].find((meme) => meme.caption === "Artwork A draft");
    assert(first);
    await click("Test painting 2");
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Artwork A draft'");
    assert.equal(await evaluate("document.querySelector('[role=\"group\"][aria-label=\"Рамка\"] button:nth-child(2)').getAttribute('aria-pressed')"), "true",
      "A newly selected artwork inherits the current caption and style");
    await editCaption("Artwork B draft");
    await evaluate("document.querySelector('[role=\"group\"][aria-label=\"Рамка\"] button:last-child').click()");
    state.holdNextSave = true;
    await saveEditor();
    assert.equal(state.saves, before + 2, "Switching artwork must create a separate meme, not PATCH the prior artwork");
    const second = [...state.memes.values()].find((meme) => meme.caption === "Artwork B draft");
    assert.equal(first.artwork.id, 1);
    assert.equal(first.caption, "Artwork A draft", "Saving B must leave A unchanged");
    assert.equal(second?.artwork.id, 2);
    assert(state.releaseSave, "B's save response must still be pending");
    await click("Test painting 1");
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Artwork A draft'");
    state.releaseSave();
    state.releaseSave = null;
    await delay(100);
    assert.equal(await evaluate("document.querySelector('[role=\"group\"][aria-label=\"Рамка\"] button:nth-child(2)').getAttribute('aria-pressed')"), "true");
    await editCaption("Artwork A revised");
    await saveEditor();
    assert.equal(state.saves, before + 2, "Returning to A must reuse its saved identity");
    assert.equal(first.caption, "Artwork A revised", "A late response for B must not replace A's save identity");
    assert.equal(second.caption, "Artwork B draft");
    await click("Test painting 2");
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Artwork B draft'");
    await command("Page.reload");
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Artwork B draft'");
    assert.equal(await evaluate("document.querySelector('[role=\"group\"][aria-label=\"Рамка\"] button:last-child').getAttribute('aria-pressed')"), "true");
    await editCaption("Artwork B revised");
    await saveEditor();
    assert.equal(state.saves, before + 2, "Reload must retain B's save identity");
    assert.equal(second.caption, "Artwork B revised");
    assert.equal(first.caption, "Artwork A revised");
    await click("Test painting 1");
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Artwork A revised'");
    state.holdNextArtwork = true;
    await click("Test painting 2");
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Artwork B revised'");
    const deadline = Date.now() + 10000;
    while (!state.releaseArtwork && Date.now() < deadline) await delay(50);
    assert(state.releaseArtwork);
    await click("Test painting 1");
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Artwork A revised'");
    state.releaseArtwork();
    state.releaseArtwork = null;
    await delay(100);
    assert.equal(await evaluate("document.querySelector('input[maxlength=\"200\"]').value"), "Artwork A revised",
      "A late artwork-details response must not revert the active selection");
    console.log("PASS: artwork switching preserves separate drafts and saved identities, including delayed saves and reload");
  }

  {
    await navigate("/create/painting/2/own");
    await editCaption("Saved after login");
    const beforeCreates = state.saves;
    const beforeUpdates = state.updates;
    state.holdNextSave = true;
    state.failNextSaveResponse = true;
    await saveEditor(3);
    const saved = [...state.memes.values()].find((meme) => meme.caption === "Saved after login");
    assert(saved);
    assert(state.releaseSave, "Rapid clicks must share the pending creation");
    state.releaseSave();
    state.releaseSave = null;
    await until("[...document.querySelectorAll('p')].some((item) => item.textContent === 'Synthetic save response failure')");
    await saveEditor(3, 0);
    await until("document.querySelector('[aria-label=\"Зберегти зміни\"]') !== null");
    assert.equal(state.saves, beforeCreates + 1, "Retry after a persisted save loses its response must reuse the intent");
    assert.equal(state.updates, beforeUpdates, "Retrying creation must not update a different meme");
    await editCaption("Saved revision");
    await saveEditor(3);
    assert.equal(state.saves, beforeCreates + 1, "Signed-in Save after editing must update the original meme");
    assert.equal(state.updates, beforeUpdates + 1, "Rapid update clicks must PATCH exactly once");
    await command("Page.reload");
    await until("document.querySelector('input[maxlength=\"200\"]') !== null");
    assert.equal(await evaluate("document.querySelector('input[maxlength=\"200\"]').value"), "Saved revision",
      "Reload must restore the latest saved caption, not an earlier/default draft");
    const mutations = state.saves + state.updates;
    await editCaption("Unsaved revision");
    await evaluate("document.querySelector('select').value = 'Rubik'; document.querySelector('select').dispatchEvent(new Event('change', {bubbles:true}))");
    await evaluate("document.querySelector('[role=\"group\"][aria-label=\"Рамка\"] button:last-child').click()");
    await delay(100);
    await command("Page.reload");
    await until("document.querySelector('input[maxlength=\"200\"]') !== null");
    assert.equal(await evaluate("document.querySelector('input[maxlength=\"200\"]').value"), "Unsaved revision");
    assert.equal(await evaluate("document.querySelector('select').value"), "Rubik");
    assert.equal(await evaluate("document.querySelector('[role=\"group\"][aria-label=\"Рамка\"] button:last-child').getAttribute('aria-pressed')"), "true");
    assert.equal(state.saves + state.updates, mutations, "Draft edits and reload must not autosave the public meme");
    assert.equal(saved.caption, "Saved revision");
    await saveEditor();
    assert.equal(saved.caption, "Unsaved revision", "Explicit save must update the original saved identity");
    await evaluate(`window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function () { throw new DOMException('Storage blocked', 'QuotaExceededError'); };`);
    await editCaption("Storage error stays visible");
    await until("document.querySelector('[role=\"alert\"]')?.textContent.includes('Браузер не може зберегти чернетку')");
    await evaluate("Storage.prototype.setItem = window.originalSetItem; delete window.originalSetItem");
    await editCaption("Recovered local draft");
    assert.equal(saved.caption, "Unsaved revision", "A local storage failure must not trigger a server save");
    const creates = state.saves;
    await navigate(`/me/memes/${saved.id}/edit`);
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Unsaved revision'");
    await editCaption("Unsaved existing-meme edit");
    await evaluate("document.querySelector('select').value = 'Oswald'; document.querySelector('select').dispatchEvent(new Event('change', {bubbles:true}))");
    await evaluate("document.querySelector('[role=\"group\"][aria-label=\"Рамка\"] button:nth-child(2)').click()");
    const unsavedEdit = await editorFields();
    const beforeLeaving = state.saves + state.updates;
    await click("До мему");
    await until(`location.pathname === '/me/memes/${saved.id}' && document.querySelector('[aria-label="Редагувати підпис"]') !== null`);
    assert.equal(saved.caption, "Unsaved revision", "Leaving the saved editor must not publish the tab draft");
    assert.equal(state.saves + state.updates, beforeLeaving, "Leaving the saved editor must not mutate a meme");
    await evaluate("document.querySelector('[aria-label=\"Редагувати підпис\"]').click()");
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Unsaved existing-meme edit'");
    assert.deepEqual(await editorFields(), unsavedEdit, "Reopening the saved editor must restore every tab draft field");
    await command("Page.reload");
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Unsaved existing-meme edit'");
    assert.deepEqual(await editorFields(), unsavedEdit, "Reload after returning must keep the same unsaved draft");
    assert.equal(state.saves + state.updates, beforeLeaving, "Return and reload must not autosave");
    await saveEditor();
    assert.equal(state.saves, creates, "Editing a saved meme must never create a new meme");
    assert.equal(saved.caption, "Unsaved existing-meme edit");
    console.log("PASS: signed-in Save has inline disclosure and no dialogs; rapid clicks/retry create once, edits update once; explicit exits retain unsaved drafts");
  }
  const savesBeforeLogin = state.saves;
  await logout();
  await navigate("/create/painting/1/own");
  await editCaption("First unique PNG");
  await evaluate("document.fonts.ready");
  await delay(200);
  await exportImage();
  await until("window.exportedPNGs.length === 1");
  await until("document.querySelector('summary')?.getAttribute('aria-label').includes('PNG 2/3')");
  assert.equal(state.used, 3, "Downloads must not consume or require AI allowance");
  assert.equal(state.exportReservations, 1);
  await exportImage();
  await until("window.exportedPNGs.length === 2");
  await exportImage();
  await until("window.exportedPNGs.length === 3");
  assert.equal(state.exportReservations, 1, "Repeated downloads reuse one export");
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Поділитися посиланням\"]')"), null);
  await editCaption("Second distinct composition");
  await exportImage();
  await until("document.querySelector('summary')?.getAttribute('aria-label').includes('PNG 1/3')");
  await editCaption("Third distinct composition");
  await exportImage();
  await until("window.exportedPNGs.length === 5");
  await until("document.querySelector('summary')?.getAttribute('aria-label').includes('PNG 0/3')");
  await editCaption("First unique PNG");
  await exportImage();
  await until("window.exportedPNGs.length === 6");
  assert.equal(exportsRemaining(), 0, "An unchanged PNG stays free after exhaustion");
  await editCaption("Fourth PNG requires Google");
  await evaluate("document.querySelector('input[type=\"checkbox\"]').click()");
  const exchangesBeforeExport = state.exchanges;
  await exportImage();
  await until("document.querySelector('[role=\"alert\"]')?.textContent.includes('Три унікальні PNG')");
  assert.equal(await evaluate("window.exportedPNGs.length"), 6, "Blocked fourth export must not dispatch a download");
  assert.equal(state.exchanges, exchangesBeforeExport, "Blocked export needs explicit Google consent");
  await click("Закрити");
  const publicId = [...state.memes.keys()][0];
  await navigate(`/m/${publicId}`);
  await until("document.querySelector('[aria-label=\"Завантажити\"]') !== null");
  assert.equal(await evaluate("document.querySelector('[aria-label^=\"Додати до улюблених\"]')"), null,
    "A public guest cannot favourite someone else's saved meme");
  await exportImage(true);
  await until("document.querySelector('[role=\"alert\"]')?.textContent.includes('Три унікальні PNG')");
  assert.equal(await evaluate("window.exportedPNGs.length"), 0, "Public saved-PNG downloads use the same export gate");
  await click("Закрити");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].some((button) => button.textContent.includes('Поділитися посиланням'))"), false);
  console.log("PASS: independent distinct PNG download quota, replay after exhaustion, and public-download gate");
  await navigate("/me");
  await until("document.body.innerText.includes('Продовжити через Google') && document.body.innerText.includes('Новий акаунт створиться автоматично')");
  await click("Продовжити через Google");
  await until("location.pathname === '/me' && document.body.innerText.includes('Вийти')");
  assert.equal(state.saves, savesBeforeLogin, "Ordinary sign-in must not replay a cancelled or unrelated save");
  assert.equal(await evaluate("window.exportedPNGs.length"), 0, "Ordinary sign-in must not replay a cancelled export");
  await logout();
  await navigate("/create/painting/1/own");
  await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Fourth PNG requires Google'");
  await exportImage();
  await until("document.querySelector('[role=\"alert\"]')?.textContent.includes('Три унікальні PNG')");
  const expectedPNG = state.lastRejectedExport;
  const reservationsBeforeLogin = state.exportReservations;
  await click("Увійти через Google і продовжити");
  await until("window.exportedPNGs.length === 1");
  assert.equal(await evaluate("window.exportedPNGs[0]"), expectedPNG, "OAuth restores the exact composition and frame-inclusion setting");
  assert.equal(state.exportReservations, reservationsBeforeLogin, "Signed-in exports do not use the guest ledger");
  assert.equal(state.saves, savesBeforeLogin, "Export after login must not create a saved meme");
  assert.equal(await evaluate("document.querySelector('summary[aria-label^=\"Гостьовий квиток\"]')"), null);
  await command("Page.reload");
  await until("document.querySelector('input[maxlength=\"200\"]') !== null");
  assert.equal(await evaluate("window.exportedPNGs.length"), 0, "Reload must not repeat the post-login export");
  console.log("PASS: explicit blocked-download OAuth continuation preserves the exact PNG and runs once; unrelated login does not export");
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  assert(state.authPrompts.every((prompt) => prompt === "select_account"), "Every Google entry point must request account selection");
  console.log("PASS: guest quota, PKCE callback, automatic generation/save, draft restoration, reload, logout, cancellation and confirmed deletion");
  }
} finally {
  state.releaseSave?.();
  state.releaseArtwork?.();
  state.releaseExport?.();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((done) => chrome.once("exit", done));
    if (closeBrowser) await closeBrowser();
    else chrome.kill("SIGTERM");
    await exited;
  }
  socket?.close();
  await new Promise((done) => server.close(done));
  rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
