-- «Моя еда» — этап 6: приготовленные порции и связь записи питания с ними.

create table public.cook_batches (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  op_id text not null,
  recipe_id text not null,
  portions numeric not null check (portions > 0),
  cooked_at timestamptz not null default now(),
  version int not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner, op_id)
);

create trigger touch before update on public.cook_batches for each row execute function public.touch_row();
create index cook_batches_owner_updated on public.cook_batches (owner, updated_at);

alter table public.cook_batches enable row level security;
revoke all on public.cook_batches from anon;
grant select, insert, update, delete on public.cook_batches to authenticated;
create policy own_select on public.cook_batches for select to authenticated using (owner = (select auth.uid()));
create policy own_insert on public.cook_batches for insert to authenticated with check (owner = (select auth.uid()));
create policy own_update on public.cook_batches for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy own_delete on public.cook_batches for delete to authenticated using (owner = (select auth.uid()));

alter publication supabase_realtime add table public.cook_batches;

-- Запись питания может ссылаться на приготовленную партию (тогда продукты повторно не списываются).
alter table public.food_entries add column from_batch uuid references public.cook_batches on delete set null;
