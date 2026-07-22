import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { UserRole, type UserProfile } from '@hl/shared';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { authedFetch, ApiError } from '../api/client';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { colors } from '../components/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

export function OnboardingScreen({ navigation }: Props) {
  const { accessToken, setUser } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.SEEKER);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (accessToken === null) return;
    setError(null);
    setBusy(true);
    try {
      const profile = await authedFetch<UserProfile>('/v1/users/me', accessToken, {
        method: 'PATCH',
        body: JSON.stringify({ displayName: displayName.trim(), role }),
      });
      setUser(profile);
      navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your details.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Set up your account</Text>
      <Text style={styles.subtitle}>
        This decides what you see first — jobs near you, or workers near you.
      </Text>

      <ErrorNotice message={error} />

      <Text style={styles.label}>Your name</Text>
      <TextInput
        style={styles.input}
        value={displayName}
        onChangeText={setDisplayName}
        autoFocus
        maxLength={60}
        accessibilityLabel="Your name"
      />
      <Text style={styles.hint}>Shown to people you contact.</Text>

      <Text style={styles.label}>I am here to</Text>
      <View style={styles.roleRow}>
        <RoleCard
          title="Find work"
          subtitle="Show me jobs nearby"
          selected={role === UserRole.SEEKER}
          onSelect={() => setRole(UserRole.SEEKER)}
        />
        <RoleCard
          title="Hire someone"
          subtitle="Show me workers nearby"
          selected={role === UserRole.PROVIDER}
          onSelect={() => setRole(UserRole.PROVIDER)}
        />
      </View>

      <Button
        title="Continue"
        onPress={onSubmit}
        loading={busy}
        disabled={displayName.trim().length < 2}
      />
    </ScrollView>
  );
}

function RoleCard({
  title,
  subtitle,
  selected,
  onSelect,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.roleCard, selected && styles.roleCardSelected]}
    >
      <Text style={[styles.roleTitle, selected && styles.roleTextSelected]}>{title}</Text>
      <Text style={[styles.roleSubtitle, selected && styles.roleTextSelected]}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: 24, paddingTop: 72, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '700', color: colors.ink, textAlign: 'center', marginBottom: 8 },
  subtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: `${colors.slate}B3`,
    textAlign: 'center',
    marginBottom: 28,
  },
  label: { fontSize: 14, fontWeight: '500', color: colors.slate, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    borderRadius: 14,
    paddingHorizontal: 16,
    minHeight: 52,
    fontSize: 15,
    color: colors.ink,
  },
  hint: { fontSize: 12, color: `${colors.slate}99`, marginTop: 6, marginBottom: 20 },
  roleRow: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  roleCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 16,
  },
  roleCardSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  roleTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  roleSubtitle: { fontSize: 12, color: `${colors.slate}99`, marginTop: 2 },
  roleTextSelected: { color: colors.canvas },
});
