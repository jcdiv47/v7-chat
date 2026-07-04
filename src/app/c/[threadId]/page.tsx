import { ChatApp } from "@/components/ChatApp";
import type { Id } from "@/lib/convexApi";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  return <ChatApp threadId={threadId as Id<"threads">} />;
}
