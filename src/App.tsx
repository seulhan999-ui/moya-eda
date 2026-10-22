import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { startDemo, startSync, supabase, type SyncSession } from './data/client';
import { LoginScreen } from './screens/LoginScreen';
import { MenuScreen } from './screens/MenuScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { RecipesScreen } from './screens/RecipesScreen';
import { SoonScreen } from './screens/SoonScreen';
import { Shell, useTab } from './ui/Shell';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [sync, setSync] = useState<SyncSession | null>(null);
  const [tab, setTab] = useTab();

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const demo = import.meta.env.DEV && location.search.includes('demo');
  const userId = demo ? 'demo-user' : session?.user.id;
  useEffect(() => {
    if (!userId) return;
    if (demo) {
      void startDemo().then(setSync);
      return;
    }
    let active: SyncSession | null = null;
    let cancelled = false;
    void startSync(userId).then((s) => {
      if (cancelled) s.stop();
      else {
        active = s;
        setSync(s);
      }
    });
    return () => {
      cancelled = true;
      active?.stop();
      setSync(null);
    };
  }, [userId, demo]);

  if (!demo && session === undefined) return null;
  if (!demo && !session) return <LoginScreen />;
  if (!sync || !userId) return null;

  return (
    <Shell tab={tab} onTab={setTab}>
      {tab === 'recipes' && <RecipesScreen session={sync} owner={userId} />}
      {tab === 'profile' && <ProfileScreen session={sync} owner={userId} email={session?.user.email ?? 'демо-режим'} />}
      {tab === 'today' && (
        <SoonScreen title="Сегодня" script="план и факт" icon="Sun" stage={6}
          items={['Ход дня и карточка «Сейчас» с кнопкой «Съел»', 'Замена и пропуск блюда, еда вне плана', '«Приготовил» — списание продуктов из запасов']} />
      )}
      {tab === 'menu' && <MenuScreen session={sync} owner={userId} onCart={() => setTab('cart')} />}
      {tab === 'cart' && (
        <SoonScreen title="Корзина" script="покупки и запасы" icon="Basket" stage={5}
          items={['Список покупок по отделам с упаковками', '«Куплено» с ценой из чека', 'Запасы «Есть дома» со сроками']} />
      )}
    </Shell>
  );
}
