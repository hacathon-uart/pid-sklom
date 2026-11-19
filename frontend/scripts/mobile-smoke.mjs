// Self-owned loopback fixtures, private Chrome and build; never uses a configured backend.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runBrowserCheck } from "../../scripts/lib/browser-harness.mjs";
import { createMobileFixtures } from "../../scripts/lib/mobile-fixtures.mjs";

const widths = [320, 375, 390, 430, 768, 1024, 1440];
const routes = [
  ["/", "form"], ["/create", "form"], ["/create/painting", "main button:has(img)"],
  ["/create/result?q=hello", ".konvajs-content canvas"],
  ["/create/painting/1/own", "#caption-font"], ["/create/painting/2/ai", ".konvajs-content canvas"],
  ["/gallery", "main button:has(img)"], ["/artists", "main a[href='/artists/test-artist']"],
  ["/artists/test-artist", "main a[href='/create/painting?artwork=1']"],
  ["/m/public-fixture", "#meme-story"], ["/quiz", ".plan-room"],
  ["/quiz/who", "button.catalogue-card"], ["/quiz/titles", "button.catalogue-card"],
  ["/quiz/pairs", "button[aria-label='Картина 1']"],
];
const fixtures = createMobileFixtures();
let referenceCount = 0;
const screenshotDir = process.env.SMOKE_SCREENSHOT_DIR ? resolve(process.env.SMOKE_SCREENSHOT_DIR) : null;
if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });

await runBrowserCheck({
  authMode: "supabase",
  handleRequest: fixtures.handleRequest,
  run: async ({ command, evaluate, until, navigate, click }) => {
    const setWidth = (width) => command("Emulation.setDeviceMetricsOverride", {
      width, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    const ready = async (selector) => {
      await until(`document.querySelector(${JSON.stringify(selector)}) && document.querySelector('h1')?.textContent.trim()`);
      await evaluate("document.fonts.ready.then(() => true)");
      await evaluate("[...document.images].forEach(i => { i.loading = 'eager'; })");
      await until("[...document.images].every(i => i.complete && i.naturalWidth > 0)", "All visible artwork images loaded");
      await evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
    };
    const visit = async (path, selector = "h1") => { await navigate(path); await ready(selector); };
    const layout = async (label) => {
      const state = await evaluate(`(() => {
        const nav = [...document.querySelectorAll('nav[aria-label="Основна навігація"]')].filter(n => n.getClientRects().length);
        const clipped = [...document.querySelectorAll('button,a,input,select,summary')].filter(e => {
          if (!e.getClientRects().length) return false;
          const r = e.getBoundingClientRect();
          return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
        }).map(e => (e.getAttribute('aria-label') || e.textContent.trim()).slice(0, 100));
        return { width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
          nav: nav.length, active: nav.every(n => !!n.querySelector('[aria-current="page"]')),
          publicView: location.pathname.startsWith('/m/'), clipped };
      })()`);
      assert(state.scroll <= state.width + 1, `${label}: overflow ${JSON.stringify(state)}`);
      assert.equal(state.nav, 1, `${label}: exactly one visible primary navigation`);
      assert.equal(state.active, !state.publicView, `${label}: active navigation matches route ownership`);
      assert.deepEqual(state.clipped, [], `${label}: horizontally clipped controls`);
    };
    const reference = async (name, selector) => {
      if (!screenshotDir) return;
      await evaluate(selector
        ? `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'start', behavior: 'instant' })`
        : "window.scrollTo({ top: 0, behavior: 'instant' })");
      await evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
      const image = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(resolve(screenshotDir, `${name}.png`), Buffer.from(image.data, "base64"));
      referenceCount++;
    };
    const input = async (selector, value) => {
      await evaluate(`(() => {
        const e = document.querySelector(${JSON.stringify(selector)});
        if (!e) throw new Error('Missing input: ' + ${JSON.stringify(selector)});
        Object.getOwnPropertyDescriptor(${selector === "#caption-font" ? "HTMLSelectElement" : "HTMLInputElement"}.prototype, 'value').set.call(e, ${JSON.stringify(value)});
        e.dispatchEvent(new Event('${selector === "#caption-font" ? "change" : "input"}', { bubbles: true }));
      })()`);
      await until(`document.querySelector(${JSON.stringify(selector)}).value === ${JSON.stringify(value)}`);
      await evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
    };
    await command("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.exportedPNGs = [];
      const anchorClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {
        if (this.download && this.href.startsWith('data:image/png')) { window.exportedPNGs.push(this.href); return; }
        return anchorClick.call(this);
      };
    ` });

    for (const width of widths) {
      await setWidth(width);
      for (const [path, selector] of routes) {
        await visit(path, selector);
        await layout(`${width} ${path}`);
      }
    }

    for (const width of [320, 390, 1440]) {
      await setWidth(width);
      await visit("/", "form");
      await reference(`home-${width}`);
      const links = await evaluate("[...document.querySelectorAll('footer a')].map(a => a.getAttribute('href'))");
      assert(links.includes("https://t.me/pid_sklom_bot"), "Footer links the production bot");
      assert(links.includes("https://github.com/hacathon-uart/pid-sklom"), "Footer links project source");
      await visit("/create/painting", "main button:has(img)");
      await evaluate("document.querySelector('main button:has(img)').click()");
      await until("document.body.innerText.includes('Згенерувати підпис')");
      await layout(`${width} selected picker`);
      if (width === 1440) {
        assert(await evaluate(`(() => {
          const image = [...document.images].find(i => i.alt === '' && i.closest('.fixed'));
          const reset = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Скинути вибір');
          if (!image || !reset || !reset.getClientRects().length) return false;
          const a = image.getBoundingClientRect(), b = reset.getBoundingClientRect();
          return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 12;
        })()`), "Desktop selected artwork actions stay in the original single row");
      }
      await reference(`picker-${width}`);
      await click("Написати свій підпис");
      await ready("#caption-font");
      await input("input[aria-label='Текст підпису']", "Довгий український підпис для перевірки вузького екрана");
      await layout(`${width} own caption`);
      await reference(`editor-${width}`);
      await reference(`editor-controls-${width}`, "#caption-font");
      await reference(`story-${width}`, "#artwork-story");
      await visit("/gallery", "main button:has(img)");
      await evaluate("document.querySelector('main a[href=\"/artists/test-artist\"]').click()");
      await ready("main a[href='/create/painting?artwork=1']");
      await click("Зробити мем з картини");
      await ready(".konvajs-content canvas");
      await until("document.body.innerText.includes('Понеділок знову настав')");
      await layout(`${width} artist to AI`);
    }

    const carouselArtists = Array.from({ length: 8 }, (_, index) => ({
      ...fixtures.art().artist, id: index + 1, slug: `carousel-${index}`, name: `Автор ${index}`,
    }));
    fixtures.state.override = ({ url, json }) => url.pathname === "/api/artists" ? json(carouselArtists) : false;
    const firstVisibleAuthor = () => evaluate(`[
      ...document.querySelectorAll('main a[href^="/artists/"]')
    ].find(a => a.getClientRects().length)?.getAttribute('href')`);
    for (const [width, expected] of [[390, "/artists/carousel-1"], [1440, "/artists/carousel-3"]]) {
      await setWidth(width);
      await visit("/gallery", "main a[href='/artists/carousel-0']");
      await evaluate("document.querySelector('button[aria-label=\"Наступні автори\"]').click()");
      await until(`[
        ...document.querySelectorAll('main a[href^="/artists/"]')
      ].find(a => a.getClientRects().length)?.getAttribute('href') === ${JSON.stringify(expected)}`);
      assert.equal(await firstVisibleAuthor(), expected, `${width}: carousel advances by visible column group`);
    }
    fixtures.state.override = null;

    fixtures.state.catalogueCount = 53;
    for (const [width, route, region] of [
      [390, "/gallery", "#gallery-artworks"],
      [1440, "/create/painting?mode=own", "#picker-artworks"],
    ]) {
      await setWidth(width);
      await visit(route, `${region} button:has(img)`);
      const firstArtwork = () => evaluate(`document.querySelector(${JSON.stringify(`${region} button img`)})?.alt`);
      assert((await firstArtwork()).startsWith("Картина 1:"), `${route}: first page starts at artwork 1`);
      await click("Наступна →");
      await until(`document.querySelector(${JSON.stringify(`${region} button img`)})?.alt.startsWith('Картина 21:')`);
      assert(await evaluate("document.body.innerText.includes('Картини 21–40 із 53 · Сторінка 2 з 3')"));
      await click("Наступна →");
      await until(`document.querySelector(${JSON.stringify(`${region} button img`)})?.alt.startsWith('Картина 41:')`);
      assert.equal(await evaluate("new URLSearchParams(location.search).get('page')"), "3", `${route}: page is addressable`);
      assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(`${region} button:has(img)`)}).length`), 13);
      await layout(`${width} ${route} last catalogue page`);
      if (route === "/gallery") {
        await evaluate("history.back()");
        await until(`new URLSearchParams(location.search).get('page') === '2' && document.querySelector(${JSON.stringify(`${region} button img`)})?.alt.startsWith('Картина 21:')`);
        await evaluate("history.forward()");
        await until(`new URLSearchParams(location.search).get('page') === '3' && document.querySelector(${JSON.stringify(`${region} button img`)})?.alt.startsWith('Картина 41:')`);
      } else {
        assert.equal(await evaluate("new URLSearchParams(location.search).get('mode')"), "own", "Picker mode survives page changes");
        await evaluate(`document.querySelector(${JSON.stringify(`${region} button:has(img)`)}).click()`);
        await until("document.body.innerText.includes('Картина 41:') && document.body.innerText.includes('Згенерувати підпис')");
        await layout("Selected artwork from last catalogue page");
      }
      if (route === "/gallery") {
        await input("input[placeholder='Автор, картина або настрій']", "нічогонемає");
        await until("document.body.innerText.includes('У цьому залі такої картини немає')");
      } else {
        await click("Пейзаж");
        await until(`document.querySelector(${JSON.stringify(`${region} button img`)})?.alt.startsWith('Картина 2:')`);
      }
      assert.equal(await evaluate("new URLSearchParams(location.search).has('page')"), false, `${route}: filter returns to page one`);
      assert.equal(await evaluate("document.querySelector('nav[aria-label=\"Сторінки картин\"]')"), null, `${route}: filter resets pagination`);
      await layout(`${width} ${route} filtered catalogue`);
    }
    fixtures.state.catalogueCount = 3;

    await setWidth(390);
    fixtures.state.empty = true;
    await visit("/gallery");
    await until("document.body.innerText.includes('У цьому залі такої картини немає')");
    await layout("Empty catalogue");
    fixtures.state.empty = false;
    fixtures.state.failCatalogue = true;
    await visit("/create/painting");
    await until("document.body.innerText.includes('Не вдалося завантажити колекцію')");
    await layout("Failed catalogue");
    await reference("catalogue-error-390");
    fixtures.state.failCatalogue = false;
    await click("Спробувати ще раз");
    await ready("main button:has(img)");

    async function quiz(game, signedIn) {
      const rounds = signedIn ? 3 : 2;
      await visit(`/quiz/${game}`, game === "pairs" ? "button[aria-label='Картина 1']" : "button.catalogue-card");
      for (let round = 0; round < rounds; round++) {
        if (game === "pairs") {
          await until("document.querySelector('button[aria-label=\"Картина 1\"]:not(:disabled)') && !document.querySelector('button[aria-label^=\"Зняти\"]')");
          for (let i = 0; i < 3; i++) {
            await evaluate(`document.querySelector('button[aria-label="Картина ${i + 1}"]').click()`);
            await until(`document.querySelector('button[aria-label="Картина ${i + 1}"]').getAttribute('aria-pressed') === 'true'`);
            await evaluate(`(() => {
              const groups = [...document.querySelectorAll('.label-tray')].filter(e => e.getClientRects().length);
              const options = groups.flatMap(g => [...g.querySelectorAll('button')]).filter(b => b.getClientRects().length && !b.disabled && b.querySelector('.wl-who'));
              if (!options[0]) throw new Error('No available curator label');
              options[0].click();
            })()`);
            await until(`document.querySelectorAll('button[aria-label^="Зняти"]').length === ${i + 1}`);
          }
          await click("Перевірити");
        } else {
          await until("document.querySelector('button.catalogue-card:not(:disabled)')");
          await evaluate("document.querySelector('button.catalogue-card:not(:disabled)').click()");
        }
        await until("document.querySelector('[role=status]') && [...document.querySelectorAll('button')].some(b => /^(Далі|Підсумки)$/.test(b.textContent.trim()))");
        await layout(`${game} reveal ${round}`);
        await click(round === rounds - 1 ? "Підсумки" : "Далі");
      }
      await until("document.querySelector('.certificate')");
      await layout(`${signedIn ? 'Member' : 'Guest'} ${game} certificate`);
      async function certificateClearance() {
        assert(await evaluate(`(() => {
          const stamp = document.querySelector('.certificate .ink-stamp').getBoundingClientRect();
          return [...document.querySelectorAll('.certificate p, .certificate h2')].every(e => {
            const r = e.getBoundingClientRect();
            return r.right <= stamp.left || r.left >= stamp.right || r.bottom <= stamp.top || r.top >= stamp.bottom;
          });
        })()`), `${game}: decorative stamp must not obscure certificate copy`);
      }
      await certificateClearance();
      if (!signedIn) {
        assert(await evaluate("document.body.innerText.includes('Далі — лише для відвідувачів з акаунтом.')"), "Guest run stops at its allowance");
        for (const width of [320, 390, 1440]) {
          await setWidth(width);
          await evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
          await layout(`${game} certificate ${width}`);
          await certificateClearance();
          await reference(`certificate-${game}-${width}`);
        }
        await setWidth(390);
      } else {
        assert.equal(fixtures.state.best[game === "titles" ? "titles:all" : game], 3, "Member best persisted");
        await visit("/quiz", ".plan-room");
        assert(await evaluate("document.body.innerText.includes('РЕКОРД 3')"), "Reloaded lobby restores best");
      }
    }
    for (const game of ["who", "pairs", "titles"]) await quiz(game, false);
    await visit("/");
    await click("Увійти з Google");
    await until("location.pathname === '/' && document.body.innerText.includes('Тестовий відвідувач')");
    for (const game of ["who", "pairs", "titles"]) await quiz(game, true);

    async function pngHash() {
      const before = await evaluate("window.exportedPNGs.length");
      await until("document.querySelector('button[aria-label=\"Завантажити PNG\"]:not(:disabled)')");
      await evaluate("document.querySelector('button[aria-label=\"Завантажити PNG\"]').click()", true);
      await until(`window.exportedPNGs.length === ${before + 1}`, "PNG export completes");
      const png = await evaluate("window.exportedPNGs.at(-1)");
      return createHash("sha256").update(Buffer.from(png.split(",")[1], "base64")).digest("hex");
    }
    await visit("/create/result?q=unchanged-export", ".konvajs-content canvas");
    const collapsed = await pngHash();
    await setWidth(320);
    assert.equal(await pngHash(), collapsed, "Collapsed editor export survives resize");
    await click("Редагувати підпис");
    await ready("#caption-font");
    assert.equal(await pngHash(), collapsed, "Opening caption controls does not change PNG pixels");

    for (const id of [1, 2]) {
      await visit(`/create/painting/${id}/own`, "#caption-font");
      await input("input[aria-label='Текст підпису']", "Перший довгий підпис українською");
      await click("+ Додати ще один текст");
      await input("input[aria-label='Текст підпису']", "Другий підпис про мистецтво");
      await click("Вгорі");
      const fonts = await evaluate("[...document.querySelector('#caption-font').options].map(o => o.value)");
      const hashes = new Set();
      for (let index = 0; index < fonts.length; index++) {
        await input("#caption-font", fonts[index]);
        await evaluate("document.fonts.ready.then(() => true)");
        await evaluate(`document.querySelectorAll('[role=group][aria-label="Рамка"] button')[${index % 4}].click()`);
        const baseline = await pngHash();
        hashes.add(baseline);
        for (const width of [320, 1440]) {
          await setWidth(width);
          await layout(`${id} ${fonts[index]} export`);
          assert.equal(await pngHash(), baseline, `${id} ${fonts[index]}: unchanged PNG across widths`);
        }
      }
      assert(hashes.size > 1, "Export variants must exercise distinct compositions");
      await setWidth(390);
      const framed = await pngHash();
      await evaluate("document.querySelector('input[type=checkbox]').click()");
      const unframed = await pngHash();
      assert.notEqual(framed, unframed, "Frame inclusion changes exported pixels");
      await setWidth(320);
      assert.equal(await pngHash(), unframed, "Unframed PNG is viewport independent");
    }
    console.log(`Mobile journeys passed: ${routes.length} routes × ${widths.length} widths; catalogue states, all guest/member quizzes, two-block/font-control/frame PNG variants${referenceCount ? `, ${referenceCount} screenshots` : ""}`);
    console.log("Offline font evidence: bundled Oswald; other font families use deterministic browser fallbacks, not production glyph acceptance.");
  },
});

await runBrowserCheck({
  handleRequest: createMobileFixtures().handleRequest,
  run: async ({ command, navigate, until, evaluate }) => {
    await command("Emulation.setDeviceMetricsOverride", { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
    for (const route of ["/", "/create", "/quiz", "/m/public-fixture"]) {
      await navigate(route);
      await until("document.querySelector('h1')?.textContent.trim()");
      assert.equal(await evaluate("document.querySelectorAll('summary[aria-label^=\"Гостьовий квиток\"]').length"), 0);
      assert.equal(await evaluate("[...document.querySelectorAll('nav a')].some(a => a.getAttribute('href') === '/me')"), false);
    }
    console.log("Auth-disabled mobile navigation passed");
  },
});
