/** Screen 1 · Головна + Про проєкт (US-01, US-06). TODO(design): add the other ways to create a meme. */
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Input } from "../components/Input";
import { Tag } from "../components/Tag";

const EXAMPLES = ["коли понеділок", "дедлайн завтра", "мама кличе вечеряти", "чекаю на зарплату"];
const STEPS = [
  ["01", "Напишіть фразу", "Опишіть ситуацію своїми словами: від понеділкового настрою до дедлайну, що горить."],
  ["02", "ШІ підбере картину", "Шукаємо серед творів українських художників, які вже стали суспільним надбанням."],
  ["03", "Дізнайтеся історію", "Кожен мем має історію: несподіваний факт про автора і саму картину."],
];

export function HomePage() {
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const [phrase, setPhrase] = useState("");

  const go = (q: string) => q.trim() && navigate(`/create/result?q=${encodeURIComponent(q.trim())}`);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    go(phrase);
  };

  return (
    <>
      <section className="relative flex min-h-[640px] flex-col items-center justify-center px-8 text-center">
        <div className="absolute right-10 top-8 flex gap-3">
          {user ? (
            <Link to="/me" className="t-strong">
              {user.name}
            </Link>
          ) : (
            <>
              {/* TODO(B, T22): login dialog is not designed yet */}
              <Button variant="soft" onClick={login}>Увійти</Button>
              <Button variant="secondary" onClick={login}>Зареєструватися</Button>
            </>
          )}
        </div>

        <h1 className="t-logo">Під склом</h1>
        <p className="t-quote mt-6 text-text-secondary">Мистецтво крізь жарти</p>

        <form onSubmit={onSubmit} className="mt-14 flex w-full max-w-[720px] gap-3">
          <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="Опишіть ситуацію або напишіть фразу…" maxLength={200} />
          <Button type="submit" className="shrink-0">Створити мем</Button>
        </form>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <span className="t-small text-text-secondary">Спробуйте:</span>
          {EXAMPLES.map((ex) => (
            <Tag key={ex} onClick={() => go(ex)}>{ex}</Tag>
          ))}
        </div>
        <div className="mt-8 flex items-center gap-4">
          <span className="t-small text-text-secondary">або</span>
          <Button variant="secondary" onClick={() => navigate("/create/painting")}>Обрати картину в галереї</Button>
        </div>

        <a href="#about" className="t-small absolute bottom-8 flex flex-col items-center text-text-secondary">
          Про проєкт <Icon name="chevronDown" size={18} />
        </a>
      </section>

      <section id="about" className="bg-surface px-8 py-24">
        <div className="mx-auto max-w-[1000px]">
          <div className="t-label">Про проєкт</div>
          <h2 className="t-h1 mt-6 max-w-[560px]">Українське мистецтво — без серйозних облич</h2>
          {/* TODO(C): final About text */}
          <p className="t-body-lg mt-8 max-w-[720px]">
            «Під склом» — платформа, де українські картини стають мемами. Напишіть фразу чи опишіть ситуацію, і штучний
            інтелект знайде твір українського художника, який пасує найкраще, та додасть коротку історію про автора й
            картину. Без реєстрації і без лекцій: лише гумор і трохи несподіваних фактів.
          </p>
          <div className="mt-12 grid grid-cols-3 gap-6">
            {STEPS.map(([n, title, text]) => (
              <div key={n} className="rounded-card border border-line bg-bg p-6">
                <div className="font-heading text-3xl text-accent">{n}</div>
                <h3 className="t-h3 mt-3">{title}</h3>
                <p className="t-small mt-2 text-text-secondary">{text}</p>
              </div>
            ))}
          </div>
          <blockquote className="mt-12 border-l-2 border-accent-soft pl-6">
            <p className="t-quote">«Мистецтво має бути поруч, а не за склом музейної вітрини».</p>
            <p className="t-caption mt-2 text-text-secondary">Звідси й назва: ми дістаємо картини з-під скла і повертаємо їх у щоденні розмови.</p>
          </blockquote>
        </div>
      </section>

      <footer className="bg-muted px-8 py-12">
        {/* TODO(D): replace placeholder contacts, bot handle, GitHub link */}
        <div className="mx-auto flex max-w-[1000px] justify-between">
          <div>
            <div className="font-heading text-3xl italic">Під склом</div>
            <div className="t-small mt-2 text-text-secondary">Хакатон-проєкт, 2026</div>
          </div>
          <FooterCol title="Контакти" items={["hello@pidsklom.ua", "Telegram-бот: @pidsklom_bot"]} />
          <FooterCol title="Проєкт" items={["Код на GitHub", "Звідки картини і факти"]} />
          <FooterCol title="Команда" items={["4 учасники", "Київ, Україна"]} />
        </div>
      </footer>
    </>
  );
}

function FooterCol({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="t-label">{title}</div>
      {items.map((i) => (
        <div key={i} className="t-small mt-3">{i}</div>
      ))}
    </div>
  );
}
