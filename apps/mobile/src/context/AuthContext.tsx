import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AuthTokens, RequestOtpResult, UserProfile, VerifyOtpResult } from '@hl/shared';
import { authedFetch, publicFetch } from '../api/client';
import { tokenStore } from '../api/secure-store';
import { registerPushToken } from '../push/registerPush';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthValue {
  status: AuthStatus;
  user: UserProfile | null;
  accessToken: string | null;
  requestOtp: (phoneE164: string) => Promise<RequestOtpResult>;
  verifyOtp: (challengeId: string, phoneE164: string, code: string) => Promise<VerifyOtpResult>;
  refresh: () => Promise<string | null>;
  logout: () => Promise<void>;
  setUser: (user: UserProfile) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const bootstrapped = useRef(false);

  const refresh = useCallback(async (): Promise<string | null> => {
    const stored = await tokenStore.get();
    if (!stored) {
      setStatus('unauthenticated');
      return null;
    }
    try {
      const tokens = await publicFetch<AuthTokens>('/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: stored }),
      });
      await tokenStore.set(tokens.refreshToken);
      setAccessToken(tokens.accessToken);
      setStatus('authenticated');
      return tokens.accessToken;
    } catch {
      await tokenStore.clear();
      setAccessToken(null);
      setUser(null);
      setStatus('unauthenticated');
      return null;
    }
  }, []);

  // Restores the session on cold start from the encrypted store.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void refresh();
  }, [refresh]);

  // Register this device for push once per authenticated session, so the FCM
  // token is refreshed on every login (tokens rotate) without blocking auth.
  const pushRegisteredFor = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'authenticated' || !accessToken) return;
    if (pushRegisteredFor.current === accessToken) return;
    pushRegisteredFor.current = accessToken;
    void registerPushToken(accessToken);
  }, [status, accessToken]);

  const requestOtp = useCallback(
    (phoneE164: string) =>
      publicFetch<RequestOtpResult>('/v1/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ phoneE164 }),
      }),
    [],
  );

  const verifyOtp = useCallback(
    async (challengeId: string, phoneE164: string, code: string) => {
      const result = await publicFetch<VerifyOtpResult>('/v1/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, phoneE164, code }),
      });
      await tokenStore.set(result.tokens.refreshToken);
      setAccessToken(result.tokens.accessToken);
      setUser(result.user);
      setStatus('authenticated');
      return result;
    },
    [],
  );

  const logout = useCallback(async () => {
    if (accessToken) {
      await authedFetch('/v1/auth/logout', accessToken, { method: 'POST' }).catch(() => undefined);
    }
    await tokenStore.clear();
    setAccessToken(null);
    setUser(null);
    setStatus('unauthenticated');
  }, [accessToken]);

  const value = useMemo(
    () => ({ status, user, accessToken, requestOtp, verifyOtp, refresh, logout, setUser }),
    [status, user, accessToken, requestOtp, verifyOtp, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
