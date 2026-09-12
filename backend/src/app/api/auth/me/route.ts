import { NextResponse } from "next/server";
import { getCurrentUser, toPublicUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();

  if (user?.status === "blocked") {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Недостаточно прав" },
      { status: 403 },
    );
  }

  return NextResponse.json({ user: user ? toPublicUser(user) : null });
}
