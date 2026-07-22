'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { FullPageSpinner } from '@/components/Spinner';

export default function IndexPage() {
  const router = useRouter();
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated') {
      router.replace(user && !user.isProfileComplete ? '/onboarding' : '/dashboard');
    }
  }, [status, user, router]);

  return <FullPageSpinner />;
}
