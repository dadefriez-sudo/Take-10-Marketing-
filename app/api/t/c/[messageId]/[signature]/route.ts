import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyTracking } from "@/lib/messaging/tracking";

export const dynamic = "force-dynamic";

/**
 * Click tracking redirect.
 *
 * Records the click, then forwards. A tracking problem must never strand the
 * recipient, so any failure still redirects — but an unsigned or off-protocol
 * target is refused outright, because an open redirect on a marketing domain
 * is a phishing gift.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ messageId: string; signature: string }> },
) {
  const { messageId, signature } = await params;
  const target = new URL(request.url).searchParams.get("u");

  if (!target) {
    return NextResponse.json({ error: "Missing destination" }, { status: 400 });
  }

  let destination: URL;
  try {
    destination = new URL(target);
  } catch {
    return NextResponse.json({ error: "Bad destination" }, { status: 400 });
  }

  if (destination.protocol !== "https:" && destination.protocol !== "http:") {
    return NextResponse.json({ error: "Bad destination" }, { status: 400 });
  }

  // The signature covers the destination, so this cannot be repointed.
  if (!verifyTracking(messageId, signature, target)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  try {
    await db.messageEvent.create({
      data: {
        messageId,
        type: "CLICKED",
        url: target,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
    });
  } catch {
    // Never hold up the redirect for a logging failure.
  }

  return NextResponse.redirect(destination.toString(), 302);
}
