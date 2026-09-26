import { NewsEditorWorkspace } from "@/features/news/news-editor-workspace";

export default async function NewsItemPage({ params }: { params: Promise<{ newsId: string }> }) {
  const { newsId } = await params;
  return <NewsEditorWorkspace newsId={decodeURIComponent(newsId)} />;
}
