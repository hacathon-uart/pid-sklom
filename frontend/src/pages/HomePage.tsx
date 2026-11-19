/**
 * Screen 1 · Головна + Про проєкт (US-01, US-06).
 * Three ways to make a meme (one per «шлях»):
 *   I   phrase → AI finds the painting           (hero form → screen 3)
 *   II  pick a painting → AI writes the caption  (2b → 3c, /create/painting?mode=ai)
 *   III pick a painting → write your own caption (2b → 3d, /create/painting?mode=own)
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { authEnabled } from "../auth/supabase";
import { GuestAllowance } from "../auth/GuestAllowance";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Input } from "../components/Input";
import { LogoMark } from "../components/Museum";
import { MemeDemo } from "../components/MemeDemo";
import { MuseumWall } from "../components/MuseumWall";
import { WordWreath } from "../components/WordWreath";
import { Tag } from "../components/Tag";

const EXAMPLES = ["коли понеділок", "дедлайн завтра", "мама кличе вечеряти", "чекаю на зарплату"];
const PAINTING_PATHS = [
  {
    no: "II",
    title: "Картина → підпис від ШІ",
    text: "Оберіть картину в галереї, а ШІ запропонує три смішні підписи до неї.",
    to: "/create/painting?mode=ai",
  },
  {
    no: "III",
    title: "Картина → свій підпис",
    text: "Усе самі: оберіть картину і напишіть підпис. Історія картини підкаже ідею.",
    to: "/create/painting?mode=own",
  },
];
const FEATURES = [
  ["Українські картини", "Твори українських художників, які вже стали суспільним надбанням: від Шевченка до Екстер."],
  ["Історія за кожним мемом", "Поруч із мемом є коротка історія картини і несподівані факти про автора. Ви можете дізнатись більше у галереї."],
  ["ШІ на підхваті", "Підбирає картину до вашої фрази або вигадує підпис до обраної картини. Або не заважає, якщо ви самі."],
];
const TEAM = ["Алла Ковальчук", "Герман Гавва", "Вікторія Лозяк"];
const EMAIL = "kov.koalla@gmail.com";

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
      <main id="main-content" tabIndex={-1}>
      <MuseumWall>
        <LogoMark size={52} className="text-accent" />
        <h1 className="t-logo mt-3 !text-[clamp(64px,16vw,190px)] text-[#2E2620] [text-shadow:0_1px_0_rgba(255,255,255,.7),0_6px_24px_rgba(250,245,236,.9)]">Під склом</h1>
        <p className="t-quote mt-3 text-[#5a4a3c] md:!text-[1.9rem]">Мистецтво крізь жарти</p>
        <a href="#start" className="t-small mt-10 flex flex-col items-center gap-1 rounded-control px-3 py-2 text-[#5a4a3c] hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">
          Гортайте вниз <span className="animate-bounce"><Icon name="chevronDown" size={20} /></span>
        </a>
      </MuseumWall>
      <section id="start" className="relative flex scroll-mt-4 flex-col items-center px-[var(--page-gutter)] pb-8 pt-5 text-center md:pt-6">
        {authEnabled && <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-start gap-4 text-left md:absolute md:inset-x-8 md:top-6 md:w-auto md:gap-6">
          <GuestAllowance />
          <div className="ml-auto">
          {user ? (
            <Link to="/me" className="t-strong">
              {user.name}
            </Link>
          ) : (
            <Button variant="secondary" onClick={login} title="Новий акаунт створиться автоматично">Увійти з Google</Button>
          )}
          </div>
        </div>}

        <h2 className="t-h2 mt-16 mb-6 md:mt-20 md:mb-8">Фраза чи картина — і мем готовий</h2>
        <MemeDemo />

        <h2 className="t-h2 mt-16 md:mt-20">Три шляхи до мему – оберіть свій!</h2>

        {/* Path I — the fastest one, right here */}
        <div className="mt-4 w-full max-w-[920px] rounded-card border border-line bg-surface p-4 text-left sm:p-5">
          <PathHead no="I" title="Фраза → картина" text="Напишіть фразу чи опишіть ситуацію, а ШІ знайде українську картину, яка пасує найкраще." />
          <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Input aria-label="Фраза для мему" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="Опишіть ситуацію або напишіть фразу…" maxLength={200} />
            <Button type="submit" className="w-full shrink-0 sm:w-auto">Створити мем</Button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="t-small text-text-secondary">Спробуйте:</span>
            {EXAMPLES.map((ex) => (
              <Tag key={ex} onClick={() => go(ex)}>{ex}</Tag>
            ))}
          </div>
        </div>

        {/* Paths II and III start from a painting */}
        <div className="mt-4 grid w-full max-w-[920px] grid-cols-1 gap-4 text-left sm:grid-cols-2">
          {PAINTING_PATHS.map((p) => (
            <Link key={p.no} to={p.to} className="group flex flex-col rounded-card border border-line bg-surface p-5 transition hover:border-accent">
              <PathHead no={p.no} title={p.title} text={p.text} />
              <span className="t-strong mt-4 flex items-center gap-2 text-accent">
                Обрати картину <Icon name="arrowRight" size={18} />
              </span>
            </Link>
          ))}
        </div>

        <a href="#about" className="t-small mt-6 flex flex-col items-center text-text-secondary hover:text-accent">
          Про проєкт <Icon name="chevronDown" size={18} />
        </a>
      </section>

      <section id="about" className="bg-surface px-[var(--page-gutter)] py-14 md:py-24">
        <div className="mx-auto max-w-[1000px]">
          <div className="t-label">Про проєкт</div>
          <h2 className="t-h1 mt-6 max-w-[560px]">Українське мистецтво — без серйозних облич</h2>
          {/* TODO(C): final About text */}
          <p className="t-body-lg mt-8 max-w-[720px]">
            «Під склом» — платформа, де українські картини стають мемами. Почніть із фрази, і штучний інтелект знайде
            картину, яка пасує найкраще. Або почніть із картини: підпис запропонує ШІ чи напишете ви самі. До кожного
            мему додаємо коротку історію про автора й картину. Без лекцій: лише гумор і трохи несподіваних фактів.
          </p>
          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {FEATURES.map(([title, text]) => (
              <div key={title} className="rounded-card border border-line bg-bg p-6">
                <h3 className="t-h3">{title}</h3>
                <p className="t-small mt-2 text-text-secondary">{text}</p>
              </div>
            ))}
          </div>
          <blockquote className="mt-12 border-l-2 border-accent-soft pl-6">
            <p className="t-quote">«Мистецтво має бути поруч, а не за склом музейної вітрини».</p>
            <p className="t-body mt-3 text-text-secondary">Звідси й назва: ми дістаємо картини з-під скла і повертаємо їх у щоденні розмови.</p>
          </blockquote>
        </div>
      </section>

      </main>

      <footer className="bg-muted px-[var(--page-gutter)] py-12">
        <div className="mx-auto mb-10 max-w-[1000px]">
          <WordWreath paper="var(--color-muted)" />
        </div>
        <div className="mx-auto grid max-w-[1000px] grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-3">
              <LogoMark size={36} className="text-accent" />
              <span className="font-heading text-3xl italic">Під склом</span>
            </div>
            <div className="t-small mt-2 text-text-secondary">Хакатон-проєкт, 2026</div>
          </div>
          <FooterCol
            title="Контакти"
            items={[
              <a key="mail" href={`mailto:${EMAIL}`} className="hover:text-accent">{EMAIL}</a>,
              <span key="telegram"><a href="https://t.me/pid_sklom_bot" className="hover:text-accent">Telegram-бот: @pid_sklom_bot</a><span className="t-caption mt-1 block text-text-secondary">Поки що з обмеженим доступом.</span></span>,
            ]}
          />
          <FooterCol title="Проєкт" items={[
            <a key="code" href="https://github.com/hacathon-uart/pid-sklom" className="hover:text-accent">Код на GitHub</a>,
            <Link key="gallery" to="/gallery" className="hover:text-accent">Картини та їхні історії</Link>,
          ]} />
          <FooterCol title="Команда" items={TEAM} />
        </div>
      </footer>
    </>
  );
}

function PathHead({ no, title, text }: { no: string; title: string; text: string }) {
  return (
    <div className="flex items-start gap-4">
      <span className="hall-no w-10 shrink-0 text-center">{no}</span>
      <div>
        <h2 className="t-h3">{title}</h2>
        <p className="t-small mt-1 text-text-secondary">{text}</p>
      </div>
    </div>
  );
}

function FooterCol({ title, items }: { title: string; items: ReactNode[] }) {
  return (
    <div>
      <div className="t-label">{title}</div>
      {items.map((i, n) => (
        <div key={n} className="t-small mt-3">{i}</div>
      ))}
    </div>
  );
}
