"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AppRole } from "@/lib/permissions";

type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: AppRole;
};

type ProtectedPageProps = {
  allowedRoles?: AuthUser["role"][];
  children: React.ReactNode;
};

export function ProtectedPage({ allowedRoles, children }: ProtectedPageProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { user: AuthUser | null }) => {
        setUser(result.user);
        setIsLoading(false);
      })
      .catch(() => {
        setUser(null);
        setIsLoading(false);
      });
  }, []);

  if (isLoading) {
    return <div className="app-card-flat p-4 text-sm text-[var(--text-secondary)]">Загрузка...</div>;
  }

  if (!user) {
    return (
      <section className="app-card max-w-xl p-6">
        <p className="page-kicker">Доступ</p>
        <h1 className="section-title mt-2">Нужно войти</h1>
        <p className="mt-2 text-[var(--text-secondary)]">
          Эта страница доступна только авторизованным пользователям.
        </p>
        <Link href="/login" className="btn btn-primary mt-5">
          Войти
        </Link>
      </section>
    );
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <section className="app-card max-w-xl p-6">
        <p className="page-kicker">Права доступа</p>
        <h1 className="section-title mt-2">Нет доступа</h1>
        <p className="mt-2 text-[var(--text-secondary)]">
          У вашей роли нет доступа к этому разделу.
        </p>
      </section>
    );
  }

  return <>{children}</>;
}
