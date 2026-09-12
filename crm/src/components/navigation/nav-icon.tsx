import * as React from "react";
import {
  BarChart3,
  CheckSquare,
  FolderOpen,
  GraduationCap,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  ScrollText,
  Settings,
  Share2,
  TrendingUp,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Users,
  Layers,
  CheckSquare,
  FolderOpen,
  GraduationCap,
  LifeBuoy,
  Wallet,
  MessageSquare,
  Workflow,
  BarChart3,
  ScrollText,
  Settings,
  Share2,
  TrendingUp,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? LayoutDashboard;
  return <Icon className={className} aria-hidden />;
}
