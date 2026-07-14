import { NextResponse } from "next/server";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/apiAuth";
import { getCurrentUser } from "@/lib/auth";
import {
  curriculumFeatureDisabledResponse,
  NO_STORE_HEADERS,
} from "@/lib/curriculum/http";
import { resolveUserCurriculumLevelStates } from "@/lib/curriculum/level-state";
import {
  mapCandidateCurriculumRead,
  mapCompletedCurriculumRead,
  mapEnrolledCurriculumRead,
  mapUnavailableCurriculumRead,
} from "@/lib/curriculum/read-api";
import { resolveUserCurriculumContext } from "@/lib/curriculum/resolver";
import { isCurriculumV2ReadEnabled } from "@/lib/env";

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
  return response;
}

function corruptResponse(reason: string) {
  return NextResponse.json(
    {
      error: "CURRICULUM_STATE_CORRUPT",
      reason,
      issues: [{ code: reason }],
    },
    { status: 409, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: Request) {
  if (!isCurriculumV2ReadEnabled()) {
    return noStore(curriculumFeatureDisabledResponse());
  }

  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return noStore(unauthorizedResponse());
  }

  if (!user) return noStore(unauthorizedResponse());
  if (user.status !== "active") return noStore(forbiddenResponse());

  if (new URL(request.url).searchParams.size !== 0) {
    return NextResponse.json(
      { error: "INVALID_QUERY" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const context = await resolveUserCurriculumContext({ userId: user.id });

    if (context.kind === "disabled") {
      return noStore(curriculumFeatureDisabledResponse());
    }
    if (context.kind === "user_not_found") {
      return noStore(forbiddenResponse());
    }
    if (context.kind === "corrupt") {
      return corruptResponse(context.reason);
    }
    if (context.kind === "candidate") {
      return NextResponse.json(
        { data: mapCandidateCurriculumRead(context) },
        { headers: NO_STORE_HEADERS },
      );
    }
    if (context.kind === "completed") {
      return NextResponse.json(
        { data: mapCompletedCurriculumRead(context) },
        { headers: NO_STORE_HEADERS },
      );
    }
    if (context.kind === "unavailable") {
      return NextResponse.json(
        { data: mapUnavailableCurriculumRead(context) },
        { headers: NO_STORE_HEADERS },
      );
    }

    const levelStates = await resolveUserCurriculumLevelStates({ userId: user.id });
    if (levelStates.kind === "corrupt") {
      return corruptResponse(levelStates.reason);
    }
    if (levelStates.kind !== "resolved") {
      return corruptResponse("enrolled_level_state_unavailable");
    }

    return NextResponse.json(
      { data: mapEnrolledCurriculumRead(context, levelStates) },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    console.error("curriculum V2 read API internal error");
    return NextResponse.json(
      { error: "INTERNAL_ERROR" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
