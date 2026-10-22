// Персональная норма энергии и пищевых веществ — ориентир, не медицинское назначение.
// Источник: МР 2.3.1.0253-21 «Нормы физиологических потребностей в энергии и пищевых веществах
// для различных групп населения Российской Федерации» (Роспотребнадзор, 2021):
//   • раздел 4.1 — основной обмен по формуле Миффлина — Сан Жеора:
//     мужчины: 9,99 × масса + 6,25 × рост − 4,92 × возраст + 5; женщины: … − 161;
//   • раздел 3.3 — коэффициенты физической активности (КФА) групп I–IV: 1,4; 1,6; 1,9; 2,2;
//     раздел 1.7 — для лиц 65 лет и старше используется КФА 1,7;
//   • раздел 4.2.1 и таблицы 10, 15 — доля энергии: белки 14 / 13 / 12,5 / 12 % по группам,
//     жиры не более 30 %, углеводы 56 / 57 / 57,5 / 58 %; пищевые волокна 20–25 г/сутки.

export type Sex = 'male' | 'female';
export type Activity = 'low' | 'light' | 'moderate' | 'high';

export const ACTIVITY: Record<Activity, { kfa: number; label: string; protein: number; carbs: number }> = {
  low: { kfa: 1.4, label: 'Умственный труд, мало движения (группа I)', protein: 0.14, carbs: 0.56 },
  light: { kfa: 1.6, label: 'Лёгкий физический труд (группа II)', protein: 0.13, carbs: 0.57 },
  moderate: { kfa: 1.9, label: 'Средняя физическая нагрузка (группа III)', protein: 0.125, carbs: 0.575 },
  high: { kfa: 2.2, label: 'Тяжёлый физический труд (группа IV)', protein: 0.12, carbs: 0.58 },
};

export interface NormInput {
  age?: number | null;
  sex?: Sex | null;
  heightCm?: number | null;
  weightKg?: number | null;
  activity?: Activity | null;
  /** Беременность, кормление, заболевание с лечебной диетой — расчёт не выполняется. */
  medical?: boolean;
}

export type NormResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      kcal: number;
      bmr: number;
      kfa: number;
      protein: number; // г
      fatMax: number; // г, не более
      carbs: number; // г
      fiber: [number, number]; // г
      source: string;
    };

export const NORM_SOURCE = 'МР 2.3.1.0253-21, формула Миффлина — Сан Жеора';

export function calcNorm(p: NormInput): NormResult {
  const missing: string[] = [];
  if (!p.age) missing.push('возраст');
  if (!p.sex) missing.push('пол');
  if (!p.heightCm) missing.push('рост');
  if (!p.weightKg) missing.push('вес');
  if (!p.activity) missing.push('активность');
  if (missing.length) return { ok: false, reason: `Укажите ${missing.join(', ')}` };
  if (p.medical) return { ok: false, reason: 'При беременности, кормлении или лечебной диете норму определяет врач' };
  if (p.age! < 18) return { ok: false, reason: 'Для младше 18 лет расчёт не выполняется — нормы детей и подростков другие' };

  const bmr = 9.99 * p.weightKg! + 6.25 * p.heightCm! - 4.92 * p.age! + (p.sex === 'male' ? 5 : -161);
  const group = ACTIVITY[p.activity!];
  const kfa = p.age! >= 65 ? 1.7 : group.kfa;
  const kcal = bmr * kfa;
  return {
    ok: true,
    bmr: Math.round(bmr),
    kfa,
    kcal: Math.round(kcal / 10) * 10,
    protein: Math.round((kcal * group.protein) / 4),
    fatMax: Math.round((kcal * 0.3) / 9),
    carbs: Math.round((kcal * group.carbs) / 4),
    fiber: [20, 25],
    source: NORM_SOURCE,
  };
}
