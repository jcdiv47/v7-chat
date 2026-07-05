import { ChatApp } from "@/components/ChatApp";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  return <ChatApp threadId={threadId} />;
}
