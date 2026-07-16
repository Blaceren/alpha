import type { ReactNode } from "react";
import "@/features/home/home.css";

/**
 * (app) route group layout. Each page renders its own <AppShell> with the
 * correct activeId (the layout cannot know the route), so this layout only
 * carries the shared app CSS. User is synthetic (no real auth / backend).
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return children;
}
