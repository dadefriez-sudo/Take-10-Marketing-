import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { Button } from "@/components/ui/button";
import { MagicConsumer } from "./magic-consumer";

export const metadata = { title: "Signing you in" };

/**
 * The link target. The token is exchanged for a session by a client-side
 * submit rather than during render, because consuming it is a state change and
 * must not happen on a prefetch or a bot's link preview.
 */
export default async function MagicLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>That link is incomplete</CardTitle>
          <CardDescription>
            The sign-in link is missing its token. Request a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <MagicConsumer token={token} />;
}
