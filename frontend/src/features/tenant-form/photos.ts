import { useEffect, useRef, useState } from "react";
import { siteConfig } from "../../shared/lib/siteConfig";

const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.8;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif"];
// Some browsers report an empty type for HEIC.
const ACCEPTED_NAME = /\.(jpe?g|png|hei[cf])$/i;

// Not lastModified, because iOS gives a photo a new one each time it's picked.
const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size;

/** Size isn't checked here, because a large phone photo shrinks to well under the limit. */
export function checkPhotos(files: File[], chosen: File[]) {
  const accepted: File[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    const seen = [...chosen, ...accepted];
    const knownType =
      ACCEPTED_TYPES.includes(file.type) ||
      (!file.type && ACCEPTED_NAME.test(file.name));
    if (!knownType) {
      rejected.push(`${file.name}: Please choose a JPG, PNG, or HEIC photo`);
    } else if (seen.some((other) => sameFile(other, file))) {
      rejected.push(`${file.name}: You already added this photo`);
    } else if (seen.length >= siteConfig.maxPhotos) {
      rejected.push(
        `${file.name}: You can add up to ${siteConfig.maxPhotos} photos`,
      );
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}

export function fitWithin(width: number, height: number) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function shrinkPhoto(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    // Rejects when the browser can't read the format, as Chrome does with HEIC.
    await image.decode();
    // Browsers apply the EXIF rotation to both naturalWidth and drawImage.
    const { width, height } = fitWithin(
      image.naturalWidth,
      image.naturalHeight,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    // JPEG has no transparency, so a clear PNG background would turn black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    const name = `${file.name.replace(/\.\w+$/, "")}.jpg`;
    return blob && new File([blob], name, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The file to upload: shrunk if the browser can read it, or else the original. Null if neither fits the limit. */
export async function preparePhoto(file: File) {
  const ready = (await shrinkPhoto(file).catch(() => null)) ?? file;
  return ready.size <= siteConfig.maxPhotoBytes ? ready : null;
}

export type Photo = {
  id: number;
  source: File;
  // Null while preparing.
  file: File | null;
  // Null while preparing, and when the browser can't show the photo.
  preview: string | null;
};

// Lives in TenantForm, not the step, so photos and their URLs survive moving between steps.
export function usePhotos() {
  const [items, setItems] = useState<Photo[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const nextId = useRef(0);
  // One entry per listed photo, so work finishing after a remove or unmount is dropped.
  const previews = useRef(new Map<number, string | null>());

  useEffect(() => {
    const live = previews.current;
    return () => {
      live.forEach((url) => url && URL.revokeObjectURL(url));
      live.clear();
    };
  }, []);

  async function add(files: File[]) {
    const { accepted, rejected: refused } = checkPhotos(
      files,
      items.map(({ source }) => source),
    );
    setRejected(refused);
    const added = accepted.map((source) => ({
      id: nextId.current++,
      source,
      file: null,
      preview: null,
    }));
    added.forEach(({ id }) => previews.current.set(id, null));
    setItems((list) => [...list, ...added]);

    // One at a time, because decoding several large photos at once can run a phone out of memory.
    for (const { id, source } of added) {
      if (!previews.current.has(id)) continue;
      const file = await preparePhoto(source);
      if (!previews.current.has(id)) continue;
      if (!file) {
        previews.current.delete(id);
        setItems((list) => list.filter((item) => item.id !== id));
        setRejected((list) => [
          ...list,
          `${source.name}: Please choose a JPG or PNG`,
        ]);
        continue;
      }
      const preview = file === source ? null : URL.createObjectURL(file);
      previews.current.set(id, preview);
      setItems((list) =>
        list.map((item) =>
          item.id === id ? { ...item, file, preview } : item,
        ),
      );
    }
  }

  function remove(id: number) {
    const preview = previews.current.get(id);
    if (preview) URL.revokeObjectURL(preview);
    previews.current.delete(id);
    setItems((list) => list.filter((item) => item.id !== id));
    setRejected([]);
  }

  return {
    items,
    rejected,
    preparing: items.some(({ file }) => !file),
    add,
    remove,
  };
}
