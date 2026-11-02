import { useRef } from "react";
import { siteConfig } from "../../shared/lib/siteConfig";
import { Button } from "../../shared/ui/Button";
import { Alert } from "../../shared/ui/Feedback";
import type { usePhotos } from "./photos";

export function PhotoPicker({
  photos: { items, rejected, preparing, add, remove },
}: {
  photos: ReturnType<typeof usePhotos>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  return (
    <div>
      <p className="mb-1 font-medium">Photos (optional)</p>
      <p className="mb-1 text-sm text-gray-700">JPG, PNG, or HEIC.</p>
      {/* No capture attribute, because it forces the camera and hides the photo library. */}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          void add([...(event.target.files ?? [])]);
          // Or picking the same photo again after removing it fires no change.
          event.target.value = "";
        }}
      />
      <Button ref={addButton} onClick={() => input.current?.click()}>
        Add photos
      </Button>
      <p role="status" className="mt-1 text-sm text-gray-700">
        {items.length} of {siteConfig.maxPhotos}
        {preparing && ". Preparing photos"}
      </p>
      {rejected.length > 0 && (
        <div className="mt-2">
          <Alert variant="error">
            <ul>
              {rejected.map((message, index) => (
                <li key={index} className="wrap-anywhere">
                  {message}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
      {items.length > 0 && (
        <ul className="mt-2 space-y-2">
          {items.map(({ id, source, file, preview }, index) => (
            <li key={id} className="flex items-center gap-3">
              {preview ? (
                <img
                  src={preview}
                  alt=""
                  className="size-16 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-gray-200 text-center text-xs text-gray-700">
                  {file ? "No preview" : "Preparing"}
                </div>
              )}
              <span className="min-w-0 flex-1 wrap-anywhere">
                {source.name}
              </span>
              {/* The number tells photos apart, because iOS can name them all image.jpg. */}
              <Button
                aria-label={`Remove photo ${index + 1}, ${source.name}`}
                onClick={() => {
                  remove(id);
                  // The button that had focus is gone, so keep keyboard users in place.
                  addButton.current?.focus();
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
