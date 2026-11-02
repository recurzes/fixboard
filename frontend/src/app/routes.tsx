import type { RouteObject } from "react-router";
import { AuthProvider } from "../features/staff/auth/AuthProvider";
import { LoginPage } from "../features/staff/auth/LoginPage";
import {
  ForgotPasswordPage,
  ResetPasswordPage,
} from "../features/staff/auth/PasswordPages";
import { RequireStaff } from "../features/staff/auth/RequireStaff";
import { RequestDetailPage } from "../features/staff/requests/RequestDetailPage";
import { LogRequestPage } from "../features/staff/requests/LogRequestPage";
import { RequestListPage } from "../features/staff/requests/RequestListPage";
import { VendorsPage } from "../features/staff/vendors/VendorsPage";
import { ConfirmationPage } from "../features/tenant-form/ConfirmationPage";
import { TenantFormPage } from "../features/tenant-form/TenantFormPage";
import { TitledOutlet } from "../shared/lib/pageTitle";
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
    element: <TitledOutlet />,
    children: [
      {
        path: "/",
        element: <TenantFormPage />,
        handle: { title: "Report a problem" },
      },
      {
        path: "/done",
        element: <ConfirmationPage />,
        handle: { title: "Request sent" },
      },
      {
        element: <AuthProvider />,
        children: [
          {
            path: "/staff/login",
            element: <LoginPage />,
            handle: { title: "Staff sign in" },
          },
          {
            path: "/staff/forgot-password",
            element: <ForgotPasswordPage />,
            handle: { title: "Forgot password" },
          },
          {
            path: "/staff/reset-password",
            element: <ResetPasswordPage />,
            handle: { title: "Set your password" },
          },
          {
            path: "/staff",
            element: <RequireStaff />,
            children: [
              {
                index: true,
                element: <RequestListPage />,
                handle: { title: "Requests" },
              },
              {
                path: "requests/new",
                element: <LogRequestPage />,
                handle: { title: "Log request" },
              },
              {
                path: "requests/:id",
                element: <RequestDetailPage />,
                handle: { title: "Request" },
              },
              {
                path: "vendors",
                element: <VendorsPage />,
                handle: { title: "Vendors" },
              },
              {
                path: "*",
                element: <StaffPlaceholder title="Staff dashboard" />,
                handle: { title: "Staff dashboard" },
              },
            ],
          },
        ],
      },
      {
        path: "*",
        element: <Placeholder title="Page not found" />,
        handle: { title: "Page not found" },
      },
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
