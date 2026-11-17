import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AttachmentChip } from "./attachment-chip";

describe("AttachmentChip", () => {
  it("links stored attachments to the authorized download endpoint", () => {
    render(<AttachmentChip filename="report.pdf" mimeType="application/pdf" size={2048} downloadId="att/1" downloadLabel="Download" />);
    const link = screen.getByRole("link", { name: "Download: report.pdf" });
    expect(link).toHaveAttribute("href", "/api/v1/attachments/att%2F1/download");
    expect(link).toHaveAttribute("download", "report.pdf");
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("offers removal for pending uploads", async () => {
    const onRemove = vi.fn();
    render(<AttachmentChip filename="photo.png" mimeType="image/png" size={10} onRemove={onRemove} removeLabel="Remove attachment" />);
    await userEvent.click(screen.getByRole("button", { name: "Remove attachment: photo.png" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
