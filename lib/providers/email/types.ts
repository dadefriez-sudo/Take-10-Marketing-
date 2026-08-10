/**
 * Email transport boundary.
 *
 * Phase 0 only needs auth and invitation mail, but the interface is the one
 * Phase 2 campaigns and Phase 4 review requests will use, so those phases add
 * implementations rather than replacing this seam.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  /** Correlates the send back to a Message/ReviewRequest row in later phases. */
  metadata?: Record<string, unknown>;
}

export interface SendResult {
  id: string;
  provider: string;
  /** False when the provider intentionally did not deliver (mock transport). */
  delivered: boolean;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutboundEmail): Promise<SendResult>;
}
