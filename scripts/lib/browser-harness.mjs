import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

export async function runBrowserCheck({ authMode = "disabled", handleRequest, run }) {
  const chromePath = process.env.CHROME_PATH ?? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ].find(existsSync);
  assert(chromePath, "Chrome is required; set CHROME_PATH");
  const workspace = mkdtempSync(join(root, ".browser-check-"));
  const dist = join(workspace, "dist");
  const profile = join(workspace, "chrome");
  const errors = [];
  let origin;
  let chrome;
  let socket;
  let command;
  const pending = new Map();
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url, origin);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const json = (value, status = 200, headers = {}) => {
        res.writeHead(status, { "Content-Type": "application/json", ...headers });
        res.end(JSON.stringify(value));
        return true;
      };
      if (url.pathname === "/__fixture-font/Oswald.ttf") {
        res.writeHead(200, { "Content-Type": "font/ttf" });
        res.end(readFileSync(join(root, "backend/app/render/fonts/Oswald.ttf")));
        return;
      }
      if (await handleRequest({ req, res, url, body, json, origin })) return;
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/v1/")) {
        errors.push(`Unexpected fixture request: ${req.method} ${url.pathname}`);
        json({ detail: "No fixture for this request" }, 404);
        return;
      }
      const requested = resolve(dist, "." + decodeURIComponent(url.pathname));
      if (requested !== dist && !requested.startsWith(dist + sep)) {
        res.writeHead(404).end();
        return;
      }
      const file = existsSync(requested) && statSync(requested).isFile()
        ? requested : extname(requested) ? null : join(dist, "index.html");
      if (!file) { res.writeHead(404).end(); return; }
      const mime = {
        ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
        ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png",
      };
      res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    })().catch((error) => {
      errors.push(error.stack ?? error.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  try {
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${server.address().port}`;
    const build = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { build } from 'vite';
      await build({ envFile: false, build: { outDir: ${JSON.stringify(dist)} } });
    `], {
      cwd: join(root, "frontend"), encoding: "utf8",
      env: {
        ...process.env, VITE_AUTH_MODE: authMode, VITE_API_URL: origin,
        VITE_SUPABASE_URL: authMode === "supabase" ? origin : "",
        VITE_SUPABASE_ANON_KEY: authMode === "supabase" ? "synthetic-public-key" : "",
      },
    });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    chrome = spawn(chromePath, [
      "--headless=new", "--no-sandbox", "--disable-background-networking", "--disable-sync",
      "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0", `--user-data-dir=${profile}`,
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "about:blank",
    ], { stdio: "ignore" });
    let launchError;
    chrome.on("error", (error) => { launchError = error; });
    const deadline = Date.now() + 20000;
    while (!existsSync(join(profile, "DevToolsActivePort"))) {
      if (launchError) throw launchError;
      assert(chrome.exitCode === null, `Chrome exited: ${chrome.exitCode}`);
      assert(Date.now() < deadline, "Chrome did not become ready");
      await delay(50);
    }
    const port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
    await new Promise((done, reject) => {
      socket.addEventListener("open", done, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let sequence = 0;
    command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request?.reject(new Error(message.error.message));
        else request?.resolve(message.result);
      }
      if (message.method === "Runtime.exceptionThrown") {
        errors.push(JSON.stringify(message.params.exceptionDetails));
      }
      if (message.method === "Fetch.requestPaused") {
        const { requestId, request } = message.params;
        if (new URL(request.url).origin === "https://fonts.googleapis.com") {
          const css = `@font-face { font-family: Oswald; font-style: normal; font-weight: 200 700; src: url('${origin}/__fixture-font/Oswald.ttf') format('truetype'); font-display: swap; }`;
          void command("Fetch.fulfillRequest", {
            requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/css" }],
            body: Buffer.from(css).toString("base64"),
          }).catch((error) => errors.push(error.message));
          return;
        }
        const local = new URL(request.url).origin === origin;
        if (!local) errors.push(`Blocked external request: ${new URL(request.url).origin}`);
        void command(local ? "Fetch.continueRequest" : "Fetch.failRequest",
          local ? { requestId } : { requestId, errorReason: "BlockedByClient" })
          .catch((error) => errors.push(error.message));
      }
    });
    const evaluate = async (expression, userGesture = false) => {
      const result = await command("Runtime.evaluate", {
        expression, returnByValue: true, awaitPromise: true, userGesture,
      });
      assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async (expression, label = expression) => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        try {
          if (await evaluate(`!!document.body && !!(${expression})`)) return;
        } catch (error) {
          if (!/context|navigation/i.test(error.message)) throw error;
        }
        await delay(50);
      }
      throw new Error(`Timed out: ${label}\n${await evaluate("document.body?.innerText")}`);
    };
    const navigate = async (path) => {
      assert(path.startsWith("/") && !path.startsWith("//"), "Use a local route");
      await command("Page.navigate", { url: origin + path });
      await until(`location.href === ${JSON.stringify(origin + path)} && document.readyState === 'complete'`);
    };
    const click = async (text) => {
      const match = `[...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === ${JSON.stringify(text)} && e.getClientRects().length && !e.disabled)`;
      await until(match, `Enabled control: ${text}`);
      await evaluate(`(${match}).click()`, true);
    };
    await command("Page.enable");
    await command("Runtime.enable");
    await command("Fetch.enable", { patterns: [
      { urlPattern: "http://*", requestStage: "Request" },
      { urlPattern: "https://*", requestStage: "Request" },
    ] });
    await run({ origin, command, evaluate, until, navigate, click, errors });
    assert.deepEqual(errors, [], "Browser/fixture errors");
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      try { await command("Browser.close"); } catch (error) {
        if (chrome?.exitCode === null) console.error("Browser close failed:", error.message);
      }
      socket.close();
    }
    for (const request of pending.values()) request.reject(new Error("Browser check closed"));
    if (chrome?.exitCode === null) {
      const exited = once(chrome, "exit");
      await Promise.race([exited, delay(3000)]);
      if (chrome.exitCode === null) chrome.kill("SIGTERM");
      await exited;
    }
    server.closeAllConnections();
    await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
    rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
