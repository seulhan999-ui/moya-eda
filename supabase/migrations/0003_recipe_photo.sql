-- «Моя еда» — этап 3: своё фото к рецепту каталога.
-- Хранится путь к файлу в приватном хранилище photos/<owner>/recipes/<recipe_id>.webp.
alter table public.taste_ratings add column photo_path text;
