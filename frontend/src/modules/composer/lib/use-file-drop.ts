"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";

/** True for a drag that carries files from the operating system (not text or a link). */
export function carriesFiles(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes("Files"));
}

/**
 * Makes an element a drop target for files. Only drags that carry files are taken: dragging
 * text inside the message body keeps working. The handlers run in the capture phase so the
 * rich-text editor never sees a file drop (it would otherwise let the browser open the file).
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [active, setActive] = useState(false);
  // dragenter/dragleave fire for every child crossed, so count them to know when the drag left.
  const depth = useRef(0);

  const onDragEnterCapture = useCallback((event: DragEvent<HTMLElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    depth.current += 1;
    setActive(true);
  }, []);

  const onDragOverCapture = useCallback((event: DragEvent<HTMLElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeaveCapture = useCallback((event: DragEvent<HTMLElement>) => {
    if (!carriesFiles(event.dataTransfer)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setActive(false);
  }, []);

  const onDropCapture = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      depth.current = 0;
      setActive(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    },
    [onFiles],
  );

  return { active, dropProps: { onDragEnterCapture, onDragOverCapture, onDragLeaveCapture, onDropCapture } };
}
