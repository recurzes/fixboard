import { useEffect } from "react";
import type { ReactNode } from "react";
import {
  Link,
  useBlocker,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { formatDateTime } from "../../../shared/lib/dates";
import { formatPhone } from "../../../shared/lib/phone";
import { useLeaveWarning } from "../../../shared/lib/useLeaveWarning";
import { Button } from "../../../shared/ui/Button";
import { Alert, EmptyState, Spinner } from "../../../shared/ui/Feedback";
import { Toast, useToast } from "../../../shared/ui/Toast";
import { ENTRY_OPTIONS } from "../../../shared/form/DetailsFields";
import { usePublicConfig } from "../../../shared/form/usePublicConfig";
import type { PublicConfig } from "../../../shared/form/usePublicConfig";
import { RequestBadges } from "./RequestBadges";
import { RequestChanges, useRequestChanges } from "./RequestChanges";
import { RequestNotes } from "./RequestNotes";
import { RequestPhotos } from "./RequestPhotos";
import { isNotFound, SOURCE_LABELS, useRequest } from "./useRequest";
import type { RequestDetail } from "./useRequest";

const LINK =
  "inline-flex min-h-11 items-center text-blue-800 underline focus-visible:outline-2 focus-visible:outline-blue-700";

/** The list puts its filters in history state, so Back lands on the same list. A new tab has none. */
function BackLink() {
  const state = useLocation().state as { listSearch?: unknown } | null;
  const search = typeof state?.listSearch === "string" ? state.listSearch : "";
  return (
    <Link to={`/staff${search}`} className={LINK}>
      ← Back to list
    </Link>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-300 p-4">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="space-y-3">
      {items.map(([term, value], index) => (
        <div key={index}>
          <dt className="text-sm text-gray-700">{term}</dt>
          <dd className="break-words whitespace-pre-wrap">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Tenant({ request }: { request: RequestDetail }) {
  // Only one of phone and email is required, so either can be missing.
  return (
    <Section title="Tenant">
      <Facts
        items={[
          [
            "Property and unit",
            `${request.property_name} · ${request.unit_label}`,
          ],
          ["Name", request.tenant_name],
          [
            "Phone",
            request.phone ? (
              <a href={`tel:${request.phone}`} className={LINK}>
                {formatPhone(request.phone)}
              </a>
            ) : (
              "Not given"
            ),
          ],
          [
            "Email",
            request.email ? (
              <a href={`mailto:${request.email}`} className={LINK}>
                {request.email}
              </a>
            ) : (
              "Not given"
            ),
          ],
          ["Created", formatDateTime(request.created_at)],
          ["Source", SOURCE_LABELS[request.source]],
        ]}
      />
    </Section>
  );
}

function Issue({
  request,
  config,
}: {
  request: RequestDetail;
  config: PublicConfig | undefined;
}) {
  // Config can change after a request is made, so a retired category, question, option, or self-check shows its raw id.
  const category = config?.categories.find(({ id }) => id === request.category);
  const questions = category?.questions ?? [];
  const rank = (id: string) => {
    const index = questions.findIndex((question) => question.id === id);
    return index === -1 ? questions.length : index;
  };
  // Postgres reorders the keys, so the answers go back into the order the tenant saw.
  const answers = Object.entries(request.followup_answers)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([id, value]): [string, ReactNode] => {
      const question = questions.find((candidate) => candidate.id === id);
      const option = question?.options.find((o) => o.value === value);
      return [question?.label ?? id, option?.label ?? value];
    });
  // A staff-logged request records a self-check from its answers, but nobody was shown it.
  const selfCheck =
    request.source === "tenant_form" &&
    request.self_check_shown &&
    (config?.categories
      .flatMap(({ questions }) => questions)
      .flatMap(({ options }) => options)
      .find(({ self_check }) => self_check?.id === request.self_check_shown)
      ?.self_check?.text ??
      request.self_check_shown);

  return (
    <Section title="Issue">
      <Facts
        items={[
          ["Category", category?.label ?? request.category],
          ["Description", request.description],
          ...answers,
          ...(request.source === "tenant_form"
            ? [
                ["Self-check suggested", selfCheck || "None"] as [
                  string,
                  ReactNode,
                ],
              ]
            : []),
          ...(selfCheck
            ? [
                [
                  "Tenant tried it",
                  request.self_check_tried ? "Yes" : "No",
                ] as [string, ReactNode],
              ]
            : []),
        ]}
      />
    </Section>
  );
}

/** Entry details reveal when a unit is empty, so they are staff-only. "Only if I'm home" must not be missed. */
function Entry({ request }: { request: RequestDetail }) {
  const homeOnly = request.entry_permission === "only_when_home";
  const label =
    ENTRY_OPTIONS.find(({ value }) => value === request.entry_permission)
      ?.label ?? request.entry_permission;
  return (
    <section
      className={`rounded-lg border-l-8 p-4 ${homeOnly ? "border-red-700 bg-red-50" : "border-amber-600 bg-amber-50"}`}
    >
      <h2 className="text-lg font-semibold">Entry permission</h2>
      <p className={homeOnly ? "text-2xl font-bold" : "text-xl font-semibold"}>
        {label}
      </p>
      {homeOnly && (
        <p className="font-semibold">
          Do not enter unless the tenant is there.
        </p>
      )}
      <h3 className="mt-3 text-sm text-gray-700">Entry notes</h3>
      <p className="break-words whitespace-pre-wrap">
        {request.entry_notes ?? "None"}
      </p>
    </section>
  );
}

/** In-app links ask first. A refresh or close gets the browser's own prompt. */
function useUnsavedGuard(dirty: boolean) {
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("You have unsaved changes. Leave without saving?")) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);
  useLeaveWarning(dirty);
}

function Detail({ id, request }: { id: string; request: RequestDetail }) {
  const config = usePublicConfig().data;
  const [toast, showToast] = useToast();
  const changes = useRequestChanges(id, request, showToast);
  useUnsavedGuard(changes.dirty);
  const { pathname, state } = useLocation();
  const navigate = useNavigate();
  const logged = (state as { logged?: unknown } | null)?.logged === true;
  useEffect(() => {
    if (!logged) return;
    showToast("Request logged");
    // Router state survives a refresh, which would show the toast again.
    void navigate(pathname, { replace: true, state: null });
  }, [logged, pathname, navigate, showToast]);
  const reviewing =
    changes.save.isPending && "needs_review" in changes.save.variables;
  return (
    <div className="space-y-4">
      <div>
        <BackLink />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold">{request.reference_number}</h1>
          <RequestBadges request={request} />
        </div>
      </div>
      {request.urgent && (
        <Alert variant="error" word="Urgent">
          This request is flagged urgent. Handle it before routine work.
        </Alert>
      )}
      {/* needs_review, not contact_matched: a request staff took from the tenant directly is unmatched but not flagged. */}
      {request.needs_review && (
        <Alert variant="warning" word="Needs review">
          The phone and email on this request don't match any current resident
          of this unit, or the unit has no residents on file. It could be a new
          tenant, a guest, or someone who doesn't live there. The request was
          still accepted, so check who sent it before acting on it.
          <div className="mt-2">
            <Button
              loading={reviewing}
              disabled={changes.save.isPending}
              onClick={() => changes.save.mutate({ needs_review: false })}
            >
              Mark as reviewed
            </Button>
          </div>
        </Alert>
      )}
      <RequestChanges changes={changes} />
      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <div className="space-y-4">
          <Tenant request={request} />
          <Entry request={request} />
        </div>
        <div className="space-y-4">
          <Issue request={request} config={config} />
          <Section title="Photos">
            <RequestPhotos
              requestId={request.id}
              photoIds={request.photo_ids}
            />
          </Section>
          <Section title="Notes">
            <RequestNotes id={id} notes={request.notes} showToast={showToast} />
          </Section>
        </div>
      </div>
      <Toast toast={toast} />
    </div>
  );
}

export function RequestDetailPage() {
  const { id } = useParams();
  const request = useRequest(id!);

  if (request.data) return <Detail id={id!} request={request.data} />;
  return (
    <div className="space-y-4">
      <BackLink />
      {!request.isError ? (
        <Spinner label="Loading request" />
      ) : isNotFound(request.error) ? (
        <EmptyState title="Request not found">
          Check the link, or find the request in the list.
        </EmptyState>
      ) : (
        <div className="space-y-2">
          <Alert variant="error">We can't load this request right now.</Alert>
          <Button
            loading={request.isFetching}
            onClick={() => void request.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
