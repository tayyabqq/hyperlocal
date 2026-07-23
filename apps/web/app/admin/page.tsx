'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  AdminMetrics,
  AdminUserSummary,
  BlockedKeyword,
  ReportSummary,
} from '@hl/shared';
import { ModerationAction, ReportStatus } from '@hl/shared';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/lib/api-client';
import {
  addKeyword,
  banUser,
  fetchAdminUsers,
  fetchKeywords,
  fetchMetrics,
  fetchReports,
  removeKeyword,
  resolveReport,
  unbanUser,
} from '@/lib/admin-client';
import { ErrorNotice } from '@/components/ErrorNotice';
import { FullPageSpinner } from '@/components/Spinner';
import { ProximityMark } from '@/components/ProximityMark';

type Tab = 'overview' | 'reports' | 'users' | 'keywords';

export default function AdminPage() {
  const router = useRouter();
  const { status, accessToken, user } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    // Non-admins have no business here; bounce them to their dashboard.
    if (status === 'authenticated' && user && !user.isAdmin) router.replace('/dashboard');
  }, [status, user, router]);

  if (status === 'loading' || !user) return <FullPageSpinner />;
  if (!user.isAdmin) return null;

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex items-center gap-3">
          <ProximityMark className="h-9 w-9" />
          <span className="font-display text-lg font-semibold text-ink">Admin</span>
          <span className="ml-auto text-sm text-slate/60">{user.displayName}</span>
        </header>

        <nav className="mb-6 flex gap-1 border-b border-line">
          {(['overview', 'reports', 'users', 'keywords'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setError(null);
                setTab(t);
              }}
              className={`px-4 py-2 text-sm font-semibold capitalize ${
                tab === t ? 'border-b-2 border-ink text-ink' : 'text-slate/60'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        <ErrorNotice message={error} />

        {accessToken && tab === 'overview' && <Overview token={accessToken} onError={setError} />}
        {accessToken && tab === 'reports' && <Reports token={accessToken} onError={setError} />}
        {accessToken && tab === 'users' && <Users token={accessToken} onError={setError} />}
        {accessToken && tab === 'keywords' && <Keywords token={accessToken} onError={setError} />}
      </div>
    </main>
  );
}

function msg(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

const METRIC_LABELS: Record<keyof AdminMetrics, string> = {
  totalUsers: 'Total users',
  bannedUsers: 'Banned',
  activeListings: 'Active listings',
  listingsLast7Days: 'Listings (7d)',
  paidListingsLast7Days: 'Paid listings (7d)',
  paidConversionPct: 'Paid conversion',
  conversationsLast7Days: 'Conversations (7d)',
  messagesLast7Days: 'Messages (7d)',
  openReports: 'Open reports',
};

function Overview({ token, onError }: { token: string; onError: (m: string) => void }) {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);

  useEffect(() => {
    fetchMetrics(token)
      .then(setMetrics)
      .catch((e) => onError(msg(e, 'Could not load metrics.')));
  }, [token, onError]);

  if (!metrics) return <p className="text-sm text-slate/60">Loading…</p>;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {(Object.keys(METRIC_LABELS) as (keyof AdminMetrics)[]).map((key) => (
        <div key={key} className="rounded-card border border-line bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate/50">{METRIC_LABELS[key]}</p>
          <p className="mt-1 font-display text-2xl font-semibold text-ink">
            {metrics[key]}
            {key === 'paidConversionPct' ? '%' : ''}
          </p>
        </div>
      ))}
    </div>
  );
}

function Reports({ token, onError }: { token: string; onError: (m: string) => void }) {
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchReports(token, ReportStatus.OPEN)
      .then(setReports)
      .catch((e) => onError(msg(e, 'Could not load reports.')));
  }, [token, onError]);

  useEffect(load, [load]);

  const act = async (id: string, action: ModerationAction) => {
    setBusy(id);
    try {
      await resolveReport(token, id, action);
      load();
    } catch (e) {
      onError(msg(e, 'Could not resolve the report.'));
    } finally {
      setBusy(null);
    }
  };

  if (!reports) return <p className="text-sm text-slate/60">Loading…</p>;
  if (reports.length === 0)
    return <p className="rounded-card border border-line bg-white p-6 text-sm text-slate/70">No open reports.</p>;

  return (
    <ul className="space-y-3">
      {reports.map((r) => (
        <li key={r.id} className="rounded-card border border-line bg-white p-5">
          <div className="flex items-center gap-2 text-xs text-slate/50">
            <span className="rounded-full bg-line px-2 py-0.5 font-semibold">{r.targetType}</span>
            <span>reported by {r.reporterName}</span>
          </div>
          <p className="mt-2 font-semibold text-ink">{r.reason}</p>
          {r.targetPreview && (
            <p className="mt-1 truncate text-sm text-slate/70">“{r.targetPreview}”</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {r.targetType === 'LISTING' && (
              <button
                disabled={busy === r.id}
                onClick={() => act(r.id, ModerationAction.KILL_LISTING)}
                className="rounded-card bg-ink px-4 py-2 text-xs font-semibold text-canvas disabled:opacity-50"
              >
                Kill listing
              </button>
            )}
            <button
              disabled={busy === r.id}
              onClick={() => act(r.id, ModerationAction.BAN_USER)}
              className="rounded-card border border-ink px-4 py-2 text-xs font-semibold text-ink disabled:opacity-50"
            >
              Ban user
            </button>
            <button
              disabled={busy === r.id}
              onClick={() => act(r.id, ModerationAction.DISMISS)}
              className="rounded-card border border-line px-4 py-2 text-xs font-semibold text-slate disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Users({ token, onError }: { token: string; onError: (m: string) => void }) {
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    (q?: string) => {
      fetchAdminUsers(token, q)
        .then(setUsers)
        .catch((e) => onError(msg(e, 'Could not load users.')));
    },
    [token, onError],
  );

  useEffect(() => load(), [load]);

  const toggleBan = async (u: AdminUserSummary) => {
    setBusy(u.id);
    try {
      if (u.bannedAt) await unbanUser(token, u.id);
      else await banUser(token, u.id);
      load(search || undefined);
    } catch (e) {
      onError(msg(e, 'Could not update the account.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(search || undefined);
        }}
        className="mb-4 flex gap-2"
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone"
          className="flex-1 rounded-card border border-line px-4 py-2.5 text-sm"
        />
        <button className="rounded-card bg-ink px-4 py-2.5 text-sm font-semibold text-canvas">
          Search
        </button>
      </form>

      {!users && <p className="text-sm text-slate/60">Loading…</p>}
      <ul className="space-y-2">
        {users?.map((u) => (
          <li
            key={u.id}
            className="flex items-center justify-between gap-4 rounded-card border border-line bg-white p-4"
          >
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">
                {u.displayName || '(no name)'}
                {u.isAdmin && <span className="ml-2 text-xs text-slate/50">admin</span>}
              </p>
              <p className="text-sm text-slate/60">
                {u.phoneE164} · {u.role}
                {u.bannedAt && <span className="text-ink"> · banned</span>}
              </p>
            </div>
            {!u.isAdmin && (
              <button
                disabled={busy === u.id}
                onClick={() => toggleBan(u)}
                className="shrink-0 rounded-card border border-ink px-4 py-2 text-xs font-semibold text-ink disabled:opacity-50"
              >
                {u.bannedAt ? 'Unban' : 'Ban'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Keywords({ token, onError }: { token: string; onError: (m: string) => void }) {
  const [keywords, setKeywords] = useState<BlockedKeyword[] | null>(null);
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchKeywords(token)
      .then(setKeywords)
      .catch((e) => onError(msg(e, 'Could not load keywords.')));
  }, [token, onError]);

  useEffect(load, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (term.trim().length < 2) return;
    setBusy(true);
    try {
      await addKeyword(token, term.trim());
      setTerm('');
      load();
    } catch (err) {
      onError(msg(err, 'Could not add the keyword.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await removeKeyword(token, id);
      load();
    } catch (err) {
      onError(msg(err, 'Could not remove the keyword.'));
    }
  };

  return (
    <div>
      <form onSubmit={add} className="mb-4 flex gap-2">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Add a blocked term or phrase"
          className="flex-1 rounded-card border border-line px-4 py-2.5 text-sm"
        />
        <button
          disabled={busy}
          className="rounded-card bg-ink px-4 py-2.5 text-sm font-semibold text-canvas disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {!keywords && <p className="text-sm text-slate/60">Loading…</p>}
      <ul className="flex flex-wrap gap-2">
        {keywords?.map((k) => (
          <li
            key={k.id}
            className="flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-sm"
          >
            <span className="text-ink">{k.term}</span>
            <button
              onClick={() => remove(k.id)}
              aria-label={`Remove ${k.term}`}
              className="text-slate/50 hover:text-ink"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
