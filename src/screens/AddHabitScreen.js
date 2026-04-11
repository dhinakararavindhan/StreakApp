import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { loadHabits, saveHabits, createHabit } from '../utils/storage';

const COLORS = [
  '#6C63FF',
  '#FF6584',
  '#43AA8B',
  '#F9844A',
  '#4CC9F0',
  '#E9C46A',
  '#9B5DE5',
  '#F15BB5',
];

export default function AddHabitScreen({ navigation, route }) {
  const editing = route.params?.habit;
  const [name, setName] = useState(editing?.name ?? '');
  const [color, setColor] = useState(editing?.color ?? COLORS[0]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Please enter a habit name.');
      return;
    }
    const habits = await loadHabits();
    let updated;
    if (editing) {
      updated = habits.map((h) =>
        h.id === editing.id ? { ...h, name: trimmed, color } : h
      );
    } else {
      updated = [...habits, createHabit(trimmed, color)];
    }
    await saveHabits(updated);
    navigation.goBack();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>Habit Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Exercise, Read, Meditate..."
          placeholderTextColor="#bbb"
          maxLength={50}
          autoFocus
        />

        <Text style={styles.label}>Color</Text>
        <View style={styles.colorGrid}>
          {COLORS.map((c) => (
            <TouchableOpacity
              key={c}
              style={[
                styles.colorDot,
                { backgroundColor: c },
                color === c && styles.colorDotSelected,
              ]}
              onPress={() => setColor(c)}
            />
          ))}
        </View>

        <View style={styles.preview}>
          <View style={[styles.previewBar, { backgroundColor: color }]} />
          <Text style={styles.previewText}>{name || 'Your habit'}</Text>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: color }]}
          onPress={handleSave}
          activeOpacity={0.85}
        >
          <Text style={styles.saveBtnText}>
            {editing ? 'Save Changes' : 'Add Habit'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f0f7' },
  content: { padding: 24 },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: '#1a1a2e',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  colorDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  colorDotSelected: {
    borderWidth: 3,
    borderColor: '#1a1a2e',
    transform: [{ scale: 1.15 }],
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    marginTop: 28,
    overflow: 'hidden',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  previewBar: { width: 6, height: 56 },
  previewText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a2e',
    paddingHorizontal: 16,
  },
  saveBtn: {
    marginTop: 32,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    elevation: 3,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  saveBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },
});
