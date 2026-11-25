import { notFound } from "next/navigation";
import { BlockEditor } from "@/components/editor/block-editor";
import { getEditorData } from "@/server/editor-data";

export const metadata = { title: "Program" };

export default async function BlockPage({ params }: { params: Promise<{ blockId: string }> }) {
  const { blockId } = await params;
  const data = await getEditorData(blockId);
  if (!data) notFound();
  // key: a fresh editor (and history) per block
  return <BlockEditor key={data.block.id} data={data} />;
}
