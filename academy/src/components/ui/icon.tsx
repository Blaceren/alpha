import type { LucideIcon } from "lucide-react";
import {
  Home,
  Route,
  BookOpen,
  Wrench,
  Users,
  Newspaper,
  Gift,
  GraduationCap,
  LifeBuoy,
  MoreHorizontal,
  User,
  Settings,
  Bell,
  Lock,
  Check,
  Flame,
  Sparkles,
  ArrowRight,
  Play,
  ChevronRight,
  Star,
  Shield,
  CircleDot,
  Target,
  Compass,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  home: Home,
  path: Route,
  lessons: BookOpen,
  tools: Wrench,
  community: Users,
  news: Newspaper,
  referrals: Gift,
  mentor: GraduationCap,
  support: LifeBuoy,
  more: MoreHorizontal,
  profile: User,
  settings: Settings,
  bell: Bell,
  lock: Lock,
  check: Check,
  flame: Flame,
  sparkles: Sparkles,
  arrowRight: ArrowRight,
  play: Play,
  chevronRight: ChevronRight,
  star: Star,
  shield: Shield,
  node: CircleDot,
  target: Target,
  compass: Compass,
};

export interface IconProps {
  name: keyof typeof ICONS | string;
  className?: string;
  strokeWidth?: number;
  "aria-hidden"?: boolean;
}

/** Renders a lucide icon by key. Decorative by default (aria-hidden). */
export function Icon({ name, className, strokeWidth = 1.75, ...rest }: IconProps) {
  const Cmp = ICONS[name] ?? CircleDot;
  return (
    <Cmp
      className={className}
      strokeWidth={strokeWidth}
      aria-hidden={rest["aria-hidden"] ?? true}
    />
  );
}

export const ICON_KEYS = Object.keys(ICONS);
