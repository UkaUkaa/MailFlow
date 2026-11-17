import { Download, FileText, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { API_BASE } from "@/infrastructure/api-client";
import { cn } from "@/shared/lib/cn";
import { formatBytes } from "@/shared/utils/format";

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith("image/")) return <ImageIcon className="size-4" aria-hidden />;
  if (mimeType.startsWith("text/") || mimeType === "application/pdf") return <FileText className="size-4" aria-hidden />;
  return <Paperclip className="size-4" aria-hidden />;
}

interface ChipProps {
  filename: string;
  mimeType: string;
  size: number;
  /** Stored attachment: renders a download link through the authorized endpoint. */
  downloadId?: string;
  downloadLabel?: string;
  onRemove?: () => void;
  removeLabel?: string;
}

export function AttachmentChip({ filename, mimeType, size, downloadId, downloadLabel, onRemove, removeLabel }: ChipProps) {
  const body = (
    <>
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-muted text-foreground-muted">
        <FileIcon mimeType={mimeType} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium text-foreground">{filename}</span>
        <span className="text-xs text-foreground-subtle">{formatBytes(size)}</span>
      </span>
    </>
  );
  const shell = "flex min-h-12 w-full max-w-full min-w-0 items-center gap-2.5 rounded-md border border-border bg-surface-raised px-2 py-1.5 text-left sm:w-64";

  if (downloadId) {
    return (
      <a
        href={`${API_BASE}/attachments/${encodeURIComponent(downloadId)}/download`}
        download={filename}
        aria-label={downloadLabel ? `${downloadLabel}: ${filename}` : filename}
        className={cn(shell, "transition-colors hover:bg-muted")}
      >
        {body}
        <Download className="mr-1 size-4 shrink-0 text-foreground-subtle" aria-hidden />
      </a>
    );
  }
  return (
    <div className={shell}>
      {body}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ? `${removeLabel}: ${filename}` : filename}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-foreground-subtle hover:bg-muted hover:text-foreground touch:size-11"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export function AttachmentList({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <ul aria-label={label} className="flex min-w-0 flex-wrap gap-2 [&>li]:max-w-full [&>li]:min-w-0 [&>li]:max-sm:w-full">
      {children}
    </ul>
  );
}
