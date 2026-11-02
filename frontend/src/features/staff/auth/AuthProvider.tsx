import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Outlet } from "react-router";
import * as auth from "../../../shared/lib/auth";

type Auth = {
  /** The access token, or null when signed out. */
  session: string | null;
  /** True until the first check of the session cookie has finished. */
  loading: boolean;
  /** Why the last session ended, for the login page to show. */
  notice: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: (notice?: string) => Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth needs AuthProvider");
  return value;
}

/** A layout route around the staff pages, so tenant pages never call the sign-in service. */
export function AuthProvider() {
  const session = useSyncExternalStore(auth.subscribe, auth.getToken);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    // If Neon is down this shows the login page, and the cookie still works once it's back.
    auth
      .refreshToken()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Cached requests hold tenant details, so the next person on this computer must not see them.
  useEffect(() => {
    if (!session) queryClient.clear();
  }, [session, queryClient]);

  const signIn = useCallback(async (email: string, password: string) => {
    setNotice(null);
    await auth.signIn(email, password);
  }, []);

  const signOut = useCallback(async (reason?: string) => {
    setNotice(reason ?? null);
    await auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ session, loading, notice, signIn, signOut }),
    [session, loading, notice, signIn, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      <Outlet />
    </AuthContext.Provider>
  );
}
