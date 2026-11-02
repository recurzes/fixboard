import { vi } from "vitest";

/** jsdom has no image decoding, canvas, or object URLs, so these stand in for the browser's. */
export function fakeImageApis({
  width = 4000,
  height = 3000,
  decode = () => Promise.resolve(),
}: {
  width?: number;
  height?: number;
  decode?: () => Promise<void>;
} = {}) {
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      naturalWidth = width;
      naturalHeight = height;
      decode = decode;
    },
  );
  const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as ImageBitmapRenderingContext,
  );
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation((callback, type) =>
      callback(new Blob(["shrunk"], { type })),
    );

  let count = 0;
  const created: string[] = [];
  const revoked: string[] = [];
  URL.createObjectURL = () => {
    created.push(`blob:${++count}`);
    return created.at(-1)!;
  };
  URL.revokeObjectURL = (url) => void revoked.push(url);
  return { context, toBlob, created, revoked };
}

/** A real file reporting any size, so a test needn't allocate megabytes. */
export function photo(name: string, type = "image/jpeg", size = 1000) {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}
