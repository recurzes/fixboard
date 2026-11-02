import { NavLink, Outlet } from "react-router";
import { Button } from "../../shared/ui/Button";
import { useAuth } from "./auth/AuthProvider";

const LINKS = [
  { to: "/staff", label: "Requests", end: true },
  { to: "/staff/requests/new", label: "Log request" },
  { to: "/staff/vendors", label: "Vendors" },
];

export function StaffLayout({ name }: { name: string }) {
  const { signOut } = useAuth();
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
                className="flex min-h-11 items-center border-b-2 border-transparent px-2 font-medium text-gray-700 hover:text-black focus-visible:outline-2 focus-visible:outline-blue-700 aria-[current=page]:border-blue-700 aria-[current=page]:text-black"
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">
        <Outlet />
      </main>
    </>
  );
}
