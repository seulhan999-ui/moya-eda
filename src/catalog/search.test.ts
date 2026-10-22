import { describe, expect, it } from 'vitest';
import { RECIPES } from './recipes';
import { matchesQuery, stem } from './search';

const find = (q: string) => RECIPES.filter((r) => matchesQuery(r, q)).map((r) => r.id);

describe('Поиск блюд по продуктам', () => {
  it('«рыба» находит блюда с минтаем, горбушей и тунцом', () => {
    const ids = find('рыба');
    for (const id of ['pollock_rice_cucumber', 'salmon_broccoli', 'pasta_tuna_tomato', 'pollock_cutlets']) expect(ids).toContain(id);
    expect(ids).not.toContain('oat_pear_walnut');
  });

  it('окончания не мешают: курица, курицу, курицы', () => {
    const a = find('курица');
    expect(a.length).toBeGreaterThan(5);
    expect(find('курицу')).toEqual(a);
    expect(find('курицы')).toEqual(a);
    expect(a).toContain('bulgur_chicken_pepper');
  });

  it('несколько продуктов — блюда, где есть все', () => {
    const ids = find('курица гречка');
    expect(ids).toContain('buckwheat_chicken_veg');
    expect(ids).not.toContain('bulgur_chicken_pepper');
  });

  it('служебные слова запроса игнорируются', () => {
    expect(find('что приготовить из рыбы')).toEqual(find('рыба'));
  });

  it('поиск по названию блюда работает как раньше', () => {
    expect(find('сырники')).toEqual(['syrniki_oven']);
    expect(find('борщ')).toEqual(['bean_borscht']);
  });

  it('основа слова', () => {
    expect(stem('рыба')).toBe('рыб');
    expect(stem('Курицу')).toBe('куриц');
    expect(stem('помидоры')).toBe('помидо');
  });
});
