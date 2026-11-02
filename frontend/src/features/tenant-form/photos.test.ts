import { afterEach, expect, it, vi } from "vitest";
import { siteConfig } from "../../shared/lib/siteConfig";
import { checkPhotos, fitWithin, preparePhoto } from "./photos";
import { fakeImageApis, photo } from "./photos.testutil";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const TOO_BIG = siteConfig.maxPhotoBytes + 1;

it.each([
  ["a.jpg", "image/jpeg"],
  ["a.png", "image/png"],
  ["a.heic", "image/heic"],
  ["a.heif", "image/heif"],
  ["a.HEIC", ""],
])("accepts %s reported as %j", (name, type) => {
  const file = photo(name, type);
  expect(checkPhotos([file], [])).toEqual({ accepted: [file], rejected: [] });
});

it.each([
  ["clip.mp4", "video/mp4"],
  ["a.gif", "image/gif"],
  ["a.webp", "image/webp"],
  ["notes.txt", ""],
  // The stated type wins when there is one.
  ["clip.jpg", "video/mp4"],
])("refuses %s reported as %j", (name, type) => {
  const { accepted, rejected } = checkPhotos([photo(name, type)], []);
  expect(accepted).toEqual([]);
  expect(rejected).toEqual([
    `${name}: Please choose a JPG, PNG, or HEIC photo`,
  ]);
});

it("refuses a duplicate of a chosen photo and within one pick", () => {
  const chosen = photo("a.jpg");
  const b = photo("b.jpg");
  const { accepted, rejected } = checkPhotos(
    [photo("a.jpg"), b, photo("b.jpg")],
    [chosen],
  );
  expect(accepted).toEqual([b]);
  expect(rejected).toEqual([
    "a.jpg: You already added this photo",
    "b.jpg: You already added this photo",
  ]);
});

it("treats the same name at another size as a different photo", () => {
  const other = photo("image.jpg", "image/jpeg", 2000);
  const { accepted } = checkPhotos([other], [photo("image.jpg")]);
  expect(accepted).toEqual([other]);
});

it("keeps the first photos that fit and gives each extra one a message", () => {
  const chosen = ["1", "2", "3", "4"].map((n) => photo(`${n}.jpg`));
  const fifth = photo("5.jpg");
  const { accepted, rejected } = checkPhotos(
    [fifth, photo("6.jpg"), photo("7.jpg")],
    chosen,
  );
  expect(accepted).toEqual([fifth]);
  expect(rejected).toEqual([
    "6.jpg: You can add up to 5 photos",
    "7.jpg: You can add up to 5 photos",
  ]);
});

it("does not refuse a large photo before trying to shrink it", () => {
  const large = photo("a.jpg", "image/jpeg", TOO_BIG);
  expect(checkPhotos([large], []).accepted).toEqual([large]);
});

it.each([
  [4000, 3000, 1600, 1200],
  [3000, 4000, 1200, 1600],
  [1600, 1600, 1600, 1600],
  [1601, 800, 1600, 800],
  // Never enlarged.
  [800, 600, 800, 600],
  // A sliver still has to be a drawable canvas.
  [10000, 3, 1600, 1],
])("fits %ix%i into %ix%i", (width, height, fitWidth, fitHeight) => {
  expect(fitWithin(width, height)).toEqual({
    width: fitWidth,
    height: fitHeight,
  });
});

it("shrinks a readable photo to a JPEG at 80%, on white, even if it started too big", async () => {
  const { context, toBlob, created, revoked } = fakeImageApis();
  const source = photo("IMG_1.large.png", "image/png", TOO_BIG);

  const ready = await preparePhoto(source);

  expect(ready?.name).toBe("IMG_1.large.jpg");
  expect(ready?.type).toBe("image/jpeg");
  expect(ready!.size).toBeLessThan(TOO_BIG);
  expect(toBlob.mock.calls[0].slice(1)).toEqual(["image/jpeg", 0.8]);
  expect(context.fillStyle).toBe("#fff");
  expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1600, 1200);
  expect(context.drawImage).toHaveBeenCalledWith(
    expect.anything(),
    0,
    0,
    1600,
    1200,
  );
  // The URL used for decoding doesn't outlive it.
  expect(revoked).toEqual(created);
});

it("sizes a rotated photo from its upright dimensions", async () => {
  const { context } = fakeImageApis({ width: 3000, height: 4000 });
  await preparePhoto(photo("a.jpg"));
  expect(context.drawImage.mock.calls[0].slice(3)).toEqual([1200, 1600]);
});

it("sends the original when the browser can't read it and it fits the limit", async () => {
  const { created, revoked } = fakeImageApis({
    decode: () => Promise.reject(new Error("cannot decode")),
  });
  const source = photo("a.heic", "image/heic", siteConfig.maxPhotoBytes);

  expect(await preparePhoto(source)).toBe(source);
  expect(revoked).toEqual(created);
});

it("gives up when the browser can't read it and it is over the limit", async () => {
  fakeImageApis({ decode: () => Promise.reject(new Error("cannot decode")) });
  expect(await preparePhoto(photo("a.heic", "image/heic", TOO_BIG))).toBeNull();
});

it("sends the original when the canvas produces nothing", async () => {
  const { toBlob } = fakeImageApis();
  toBlob.mockImplementation((callback) => callback(null));
  const source = photo("a.jpg");
  expect(await preparePhoto(source)).toBe(source);
});
