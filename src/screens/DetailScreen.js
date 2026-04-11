import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  loadHabits,
  saveHabits,
  toggleToday,
  calcStreak,
  calcLongest,
  isCompletedToday,
  last30Days,
  today,
} from '../utils/storage';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function DetailScreen({ navigation, route }) {
  const { habitId } = route.params;
  const [habit, setHabit] = useState(null);

  useFocusEffect(
    useCallback(() => {
      loadHabits().then((habits) => {
        const found = habits.find((h) => h.id === habitId);
        if (found) setHabit(found);
      });
    }, [habitId])
  );

  const handleToggle = async () => {
    const habits = await loadHabits();
    const updated = habits.map((h) => (h.id === habitId ? toggleToday(h) : h));
    await saveHabits(updated);
    const found = updated.find((h) => h.id === habitId);
    setHabit(found);
  };

  const handleEdit = () => {
    navigation.navigate('AddHabit', { habit });
  };

  if (!habit) return null;

  const streak = calcStreak(habit);
  const longest = calcLongest(habit);
  const done = isCompletedToday(habit);
  const days = last30Days();
  const todayStr = today();

  // Group days into weeks (rows of 7)
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header card */}
      <View style={[styles.headerCard, { backgroundColor: habit.color }]}>
        <Text style={styles.habitName}>{habit.name}</Text>
        <Text style={styles.headerSub}>
          Started{' '}
          {new Date(habit.createdAt).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </Text>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{streak}</Text>
          <Text style={styles.statLabel}>Current{'\n'}Streak</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{longest}</Text>
          <Text style={styles.statLabel}>Longest{'\n'}Streak</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{habit.completedDates.length}</Text>
          <Text style={styles.statLabel}>Total{'\n'}Days</Text>
        </View>
      </View>

      {/* 30-day calendar */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Last 30 Days</Text>
        <View style={styles.calendar}>
          {weeks.map((week, wi) => (
            <View key={wi} style={styles.weekRow}>
              {week.map((day) => {
                const isToday = day === todayStr;
                const completed = habit.completedDates.includes(day);
                return (
                  <View
                    key={day}
                    style={[
                      styles.dayCell,
                      completed && { backgroundColor: habit.color },
                      isToday && styles.todayCell,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        completed && styles.dayTextCompleted,
                      ]}
                    >
                      {new Date(day + 'T12:00:00').getDate()}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
        <View style={styles.legend}>
          <View style={[styles.legendDot, { backgroundColor: habit.color }]} />
          <Text style={styles.legendText}>Completed</Text>
          <View style={[styles.legendDot, { backgroundColor: '#e8e8e8' }]} />
          <Text style={styles.legendText}>Missed</Text>
        </View>
      </View>

      {/* Today button */}
      <TouchableOpacity
        style={[
          styles.todayBtn,
          { backgroundColor: done ? '#e8e8e8' : habit.color },
        ]}
        onPress={handleToggle}
        activeOpacity={0.85}
      >
        <Text style={[styles.todayBtnText, done && { color: '#666' }]}>
          {done ? '✓  Completed Today' : 'Mark as Done Today'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.editBtn} onPress={handleEdit}>
        <Text style={styles.editBtnText}>Edit Habit</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f0f7' },
  headerCard: {
    paddingTop: 36,
    paddingBottom: 28,
    paddingHorizontal: 24,
  },
  habitName: { fontSize: 26, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 6 },
  statsRow: {
    flexDirection: 'row',
    margin: 16,
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1a1a2e',
  },
  statLabel: {
    fontSize: 11,
    color: '#999',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 14,
  },
  calendar: { gap: 6 },
  weekRow: { flexDirection: 'row', gap: 6 },
  dayCell: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#e8e8e8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCell: {
    borderWidth: 2,
    borderColor: '#1a1a2e',
  },
  dayText: { fontSize: 11, fontWeight: '600', color: '#888' },
  dayTextCompleted: { color: '#fff' },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 6,
  },
  legendDot: { width: 12, height: 12, borderRadius: 3 },
  legendText: { fontSize: 12, color: '#888', marginRight: 12 },
  todayBtn: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    elevation: 3,
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  todayBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  editBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#ddd',
  },
  editBtnText: { fontSize: 15, fontWeight: '600', color: '#555' },
});
