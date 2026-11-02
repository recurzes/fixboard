import { createContext, useContext, useEffect, useState } from "react";
import { Outlet, useMatches } from "react-router";

/** What a route puts in `handle`. The deepest route with a title names the tab. */
export type RouteHandle = { title?: string };

const SetPrefix = createContext<(prefix: string) => void>(() => {});

/** The root route's element. It alone writes the tab title, so a prefix and a page title never race. */
export function TitledOutlet() {
  const [prefix, setPrefix] = useState("");
  const title = useMatches()
    .map(({ handle }) => (handle as RouteHandle | undefined)?.title)
    .filter(Boolean)
    .at(-1);
  useEffect(() => {
    document.title = `${prefix}${title ? `${title} – ` : ""}Fixboard`;
  }, [prefix, title]);
  return (
    <SetPrefix value={setPrefix}>
      <Outlet />
    </SetPrefix>
  );
}

/** Puts something like "(3) " in front of the tab title while the caller is on the page. */
export function useTitlePrefix(prefix: string) {
  const setPrefix = useContext(SetPrefix);
  useEffect(() => {
    setPrefix(prefix);
    return () => setPrefix("");
  }, [setPrefix, prefix]);
}
