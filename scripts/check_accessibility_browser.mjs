import assert from "node:assert/strict";
import { runBrowserCheck } from "./lib/browser-harness.mjs";
import { createMobileFixtures } from "./lib/mobile-fixtures.mjs";

await runBrowserCheck({
  authMode: "supabase",
  handleRequest: createMobileFixtures().handleRequest,
  run: async ({ command, evaluate, until, navigate, click }) => {
    const viewport = (width) => command("Emulation.setDeviceMetricsOverride", {
      width, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    const settle = () => evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
    const key = async (value) => {
      const windowsVirtualKeyCode = { Tab: 9, Enter: 13, Escape: 27 }[value];
      await command("Input.dispatchKeyEvent", {
        type: "keyDown", key: value, code: value, windowsVirtualKeyCode,
        ...(value === "Enter" ? { text: "\r" } : {}),
      });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: value, code: value, windowsVirtualKeyCode });
      await settle();
    };
    const overflow = async (label) => {
      const state = await evaluate(`({
        width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll('body *')].filter(e => {
          const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
        }).slice(-15).map(e => ({ tag: e.tagName, class: e.className, text: e.textContent.trim().slice(0, 80), width: e.getBoundingClientRect().width })),
        scrolling: [...document.querySelectorAll('body *')].filter(e => e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0).slice(-12).map(e => ({tag:e.tagName, class:e.className, scroll:e.scrollWidth, client:e.clientWidth, overflow:getComputedStyle(e).overflowX})),
      })`);
      assert(state.scroll <= state.width + 1, `${label}: no document overflow ${JSON.stringify(state)}`);
    };
    for (const width of [320, 390, 1440]) {
      await viewport(width);
      for (const [path, selector] of [
        ["/create", ".t-body"], ["/create/painting/1/own", "label[for='caption-font']"], ["/quiz", "main header .t-body"],
      ]) {
        await navigate(path);
        await until(`document.querySelector(${JSON.stringify(selector)}) && document.querySelector('h1')?.textContent.trim()`);
        await evaluate("document.fonts.ready.then(() => true)");
        const before = await evaluate(`parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(selector)})).fontSize)`);
        await evaluate("document.documentElement.style.fontSize = '32px'");
        await settle();
        const after = await evaluate(`parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(selector)})).fontSize)`);
        assert(Math.abs(after - before * 2) < 0.1, `${path}: representative text must actually double (${before} -> ${after})`);
        await overflow(`${width} ${path} at 200% root text`);
        const nav = await evaluate(`(() => {
          const n = [...document.querySelectorAll('nav')].find(e => e.getClientRects().length);
          const last = [...n.querySelectorAll('a')].at(-1);
          last.focus();
          last.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          const r = last.getBoundingClientRect();
          return { left: r.left, right: r.right, width: innerWidth };
        })()`);
        assert(nav.left >= -1 && nav.right <= nav.width + 1, `${width} ${path}: enlarged navigation remains reachable ${JSON.stringify(nav)}`);
      }
    }

    await viewport(390);
    await navigate("/create");
    await until("document.querySelector('h1')?.textContent.trim()");
    await key("Tab");
    assert.equal(await evaluate("document.activeElement?.textContent.trim()"), "До вмісту", "Keyboard entry exposes skip link");
    await key("Enter");
    assert.equal(await evaluate("document.activeElement?.id"), "main-content", "Skip link moves focus to main content");

    async function keyboardRoute(path, ready) {
      await navigate(path);
      await until(ready);
      const visited = new Set();
      for (let index = 0; index < 100; index++) {
        await key("Tab");
        const focus = await evaluate(`(() => {
          const e = document.activeElement;
          if (!e || e === document.body) return null;
          const r = e.getBoundingClientRect();
          const x = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2));
          const y = Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2));
          const hit = document.elementFromPoint(x, y);
          const style = getComputedStyle(e);
          return {
            key: [...document.querySelectorAll('*')].indexOf(e),
            label: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 100) || e.outerHTML.slice(0, 220),
            visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight,
            unobscured: !!hit && (e.contains(hit) || hit.contains(e)),
            indicator: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 || style.boxShadow !== 'none',
          };
        })()`);
        if (!focus) continue;
        if (visited.has(focus.key)) break;
        visited.add(focus.key);
        assert(focus.visible && focus.unobscured, `${path}: focus visible and unobscured: ${focus.label}`);
        assert(focus.indicator, `${path}: visible focus indicator: ${focus.label}`);
      }
      assert(visited.size >= 8, `${path}: exercised real keyboard traversal`);
      await overflow(`${path} keyboard traversal`);
    }
    await keyboardRoute("/create", "document.querySelector('form')");
    await keyboardRoute("/create/painting/1/own", "document.querySelector('#caption-font')");
    await keyboardRoute("/create/painting?artwork=1", "[...document.querySelectorAll('button')].some(b => b.textContent === 'Написати свій підпис')");
    await keyboardRoute("/quiz", "document.querySelector('.plan-room')");
    assert.equal(await evaluate("document.documentElement.style.getPropertyValue('--picker-panel-clearance')"), "", "Picker clears its global scroll reservation on exit");

    await navigate("/create");
    await until("document.querySelector('summary[aria-label^=\"Гостьовий квиток\"]')");
    await evaluate("document.querySelector('summary').focus()");
    await key("Enter");
    await until("document.querySelector('details').open");
    await key("Escape");
    assert(await evaluate("!document.querySelector('details').open && document.activeElement.tagName === 'SUMMARY'"), "Ticket Escape closes and restores focus");

    await navigate("/create/painting/1/own");
    await until("document.querySelector('#caption-font')");
    await click("Вгорі");
    assert(await evaluate("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Вгорі' && b.getAttribute('aria-pressed') === 'true')"), "Non-drag caption position path");
    await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await navigate("/quiz/who");
    await until("document.querySelector('button.catalogue-card')");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('button.catalogue-card')).transitionDuration"), "0s", "Reduced motion removes answer-card transitions");
    console.log("Accessibility automation passed: actual representative 200% text growth, narrow reflow, keyboard/skip/focus, guest ticket Escape, caption presets, reduced motion.");
    console.log("Human gates remain: real browser zoom, screen readers, contrast/visual review and iOS/Android native interaction.");
  },
});
