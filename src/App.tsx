import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { startDemo, startSync, supabase, type SyncSession } from './data/client';
import { CartScreen } from './screens/CartScreen';
import { LoginScreen } from './screens/LoginScreen';
import { MenuScreen } from './screens/MenuScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { RecipesScreen } from './screens/RecipesScreen';
import { TodayScreen } from './screens/TodayScreen';
import { Shell, useTab } from './ui/Shell';
import { profileIcon } from './ui/icons';
import { useRows } from './ui/kit';

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

  return <Screens sync={sync} userId={userId} email={session?.user.email ?? 'демо-режим'} tab={tab} setTab={setTab} />;
}

function Screens({ sync, userId, email, tab, setTab }: { sync: SyncSession; userId: string; email: string; tab: ReturnType<typeof useTab>[0]; setTab: ReturnType<typeof useTab>[1] }) {
  const [profiles] = useRows(sync, 'profiles');
  return (
    <Shell tab={tab} onTab={setTab} profileIcon={profileIcon(profiles[0]?.sex)}>
      {tab === 'recipes' && <RecipesScreen session={sync} owner={userId} />}
      {tab === 'profile' && <ProfileScreen session={sync} owner={userId} email={email} />}
      {tab === 'today' && <TodayScreen session={sync} owner={userId} onMenu={() => setTab('menu')} onCart={() => setTab('cart')} />}
      {tab === 'menu' && <MenuScreen session={sync} owner={userId} onCart={() => setTab('cart')} />}
      {tab === 'cart' && <CartScreen session={sync} onMenu={() => setTab('menu')} />}
    </Shell>
  );
}
