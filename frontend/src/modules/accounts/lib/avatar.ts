import { buildUrl } from "@/infrastructure/api-client";
import type { Account } from "../types";

/** Size of the square the picture is cropped and scaled to before upload, in pixels. */
export const AVATAR_SIZE = 96;
/** Largest file the server accepts (MAX_AVATAR_BYTES in the backend). */
export const MAX_AVATAR_BYTES = 128 * 1024;
export const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";

/** URL of the mailbox picture, versioned so a changed picture is never served from cache. */
export function accountAvatarUrl(account: Pick<Account, "id" | "avatar_updated_at">): string | null {
  if (!account.avatar_updated_at) return null;
  return buildUrl(`/accounts/${encodeURIComponent(account.id)}/avatar`, {
    v: String(Date.parse(account.avatar_updated_at) || account.avatar_updated_at),
  });
}

/**
 * Average colour of the opaque pixels of RGBA data, as `#rrggbb`; `null` when nothing is opaque.
 * Used to suggest an account colour that matches a newly chosen picture.
 */
export function averageColor(data: Uint8ClampedArray): string | null {
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  for (let index = 0; index + 3 < data.length; index += 4) {
    const alpha = (data[index + 3] ?? 0) / 255;
    if (alpha < 0.5) continue;
    red += (data[index] ?? 0) * alpha;
    green += (data[index + 1] ?? 0) * alpha;
    blue += (data[index + 2] ?? 0) * alpha;
    weight += alpha;
  }
  if (weight === 0) return null;
  const hex = (sum: number) => Math.round(sum / weight).toString(16).padStart(2, "0");
  return `#${hex(red)}${hex(green)}${hex(blue)}`;
}

export interface PreparedAvatar {
  blob: Blob;
  /** Object URL of `blob` for previewing; revoke it when it is no longer shown. */
  previewUrl: string;
  color: string | null;
}

export class AvatarImageError extends Error {
  constructor(readonly reason: "unsupported" | "tooLarge") {
    super(reason);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Crops the chosen image to a centred square and scales it to AVATAR_SIZE. Re-encoding in the
 * browser keeps uploads tiny and drops whatever metadata (location, camera) the file carried.
 */
export async function prepareAvatar(file: File): Promise<PreparedAvatar> {
  if (!AVATAR_ACCEPT.split(",").includes(file.type)) throw new AvatarImageError("unsupported");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AvatarImageError("unsupported");
  }
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new AvatarImageError("unsupported");
  const side = Math.min(bitmap.width, bitmap.height);
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();
  const color = averageColor(context.getImageData(0, 0, AVATAR_SIZE, AVATAR_SIZE).data);
  // Browsers that cannot encode WebP hand back a PNG instead, which the server accepts too.
  const blob = (await canvasBlob(canvas, "image/webp", 0.9)) ?? (await canvasBlob(canvas, "image/png"));
  if (!blob) throw new AvatarImageError("unsupported");
  if (blob.size > MAX_AVATAR_BYTES) throw new AvatarImageError("tooLarge");
  return { blob, previewUrl: URL.createObjectURL(blob), color };
}
