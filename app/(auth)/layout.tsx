import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-12">
      <Link href="/" className="flex items-center gap-2">
        <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg text-sm font-bold">
          10
        </span>
        <span className="text-lg font-semibold tracking-tight">
          Take 10 Marketing
        </span>
      </Link>
      <div className="w-full max-w-md">{children}</div>
      <p className="text-muted-foreground max-w-md text-center text-xs">
        Booking, reviews, and after-hours capture for local businesses — run
        from one place.
      </p>
    </div>
  );
}
