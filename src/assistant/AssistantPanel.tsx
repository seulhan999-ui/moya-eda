import { useEffect, useRef, useState } from 'react';
import { MEAL_LABEL, RECIPE_MAP } from '../catalog';
import { supabase } from '../data/client';
import { Obj } from '../ui/kit';
import { FUNCTIONS, resultForModel, runTool, systemPrompt, type ToolContext, type ToolResult } from './tools';
import type { MealType } from '../core/types';

type ModelMsg = { role: 'system' | 'user' | 'assistant' | 'function'; content: string; name?: string; function_call?: { name: string; arguments: unknown } };
type Bubble = { who: 'me' | 'ai'; text: string; result?: ToolResult; done?: boolean | 'no' };

const HINTS = [
  'Что вкусного приготовить за 10 минут?',
  'Собери продукты на неделю',
  'Найди дешевле',
  'Хочу что-нибудь необычное',
  'Сегодня не завтракал',
  'Что приготовить из продуктов в холодильнике?',
];

const ERRORS: Record<string, string> = {
  limit: 'Бесплатные токены GigaChat закончились или временно исчерпан лимит. Остальное приложение работает как обычно.',
  not_allowed: 'Помощник не включён для этого аккаунта.',
  no_key: 'Помощник не настроен: нет ключа GigaChat в Supabase.',
  network: 'Не удалось связаться с GigaChat. Проверьте интернет и попробуйте ещё раз.',
  upstream: 'GigaChat сейчас не отвечает. Попробуйте чуть позже.',
  auth: 'Войдите в приложение заново.',
  not_deployed: 'Помощник ещё не размещён в Supabase (нет функции assistant).',
};

async function callAssistant(messages: ModelMsg[]): Promise<{ ok: true; content: string; function_call: { name: string; arguments: unknown } | null } | { ok: false; error: string }> {
  const { data, error } = await supabase.functions.invoke('assistant', { body: { messages, functions: FUNCTIONS } });
  if (error) {
    let code = 'network';
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx?.status === 404) code = 'not_deployed';
      const body = await ctx?.json();
      code = body?.error ?? code;
    } catch { /* нет тела ответа */ }
    return { ok: false, error: code };
  }
  if (!data?.ok) return { ok: false, error: data?.error ?? 'upstream' };
  return { ok: true, content: data.message.content ?? '', function_call: data.message.function_call };
}

interface Props {
  ctx: ToolContext;
  today: string;
  todayMeals: string;
  exclusions: string[];
  onOpenRecipe: (id: string) => void;
  onOpenCart: () => void;
  onMark: (meal: MealType, status: 'eaten' | 'skipped') => Promise<void>;
}

export function AssistantPanel({ ctx, today, todayMeals, exclusions, onOpenRecipe, onOpenCart, onMark }: Props) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [history, setHistory] = useState<ModelMsg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [bubbles, busy]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setText('');
    setBusy(true);
    setBubbles((b) => [...b, { who: 'me', text: question }]);
    const sys: ModelMsg = { role: 'system', content: systemPrompt(today, todayMeals, exclusions) };
    let msgs: ModelMsg[] = [sys, ...history, { role: 'user', content: question }];
    try {
      const r1 = await callAssistant(msgs);
      if (!r1.ok) {
        setBubbles((b) => [...b, { who: 'ai', text: ERRORS[r1.error] ?? ERRORS.upstream }]);
        return;
      }
      let result: ToolResult | undefined;
      let answer = r1.content;
      if (r1.function_call) {
        result = runTool(r1.function_call.name, r1.function_call.arguments, ctx);
        msgs = [...msgs, { role: 'assistant', content: '', function_call: r1.function_call }, { role: 'function', name: r1.function_call.name, content: resultForModel(result) }];
        const r2 = await callAssistant(msgs);
        answer = r2.ok && r2.content ? r2.content : defaultText(result);
        if (r2.ok) msgs = [...msgs, { role: 'assistant', content: answer }];
      } else {
        msgs = [...msgs, { role: 'assistant', content: answer }];
      }
      setHistory(msgs.slice(1).slice(-10));
      setBubbles((b) => [...b, { who: 'ai', text: answer || defaultText(result), result }]);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(i: number, meal: MealType, status: 'eaten' | 'skipped') {
    await onMark(meal, status);
    setBubbles((b) => b.map((x, k) => (k === i ? { ...x, done: true } : x)));
  }

  return (
    <div className="ai">
      <div className="ai-head"><Obj name="Speech balloon" size={56} /><div><b className="serif">Помощник</b><span className="note small">GigaChat · цифры — только из приложения</span></div></div>

      {bubbles.length === 0 && (
        <div className="ai-hints">
          {HINTS.map((h) => <button key={h} className="pill-btn" onClick={() => void send(h)}>{h}</button>)}
        </div>
      )}

      <div className="ai-list">
        {bubbles.map((b, i) => (
          <div key={i} className={`bubble ${b.who}`}>
            <p>{b.text}</p>
            {b.result && <ResultView r={b.result} done={b.done} onRecipe={onOpenRecipe} onCart={onOpenCart} onConfirm={(m, s) => void confirm(i, m, s)} onCancel={() => setBubbles((bb) => bb.map((x, k) => (k === i ? { ...x, done: 'no' } : x)))} />}
          </div>
        ))}
        {busy && <div className="bubble ai typing"><span /><span /><span /></div>}
        <div ref={endRef} />
      </div>

      <form className="ai-input" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <input className="input" placeholder="Напишите вопрос…" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
        <button className="ai-send" disabled={busy || !text.trim()} aria-label="Отправить">↑</button>
      </form>
    </div>
  );
}

function ResultView({ r, done, onRecipe, onCart, onConfirm, onCancel }: { r: ToolResult; done?: boolean | 'no'; onRecipe: (id: string) => void; onCart: () => void; onConfirm: (m: MealType, s: 'eaten' | 'skipped') => void; onCancel: () => void }) {
  if (r.kind === 'recipes') {
    return (
      <div className="ai-cards">
        {r.note && <p className="note small">{r.note}</p>}
        {r.items.map((i) => (
          <button key={i.id} className="alt-opt" onClick={() => onRecipe(i.id)}>
            <Obj name={RECIPE_MAP.get(i.id)?.icon ?? 'Pot of food'} size={48} />
            <span>{i.name}<small>{i.minutes} мин · {i.kcal} ккал{i.atHome < 100 && i.atHome > 0 ? ` · дома ${i.atHome}% продуктов` : i.atHome === 100 ? ' · всё есть дома' : ''}</small></span>
          </button>
        ))}
      </div>
    );
  }
  if (r.kind === 'confirm') {
    const label = `${MEAL_LABEL[r.meal]}: ${r.status === 'skipped' ? 'пропущен' : 'съел'}`;
    if (done === 'no') return <p className="note small">Хорошо, ничего не отмечаю.</p>;
    return done ? <p className="note small ok">✓ Отмечено — {label.toLowerCase()}</p> : (
      <div className="row2"><button className="btn btn-cu" onClick={() => onConfirm(r.meal, r.status)}>Да, отметить</button><button className="btn btn-ln" onClick={() => onCancel()}>Нет</button></div>
    );
  }
  if (r.kind === 'shopping') {
    return r.hasPlan ? (
      <div className="ai-cards">
        <p className="note small">Купить: {r.toBuy} поз.{r.knownSum ? ` · известная сумма ~${Math.round(r.knownSum)} ₽` : ''}{r.unpriced ? ` · без цены: ${r.unpriced}` : ''}</p>
        <button className="btn btn-cu btn-full" onClick={onCart}>Открыть корзину</button>
      </div>
    ) : <p className="note small">Сначала выберите неделю в «Меню».</p>;
  }
  if (r.kind === 'cheaper') {
    return (
      <div className="ai-cards">
        {r.tips.map((t) => <p key={t.recipe} className="cheap">{t.recipe}: {t.tip.replace(/^Дешевле:\s*/, '')}</p>)}
        {r.economy.map((e) => <button key={e.id} className="alt-opt" onClick={() => onRecipe(e.id)}><Obj name={RECIPE_MAP.get(e.id)?.icon ?? 'Pot of food'} size={44} /><span>{e.name}<small>экономный режим</small></span></button>)}
      </div>
    );
  }
  return null;
}

function defaultText(r?: ToolResult): string {
  if (!r) return 'Не понял вопрос — попробуйте сформулировать иначе.';
  switch (r.kind) {
    case 'recipes': return r.items.length ? 'Вот что подходит:' : r.note ?? 'Ничего не нашлось.';
    case 'confirm': return 'Отметить в дневнике?';
    case 'shopping': return r.hasPlan ? 'Собрал список по меню недели.' : 'Меню на неделю ещё не выбрано.';
    case 'cheaper': return 'Вот как можно сэкономить:';
    case 'error': return r.message;
  }
}
