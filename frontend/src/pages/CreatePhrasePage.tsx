/** Screen 2 · Конструктор — введення (US-01). Phrase + optional image description → screen 3. */
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Artwork } from "../components/Artwork";
import { Button } from "../components/Button";
import { Input, Label, Textarea } from "../components/Input";
import { Page } from "../components/Layout";
import { ModeSwitch } from "../components/ModeSwitch";
import { VelvetRope } from "../components/Museum";

export function CreatePhrasePage() {
  const navigate = useNavigate();
  const [phrase, setPhrase] = useState("");
  const [description, setDescription] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!phrase.trim()) return;
    const params = new URLSearchParams({ q: phrase.trim() });
    if (description.trim()) params.set("d", description.trim());
    navigate(`/create/result?${params}`);
  };

  return (
    <Page title="Створити мем" subtitle="Напишіть фразу, а ми знайдемо для неї українську картину" actions={<ModeSwitch />}>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-14">
        <div className="order-2 lg:order-1" aria-hidden="true"><Artwork aspect="10/9">
          <span className="t-body text-text-secondary">Тут з'явиться картина</span>
        </Artwork></div>
        <form onSubmit={onSubmit} className="order-1 min-w-0 lg:order-2">
          <Label htmlFor="phrase" required>Підпис</Label>
          <Input id="phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} maxLength={200} placeholder="«Коли дедлайн був учора»" />
          <div className="mt-7 md:mt-10">
            <Label htmlFor="desc" hint="допомагає ШІ точніше знайти картину">Опис зображення</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder={"Що має бути на картині?\nНаприклад: людина дивиться у вікно, осінь, легкий сум."}
            />
          </div>
          <Button type="submit" className="mt-6 w-full sm:w-auto" disabled={!phrase.trim()}>Знайти картину</Button>
          <div className="t-small mt-6 rounded-card bg-muted p-5">
            Після генерації ви зможете змінити шрифт, розмір, колір і розташування підпису, а також прочитати історію картини.
          </div>
        </form>
      </div>
      <div className="mt-20 flex justify-center">
        <VelvetRope />
      </div>
    </Page>
  );
}
