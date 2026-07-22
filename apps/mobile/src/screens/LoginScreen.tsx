import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { ProximityMark } from '../components/ProximityMark';
import { colors } from '../components/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { requestOtp, verifyOtp } = useAuth();

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('+971');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function onRequest() {
    setError(null);
    setBusy(true);
    try {
      const result = await requestOtp(phone.trim());
      setChallengeId(result.challengeId);
      setCooldown(result.retryAfterSeconds);
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    if (challengeId === null) return;
    setError(null);
    setBusy(true);
    try {
      const result = await verifyOtp(challengeId, phone.trim(), code);
      navigation.reset({
        index: 0,
        routes: [
          { name: result.isNewUser || !result.user.isProfileComplete ? 'Onboarding' : 'Dashboard' },
        ],
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify that code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.markWrap}>
          <ProximityMark />
        </View>

        <Text style={styles.title}>
          {step === 'phone' ? 'Work happens nearby' : 'Enter your code'}
        </Text>
        <Text style={styles.subtitle}>
          {step === 'phone'
            ? 'Sign in with your phone number. We send a code on WhatsApp — no password to remember.'
            : `We sent a 6-digit code to ${phone} on WhatsApp.`}
        </Text>

        <ErrorNotice message={error} />

        {step === 'phone' ? (
          <>
            <Text style={styles.label}>Phone number</Text>
            <TextInput
              style={styles.input}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoFocus
              value={phone}
              onChangeText={setPhone}
              accessibilityLabel="Phone number, include country code"
            />
            <Text style={styles.hint}>Include the country code.</Text>
            <Button
              title="Send code"
              onPress={onRequest}
              loading={busy}
              disabled={phone.trim().length < 8}
            />
          </>
        ) : (
          <>
            <Text style={styles.label}>6-digit code</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={6}
              autoFocus
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
              accessibilityLabel="Six digit verification code"
            />
            <Button
              title="Verify and continue"
              onPress={onVerify}
              loading={busy}
              disabled={code.length !== 6}
            />
            <Text
              style={[styles.link, cooldown > 0 && styles.linkDisabled]}
              onPress={
                cooldown > 0
                  ? undefined
                  : () => {
                      setStep('phone');
                      setCode('');
                      setError(null);
                    }
              }
            >
              {cooldown > 0 ? `Resend available in ${cooldown}s` : 'Use a different number'}
            </Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 48 },
  markWrap: { alignItems: 'center', marginBottom: 28 },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 8,
  },
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
    marginBottom: 8,
  },
  codeInput: { textAlign: 'center', fontSize: 24, letterSpacing: 8, marginBottom: 16 },
  hint: { fontSize: 12, color: `${colors.slate}99`, marginBottom: 20 },
  link: {
    textAlign: 'center',
    color: `${colors.slate}99`,
    fontSize: 13,
    marginTop: 20,
    textDecorationLine: 'underline',
  },
  linkDisabled: { textDecorationLine: 'none', opacity: 0.6 },
});
