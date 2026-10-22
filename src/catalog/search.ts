// Поиск блюд по продуктам: «рыба», «курицу», «курица рис», «творог ягоды».
// Каждое слово запроса должно найтись в названии блюда, названии продукта или его группе.

import type { Recipe } from '../core/types';
import { INGREDIENTS } from './ingredients';

const INGREDIENT_MAP = new Map(INGREDIENTS.map((i) => [i.id, i]));

/** Группы и другие названия продуктов, по которым их ищут. */
const TAGS: Record<string, string[]> = {
  pollock: ['рыба', 'минтай', 'белая рыба'],
  pink_salmon: ['рыба', 'горбуша', 'лосось', 'красная рыба', 'семга'],
  tuna_can: ['рыба', 'тунец', 'консервы'],
  shrimp: ['морепродукты', 'креветки'],
  chicken_breast: ['курица', 'куриное', 'птица', 'мясо', 'филе', 'грудка'],
  chicken_thigh: ['курица', 'куриное', 'птица', 'мясо', 'бедро'],
  chicken_liver: ['курица', 'печень', 'печенка', 'субпродукты'],
  turkey_mince: ['индейка', 'птица', 'мясо', 'фарш'],
  beef_mince: ['говядина', 'мясо', 'фарш'],
  egg: ['яйцо', 'яйца'],
  cottage: ['творог', 'молочное'],
  milk: ['молоко', 'молочное'],
  kefir: ['кефир', 'молочное'],
  yogurt: ['йогурт', 'молочное'],
  greek_yogurt: ['йогурт', 'молочное'],
  sour_cream: ['сметана', 'молочное'],
  mozzarella: ['сыр', 'моцарелла', 'молочное'],
  feta: ['сыр', 'брынза', 'фета', 'молочное'],
  cheese_hard: ['сыр', 'молочное'],
  oats: ['овсянка', 'овес', 'хлопья', 'крупа'],
  buckwheat: ['гречка', 'греча', 'крупа'],
  bulgur: ['булгур', 'крупа'],
  rice: ['рис', 'крупа'],
  couscous: ['кускус', 'крупа'],
  barley: ['перловка', 'крупа'],
  pasta: ['макароны', 'паста', 'спагетти'],
  pasta_wg: ['макароны', 'паста', 'спагетти'],
  lentils_red: ['чечевица', 'бобовые'],
  chickpeas_can: ['нут', 'бобовые'],
  beans_red_can: ['фасоль', 'бобовые'],
  beans_white_can: ['фасоль', 'бобовые'],
  peas_frozen: ['горошек', 'горох', 'овощи'],
  potato: ['картофель', 'картошка', 'овощи'],
  carrot: ['морковь', 'морковка', 'овощи'],
  onion: ['лук', 'овощи'],
  cabbage: ['капуста', 'овощи'],
  sauerkraut: ['капуста', 'квашеная'],
  broccoli: ['брокколи', 'капуста', 'овощи'],
  cauliflower: ['цветная капуста', 'капуста', 'овощи'],
  zucchini: ['кабачок', 'овощи'],
  eggplant: ['баклажан', 'овощи'],
  pumpkin: ['тыква', 'овощи'],
  beet: ['свекла', 'овощи'],
  bell_pepper: ['перец', 'овощи'],
  tomato: ['помидоры', 'томаты', 'овощи'],
  tomatoes_can: ['помидоры', 'томаты'],
  cucumber: ['огурцы', 'овощи'],
  pickles: ['огурцы', 'соленые'],
  spinach: ['шпинат', 'зелень'],
  mushrooms: ['грибы', 'шампиньоны'],
  veg_mix_frozen: ['овощи', 'замороженные овощи'],
  apple: ['яблоко', 'фрукты'],
  pear: ['груша', 'фрукты'],
  banana: ['банан', 'фрукты'],
  orange: ['апельсин', 'фрукты'],
  kiwi: ['киви', 'фрукты'],
  avocado: ['авокадо'],
  blueberries: ['черника', 'ягоды'],
  raspberries: ['малина', 'ягоды'],
  dried_apricots: ['курага', 'сухофрукты'],
  walnuts: ['орехи'],
  peanut_butter: ['арахис', 'орехи'],
  bread_ww: ['хлеб'],
  bread_rye: ['хлеб'],
  lavash: ['лаваш', 'тортилья'],
  hummus: ['хумус', 'нут'],
};

/** Основа слова: без окончания, чтобы «курицу», «курица», «куриное» совпадали. */
export function stem(word: string): string {
  const w = word.toLowerCase().replace(/ё/g, 'е');
  if (w.length <= 3) return w;
  // короткие слова теряют одну букву окончания, длинные — две
  return w.slice(0, w.length <= 6 ? w.length - 1 : w.length - 2);
}

function words(text: string): string[] {
  return text.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(Boolean);
}

/** Все слова, по которым можно найти рецепт. */
function haystack(r: Recipe): string[] {
  const out = words(r.name);
  for (const ri of r.ingredients) {
    const ing = INGREDIENT_MAP.get(ri.ingredientId);
    if (ing) out.push(...words(ing.name));
    for (const t of TAGS[ri.ingredientId] ?? []) out.push(...words(t));
  }
  return out;
}

const INDEX = new WeakMap<Recipe, string[]>();

/** Подходит ли рецепт под запрос: каждое слово запроса совпадает с началом какого-нибудь слова. */
export function matchesQuery(r: Recipe, query: string): boolean {
  const q = words(query).filter((w) => !STOP.has(w));
  if (q.length === 0) return true;
  let hay = INDEX.get(r);
  if (!hay) {
    hay = haystack(r);
    INDEX.set(r, hay);
  }
  return q.every((w) => {
    const s = stem(w);
    return hay!.some((h) => h.startsWith(s));
  });
}

/** Служебные слова в запросе вроде «есть рыба и рис», «что приготовить из курицы». */
const STOP = new Set(['и', 'с', 'со', 'из', 'у', 'меня', 'есть', 'что', 'приготовить', 'блюдо', 'блюда', 'на', 'в', 'или', 'для']);
