import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, useLocation } from "react-router";
import { ApiError, apiFetch } from "../../../shared/api/client";
import { Button } from "../../../shared/ui/Button";
import { Alert, Spinner } from "../../../shared/ui/Feedback";
import { StaffLayout } from "../StaffLayout";
import { useAuth } from "./AuthProvider";

const PageSpinner = () => (
  <div className="flex min-h-dvh items-center justify-center">
    <Spinner />
  </div>
);

/** Every staff page sits under this: no session goes to login, and no staff row is refused. */
export function RequireStaff() {
  const { session, loading, signOut } = useAuth();
  const location = useLocation();
  const me = useQuery({
    queryKey: ["staff", "me"],
    queryFn: () => apiFetch<{ name: string; email: string }>("/api/staff/me"),
    enabled: !!session,
  });
  const refused = me.error instanceof ApiError && me.error.status === 403;

  useEffect(() => {
    if (refused) void signOut("This account isn't set up for staff");
  }, [refused, signOut]);

  if (loading) return <PageSpinner />;
  if (!session) {
    return <Navigate to="/staff/login" state={{ from: location }} replace />;
  }
  if (refused) return <PageSpinner />;
  // Checked before the error, so a failed background refetch doesn't replace a page with work on it.
  if (me.data) return <StaffLayout name={me.data.name} />;
  if (me.error) {
    return (
      <main className="mx-auto max-w-sm space-y-4 p-4">
        <Alert variant="error">
          We can't reach the server right now. You're still signed in.
        </Alert>
        <Button loading={me.isFetching} onClick={() => void me.refetch()}>
          Try again
        </Button>
      </main>
    );
  }
  return <PageSpinner />;
}
