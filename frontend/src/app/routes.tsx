import type { RouteObject } from "react-router";
import { AuthProvider } from "../features/staff/auth/AuthProvider";
import { LoginPage } from "../features/staff/auth/LoginPage";
import {
  ForgotPasswordPage,
  ResetPasswordPage,
} from "../features/staff/auth/PasswordPages";
import { RequireStaff } from "../features/staff/auth/RequireStaff";
import { RequestListPage } from "../features/staff/requests/RequestListPage";
import { ConfirmationPage } from "../features/tenant-form/ConfirmationPage";
import { TenantFormPage } from "../features/tenant-form/TenantFormPage";
import { ErrorScreen } from "../shared/ui/ErrorScreen";
import { DemoCrash, UiDemo } from "./UiDemo";

const StaffPlaceholder = ({ title }: { title: string }) => (
  <h1 className="text-2xl font-bold">{title}</h1>
);

function Placeholder({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-lg p-4">
      <h1 className="mb-4 text-2xl font-bold">{title}</h1>
    </main>
  );
}

export const routes: RouteObject[] = [
  {
    // The router catches render errors itself, so its boundary is the one that shows.
    errorElement: <ErrorScreen />,
    children: [
      { path: "/", element: <TenantFormPage /> },
      { path: "/done", element: <ConfirmationPage /> },
      {
        element: <AuthProvider />,
        children: [
          { path: "/staff/login", element: <LoginPage /> },
          { path: "/staff/forgot-password", element: <ForgotPasswordPage /> },
          { path: "/staff/reset-password", element: <ResetPasswordPage /> },
          {
            path: "/staff",
            element: <RequireStaff />,
            children: [
              { index: true, element: <RequestListPage /> },
              {
                path: "requests/new",
                element: <StaffPlaceholder title="Log request" />,
              },
              {
                path: "vendors",
                element: <StaffPlaceholder title="Vendors" />,
              },
              {
                path: "*",
                element: <StaffPlaceholder title="Staff dashboard" />,
              },
            ],
          },
        ],
      },
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
