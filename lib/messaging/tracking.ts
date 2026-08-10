import { createHmac } from "node:crypto";

/**
 * Open and click tracking.
 *
 * Both the pixel and the click redirect are signed. Without a signature anyone
 * could forge engagement for a message id, and open/click rates are exactly the
 * numbers an agency reports to its clients — so they need to be as hard to
 * fake as they are to read.
 */

function secret(): string {
  return process.env.AUTH_SECRET ?? "dev-secret";
}

export function signTracking(messageId: string, target = ""): string {
  return createHmac("sha256", secret())
    .update(`${messageId}:${target}`)
    .digest("base64url")
    .slice(0, 24);
}

export function verifyTracking(
  messageId: string,
  signature: string,
  target = "",
): boolean {
  return signTracking(messageId, target) === signature;
}

function base(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

export function openPixelUrl(messageId: string): string {
  return `${base()}/api/t/o/${messageId}/${signTracking(messageId)}.gif`;
}

export function clickUrl(messageId: string, target: string): string {
  const encoded = encodeURIComponent(target);
  return `${base()}/api/t/c/${messageId}/${signTracking(
    messageId,
    target,
  )}?u=${encoded}`;
}

/**
 * Rewrite outbound links so clicks are attributable, and append the open pixel.
 *
 * Unsubscribe links are deliberately left alone: an opt-out must keep working
 * even if tracking is broken or blocked, and it should not be logged as
 * engagement.
 */
export function instrumentHtml(html: string, messageId: string): string {
  const rewritten = html.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (match, url: string) => {
      if (url.includes("/u/")) return match;
      return `href="${clickUrl(messageId, url)}"`;
    },
  );

  return `${rewritten}<img src="${openPixelUrl(
    messageId,
  )}" width="1" height="1" alt="" style="display:none" />`;
}
