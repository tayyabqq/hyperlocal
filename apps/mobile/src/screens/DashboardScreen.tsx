import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { formatAed, LISTING_FEE_FILS, ListingStatus, UserRole } from '@hl/shared';
import type { ListingSummary, UserProfile } from '@hl/shared';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { ApiError, authedFetch } from '../api/client';
import { fetchMyListings } from '../api/listings';
import { fetchCredits, retryListingPayment } from '../api/payments';
import { ErrorNotice } from '../components/ErrorNotice';
import { ProximityMark } from '../components/ProximityMark';
import { colors } from '../components/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

const STATUS_LABEL: Record<string, string> = {
  [ListingStatus.PENDING_PAYMENT]: 'Awaiting payment',
  [ListingStatus.ACTIVE]: 'Live',
  [ListingStatus.EXPIRED]: 'Expired',
  [ListingStatus.REMOVED]: 'Removed',
};

function daysLeft(expiresAt: string | null): string | null {
  if (expiresAt === null) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const days = Math.ceil(ms / 86_400_000);
  return days === 1 ? '1 day left' : `${days} days left`;
}

export function DashboardScreen({ navigation }: Props) {
  const { accessToken, user, setUser, refresh, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [listings, setListings] = useState<ListingSummary[] | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

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

  const loadListings = useCallback(async () => {
    if (accessToken === null) return;
    try {
      const [mine, balance] = await Promise.all([
        fetchMyListings(accessToken),
        fetchCredits(accessToken),
      ]);
      setListings(mine);
      setCredits(balance.credits);
    } catch {
      setError('Could not load your listings.');
    }
  }, [accessToken]);

  useEffect(() => {
    if (user === null) void loadProfile();
  }, [user, loadProfile]);

  // Re-read on every focus so a listing paid for elsewhere shows as live here.
  useEffect(() => navigation.addListener('focus', () => void loadListings()), [
    navigation,
    loadListings,
  ]);

  const completePayment = useCallback(
    async (listingId: string) => {
      if (accessToken === null) return;
      setError(null);
      setPayingId(listingId);
      try {
        const order = await retryListingPayment(accessToken, listingId);
        if (order.redirectUrl !== null) {
          await WebBrowser.openBrowserAsync(order.redirectUrl);
        }
        navigation.navigate('PaymentPending', { orderId: order.id });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not restart your payment.');
      } finally {
        setPayingId(null);
      }
    },
    [accessToken, navigation],
  );

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
            ? 'Post what you need and workers within 2 km will see it.'
            : 'Post your availability and employers within 2 km will see it.'}
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
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>FREE LISTINGS</Text>
            <Text style={styles.metaValue}>{credits ?? '—'}</Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Map')}>
          <Text style={styles.primaryButtonText}>Browse the map</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('NewListing')}>
          <Text style={styles.secondaryButtonText}>Post a listing</Text>
        </Pressable>
      </View>

      <Pressable style={styles.messagesButton} onPress={() => navigation.navigate('Conversations')}>
        <Text style={styles.messagesButtonText}>Messages</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Your listings</Text>

      {listings !== null && listings.length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.body}>Nothing posted yet. Your first listing is free.</Text>
        </View>
      )}

      {listings?.map((listing) => {
        const remaining = daysLeft(listing.expiresAt);
        const unpaid = listing.status === ListingStatus.PENDING_PAYMENT;

        return (
          <View key={listing.id} style={styles.listingCard}>
            <View style={styles.listingHeader}>
              <View style={styles.listingHeaderText}>
                <Text style={styles.listingTitle}>{listing.category}</Text>
                <Text style={styles.listingMeta}>
                  AED {listing.payAmountAed} · {listing.locationLabel}
                </Text>
              </View>
              <View
                style={[
                  styles.badge,
                  listing.status === ListingStatus.ACTIVE ? styles.badgeLive : styles.badgeMuted,
                ]}
              >
                <Text
                  style={
                    listing.status === ListingStatus.ACTIVE
                      ? styles.badgeLiveText
                      : styles.badgeMutedText
                  }
                >
                  {STATUS_LABEL[listing.status] ?? listing.status}
                </Text>
              </View>
            </View>

            {remaining !== null && <Text style={styles.remaining}>{remaining}</Text>}

            {unpaid && (
              <Pressable
                style={styles.payButton}
                disabled={payingId === listing.id}
                onPress={() => void completePayment(listing.id)}
              >
                <Text style={styles.payButtonText}>
                  {payingId === listing.id
                    ? 'Working…'
                    : `Pay ${formatAed(LISTING_FEE_FILS)} to publish`}
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}
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
  metaRow: { flexDirection: 'row', gap: 16 },
  metaItem: { flex: 1 },
  metaLabel: { fontSize: 11, letterSpacing: 0.6, color: `${colors.slate}80` },
  metaValue: { fontSize: 14, color: colors.ink, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  primaryButton: {
    flex: 1,
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.canvas, fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  secondaryButtonText: { color: colors.slate, fontSize: 15, fontWeight: '600' },
  messagesButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  messagesButtonText: { color: colors.slate, fontSize: 15, fontWeight: '600' },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginTop: 32, marginBottom: 12 },
  emptyCard: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 20,
  },
  listingCard: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 20,
    marginBottom: 12,
  },
  listingHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  listingHeaderText: { flex: 1 },
  listingTitle: { fontSize: 15, fontWeight: '600', color: colors.ink },
  listingMeta: { fontSize: 13, color: `${colors.slate}B3`, marginTop: 4 },
  badge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  badgeLive: { backgroundColor: colors.ink },
  badgeMuted: { borderWidth: 1, borderColor: colors.line },
  badgeLiveText: { fontSize: 11, fontWeight: '700', color: colors.canvas },
  badgeMutedText: { fontSize: 11, fontWeight: '700', color: `${colors.slate}B3` },
  remaining: { fontSize: 11, color: `${colors.slate}99`, marginTop: 12 },
  payButton: {
    marginTop: 16,
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  payButtonText: { color: colors.canvas, fontSize: 14, fontWeight: '600' },
});
