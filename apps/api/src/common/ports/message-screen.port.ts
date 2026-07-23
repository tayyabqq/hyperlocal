export const MESSAGE_SCREEN_PORT = Symbol('MESSAGE_SCREEN_PORT');

export interface ScreenResult {
  allowed: boolean;
  /** Present when blocked; safe to surface to the sender. */
  reason?: string;
}

/**
 * Content gate applied to a message before it is stored. Chat depends on this
 * seam so the keyword blacklist and its tuning live in the moderation module
 * (M5) without chat importing it. The default binding allows everything;
 * moderation replaces it.
 */
export interface MessageScreen {
  screen(body: string): ScreenResult;
}

/** Baseline used until moderation provides a real screen. */
export class AllowAllMessageScreen implements MessageScreen {
  screen(): ScreenResult {
    return { allowed: true };
  }
}
