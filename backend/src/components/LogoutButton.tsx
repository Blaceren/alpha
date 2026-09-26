"use client";

import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/api";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await csrfFetch("/api/auth/logout", {
      method: "POST",
    });

    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={logout}
      className="btn btn-ghost min-h-9 px-3 py-1.5 text-xs"
    >
      Выйти
    </button>
  );
}
