export type AppRole = "user" | "admin" | "support" | "mentor" | "moderator" | "news_editor";

export const publicRoutes = [
  "/",
  "/news",
  "/privacy",
  "/cookies",
  "/security",
  "/login",
  "/register",
  "/403",
];

export const userRoutes = [
  "/dashboard",
  "/tasks",
  "/levels",
  "/rewards",
  "/notifications",
  "/exchange",
  "/chat",
  "/mentor-chat",
  "/leaderboard",
  "/achievements",
  "/profile",
];

export const feedbackRoutes = ["/feedback"];
export const problemManagementRoutes = ["/admin/feedback"];
export const adminRoutes = ["/crm", "/open-questions", "/design-lab", "/admin"];
export const supportRoutes = ["/support"];
export const taskReportReviewRoutes = ["/admin/task-reports"];
export const moderationRoutes = ["/admin/chat-moderation"];
export const newsEditorRoutes = ["/admin/news"];

function matchesRoute(path: string, routes: string[]) {
  return routes.some((route) => path === route || path.startsWith(`${route}/`));
}

export function canAccessAdmin(role?: AppRole | null) {
  return role === "admin";
}

export function canAccessNewsAdmin(role?: AppRole | null) {
  return role === "admin" || role === "news_editor";
}

export function canAccessSupport(role?: AppRole | null) {
  return role === "admin" || role === "support" || role === "mentor";
}

export function canReviewTaskReports(role?: AppRole | null) {
  return role === "admin" || role === "mentor";
}

export function canModerateChat(role?: AppRole | null) {
  return role === "admin" || role === "moderator";
}

export function isPrivateRoute(path: string) {
  return (
    matchesRoute(path, userRoutes) ||
    matchesRoute(path, feedbackRoutes) ||
    matchesRoute(path, problemManagementRoutes) ||
    matchesRoute(path, adminRoutes) ||
    matchesRoute(path, supportRoutes) ||
    matchesRoute(path, taskReportReviewRoutes) ||
    matchesRoute(path, moderationRoutes) ||
    matchesRoute(path, newsEditorRoutes)
  );
}

export function canAccessRoute(role: AppRole | null | undefined, path: string) {
  if (matchesRoute(path, publicRoutes)) {
    return true;
  }

  if (!role) {
    return false;
  }

  if (matchesRoute(path, feedbackRoutes)) {
    return role === "user" || role === "admin";
  }

  if (matchesRoute(path, problemManagementRoutes)) {
    return role === "admin" || role === "support";
  }

  if (matchesRoute(path, taskReportReviewRoutes)) {
    return canReviewTaskReports(role);
  }

  if (matchesRoute(path, moderationRoutes)) {
    return canModerateChat(role);
  }

  if (matchesRoute(path, newsEditorRoutes)) {
    return canAccessNewsAdmin(role);
  }

  if (matchesRoute(path, adminRoutes)) {
    return canAccessAdmin(role);
  }

  if (matchesRoute(path, supportRoutes)) {
    return canAccessSupport(role);
  }

  if (matchesRoute(path, userRoutes)) {
    if (role === "user") return true;
    if (role === "admin") return ["/dashboard", "/notifications", "/leaderboard", "/chat", "/profile"].includes(path);
    if (role === "mentor") return path === "/mentor-chat" || path === "/chat" || path === "/profile";
    if (role === "moderator") return path === "/chat" || path === "/profile";
    if (role === "support" || role === "news_editor") return path === "/profile";
    return false;
  }

  return true;
}
