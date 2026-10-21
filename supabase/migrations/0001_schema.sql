-- «Моя еда» — схема данных, этап 1.
-- Каждая строка принадлежит пользователю (owner). Правила RLS: видишь и меняешь только своё.
-- Каталог стартовых рецептов и продуктов хранится в коде приложения, здесь — только личные данные.
-- События (питание, движение продуктов) имеют op_id: повтор одной операции не создаёт копию.

-- ---------- Общие поля и триггер версии ----------
create or replace function public.touch_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.version := coalesce(old.version, 0) + 1;
  return new;
end $$;

-- ---------- Профиль ----------
create table public.profiles (
  owner uuid primary key default auth.uid() references auth.users on delete cascade,
  goal text not null default 'tasty_healthy',
  weight_goal text check (weight_goal in ('lose', 'keep', 'gain', 'none')),
  budget_week numeric check (budget_week >= 0),
  max_cook_min int check (max_cook_min between 1 and 600),
  equipment text[] not null default '{}',
  age int check (age between 1 and 120),
  sex text check (sex in ('male', 'female')),
  height_cm numeric check (height_cm between 50 and 260),
  activity text check (activity in ('low', 'light', 'moderate', 'high', 'very_high')),
  medical_note text,
  city text not null default 'Красноярск',
  timezone text not null default 'Asia/Krasnoyarsk',
  mode text not null default 'smart_mix' check (mode in ('economy', 'tasty', 'no_cook', 'smart_mix')),
  version int not null default 1,
  updated_at timestamptz not null default now()
);

-- ---------- Вкусы и исключения ----------
create table public.food_preferences (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('like', 'dislike', 'exclude')),
  ingredient_id text,
  label text not null,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------- Личные продукты и рецепты (в т.ч. из книги) ----------
create table public.ingredients (
  id text not null,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  data jsonb not null,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (owner, id)
);

create table public.recipes (
  id text not null,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  data jsonb not null,
  source jsonb,                 -- файл, контрольная сумма, страницы, дата импорта
  verified boolean not null default false,
  photo_path text,              -- путь в приватном хранилище photos/<owner>/...
  version int not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (owner, id)
);

-- ---------- Меню ----------
create table public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  week_start date not null,
  mode text not null check (mode in ('economy', 'tasty', 'no_cook', 'smart_mix')),
  variants jsonb not null default '[]',   -- три варианта недели
  active_variant int check (active_variant between 0 and 2),
  version int not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index meal_plans_week on public.meal_plans (owner, week_start) where deleted_at is null;

create table public.planned_meals (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  plan_id uuid not null references public.meal_plans on delete cascade,
  day date not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'snack', 'dinner')),
  recipe_id text not null,
  portions numeric not null default 1 check (portions > 0),
  pinned boolean not null default false,
  alternatives text[] not null default '{}',
  version int not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------- Дневник: факт отдельно от плана ----------
create table public.food_entries (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  op_id text not null,
  day date not null,
  meal_type text check (meal_type in ('breakfast', 'lunch', 'snack', 'dinner')),
  planned_meal_id uuid references public.planned_meals on delete set null,
  status text not null check (status in ('eaten', 'replaced', 'skipped')),
  recipe_id text,
  name text,
  portions numeric check (portions > 0),
  nutrition jsonb,              -- снимок на момент записи
  off_plan boolean not null default false,
  stock_written_off boolean not null default false,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner, op_id)
);

-- ---------- Запасы: журнал движений (только добавление) ----------
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  op_id text not null,
  ingredient_id text not null,
  delta numeric not null,
  kind text not null check (kind in ('purchase', 'cook', 'correction', 'reversal')),
  ref_id text,
  price numeric check (price >= 0),
  store text,
  at timestamptz not null default now(),
  unique (owner, op_id)
);

create table public.pantry_meta (
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  ingredient_id text not null,
  expires_on date,
  note text,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (owner, ingredient_id)
);

-- ---------- Покупки и цены ----------
create table public.shopping_manual (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  ingredient_id text not null,
  amount numeric not null check (amount > 0),
  unit text not null check (unit in ('g', 'ml', 'pcs')),
  version int not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.store_prices (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  ingredient_id text not null,
  store text not null,
  city text not null default 'Красноярск',
  package_size numeric check (package_size > 0),
  price numeric not null check (price >= 0),
  price_date date not null,
  source text not null default 'receipt' check (source in ('receipt', 'manual', 'integration')),
  delivery boolean not null default false,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------- Вкусы, вес, импорт ----------
create table public.taste_ratings (
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  recipe_id text not null,
  rating text check (rating in ('tasty', 'ok', 'bad')),
  favorite boolean not null default false,
  never_suggest boolean not null default false,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (owner, recipe_id)
);

create table public.weight_entries (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  kg numeric not null check (kg > 0 and kg < 500),
  note text,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  file_name text not null,
  checksum text not null,
  pages int[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'review', 'done', 'cancelled')),
  drafts jsonb not null default '[]',
  errors jsonb not null default '[]',
  version int not null default 1,
  updated_at timestamptz not null default now()
);

-- ---------- Триггеры версии, RLS и права ----------
do $$
declare t text;
begin
  foreach t in array array['profiles', 'food_preferences', 'ingredients', 'recipes', 'meal_plans', 'planned_meals',
    'food_entries', 'pantry_meta', 'shopping_manual', 'store_prices', 'taste_ratings', 'weight_entries', 'import_jobs']
  loop
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_row()', t);
  end loop;

  foreach t in array array['profiles', 'food_preferences', 'ingredients', 'recipes', 'meal_plans', 'planned_meals',
    'food_entries', 'stock_movements', 'pantry_meta', 'shopping_manual', 'store_prices', 'taste_ratings', 'weight_entries', 'import_jobs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy own_select on public.%I for select to authenticated using (owner = (select auth.uid()))', t);
    execute format('create policy own_insert on public.%I for insert to authenticated with check (owner = (select auth.uid()))', t);
    if t <> 'stock_movements' then
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
      execute format('create policy own_update on public.%I for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()))', t);
      execute format('create policy own_delete on public.%I for delete to authenticated using (owner = (select auth.uid()))', t);
    else
      -- Журнал движений только пополняется: исправления — обратной записью.
      execute format('grant select, insert on public.%I to authenticated', t);
    end if;
  end loop;
end $$;

-- ---------- Приватное хранилище фото: photos/<owner>/... ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy photos_own_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy photos_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy photos_own_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy photos_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
