export const MESSAGE_SCREEN_PORT = Symbol('MESSAGE_SCREEN_PORT');

export interface ScreenResult {
  allowed: boolean;
  /** Present when blocked; safe to surface to the sender. */
  reason?: string;
}

/**
 * Content gate applied to a message before it is stored. Chat depends on this
 * seam so the keyword blacklist and its tuning live in the moderation module
 * without chat importing it — the moderation module provides the binding
 * globally.
 */
export interface MessageScreen {
  screen(body: string): ScreenResult;
}
