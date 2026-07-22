export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

export interface OtpProvider {
  /**
   * Deliver a one-time code. Implementations must not surface errors that
   * distinguish "number not reachable" from "delivery failed" — that turns
   * this endpoint into a phone-number oracle.
   */
  sendOtp(phoneE164: string, code: string): Promise<void>;
}
