import type { ReactNode } from "react";
import type { RouteObject } from "react-router";
import { ErrorScreen } from "../shared/ui/ErrorScreen";
import { DemoCrash, UiDemo } from "./UiDemo";

function Placeholder({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-lg p-4">
      <h1 className="mb-4 text-2xl font-bold">{title}</h1>
      {children}
    </main>
  );
}

export const routes: RouteObject[] = [
  {
    // The router catches render errors itself, so its boundary is the one that shows.
    errorElement: <ErrorScreen />,
    children: [
      {
        path: "/",
        element: (
          <Placeholder title="Tenant form">
            <button
              type="button"
              className="min-h-11 w-full rounded-lg bg-blue-700 px-4 font-semibold text-white"
            >
              Test button
            </button>
          </Placeholder>
        ),
      },
      { path: "/done", element: <Placeholder title="Request received" /> },
      { path: "/staff/login", element: <Placeholder title="Staff sign in" /> },
      { path: "/staff/*", element: <Placeholder title="Staff dashboard" /> },
      { path: "*", element: <Placeholder title="Page not found" /> },
      // Vite removes these from production builds.
      ...(import.meta.env.DEV
        ? [
            { path: "/dev/ui", element: <UiDemo /> },
            { path: "/dev/crash", element: <DemoCrash /> },
          ]
        : []),
    ],
  },
];
