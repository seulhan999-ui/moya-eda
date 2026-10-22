import { useState, type FormEvent } from 'react';
import { supabase } from '../data/client';

/** Вход по почте и паролю. Регистрация — один раз, для своего аккаунта. */
export function LoginScreen() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'err' | 'note'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        if (password.length < 8) throw new Error('Пароль — не короче 8 символов');
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) {
          setMsg({ kind: 'note', text: 'Аккаунт создан. Откройте письмо от Supabase, подтвердите почту и войдите.' });
          setMode('in');
        }
      }
    } catch (err) {
      setMsg({ kind: 'err', text: humanError((err as Error).message) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="brand">
        <div className="script">вкусно и полезно</div>
        <h1>Моя еда</h1>
      </div>
      <form className="card pad" onSubmit={submit}>
        <label className="field">
          <span>Почта</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input
            className="input"
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {msg && <p className={msg.kind}>{msg.text}</p>}
        <button className="btn btn-cu btn-full" disabled={busy}>
          {busy ? 'Подождите…' : mode === 'in' ? 'Войти' : 'Создать аккаунт'}
        </button>
      </form>
      <p className="note" style={{ textAlign: 'center', marginTop: 16 }}>
        {mode === 'in' ? 'Первый раз? ' : 'Уже есть аккаунт? '}
        <button type="button" className="btn-link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
          style={{ background: 'none', border: 0, color: 'var(--copper-2)', fontWeight: 600, padding: 8 }}>
          {mode === 'in' ? 'Создать аккаунт' : 'Войти'}
        </button>
      </p>
    </div>
  );
}

function humanError(m: string): string {
  if (/Invalid login credentials/i.test(m)) return 'Неверная почта или пароль';
  if (/Email not confirmed/i.test(m)) return 'Почта ещё не подтверждена — откройте письмо от Supabase';
  if (/already registered/i.test(m)) return 'Такая почта уже зарегистрирована — войдите';
  if (/Signups not allowed/i.test(m)) return 'Регистрация новых аккаунтов закрыта';
  if (/fetch|network/i.test(m)) return 'Нет связи с сервером. Проверьте интернет';
  return m;
}
