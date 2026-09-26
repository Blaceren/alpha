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
  mapCandidateCurriculumSummary,
  mapCompletedCurriculumRead,
  mapCompletedCurriculumSummary,
  mapEnrolledCurriculumRead,
  mapEnrolledCurriculumSummary,
  mapUnavailableCurriculumRead,
  mapUnavailableCurriculumSummary,
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

/**
 * A6 — the response shape.
 *
 * `full` is the shipped contract and stays byte-identical, including when it is
 * requested by omitting the parameter entirely: an existing client sends no
 * query and gets exactly what it got before, with no `shape` marker added.
 *
 * `summary` is the Home projection — the same resolution on the same snapshot,
 * serialised down to the handful of facts a Home card needs instead of the
 * whole 100-level graph.
 *
 * Validation is an allow-list over BOTH the parameter names and the value.
 * `?shape=` (empty), `?shape=Summary`, `?shape=summary&asOf=…` and a repeated
 * `?shape=full&shape=summary` are all 400s rather than silently resolving to a
 * default — a query the server had to guess at is a query the client did not
 * mean.
 */
const RESPONSE_SHAPES = ["full", "summary"] as const;
type ResponseShape = (typeof RESPONSE_SHAPES)[number];

function resolveShape(request: Request): ResponseShape | null {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (key !== "shape") return null;
  }
  const values = params.getAll("shape");
  if (values.length === 0) return "full";
  if (values.length !== 1) return null;
  const value = values[0];
  return (RESPONSE_SHAPES as readonly string[]).includes(value)
    ? (value as ResponseShape)
    : null;
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

  const shape = resolveShape(request);
  if (shape === null) {
    return curriculumReadErrorResponse("INVALID_QUERY");
  }
  const summary = shape === "summary";

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
          data: summary
            ? mapCandidateCurriculumSummary(context)
            : mapCandidateCurriculumRead(context),
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
        {
          data: summary
            ? mapCompletedCurriculumSummary(context, xp)
            : mapCompletedCurriculumRead(context, xp),
        },
        { headers: NO_STORE_HEADERS },
      );
    }
    if (context.kind === "unavailable") {
      return NextResponse.json(
        {
          data: summary
            ? mapUnavailableCurriculumSummary(context)
            : mapUnavailableCurriculumRead(context),
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
      {
        data: summary
          ? mapEnrolledCurriculumSummary(levelStates)
          : mapEnrolledCurriculumRead(levelStates),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    console.error("curriculum V2 read API internal error");
    return curriculumReadErrorResponse("INTERNAL_ERROR");
  }
}
