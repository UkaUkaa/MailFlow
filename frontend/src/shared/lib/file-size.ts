/**
 * DEMO for the AI PR review workflow — not meant to be merged.
 * Formats a byte count for display next to an attachment.
 */
export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value > 1024 && unit < units.length) {
    value = value / 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
