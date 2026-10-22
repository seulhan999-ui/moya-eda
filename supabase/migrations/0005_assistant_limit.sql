-- «Моя еда» — этап 7: дневной лимит вопросов к ИИ-помощнику для тестировщиков.
-- Таблица закрыта для пользователей (RLS без политик): читать и менять её может только
-- серверная функция помощника через сервисный ключ.

create table public.assistant_usage (
  owner uuid not null references auth.users on delete cascade,
  day date not null,
  count int not null default 0,
  primary key (owner, day)
);

alter table public.assistant_usage enable row level security;
revoke all on public.assistant_usage from anon, authenticated;

-- Атомарно увеличить счётчик вопросов за день и вернуть новое значение.
create or replace function public.assistant_hit(p_owner uuid, p_day date)
returns int
language sql
security definer
set search_path = ''
as $$
  insert into public.assistant_usage (owner, day, count)
  values (p_owner, p_day, 1)
  on conflict (owner, day) do update set count = public.assistant_usage.count + 1
  returning count;
$$;

revoke all on function public.assistant_hit(uuid, date) from public, anon, authenticated;
grant execute on function public.assistant_hit(uuid, date) to service_role;
