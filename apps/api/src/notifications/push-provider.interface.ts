export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export interface PushMessage {
  title: string;
  body: string;
  /** Delivered to the app for deep-linking; string values only, per FCM. */
  data?: Record<string, string>;
}

export interface PushTarget {
  token: string;
  platform: string;
}

export interface PushResult {
  /** Tokens the provider reported as permanently invalid; callers prune these. */
  invalidTokens: string[];
}

export interface PushProvider {
  /**
   * Best-effort fan-out to a user's devices. Must never throw into a
   * user-facing request path — a failed push cannot fail sending a message.
   */
  send(targets: PushTarget[], message: PushMessage): Promise<PushResult>;
}
