import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PaymentOrderSummary } from '@hl/shared';
import { formatAed, PaymentMethod, PaymentOrderStatus } from '@hl/shared';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';
import { fetchOrder, retryListingPayment } from '../api/payments';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { colors } from '../components/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PaymentPending'>;

const POLL_INTERVAL_MS = 2000;
// The gateway callback normally lands within a second or two; after this we
// stop spinning and tell the user plainly rather than looping forever.
const MAX_POLLS = 30;

/**
 * Confirms a listing payment. The user closing the payment browser proves
 * nothing — only our own gateway callback does — so this screen polls the
 * order until the server confirms it.
 */
export function PaymentPendingScreen({ navigation, route }: Props) {
  const { orderId } = route.params;
  const { accessToken } = useAuth();

  const [order, setOrder] = useState<PaymentOrderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const pollCount = useRef(0);

  useEffect(() => {
    if (accessToken === null) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const next = await fetchOrder(accessToken, orderId);
        if (cancelled) return;
        setOrder(next);

        if (next.status !== PaymentOrderStatus.PENDING) return;
        if (++pollCount.current >= MAX_POLLS) {
          setTimedOut(true);
          return;
        }
        timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Could not check your payment.');
      }
    };

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accessToken, orderId]);

  const onRetry = useCallback(async () => {
    if (accessToken === null || order === null) return;
    setError(null);
    setRetrying(true);
    try {
      const next = await retryListingPayment(accessToken, order.listingId);
      if (next.redirectUrl !== null) {
        await WebBrowser.openBrowserAsync(next.redirectUrl);
      }
      navigation.replace('PaymentPending', { orderId: next.id });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not restart your payment.');
      setRetrying(false);
    }
  }, [accessToken, order, navigation]);

  const isPaid = order?.status === PaymentOrderStatus.PAID;
  const isPending = order?.status === PaymentOrderStatus.PENDING;
  const isFailed = order?.status === PaymentOrderStatus.FAILED;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ErrorNotice message={error} />

      {order === null && error === null && (
        <View style={styles.card}>
          <ActivityIndicator color={colors.ink} />
          <Text style={styles.title}>Checking your payment…</Text>
          <Text style={styles.body}>This takes a few seconds.</Text>
        </View>
      )}

      {isPaid && (
        <View style={styles.card}>
          <Text style={styles.title}>Your listing is live</Text>
          <Text style={styles.body}>
            {order.method === PaymentMethod.CREDIT
              ? 'That one was free — we used a listing credit. '
              : `${formatAed(order.amountFils)} paid. `}
            People within 2 km can see it now, and it stays up for 7 days.
          </Text>
          <Button title="See it on the map" onPress={() => navigation.replace('Map')} />
        </View>
      )}

      {isPending && !timedOut && (
        <View style={styles.card}>
          <ActivityIndicator color={colors.ink} />
          <Text style={styles.title}>Waiting for confirmation</Text>
          <Text style={styles.body}>
            Your bank is confirming {formatAed(order.amountFils)}. Keep this screen open — it
            updates by itself.
          </Text>
        </View>
      )}

      {isPending && timedOut && (
        <View style={styles.card}>
          <Text style={styles.title}>Still not confirmed</Text>
          <Text style={styles.body}>
            We have not had confirmation from your bank. Nothing has been posted and you have not
            been charged twice — you can start the payment again.
          </Text>
          <Button title="Try the payment again" onPress={onRetry} loading={retrying} />
        </View>
      )}

      {isFailed && (
        <View style={styles.card}>
          <Text style={styles.title}>Payment did not go through</Text>
          <Text style={styles.body}>
            Your listing is saved but not visible yet. You have not been charged.
          </Text>
          <Button title="Try again" onPress={onRetry} loading={retrying} />
        </View>
      )}

      <Text
        style={styles.backLink}
        accessibilityRole="button"
        onPress={() => navigation.replace('Dashboard')}
      >
        Back to dashboard
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: 24, paddingTop: 72, paddingBottom: 40 },
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 24,
    gap: 8,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.ink },
  body: { fontSize: 14, lineHeight: 21, color: `${colors.slate}B3`, marginBottom: 12 },
  backLink: {
    marginTop: 24,
    textAlign: 'center',
    fontSize: 13,
    color: `${colors.slate}99`,
    textDecorationLine: 'underline',
  },
});
