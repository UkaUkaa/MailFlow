"use client";

import { useParams } from "next/navigation";
import { ThreadReader } from "@/modules/emails";

export default function ThreadPage() {
  const params = useParams<{ view: string; threadId: string }>();
  return <ThreadReader key={params.threadId} threadId={params.threadId} view={params.view} />;
}
