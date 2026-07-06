"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Sidebar footer: the Clerk account entry point (docs/specs/05 → sidebar
 * footer). */
export function UserFooter() {
  const { user } = useUser();
  return (
    <div className="flex items-center gap-2 border-t border-sidebar-border px-3 py-2.5">
      <UserButton appearance={{ elements: { avatarBox: "size-7" } }} />
      <div className="flex-1 leading-tight">
        <div className="truncate text-xs font-medium">
          {user?.fullName ?? user?.username ?? "Account"}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {user?.primaryEmailAddress?.emailAddress ?? "Signed in"}
        </div>
      </div>
      <ThemeToggle />
    </div>
  );
}
