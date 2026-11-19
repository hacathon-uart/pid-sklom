// Real routes and fetch responses; held fixture requests make selection races deterministic.
import assert from "node:assert/strict";
import { runBrowserCheck } from "./lib/browser-harness.mjs";

const pending = [];
const plans = new Map();
const requestCounts = new Map();
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=", "base64");
const plan = (path, response) => plans.set(path, [...(plans.get(path) ?? []), response]);
const hold = (path) => plan(path, "hold");
const fail = (path) => plan(path, "fail");
const story = (id, version = "чинна") => ({
  about_artwork: `Історія ${id}: ${version}`, museum: null, artwork_fact: null, artist_fact: null,
  source_url: `/sources/${id}`,
});
await runBrowserCheck({
  handleRequest: async ({ url, json, res, origin }) => {
    const artwork = (id) => ({
      id, slug: `artwork-${id}`, title: `Картина ${id}`, year: 1850, genre: "everyday",
      image_url: `${origin}/painting-${id}.png`, thumb_url: `${origin}/painting-${id}.png`,
      artist: { id: 1, slug: "artist", name: "Художник", birth_year: 1800, death_year: 1900, portrait_url: null },
    });
    const detail = (id, version) => ({
      ...artwork(id), about: "", tags: [], facts: [], artist_facts: [], story: id === 4 ? null : story(id, version),
    });
    if (/^\/painting-\d+\.png$/.test(url.pathname)) {
      res.writeHead(200, { "Content-Type": "image/png" }).end(image);
      return true;
    }
    if (url.pathname === "/api/guest") return json({ enabled: false, token: null, remaining: null });
    const random = url.pathname === "/api/artworks" && url.searchParams.get("random") === "true";
    if (url.pathname === "/api/artworks" && !random) return json({ items: [1, 2, 3, 4].map(artwork), total: 4 });
    if (url.pathname === "/api/matches") return json({
      artwork: artwork(1), story: story(1), caption: "Початковий підпис", position: "bottom", reason: "match",
      alternatives: [1, 2, 3, 4].map((id) => ({ artwork: artwork(id), score: 1 / id })), source: "fallback",
    }, 201);
    if (/^\/api\/artworks\/\d+$/.test(url.pathname) || random) {
      const path = random ? "/api/artworks?random=true" : url.pathname;
      requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
      const response = plans.get(path)?.shift();
      if (response === "hold") {
        return await new Promise((done) => pending.push({
          path,
          release: ({ failure = false, id = Number(path.split("/").at(-1)), version } = {}) => {
            done(failure ? json({ detail: "Тестова помилка завантаження" }, 503) : json(random ? { items: [artwork(id)] } : detail(id, version)));
          },
        }));
      }
      if (response === "fail") return json({ detail: "Тестова помилка завантаження" }, 503);
      return json(random ? { items: [artwork(3)] } : detail(Number(path.split("/").at(-1))));
    }
    return false;
  },
  run: async ({ command, evaluate, until, navigate, click, errors }) => {
    await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await command("Network.enable");
    await command("Network.setBlockedURLs", { urls: ["https://fonts.googleapis.com/*", "https://fonts.gstatic.com/*"] });
    // Observe actual response consumption, then allow React's commit before checking ignored stale data.
    await command("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.consumed = {};
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const originalJson = response.json.bind(response);
        response.json = async () => {
          const value = await originalJson();
          const path = new URL(response.url).pathname;
          window.consumed[path] = (window.consumed[path] || 0) + 1;
          return value;
        };
        return response;
      };
    ` });
    const text = (value) => `document.body.innerText.includes(${JSON.stringify(value)})`;
    const panel = "document.querySelector('#artwork-story')";
    const selected = (id) => `[...document.querySelectorAll('[role="status"]')].some(e => e.textContent.includes('Обрано') && e.textContent.includes('Картина ${id}'))`;
    const pick = async (id) => {
      const selector = `document.querySelector('button img[alt="Картина ${id}"]')?.closest('button')`;
      await until(selector);
      await evaluate(`(${selector}).click()`, true);
    };
    const held = async (path) => {
      const deadline = Date.now() + 20000;
      while (!pending.some((entry) => entry.path === path)) {
        assert(Date.now() < deadline, `No held request: ${path}`);
        await evaluate("new Promise(requestAnimationFrame)");
      }
      return pending.splice(pending.findIndex((entry) => entry.path === path), 1)[0];
    };
    const release = async (entry, response = {}) => {
      const path = JSON.stringify(entry.path.split("?")[0]);
      const before = await evaluate(`window.consumed[${path}] || 0`);
      entry.release(response);
      await until(`window.consumed[${path}] > ${before}`, "Held response consumed");
      await evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
    };

    await navigate("/create/result?q=story-check");
    await until(`${panel}?.textContent.includes('Історія 1')`);
    hold("/api/artworks/2");
    await pick(2);
    const firstStory = await held("/api/artworks/2");
    await until(`${panel}?.getAttribute('aria-busy') === 'true'`);
    assert(!await evaluate(`${panel}.textContent.includes('недоступна')`), "Loading is not unavailable");
    await evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Підпис мему"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Моя незмінна чернетка');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`, true);
    await release(firstStory, { failure: true });
    await until(`${panel}?.querySelector('[role="alert"]')`);
    hold("/api/artworks/2");
    await click("Спробувати ще раз");
    const retry = await held("/api/artworks/2");
    await until(`${panel}?.getAttribute('aria-busy') === 'true'`);
    await release(retry);
    await until(`${panel}?.textContent.includes('Історія 2: чинна')`);
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Підпис мему\"]').value"), "Моя незмінна чернетка");
    assert.equal(await evaluate(`${panel}.querySelector('a[target="_blank"]').getAttribute('href')`), "/sources/2");

    // A -> B -> A cannot be protected by artwork ID alone.
    await pick(1);
    hold("/api/artworks/2");
    await pick(2);
    const staleSameArtwork = await held("/api/artworks/2");
    hold("/api/artworks/3");
    await pick(3);
    const staleFailure = await held("/api/artworks/3");
    hold("/api/artworks/2");
    await pick(2);
    const latest = await held("/api/artworks/2");
    await release(latest, { version: "найновіша" });
    await until(`${panel}?.textContent.includes('найновіша')`);
    await release(staleSameArtwork, { version: "застаріла" });
    await release(staleFailure, { failure: true });
    assert(await evaluate(`${panel}.textContent.includes('найновіша') && !${panel}.querySelector('[role="alert"]')`));

    await pick(1);
    fail("/api/artworks/2");
    await pick(2);
    await until(`${panel}?.querySelector('[role="alert"]')`);
    hold("/api/artworks/2");
    await click("Спробувати ще раз");
    const staleRetry = await held("/api/artworks/2");
    await pick(1);
    await release(staleRetry, { failure: true });
    assert(await evaluate(`${panel}.textContent.includes('Історія 1') && !${panel}.querySelector('[role="alert"]')`));
    await pick(2);
    await until(`${panel}?.textContent.includes('Історія 2')`);
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Підпис мему\"]').value"), "Моя незмінна чернетка");
    await pick(4);
    await until(`${panel}?.textContent.includes('зараз недоступна') && ${panel}?.getAttribute('aria-busy') === 'false'`);
    console.log("PASS story loading/error/retry/source/draft/unavailable and stale success/failure/retry races");

    fail("/api/artworks/99");
    await navigate("/create/painting?artwork=99");
    await until(text("Не вдалося завантажити картину за посиланням"));
    hold("/api/artworks/99");
    await click("Спробувати ще раз");
    const preselectionRetry = await held("/api/artworks/99");
    await until(text("Завантажуємо обрану картину"));
    await release(preselectionRetry);
    await until(selected(99));
    await click("Закрити");
    assert(!await evaluate(selected(99)));

    fail("/api/artworks/99");
    await navigate("/create/painting?artwork=99&mode=own");
    await until(text("Не вдалося завантажити картину за посиланням"));
    await click("Приховати");
    assert(!await evaluate(text("Не вдалося завантажити картину за посиланням")));
    await pick(1);
    await until(selected(1));
    await click("Написати свій підпис");
    await until("location.pathname === '/create/painting/1/own'");
    await until(`${panel}?.textContent.includes('Історія 1')`);

    fail("/api/artworks/99");
    await navigate("/create/painting?artwork=99&test=retry-race");
    await until(text("Не вдалося завантажити картину за посиланням"));
    hold("/api/artworks/99");
    await click("Спробувати ще раз");
    const oldPreselectionRetry = await held("/api/artworks/99");
    await pick(2);
    await until(selected(2));
    await release(oldPreselectionRetry);
    assert(await evaluate(selected(2)), "Manual choice must survive late preselection retry");

    for (const [failure, suffix] of [[false, "success"], [true, "failure"]]) {
      hold("/api/artworks/99");
      await navigate(`/create/painting?artwork=99&test=${suffix}`);
      const preselection = await held("/api/artworks/99");
      await pick(2);
      await until(selected(2));
      await release(preselection, { failure });
      assert(await evaluate(selected(2)), "Manual choice must survive late preselection");
      assert(!await evaluate(text("Не вдалося завантажити картину за посиланням")));
    }

    hold("/api/artworks/99");
    await navigate("/create/painting?artwork=99&test=dismiss");
    const dismissed = await held("/api/artworks/99");
    await click("Приховати");
    await release(dismissed);
    assert(!await evaluate(selected(99)), "Dismissal cancels pending preselection");

    await navigate("/create/painting?artwork=invalid");
    await until(text("Не вдалося завантажити картину за посиланням"));
    await click("Приховати");
    for (const failure of [false, true]) {
      hold("/api/artworks?random=true");
      await click("Випадкова картина");
      const random = await held("/api/artworks?random=true");
      await pick(1);
      await until(selected(1));
      await release(random, { failure, id: 3 });
      assert(await evaluate(selected(1)), "Manual choice must survive late random response");
      assert(!await evaluate(text("Не вдалося обрати картину")));
      assert(await evaluate("[...document.querySelectorAll('button')].some(e => e.textContent === 'Випадкова картина' && !e.disabled)"));
    }
    assert((requestCounts.get("/api/artworks/2") ?? 0) >= 6, "Story requests exercised retry and races");
    assert.deepEqual(errors, []);
    console.log("PASS preselection failure/retry/dismissal/invalid links and manual selection vs preselection/random");
  },
});
