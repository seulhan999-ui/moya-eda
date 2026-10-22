import { useEffect, useState, type ReactNode } from 'react';
import { iconUrl } from './icons';

export type Tab = 'today' | 'menu' | 'recipes' | 'cart' | 'profile';

export const TABS: { id: Tab; label: string; long: string; icon: string }[] = [
  { id: 'today', label: 'Сегодня', long: 'Сегодня', icon: 'Sun' },
  { id: 'menu', label: 'Меню', long: 'Меню недели', icon: 'Spiral calendar' },
  { id: 'recipes', label: 'Рецепты', long: 'Рецепты', icon: 'Open book' },
  { id: 'cart', label: 'Корзина', long: 'Корзина', icon: 'Basket' },
  { id: 'profile', label: 'Профиль', long: 'Профиль', icon: 'Person' },
];

function fromHash(): Tab {
  const h = location.hash.replace('#/', '') as Tab;
  return TABS.some((t) => t.id === h) ? h : 'today';
}

/** Текущий раздел хранится в адресе (#/recipes), чтобы «назад» в браузере работало. */
export function useTab(): [Tab, (t: Tab) => void] {
  const [tab, setTab] = useState<Tab>(fromHash());
  useEffect(() => {
    const on = () => setTab(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [tab, (t) => { location.hash = `#/${t}`; window.scrollTo(0, 0); }];
}

export function Shell({ tab, onTab, children }: { tab: Tab; onTab: (t: Tab) => void; children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand-side"><img src={iconUrl('Herb')} alt="" /><span>Моя еда</span></div>
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => onTab(t.id)}>
            <img src={iconUrl(t.icon)} alt="" />{t.long}
          </button>
        ))}
      </aside>
      <main className="main">{children}</main>
      <nav className="tabbar" aria-label="Разделы">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => onTab(t.id)}>
            <img src={iconUrl(t.icon)} alt="" />{t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
