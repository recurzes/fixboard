import { Link } from "react-router";
import { formatDateTime } from "../../../shared/lib/dates";
import { usePublicConfig } from "../../tenant-form/usePublicConfig";
import { RequestBadges } from "./RequestBadges";
import type { RequestRow } from "./useRequests";

const HEADINGS = [
  "Reference",
  "Property and unit",
  "Category",
  "Status",
  "Assignee",
  "Created",
];
const CELL = "px-3 py-3 align-top break-words";
// With no notifications, this bar is how staff notice new work, so it has to survive grayscale.
const accentBar = (request: RequestRow) =>
  `border-l-8 ${request.status === "new" ? "border-l-blue-900" : "border-l-transparent"}`;
const weight = (request: RequestRow) =>
  request.status === "new" ? "font-bold" : "";
const place = (request: RequestRow) =>
  `${request.property_name} · ${request.unit_label}`;
const assignee = (request: RequestRow) => request.assignee_name ?? "Unassigned";

/** Both layouts stay in the page and CSS shows one, so each row's data has one source. */
export function RequestRows({ rows }: { rows: RequestRow[] }) {
  const config = usePublicConfig();
  // The label comes from the config, and a retired category still has its id to show.
  const categoryLabel = (id: string) =>
    config.data?.categories.find((category) => category.id === id)?.label ?? id;

  return (
    <>
      <table className="hidden w-full md:table">
        <thead>
          <tr className="border-b-2 border-gray-400 text-left">
            {HEADINGS.map((heading, index) => (
              <th
                key={heading}
                scope="col"
                className={`px-3 py-2 font-semibold ${index === 0 ? "border-l-8 border-l-transparent" : ""}`}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((request) => (
            <tr
              key={request.id}
              className={`relative border-b border-gray-300 hover:bg-gray-100 ${weight(request)}`}
            >
              <td className={`${CELL} whitespace-nowrap ${accentBar(request)}`}>
                {/* The link stretches over the row, so it is one tab stop and opens in a new tab. */}
                <Link
                  to={`/staff/requests/${request.id}`}
                  className="text-blue-800 underline outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-blue-700"
                >
                  {request.reference_number}
                </Link>
              </td>
              <td className={CELL}>{place(request)}</td>
              <td className={CELL}>{categoryLabel(request.category)}</td>
              <td className={CELL}>
                <RequestBadges request={request} />
              </td>
              <td className={CELL}>{assignee(request)}</td>
              <td className={CELL}>{formatDateTime(request.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="space-y-2 md:hidden">
        {rows.map((request) => (
          <li key={request.id}>
            <Link
              to={`/staff/requests/${request.id}`}
              className={`block space-y-1 rounded-lg border border-gray-400 p-3 break-words hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${request.status === "new" ? accentBar(request) : ""} ${weight(request)}`}
            >
              <span className="block text-blue-800 underline">
                {request.reference_number}
              </span>
              <RequestBadges request={request} />
              <span className="block">{place(request)}</span>
              <span className="block">{categoryLabel(request.category)}</span>
              <span className="block">{assignee(request)}</span>
              <span className="block text-gray-700">
                {formatDateTime(request.created_at)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
