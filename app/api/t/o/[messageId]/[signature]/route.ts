import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyTracking } from "@/lib/messaging/tracking";

export const dynamic = "force-dynamic";

// 1x1 transparent GIF.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

/**
 * Open tracking pixel.
 *
 * Always returns the image, whatever happens — a tracking failure must never
 * show a broken-image icon in someone's inbox.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ messageId: string; signature: string }> },
) {
  const { messageId, signature } = await params;
  const cleanSignature = signature.replace(/\.gif$/, "");

  if (verifyTracking(messageId, cleanSignature)) {
    try {
      const message = await db.message.findUnique({
        where: { id: messageId },
        select: { id: true, status: true },
      });

      if (message) {
        // Record every open; the first is the "opened" metric, the rest are
        // re-reads and forwards, which are worth keeping separately.
        await db.messageEvent.create({
          data: { messageId, type: "OPENED" },
        });

        if (message.status === "SENT") {
          await db.message.update({
            where: { id: messageId },
            data: { status: "DELIVERED" },
          });
        }
      }
    } catch {
      // Swallow: the pixel's job is to render, not to report errors.
    }
  }

  return new NextResponse(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
    },
  });
}
