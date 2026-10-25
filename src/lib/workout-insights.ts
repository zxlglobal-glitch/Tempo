export type CalendarWorkout = {
  id: string;
  title: string;
  created_at: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rolling windows, not an average number of workouts per week. */
export function getWorkoutCounts<T extends { category: string; created_at: string }>(
  workouts: readonly T[],
  now: Date = new Date(),
) {
  let last7 = 0;
  let last30 = 0;
  const categories = new Map<string, number>();
  for (const workout of workouts) {
    categories.set(workout.category, (categories.get(workout.category) ?? 0) + 1);
    const age = now.getTime() - new Date(workout.created_at).getTime();
    if (age >= 0 && age < 7 * DAY_MS) last7 += 1;
    if (age >= 0 && age < 30 * DAY_MS) last30 += 1;
  }
  const favorite = [...categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  return { count: workouts.length, last7, last30, favorite };
}

/** Match the calendar month to the viewer's local dates rather than UTC dates. */
export function localMonthBounds(year: number, monthIndex: number) {
  return {
    start: new Date(year, monthIndex, 1).toISOString(),
    end: new Date(year, monthIndex + 1, 1).toISOString(),
  };
}

export function groupWorkoutsByLocalDay<T extends CalendarWorkout>(
  workouts: readonly T[],
  year: number,
  monthIndex: number,
): Map<number, T[]> {
  const result = new Map<number, T[]>();
  for (const workout of workouts) {
    const date = new Date(workout.created_at);
    if (date.getFullYear() !== year || date.getMonth() !== monthIndex) continue;
    const day = date.getDate();
    const items = result.get(day) ?? [];
    items.push(workout);
    result.set(day, items);
  }
  return result;
}

export function isLocalToday(year: number, monthIndex: number, day: number, now: Date = new Date()) {
  return now.getFullYear() === year && now.getMonth() === monthIndex && now.getDate() === day;
}
