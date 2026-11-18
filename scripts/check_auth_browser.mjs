// Real browser + Supabase SDK against loopback-only fake OAuth/provider endpoints.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = process.env.CHROME_PATH ?? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
assert(chromePath, "Chrome is required; set CHROME_PATH");
const profile = mkdtempSync(join(tmpdir(), "pidsklom-auth-browser-"));
let chrome;
let socket;
let closeBrowser;
let origin;
const userId = "11111111-1111-4111-8111-111111111111";
const state = { used: 0, calls: 0, exchanges: 0, saves: 0, updates: 0, cancelNext: false,
  holdNextSave: false, releaseSave: null, holdNextArtwork: false, releaseArtwork: null,
  lastExclude: [], results: new Map(), memes: new Map() };
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
  if (url.pathname === "/api/guest") return json({ enabled: true, token: "browser-guest", remaining: 3 - state.used });
  if (/^\/api\/artworks\/[12]$/.test(url.pathname)) {
    if (state.holdNextArtwork) {
      state.holdNextArtwork = false;
      await new Promise((done) => { state.releaseArtwork = done; });
    }
    return json({ ...art(Number(url.pathname.split("/").at(-1))), about: "Description", tags: [], facts: [], artist_facts: [], story });
  }
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
  const dist = join(root, "frontend/dist");
  const requested = join(dist, decodeURIComponent(url.pathname));
  if (!requested.startsWith(dist + "/") && requested !== dist) {
    res.writeHead(404).end();
    return;
  }
  const file = existsSync(requested) && extname(requested) ? requested : join(root, "frontend/dist/index.html");
  const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff" };
  res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});

try {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  const build = spawnSync("npm", ["run", "build"], {
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
      void command("Page.handleJavaScriptDialog", { accept: acceptDialog });
    }
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
  });
  await command("Runtime.enable");
  await command("Page.enable");
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      try { if (await evaluate(expression)) return; } catch (error) {
        if (!/context|navigation/i.test(error.message)) throw error;
      }
      await delay(100);
    }
    throw new Error(`Browser assertion timed out: ${expression}\n${await evaluate("document.body.innerText")}`);
  };
  const navigate = async (path) => { await command("Page.navigate", { url: origin + path }); };
  const click = async (text) => evaluate(`(() => {
    const button = [...document.querySelectorAll('button,a')].find((item) => item.textContent.includes(${JSON.stringify(text)}));
    if (!button) throw new Error('Missing button: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  const logout = async () => {
    await navigate("/me");
    await until("document.body.innerText.includes('Вийти')");
    await click("Вийти");
    await until("location.pathname === '/' && document.body.innerText.includes('Зареєструватися')");
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
  const saveEditor = async () => {
    await evaluate("document.fonts.ready");
    const before = state.saves + state.updates;
    await evaluate("document.querySelector('[aria-label=\"Зберегти зміни\"], [aria-label=\"Зберегти в «Мої меми»\"]').click()");
    const deadline = Date.now() + 10000;
    while (state.saves + state.updates === before && Date.now() < deadline) await delay(50);
    assert.equal(state.saves + state.updates, before + 1, "Save must make exactly one mutation");
    await delay(100);
  };
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
  await until("document.body.innerText.includes('Видалити мем')");
  acceptDialog = false;
  await click("Видалити мем");
  await delay(200);
  assert.equal(state.memes.size, 1, "Cancelled deletion must do nothing");
  acceptDialog = true;
  await click("Видалити мем");
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
    await evaluate("document.querySelector('[role=\"radiogroup\"] button:nth-child(2)').click()");
    await saveEditor();
    const first = [...state.memes.values()].find((meme) => meme.caption === "Artwork A draft");
    assert(first);
    await click("Test painting 2");
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Artwork A draft'");
    assert.equal(await evaluate("document.querySelector('[role=\"radiogroup\"] button:nth-child(2)').getAttribute('aria-checked')"), "true",
      "A newly selected artwork inherits the current caption and style");
    await editCaption("Artwork B draft");
    await evaluate("document.querySelector('[role=\"radiogroup\"] button:last-child').click()");
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
    assert.equal(await evaluate("document.querySelector('[role=\"radiogroup\"] button:nth-child(2)').getAttribute('aria-checked')"), "true");
    await editCaption("Artwork A revised");
    await saveEditor();
    assert.equal(state.saves, before + 2, "Returning to A must reuse its saved identity");
    assert.equal(first.caption, "Artwork A revised", "A late response for B must not replace A's save identity");
    assert.equal(second.caption, "Artwork B draft");
    await click("Test painting 2");
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Artwork B draft'");
    await command("Page.reload");
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Artwork B draft'");
    assert.equal(await evaluate("document.querySelector('[role=\"radiogroup\"] button:last-child').getAttribute('aria-checked')"), "true");
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
    await saveEditor();
    const saved = [...state.memes.values()].find((meme) => meme.caption === "Saved after login");
    assert(saved);
    await editCaption("Saved revision");
    await saveEditor();
    await command("Page.reload");
    await until("document.querySelector('input[maxlength=\"200\"]') !== null");
    assert.equal(await evaluate("document.querySelector('input[maxlength=\"200\"]').value"), "Saved revision",
      "Reload must restore the latest saved caption, not an earlier/default draft");
    const mutations = state.saves + state.updates;
    await editCaption("Unsaved revision");
    await evaluate("document.querySelector('select').value = 'Rubik'; document.querySelector('select').dispatchEvent(new Event('change', {bubbles:true}))");
    await evaluate("document.querySelector('[role=\"radiogroup\"] button:last-child').click()");
    await delay(100);
    await command("Page.reload");
    await until("document.querySelector('input[maxlength=\"200\"]') !== null");
    assert.equal(await evaluate("document.querySelector('input[maxlength=\"200\"]').value"), "Unsaved revision");
    assert.equal(await evaluate("document.querySelector('select').value"), "Rubik");
    assert.equal(await evaluate("document.querySelector('[role=\"radiogroup\"] button:last-child').getAttribute('aria-checked')"), "true");
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
    await command("Page.reload");
    await until("document.querySelector('input[maxlength=\"200\"]')?.value === 'Unsaved existing-meme edit'");
    await saveEditor();
    assert.equal(state.saves, creates, "Editing a saved meme must never create a new meme");
    assert.equal(saved.caption, "Unsaved existing-meme edit");
    console.log("PASS: reload restores latest saved and unsaved draft fields without autosaving");
  }
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log("PASS: guest quota, PKCE callback, automatic generation/save, draft restoration, reload, logout, cancellation and confirmed deletion");
} finally {
  state.releaseSave?.();
  state.releaseArtwork?.();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((done) => chrome.once("exit", done));
    if (closeBrowser) await closeBrowser();
    else chrome.kill("SIGTERM");
    await exited;
  }
  socket?.close();
  await new Promise((done) => server.close(done));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
