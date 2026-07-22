'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { RequestOtpResult, UserProfile } from '@hl/shared';
import { routeFetch } from '@/lib/api-client';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface VerifyResponse {
  accessToken: string;
  user: UserProfile;
  isNewUser: boolean;
}

interface AuthValue {
  status: AuthStatus;
  user: UserProfile | null;
  accessToken: string | null;
  requestOtp: (phoneE164: string) => Promise<RequestOtpResult>;
  verifyOtp: (challengeId: string, phoneE164: string, code: string) => Promise<VerifyResponse>;
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
    try {
      const data = await routeFetch<{ accessToken: string }>('/api/auth/refresh');
      setAccessToken(data.accessToken);
      setStatus('authenticated');
      return data.accessToken;
    } catch {
      setAccessToken(null);
      setUser(null);
      setStatus('unauthenticated');
      return null;
    }
  }, []);

  // Silent restore: the httpOnly cookie survives reloads, the access token does not.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void refresh();
  }, [refresh]);

  const requestOtp = useCallback(
    (phoneE164: string) => routeFetch<RequestOtpResult>('/api/auth/otp/request', { phoneE164 }),
    [],
  );

  const verifyOtp = useCallback(
    async (challengeId: string, phoneE164: string, code: string) => {
      const data = await routeFetch<VerifyResponse>('/api/auth/otp/verify', {
        challengeId,
        phoneE164,
        code,
      });
      setAccessToken(data.accessToken);
      setUser(data.user);
      setStatus('authenticated');
      return data;
    },
    [],
  );

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    }).catch(() => undefined);
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
