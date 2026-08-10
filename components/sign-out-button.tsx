import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export function SignOutButton({
  className,
}: {
  className?: string;
}) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <Button type="submit" variant="secondary" size="sm" className={className}>
        Sign out
      </Button>
    </form>
  );
}
