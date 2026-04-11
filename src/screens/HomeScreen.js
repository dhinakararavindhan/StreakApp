import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  loadHabits,
  saveHabits,
  toggleToday,
  calcStreak,
  isCompletedToday,
} from '../utils/storage';

const FLAME = '🔥';
const CHECK = '✓';

export default function HomeScreen({ navigation }) {
  const [habits, setHabits] = useState([]);

  useFocusEffect(
    useCallback(() => {
      loadHabits().then(setHabits);
    }, [])
  );

  const handleToggle = async (habit) => {
    const updated = habits.map((h) =>
      h.id === habit.id ? toggleToday(h) : h
    );
    setHabits(updated);
    await saveHabits(updated);
  };

  const handleDelete = (habit) => {
    Alert.alert('Delete Habit', `Delete "${habit.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const updated = habits.filter((h) => h.id !== habit.id);
          setHabits(updated);
          await saveHabits(updated);
        },
      },
    ]);
  };

  const renderItem = ({ item }) => {
    const streak = calcStreak(item);
    const done = isCompletedToday(item);
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('Detail', { habitId: item.id })}
        onLongPress={() => handleDelete(item)}
        activeOpacity={0.8}
      >
        <View style={[styles.colorBar, { backgroundColor: item.color }]} />
        <View style={styles.cardBody}>
          <Text style={styles.habitName}>{item.name}</Text>
          <View style={styles.streakRow}>
            <Text style={styles.flameIcon}>{streak > 0 ? FLAME : '  '}</Text>
            <Text style={styles.streakText}>
              {streak} day{streak !== 1 ? 's' : ''} streak
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.checkBtn, done && { backgroundColor: item.color }]}
          onPress={() => handleToggle(item)}
        >
          <Text style={[styles.checkText, done && styles.checkTextDone]}>
            {done ? CHECK : '○'}
          </Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Habits</Text>
        <Text style={styles.headerSub}>
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
      </View>

      {habits.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🌱</Text>
          <Text style={styles.emptyText}>No habits yet.</Text>
          <Text style={styles.emptySubText}>Tap + to add your first habit!</Text>
        </View>
      ) : (
        <FlatList
          data={habits}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('AddHabit')}
        activeOpacity={0.85}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f0f7' },
  header: {
    backgroundColor: '#1a1a2e',
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 24,
  },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#fff' },
  headerSub: { fontSize: 14, color: '#aaa', marginTop: 4 },
  list: { padding: 16, paddingBottom: 90 },
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    alignItems: 'center',
  },
  colorBar: { width: 6, alignSelf: 'stretch' },
  cardBody: { flex: 1, paddingVertical: 16, paddingHorizontal: 14 },
  habitName: { fontSize: 17, fontWeight: '600', color: '#1a1a2e' },
  streakRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  flameIcon: { fontSize: 16, marginRight: 4 },
  streakText: { fontSize: 13, color: '#666' },
  checkBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  checkText: { fontSize: 18, color: '#bbb' },
  checkTextDone: { color: '#fff', fontWeight: '700' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 60,
  },
  emptyIcon: { fontSize: 60, marginBottom: 16 },
  emptyText: { fontSize: 20, fontWeight: '600', color: '#333' },
  emptySubText: { fontSize: 14, color: '#999', marginTop: 6 },
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#6C63FF',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  fabText: { fontSize: 32, color: '#fff', lineHeight: 36 },
});
