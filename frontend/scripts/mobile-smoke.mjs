/**
 * Local responsive smoke check with no browser-test dependency.
 * Start the offline stub API and Vite, then launch Chrome with
 * --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/pidsklom-smoke.
 * Run `npm run smoke:mobile` from frontend/. Set SMOKE_EXPORT=1 and
 * SMOKE_FLOWS=1 for PNG and quiz interactions; use only with the offline stub API.
 */
import { createHash } from "node:crypto";

const appUrl = process.env.SMOKE_APP_URL ?? "http://127.0.0.1:5173";
const cdpUrl = process.env.SMOKE_CDP_URL ?? "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!["127.0.0.1", "localhost"].includes(new URL(appUrl).hostname)) {
  throw new Error("The mobile smoke check runs against a local frontend only");
}

const tab = await (await fetch(`${cdpUrl}/json/new?about:blank`, { method: "PUT" })).json();
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  message.error ? reject(new Error(message.error.message)) : resolve(message.result);
};
function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}
async function setWidth(width) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(100);
}
async function visit(path) {
  await send("Page.navigate", { url: `${appUrl}${path}` });
  await sleep(1000);
  return evaluate(`({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    nav: [...document.querySelectorAll('nav')].filter(n => getComputedStyle(n).display !== 'none')
      .map(n => ({right: n.getBoundingClientRect().right, selected: !!n.querySelector('[aria-current="page"]')})),
    heading: !!document.querySelector('h1'),
  })`);
}

await send("Page.enable");
await send("Runtime.enable");
const routes = ["/", "/create", "/create/painting", "/create/result?q=hello", "/gallery", "/artists", "/quiz", "/quiz/who", "/quiz/pairs"];
const widths = [320, 390, 768, 1024, 1440];
const failures = [];
try {
  for (const width of widths) {
    await setWidth(width);
    for (const path of routes) {
      const state = await visit(path);
      if (state.scroll > state.client + 1) failures.push(`${width} ${path}: horizontal overflow ${state.scroll} > ${state.client}`);
      if (!state.heading) failures.push(`${width} ${path}: missing heading`);
      if (state.nav.length !== 1 || state.nav[0].right > state.client + 1 || !state.nav[0].selected) {
        failures.push(`${width} ${path}: primary navigation is missing, overflowing, or inactive`);
      }
    }
  }

  await setWidth(320);
  await visit("/create");
  const enlarged = await evaluate(`(() => {
    document.documentElement.style.fontSize = '32px';
    const nav = [...document.querySelectorAll('nav')].find(n => getComputedStyle(n).display !== 'none');
    const last = nav.querySelector('a:last-child');
    last.scrollIntoView({ block: 'nearest', inline: 'end' });
    return { page: document.documentElement.scrollWidth, width: document.documentElement.clientWidth,
      lastRight: last.getBoundingClientRect().right, navRight: nav.getBoundingClientRect().right };
  })()`);
  if (enlarged.page > enlarged.width + 1 || enlarged.lastRight > enlarged.navRight + 1) {
    failures.push("Enlarged navigation must remain reachable without page overflow");
  }

  if (process.env.SMOKE_FLOWS === "1") {
    await setWidth(320);
    await visit("/create/painting");
    await evaluate("document.querySelector('main button:has(img)')?.click()");
    await sleep(120);
    const picker = await evaluate("!![...document.querySelectorAll('button')].find(b => b.textContent.includes('Згенерувати підпис'))");
    if (!picker) failures.push("Painting selection did not reveal caption actions");

    for (const game of ["who", "titles"]) {
      await visit(`/quiz/${game}`);
      const options = await evaluate("document.querySelectorAll('button.catalogue-card').length");
      if (!options) { failures.push(`${game}: no answer cards`); continue; }
      await evaluate("document.querySelector('button.catalogue-card').click()");
      await sleep(350);
      const revealed = await evaluate("!!document.querySelector('.wall-label') && !![...document.querySelectorAll('button')].find(b => /Далі|Підсумки/.test(b.textContent))");
      if (!revealed) failures.push(`${game}: answer did not reveal a fact and next action`);
    }

    await visit("/quiz/pairs");
    for (let index = 0; index < 3; index++) {
      const assigned = await evaluate(`(() => {
        const tray = document.querySelector('.label-tray[role="group"]');
        const option = [...(tray?.querySelectorAll('button') ?? [])].find(b => !b.disabled);
        if (!option) return false;
        option.click();
        return true;
      })()`);
      if (!assigned) { failures.push(`pairs: could not assign label ${index + 1}`); break; }
      await sleep(60);
    }
    const canCheck = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Перевірити');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!canCheck) failures.push("pairs: assigned labels did not enable checking");
    else {
      await sleep(400);
      const revealed = await evaluate("!!document.querySelector('[role=status] .t-label')");
      if (!revealed) failures.push("pairs: submitted labels did not reveal a result");
    }
  }

  if (process.env.SMOKE_EXPORT === "1") {
    await setWidth(390);
    await visit("/create/result?q=hello");
    await evaluate(`HTMLAnchorElement.prototype.click = function() { window.__smokePng = this.href; }`);
    async function pngHash() {
      await evaluate(`window.__smokePng = null; document.querySelector('button[aria-label="Завантажити PNG"]').click()`);
      for (let attempt = 0; attempt < 30; attempt++) {
        await sleep(150);
        const png = await evaluate("window.__smokePng");
        if (png) return createHash("sha256").update(Buffer.from(png.split(",")[1], "base64")).digest("hex");
      }
      throw new Error("PNG export did not complete against the offline stub API");
    }
    const wide = await pngHash();
    await setWidth(320);
    const narrow = await pngHash();
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Редагувати підпис'))?.click()`);
    await sleep(200);
    const editing = await pngHash();
    if (wide !== narrow || wide !== editing) failures.push("Unchanged PNG pixels differ by viewport or editor state");
  }
} finally {
  socket.close();
  await fetch(`${cdpUrl}/json/close/${tab.id}`).catch(() => {});
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Mobile smoke passed: ${routes.length} routes × ${widths.length} widths${process.env.SMOKE_FLOWS === "1" ? ", picker and quiz interactions" : ""}${process.env.SMOKE_EXPORT === "1" ? ", canonical PNG" : ""}`);
}
