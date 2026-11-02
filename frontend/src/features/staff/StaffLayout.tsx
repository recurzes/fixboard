import { useEffect } from "react";
import { NavLink, Outlet } from "react-router";
import { Button } from "../../shared/ui/Button";
import { Badge } from "../../shared/ui/Feedback";
import { useAuth } from "./auth/AuthProvider";
import { useSummary } from "./requests/useSummary";

const LINKS = [
  { to: "/staff", label: "Requests", end: true },
  { to: "/staff/requests/new", label: "Log request" },
  { to: "/staff/vendors", label: "Vendors" },
];

export function StaffLayout({ name }: { name: string }) {
  const { signOut } = useAuth();
  const summary = useSummary().data;
  const newCount = summary?.by_status.new ?? 0;

  useEffect(() => {
    document.title = newCount ? `(${newCount}) Fixboard` : "Fixboard";
    return () => {
      document.title = "Fixboard";
    };
  }, [newCount]);

  return (
    <>
      <header className="border-b border-gray-300">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex items-center justify-between gap-4 py-2">
            <span className="min-w-0 truncate font-medium">{name}</span>
            <Button className="shrink-0" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
          <nav aria-label="Staff" className="flex flex-wrap gap-x-1">
            {LINKS.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className="flex min-h-11 items-center gap-1.5 border-b-2 border-transparent px-2 font-medium text-gray-700 hover:text-black focus-visible:outline-2 focus-visible:outline-blue-700 aria-[current=page]:border-blue-700 aria-[current=page]:text-black"
              >
                {label}
                {to === "/staff" && newCount > 0 && (
                  <Badge tone="strong">
                    {newCount}
                    <span className="sr-only"> new</span>
                  </Badge>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">
        <Outlet context={summary} />
      </main>
    </>
  );
}
