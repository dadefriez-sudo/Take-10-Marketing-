import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id) redirect("/workspaces");

  const { next } = await searchParams;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Welcome back. Use your password, or have a one-time link emailed to
          you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <LoginForm next={next} />
        <p className="text-muted-foreground text-center text-sm">
          No account yet?{" "}
          <Link href="/signup" className="text-primary hover:underline">
            Create your agency
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
