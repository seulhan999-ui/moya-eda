-- «Моя еда» — этап 2: поддержка синхронизации.

-- Время записи на сервере для журнала движений: по нему второе устройство
-- забирает новые записи (время устройства для этого ненадёжно).
alter table public.stock_movements add column server_at timestamptz not null default now();
create index stock_movements_server_at on public.stock_movements (owner, server_at);

-- Индексы для выборки «что изменилось с прошлого раза».
do $$
declare t text;
begin
  foreach t in array array['profiles', 'food_preferences', 'ingredients', 'recipes', 'meal_plans', 'planned_meals',
    'food_entries', 'pantry_meta', 'shopping_manual', 'store_prices', 'taste_ratings', 'weight_entries', 'import_jobs']
  loop
    execute format('create index %I on public.%I (owner, updated_at)', t || '_owner_updated', t);
  end loop;
end $$;

-- Мгновенные уведомления об изменениях (Realtime). Правила RLS действуют и здесь:
-- устройство получает уведомления только о своих строках.
alter publication supabase_realtime add table
  public.profiles, public.food_preferences, public.ingredients, public.recipes, public.meal_plans,
  public.planned_meals, public.food_entries, public.stock_movements, public.pantry_meta,
  public.shopping_manual, public.store_prices, public.taste_ratings, public.weight_entries, public.import_jobs;
