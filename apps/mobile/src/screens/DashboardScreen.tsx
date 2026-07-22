import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { UserRole, type UserProfile } from '@hl/shared';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { authedFetch } from '../api/client';
import { ErrorNotice } from '../components/ErrorNotice';
import { ProximityMark } from '../components/ProximityMark';
import { colors } from '../components/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

export function DashboardScreen({ navigation }: Props) {
  const { accessToken, user, setUser, refresh, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (accessToken === null) return;
    try {
      setUser(await authedFetch<UserProfile>('/v1/users/me', accessToken));
    } catch {
      // The 15-minute access token may have expired while the app was
      // backgrounded; rotate once before surfacing an error.
      const fresh = await refresh();
      if (fresh === null) return;
      try {
        setUser(await authedFetch<UserProfile>('/v1/users/me', fresh));
      } catch {
        setError('Could not load your profile. Pull down to retry.');
      }
    }
  }, [accessToken, setUser, refresh]);

  useEffect(() => {
    if (user === null) void loadProfile();
  }, [user, loadProfile]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <ProximityMark size={34} />
          <Text style={styles.brandText}>Work Nearby</Text>
        </View>
        <Text
          style={styles.logout}
          accessibilityRole="button"
          onPress={() =>
            void logout().then(() => navigation.reset({ index: 0, routes: [{ name: 'Login' }] }))
          }
        >
          Log out
        </Text>
      </View>

      <ErrorNotice message={error} />

      <View style={styles.card}>
        <Text style={styles.welcome}>
          {user !== null ? `Welcome, ${user.displayName}` : 'Welcome'}
        </Text>
        <Text style={styles.body}>
          {user?.role === UserRole.PROVIDER
            ? 'Your account is set up to hire. The map of workers near you opens next.'
            : 'Your account is set up to find work. The map of jobs near you opens next.'}
        </Text>

        <View style={styles.divider} />

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>PHONE</Text>
            <Text style={styles.metaValue}>{user?.phoneE164 ?? '—'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>ACCOUNT TYPE</Text>
            <Text style={styles.metaValue}>
              {user?.role === UserRole.PROVIDER ? 'Hiring' : 'Looking for work'}
            </Text>
          </View>
        </View>
      </View>

      <Pressable style={styles.mapButton} onPress={() => navigation.navigate('Map')}>
        <Text style={styles.mapButtonText}>Browse the map</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: 24, paddingTop: 64, paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandText: { fontSize: 17, fontWeight: '700', color: colors.ink },
  logout: { fontSize: 13, color: `${colors.slate}99`, textDecorationLine: 'underline' },
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 24,
  },
  welcome: { fontSize: 20, fontWeight: '700', color: colors.ink },
  body: { fontSize: 14, lineHeight: 21, color: `${colors.slate}B3`, marginTop: 8 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 24 },
  metaRow: { flexDirection: 'row', gap: 24 },
  metaItem: { flex: 1 },
  metaLabel: { fontSize: 11, letterSpacing: 0.6, color: `${colors.slate}80` },
  metaValue: { fontSize: 14, color: colors.ink, marginTop: 4 },
  mapButton: {
    marginTop: 20,
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  mapButtonText: { color: colors.canvas, fontSize: 15, fontWeight: '600' },
});
