import type { QuizGame } from "../api/types";
import { plural } from "../plural";

/** The three quiz games (ADR 0008), in the order of the «Вікторина» lobby. */
export const GAMES: Record<QuizGame, {
  no: string;
  title: string;
  level: string;
  text: string;
  prompt: string;
  guestNote: (limit: number) => string;
  guestShort: (limit: number) => string; // the same, short enough for a one-line catalogue card
}> = {
  who: {
    no: "I",
    title: "Хто автор?",
    level: "Легко",
    text: "Картина й чотири художники. Вгадуйте, доки не помилитесь або доки не впізнаєте всю колекцію.",
    prompt: "Хто написав цю картину?",
    guestNote: (n) => `Гостьова версія: ${n} ${plural(n, "картина", "картини", "картин")}`,
    guestShort: (n) => `${n} ${plural(n, "картина", "картини", "картин")}`,
  },
  pairs: {
    no: "II",
    title: "Пари",
    level: "Середньо",
    text: "Три картини і три художники. З’єднайте кожну картину з її автором — без жодної помилки.",
    prompt: "З’єднайте картини з їхніми авторами",
    guestNote: (n) => `Гостьова версія: ${n} ${plural(n, "раунд", "раунди", "раундів")} по 3 пари`,
    guestShort: (n) => `${n} ${plural(n, "раунд", "раунди", "раундів")}`,
  },
  titles: {
    no: "III",
    title: "Назва картини",
    level: "Складно",
    text: "Найважче: згадайте, як називається картина. Грайте за всією колекцією або за одним автором.",
    prompt: "Як називається ця картина?",
    guestNote: (n) => `Гостьова версія: ${n} ${plural(n, "картина", "картини", "картин")} з усієї колекції`,
    guestShort: (n) => `${n} ${plural(n, "картина", "картини", "картин")}`,
  },
};

export const GAME_ORDER: QuizGame[] = ["who", "pairs", "titles"];

/** Key of a best score, as the backend stores it. */
export const bestKey = (game: QuizGame, scope: string) => (game === "titles" ? `titles:${scope}` : game);
