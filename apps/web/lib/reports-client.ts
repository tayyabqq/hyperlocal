import { ReportTargetType } from '@hl/shared';
import { apiFetch } from './api-client';

export function reportTarget(
  accessToken: string,
  targetType: ReportTargetType,
  targetId: string,
  reason: string,
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>('/v1/reports', accessToken, {
    method: 'POST',
    body: JSON.stringify({ targetType, targetId, reason }),
  });
}
