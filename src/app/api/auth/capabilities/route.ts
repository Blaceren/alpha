import { NextResponse } from "next/server";
import { accountCapabilities } from "@/lib/account/capabilities";
import { isRegistrationAutoEnrollmentActive } from "@/lib/curriculum/registration-enrollment";

/**
 * WHAT THIS DEPLOYMENT CAN DO FOR AN ACCOUNT — public, and it names no account.
 *
 * The Academy reads it before it draws «Забыли пароль?» or the email actions in
 * the profile: a flow that ends in an email is offered only where an email can
 * be sent. Three booleans, no configuration detail.
 *
 * And one more, about the first visit (2026-10-04, launch audit): whether a
 * new account starts on the program at once. The registration page used to
 * say «Доступ к обучению открывает куратор» whatever the deployment did;
 * pre-production enrols on registration, so a new visitor was told to wait for
 * a person who never comes. The page now says what this deployment does.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    {
      capabilities: accountCapabilities(),
      registration: { opensLearning: isRegistrationAutoEnrollmentActive() },
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
