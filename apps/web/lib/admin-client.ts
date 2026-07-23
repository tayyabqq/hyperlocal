import type {
  AdminMetrics,
  AdminUserSummary,
  BlockedKeyword,
  ModerationAction,
  ReportStatus,
  ReportSummary,
} from '@hl/shared';
import { apiFetch } from './api-client';

export function fetchMetrics(accessToken: string): Promise<AdminMetrics> {
  return apiFetch<AdminMetrics>('/v1/admin/metrics', accessToken);
}

export function fetchReports(
  accessToken: string,
  status?: ReportStatus,
): Promise<ReportSummary[]> {
  const query = status ? `?status=${status}` : '';
  return apiFetch<ReportSummary[]>(`/v1/admin/reports${query}`, accessToken);
}

export function resolveReport(
  accessToken: string,
  reportId: string,
  action: ModerationAction,
  note?: string,
): Promise<void> {
  return apiFetch<void>(`/v1/admin/reports/${reportId}/resolve`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ action, note }),
  });
}

export function fetchAdminUsers(
  accessToken: string,
  search?: string,
): Promise<AdminUserSummary[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  return apiFetch<AdminUserSummary[]>(`/v1/admin/users${query}`, accessToken);
}

export function banUser(accessToken: string, userId: string, note?: string): Promise<void> {
  return apiFetch<void>(`/v1/admin/users/${userId}/ban`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export function unbanUser(accessToken: string, userId: string, note?: string): Promise<void> {
  return apiFetch<void>(`/v1/admin/users/${userId}/unban`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export function removeListing(accessToken: string, listingId: string, note?: string): Promise<void> {
  return apiFetch<void>(`/v1/admin/listings/${listingId}/remove`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export function fetchKeywords(accessToken: string): Promise<BlockedKeyword[]> {
  return apiFetch<BlockedKeyword[]>('/v1/admin/keywords', accessToken);
}

export function addKeyword(accessToken: string, term: string): Promise<void> {
  return apiFetch<void>('/v1/admin/keywords', accessToken, {
    method: 'POST',
    body: JSON.stringify({ term }),
  });
}

export function removeKeyword(accessToken: string, id: string): Promise<void> {
  return apiFetch<void>(`/v1/admin/keywords/${id}`, accessToken, { method: 'DELETE' });
}
