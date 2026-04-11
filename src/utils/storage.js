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

// Returns today's date as YYYY-MM-DD string
export const today = () => new Date().toISOString().slice(0, 10);

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

  const sorted = [...habit.completedDates].sort().reverse();
  const todayStr = today();
  const todayDate = new Date(todayStr);

  // Streak must include today or yesterday
  if (sorted[0] !== todayStr) {
    const yesterday = new Date(todayDate);
    yesterday.setDate(yesterday.getDate() - 1);
    if (sorted[0] !== yesterday.toISOString().slice(0, 10)) return 0;
  }

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diff = (prev - curr) / (1000 * 60 * 60 * 24);
    if (diff === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
};

// Longest streak ever
export const calcLongest = (habit) => {
  if (habit.completedDates.length === 0) return 0;
  const sorted = [...habit.completedDates].sort();
  let max = 1;
  let current = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diff = (curr - prev) / (1000 * 60 * 60 * 24);
    if (diff === 1) {
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
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
};
