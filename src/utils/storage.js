import AsyncStorage from '@react-native-async-storage/async-storage';

const HABITS_KEY = 'streak_app_habits';

export const loadHabits = async () => {
  try {
    const json = await AsyncStorage.getItem(HABITS_KEY);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
};

export const saveHabits = async (habits) => {
  await AsyncStorage.setItem(HABITS_KEY, JSON.stringify(habits));
};

export const createHabit = (name, color = '#6C63FF') => ({
  id: Date.now().toString(),
  name,
  color,
  completedDates: [],
  createdAt: new Date().toISOString(),
});

const pad = (n) => String(n).padStart(2, '0');

// Local calendar date (not UTC) as YYYY-MM-DD, so streaks follow the user's day
export const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Add n days to a YYYY-MM-DD string (DST-safe: works in UTC on the date string)
export const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

// Whole days between two YYYY-MM-DD strings (b - a)
const daysBetween = (a, b) => {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};

// Returns today's date as YYYY-MM-DD string
export const today = () => dateKey();

export const isCompletedToday = (habit) => habit.completedDates.includes(today());

export const toggleToday = (habit) => {
  const t = today();
  const completed = habit.completedDates.includes(t);
  return {
    ...habit,
    completedDates: completed
      ? habit.completedDates.filter((d) => d !== t)
      : [...habit.completedDates, t].sort(),
  };
};

// Calculate current streak (consecutive days ending today or yesterday)
export const calcStreak = (habit) => {
  if (habit.completedDates.length === 0) return 0;

  const sorted = [...new Set(habit.completedDates)].sort().reverse();
  const todayStr = today();

  // Streak must include today or yesterday
  if (sorted[0] !== todayStr && sorted[0] !== addDays(todayStr, -1)) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (daysBetween(sorted[i], sorted[i - 1]) === 1) streak++;
    else break;
  }
  return streak;
};

// Longest streak ever
export const calcLongest = (habit) => {
  if (habit.completedDates.length === 0) return 0;
  const sorted = [...new Set(habit.completedDates)].sort();
  let max = 1;
  let current = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (daysBetween(sorted[i - 1], sorted[i]) === 1) {
      current++;
      if (current > max) max = current;
    } else {
      current = 1;
    }
  }
  return max;
};

// Last 30 days as YYYY-MM-DD array (oldest first)
export const last30Days = () => {
  const t = today();
  const days = [];
  for (let i = 29; i >= 0; i--) days.push(addDays(t, -i));
  return days;
};
