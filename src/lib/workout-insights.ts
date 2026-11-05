export type CalendarWorkout = {
  id: string;
  title: string;
  created_at: string;
  workout_date?: string | null;
};
const DAY_MS = 24 * 60 * 60 * 1000;
const day = (value: number) => String(value).padStart(2, '0');
/** ISO date without timezone shifts; explicitly chosen dates are calendar days. */
export function localDateString(date: Date): string {
  return [date.getFullYear(), day(date.getMonth() + 1), day(date.getDate())].join('-');
}
/** Legacy workouts with no activity date use their original local publication day. */
export function effectiveWorkoutDate(workout: { created_at: string; workout_date?: string | null }): string {
  return workout.workout_date || localDateString(new Date(workout.created_at));
}
export function validateWorkoutDate(value: string, today: string = localDateString(new Date())): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Укажите дату тренировки.');
  const [year, month, date] = value.split('-').map(Number);
  const actual = new Date(Date.UTC(year, month - 1, date));
  if (!Number.isFinite(actual.getTime()) || actual.toISOString().slice(0, 10) !== value || value > today) {
    throw new Error('Дата тренировки должна быть сегодняшней или прошедшей.');
  }
  return value;
}
function ordinal(value: string): number {
  const [y, m, d] = value.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}
/** Last 7 and 30 calendar days by date trained, not publication timestamp. */
export function getWorkoutCounts<T extends { category: string; created_at: string; workout_date?: string | null }>(
  workouts: readonly T[], now: Date = new Date(),
) {
  let last7 = 0;
  let last30 = 0;
  const today = ordinal(localDateString(now));
  const categories = new Map<string, number>();
  for (const workout of workouts) {
    categories.set(workout.category, (categories.get(workout.category) ?? 0) + 1);
    if (!workout.workout_date && new Date(workout.created_at).getTime() > now.getTime()) continue;
    const age = today - ordinal(effectiveWorkoutDate(workout));
    if (age >= 0 && age < 7) last7 += 1;
    if (age >= 0 && age < 30) last30 += 1;
  }
  const favorite = [...categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  return { count: workouts.length, last7, last30, favorite };
}
/** Local timestamp bounds used for legacy workouts lacking activity date. */
export function localMonthBounds(year: number, monthIndex: number) {
  return {start: new Date(year, monthIndex, 1).toISOString(),end: new Date(year, monthIndex + 1, 1).toISOString()};
}
/** Date-column month boundaries, independent of UTC offsets. */
export function monthDateBounds(year: number, monthIndex: number) {
  return {
    start: new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString().slice(0, 10),
  };
}
export function groupWorkoutsByLocalDay<T extends CalendarWorkout>(
  workouts: readonly T[], year: number, monthIndex: number,
): Map<number, T[]> {
  const result = new Map<number, T[]>();
  for (const workout of workouts) {
    const [y, m, d] = effectiveWorkoutDate(workout).split('-').map(Number);
    if (y !== year || m !== monthIndex + 1) continue;
    const items = result.get(d) ?? [];
    items.push(workout);
    result.set(d, items);
  }
  return result;
}
export function isLocalToday(year: number, monthIndex: number, date: number, now: Date = new Date()) {
  return now.getFullYear() === year && now.getMonth() === monthIndex && now.getDate() === date;
}
