import { ReportTargetType } from '@hl/shared';
import { authedFetch } from './client';

export function reportTarget(
  accessToken: string,
  targetType: ReportTargetType,
  targetId: string,
  reason: string,
): Promise<{ id: string }> {
  return authedFetch<{ id: string }>('/v1/reports', accessToken, {
    method: 'POST',
    body: JSON.stringify({ targetType, targetId, reason }),
  });
}
