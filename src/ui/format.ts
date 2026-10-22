/** Время готовки: «45 мин», «1 ч 10 мин», «8 ч 5 мин». */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}
