import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "../../../shared/api/client";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";

function usePhotoUrl(requestId: number, photoId: number) {
  return useQuery({
    queryKey: ["staff", "photo", requestId, photoId],
    queryFn: () =>
      apiFetch<{ url: string }>(
        `/api/staff/requests/${requestId}/photos/${photoId}`,
      ),
    // A new link downloads the whole image again, so one is fetched only when the old one fails.
    staleTime: Infinity,
  });
}

/**
 * A skeleton until the image loads. Links expire after a few minutes, so a failed image fetches a
 * new link once, then offers Retry if that fails too.
 */
function SignedPhoto({
  requestId,
  photoId,
  label,
  contain = false,
  className,
  onOpen,
}: {
  requestId: number;
  photoId: number;
  label: string;
  contain?: boolean;
  className: string;
  onOpen?: () => void;
}) {
  const link = usePhotoUrl(requestId, photoId);
  // Every fetch gets a new version, so the image loads again even if the server sent the same link.
  const version = link.dataUpdatedAt;
  const [loadedVersion, setLoadedVersion] = useState<number>();
  const [failedVersion, setFailedVersion] = useState<number>();
  const [refetched, setRefetched] = useState(false);
  const loaded = loadedVersion === version;
  const failed =
    (link.isError && !link.isFetching) || failedVersion === version;

  const image = link.data && !failed && (
    <img
      key={version}
      src={link.data.url}
      alt={label}
      loading="lazy"
      referrerPolicy="no-referrer"
      onLoad={() => {
        setLoadedVersion(version);
        setRefetched(false);
      }}
      onError={() => {
        if (refetched) return setFailedVersion(version);
        setRefetched(true);
        void link.refetch();
      }}
      // Not hidden, because a lazy image that isn't displayed never loads.
      className={`size-full ${contain ? "object-contain" : "object-cover"} ${loaded ? "" : "opacity-0"}`}
    />
  );

  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-gray-100 ${className}`}
    >
      {onOpen && image ? (
        <button
          type="button"
          onClick={onOpen}
          className="size-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-700"
        >
          {image}
        </button>
      ) : (
        image
      )}
      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-2 text-center">
          <p>{label} didn't load.</p>
          <Button onClick={() => void link.refetch()}>Retry</Button>
        </div>
      ) : (
        !loaded && (
          <div
            role="status"
            className="pointer-events-none absolute inset-0 bg-gray-200 motion-safe:animate-pulse"
          >
            <span className="sr-only">Loading {label}</span>
          </div>
        )
      )}
    </div>
  );
}

export function RequestPhotos({
  requestId,
  photoIds,
}: {
  requestId: number;
  photoIds: number[];
}) {
  const [viewing, setViewing] = useState<number | null>(null);
  const count = photoIds.length;
  const label = (index: number) => `Photo ${index + 1} of ${count}`;
  // Wraps around, so Previous and Next never disable and drop keyboard focus.
  const step = (by: number) =>
    setViewing((index) =>
      index === null ? null : (index + by + count) % count,
    );

  if (!count) return <p className="text-gray-700">No photos.</p>;

  return (
    <>
      <ul className="grid grid-cols-3 gap-2">
        {photoIds.map((photoId, index) => (
          <li key={photoId}>
            <SignedPhoto
              requestId={requestId}
              photoId={photoId}
              label={label(index)}
              className="aspect-square"
              onOpen={() => setViewing(index)}
            />
          </li>
        ))}
      </ul>
      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title="Photos"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") step(-1);
          if (event.key === "ArrowRight") step(1);
        }}
      >
        {viewing !== null && (
          <>
            <SignedPhoto
              key={photoIds[viewing]}
              requestId={requestId}
              photoId={photoIds[viewing]}
              label={label(viewing)}
              contain
              className="h-[70dvh]"
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button onClick={() => step(-1)} disabled={count < 2}>
                Previous
              </Button>
              <p aria-live="polite">{label(viewing)}</p>
              <Button onClick={() => step(1)} disabled={count < 2}>
                Next
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
