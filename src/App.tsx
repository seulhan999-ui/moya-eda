import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { startSync, supabase, type SyncSession } from './data/client';
import { LoginScreen } from './screens/LoginScreen';
import { SyncCheckScreen } from './screens/SyncCheckScreen';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [sync, setSync] = useState<SyncSession | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
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
  }, [userId]);

  if (session === undefined) return null;
  if (!session) return <LoginScreen />;
  if (!sync) return null;
  return <SyncCheckScreen session={sync} email={session.user.email ?? ''} />;
}
