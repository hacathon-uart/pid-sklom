import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export function createMobileFixtures() {
  let origin;
  const state = {
    override: null, empty: false, failCatalogue: false,
    runs: new Map(), best: {}, answers: 0,
  };
  const artist = {
    id: 1, slug: "test-artist", name: "Олександра Художниця з довгим українським прізвищем",
    birth_year: 1800, death_year: 1900, portrait_url: null, short_bio: "Перевірена біографія.",
  };
  const art = (id = 1) => ({
    id, slug: `artwork-${id}`, title: `Картина ${id}: надзвичайно довга українська назва для перевірки перенесення`,
    year: 1850, genre: id === 2 ? "landscape" : "everyday",
    image_url: `${origin}/fixture-${id}.svg`, thumb_url: `${origin}/fixture-${id}.svg`, artist,
  });
  const story = {
    about_artwork: "Перевірена історія картини. Текст залишається читабельним на вузькому екрані.",
    museum: "Музей українського мистецтва", artwork_fact: null, artist_fact: null,
    source_url: "https://example.test/reviewed-source",
  };
  const style = {
    frame: "gold", blocks: [{
      text: "Довгий український підпис про понеділок і незавершені справи",
      font: "Oswald", size: 40, color: "#FFFFFF", outline: true, position: "bottom",
      x: null, y: null, width: null,
    }],
  };
  const meme = () => ({
    id: "public-fixture", artwork: art(), caption: style.blocks[0].text, style,
    image_url: `${origin}/fixture-1.svg`, is_favorite: false,
    created_at: "2026-01-01T00:00:00Z", can_edit: false,
  });
  const user = {
    id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated",
    email: "fixture@example.test", user_metadata: { full_name: "Тестовий відвідувач" },
    app_metadata: { provider: "google" }, created_at: "2026-01-01T00:00:00Z",
  };
  function question(game, index) {
    const ids = game === "pairs" ? [1, 2, 3] : [index % 2 + 1];
    return {
      images: ids.map((id, i) => ({ key: `image-${i}`, image_url: `${art(id).image_url}?question=${index}` })),
      options: (game === "pairs" ? [1, 2, 3] : [1, 2, 3, 4]).map((id, i) => ({
        key: `option-${i}`, label: game === "titles" ? art(id).title : `${artist.name} ${id}`,
      })),
    };
  }
  const handleRequest = async (context) => {
    origin = context.origin;
    const { req, res, url, body, json } = context;
    if (state.override && await state.override(context)) return true;
    const signedIn = Boolean(req.headers.authorization?.startsWith("Bearer ey"));
    if (/^\/fixture-[1234]\.svg$/.test(url.pathname)) {
      const landscape = url.pathname.includes("-2");
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${landscape ? 640 : 320}" height="${landscape ? 320 : 480}" viewBox="0 0 640 480"><rect width="640" height="480" fill="#c9b08f"/><path d="M0 400L240 50L640 480H0" fill="#5e1f25"/></svg>`);
      return true;
    }
    if (url.pathname === "/auth/v1/authorize") {
      res.writeHead(302, { Location: `${origin}/auth/callback?code=fixture-code` }).end();
      return true;
    }
    if (url.pathname === "/auth/v1/token") {
      const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
      return json({
        access_token: `${encode({ alg: "HS256" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })}.fixture`,
        refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 3600, user,
      });
    }
    if (url.pathname === "/auth/v1/user") return json(user);
    if (url.pathname === "/auth/v1/logout") { res.writeHead(204).end(); return true; }
    if (url.pathname === "/api/guest") return json({ enabled: true, token: "fixture-guest", remaining: 3, exports_remaining: 3 });
    if (url.pathname === "/api/exports") return json({ enabled: false, remaining: null });
    if (url.pathname === "/api/artists") return json([artist]);
    if (url.pathname === "/api/artists/test-artist") return json({
      ...artist, birth_place: "Україна", long_bio: "Перевірена довга біографія художниці. ".repeat(8),
      facts: [], sources: [], featured_artwork: art(), artworks: [art(), art(2), art(3)],
    });
    if (url.pathname === "/api/artworks") {
      if (state.failCatalogue) return json({ detail: "Не вдалося завантажити колекцію" }, 503);
      const items = state.empty || url.searchParams.get("q") === "нічогонемає" ? [] : [art(), art(2), art(3)];
      return json({ items: url.searchParams.get("random") ? items.slice(1, 2) : items, total: items.length });
    }
    const detail = url.pathname.match(/^\/api\/artworks\/([123])$/);
    if (detail) return json({
      ...art(Number(detail[1])), about: story.about_artwork, story, tags: [], facts: [], artist_facts: [],
      museum: story.museum, source_url: story.source_url, license: "Public domain", medium: "Олія",
    });
    if (url.pathname === "/api/matches") return json({
      artwork: art(), story, caption: body.phrase, position: "bottom", source: "fallback",
      reason: "Тестова відповідність", alternatives: [1, 2, 3].map((id) => ({ artwork: art(id), score: 1 / id })),
    }, 201);
    if (/^\/api\/artworks\/[123]\/captions$/.test(url.pathname)) return json({
      artwork_id: Number(url.pathname.split("/")[3]), source: "fallback",
      captions: [{ text: "Понеділок знову настав", kind: "everyday" }, { text: "Дедлайн учора", kind: "work" }, { text: "Мистецтво чекати", kind: "story" }],
    }, 201);
    if (url.pathname === "/api/memes/public-fixture") return json({ ...meme(), can_edit: signedIn });
    if (url.pathname === "/api/memes") return json([meme()]);
    if (url.pathname === "/api/quiz") return json({
      games: ["who", "pairs", "titles"], artworks: 24, limited: !signedIn,
      guest_limits: { who: 2, pairs: 2, titles: 2 },
      title_scopes: [{ key: "all", name: "Усі картини", artworks: 24 }, { key: artist.slug, name: artist.name, artworks: 12 }],
      best: signedIn ? state.best : null,
    });
    if (url.pathname === "/api/quiz/runs") {
      assert(["who", "pairs", "titles"].includes(body.game));
      const token = randomUUID();
      const run = { game: body.game, scope: body.scope, score: 0, signedIn, limit: signedIn ? 3 : 2 };
      state.runs.set(token, run);
      return json({ token, score: 0, limit: signedIn ? null : run.limit, question: question(run.game, 0) });
    }
    if (url.pathname === "/api/quiz/runs/answer") {
      const run = state.runs.get(body.token);
      assert(run, "Quiz must submit the current run token");
      const current = question(run.game, run.score);
      const reveals = current.images.map((image, index) => {
        const chosen = body.answer[run.game === "pairs" ? image.key : "answer"];
        return {
          image_key: image.key, chosen, right: `option-${index}`, correct: chosen === `option-${index}`,
          artwork: art(index + 1), fact: "Перевірений факт про картину.",
        };
      });
      const correct = reveals.every((r) => r.correct);
      if (correct) run.score++;
      state.answers++;
      const finished = !correct ? "mistake" : run.score >= run.limit ? run.signedIn ? "complete" : "guest_limit" : null;
      const key = run.game === "titles" ? `titles:${run.scope}` : run.game;
      const new_record = signedIn && run.score > (state.best[key] ?? 0);
      if (new_record) state.best[key] = run.score;
      return json({
        correct, reveals, finished, best: signedIn ? state.best[key] ?? 0 : null, new_record,
        run: { token: finished ? null : body.token, score: run.score, limit: signedIn ? null : run.limit, question: finished ? null : question(run.game, run.score) },
      });
    }
    return false;
  };
  return { handleRequest, state, art, story };
}
