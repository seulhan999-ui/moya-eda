import { describe, expect, it } from 'vitest';
import { calcNorm } from './norms';

describe('D04 — норма по МР 2.3.1.0253-21', () => {
  it('мужчина 34 года, 178 см, 82 кг, умственный труд', () => {
    const r = calcNorm({ age: 34, sex: 'male', heightCm: 178, weightKg: 82, activity: 'low' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 9,99·82 + 6,25·178 − 4,92·34 + 5 = 819,18 + 1112,5 − 167,28 + 5 = 1769,4
    expect(r.bmr).toBe(1769);
    expect(r.kfa).toBe(1.4);
    expect(r.kcal).toBe(2480); // 1769,4 × 1,4 = 2477,2 → округление до 10
    expect(r.protein).toBe(87); // 14 % энергии
    expect(r.fatMax).toBe(83); // не более 30 %
    expect(r.carbs).toBe(347); // 56 %
    expect(r.fiber).toEqual([20, 25]);
  });

  it('женская формула отличается свободным членом −161', () => {
    const m = calcNorm({ age: 30, sex: 'male', heightCm: 165, weightKg: 60, activity: 'light' });
    const f = calcNorm({ age: 30, sex: 'female', heightCm: 165, weightKg: 60, activity: 'light' });
    if (!m.ok || !f.ok) throw new Error('расчёт должен выполниться');
    expect(m.bmr - f.bmr).toBe(166);
  });

  it('65 лет и старше — КФА 1,7', () => {
    const r = calcNorm({ age: 70, sex: 'female', heightCm: 160, weightKg: 65, activity: 'high' });
    expect(r.ok && r.kfa).toBe(1.7);
  });

  it('при неполных данных норма «не рассчитана» с понятной причиной', () => {
    const r = calcNorm({ age: 34, heightCm: 178, weightKg: 82, activity: 'low' });
    expect(r).toEqual({ ok: false, reason: 'Укажите пол' });
  });

  it('младше 18 лет и при лечебной диете расчёт не выполняется', () => {
    expect(calcNorm({ age: 15, sex: 'female', heightCm: 160, weightKg: 50, activity: 'light' }).ok).toBe(false);
    expect(calcNorm({ age: 30, sex: 'female', heightCm: 160, weightKg: 60, activity: 'light', medical: true }).ok).toBe(false);
  });
});
