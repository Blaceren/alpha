import { NextResponse } from "next/server";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/apiAuth";
import { getCurrentUser } from "@/lib/auth";
import {
  curriculumReadErrorResponse,
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
import { resolveEnrollmentXp } from "@/lib/curriculum/xp";
import {
  isCurriculumV2ReadEnabled,
  isCurriculumV2XpEnabled,
} from "@/lib/env";

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
  return response;
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
    return curriculumReadErrorResponse("INVALID_QUERY");
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
      return curriculumReadErrorResponse(
        "CURRICULUM_STATE_CORRUPT",
        context.reason,
      );
    }
    if (context.kind === "candidate") {
      return NextResponse.json(
        {
          data: mapCandidateCurriculumRead(context),
        },
        { headers: NO_STORE_HEADERS },
      );
    }
    if (context.kind === "completed") {
      const xp = isCurriculumV2XpEnabled()
        ? await resolveEnrollmentXp({ enrollmentId: context.enrollment.id })
        : ({ kind: "disabled" } as const);
      if (xp.kind === "not_found" || xp.kind === "corrupt") {
        return curriculumReadErrorResponse("XP_STATE_CORRUPT", "XP_STATE_CORRUPT");
      }
      return NextResponse.json(
        { data: mapCompletedCurriculumRead(context, xp) },
        { headers: NO_STORE_HEADERS },
      );
    }
    if (context.kind === "unavailable") {
      return NextResponse.json(
        {
          data: mapUnavailableCurriculumRead(context),
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    const levelStates = await resolveUserCurriculumLevelStates({ userId: user.id });
    if (levelStates.kind === "corrupt") {
      const code = levelStates.reason.startsWith("xp_")
        ? "XP_STATE_CORRUPT"
        : "CURRICULUM_STATE_CORRUPT";
      return curriculumReadErrorResponse(
        code,
        code === "XP_STATE_CORRUPT" ? code : levelStates.reason,
      );
    }
    if (levelStates.kind !== "resolved") {
      return curriculumReadErrorResponse(
        "CURRICULUM_STATE_CORRUPT",
        "enrolled_level_state_unavailable",
      );
    }

    return NextResponse.json(
      { data: mapEnrolledCurriculumRead(levelStates) },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    console.error("curriculum V2 read API internal error");
    return curriculumReadErrorResponse("INTERNAL_ERROR");
  }
}
