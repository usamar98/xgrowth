import { notFound } from "next/navigation";
import SignalDesk from "@/components/signaldesk";
import { sections } from "@/lib/navigation";
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!sections.some((item) => item.id === section)) notFound();
  return <SignalDesk initialView={section} />;
}
