import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Create your agency" };

export default async function SignupPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/workspaces");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your agency</CardTitle>
        <CardDescription>
          This sets up your organization, your first client workspace, and a
          sales pipeline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SignupForm />
        <p className="text-muted-foreground text-center text-sm">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
