import { NextResponse } from "next/server";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/apiAuth";
import { getCurrentUser } from "@/lib/auth";
import {
  curriculumFeatureDisabledResponse,
  curriculumReadErrorResponse,
  NO_STORE_HEADERS,
} from "@/lib/curriculum/http";
import {
  isCurriculumXpReadError,
  parseCurriculumXpHistoryQuery,
  readCurriculumXpHistory,
} from "@/lib/curriculum/xp-read";
import {
  isCurriculumV2ReadEnabled,
  isCurriculumV2XpEnabled,
} from "@/lib/env";

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
  return response;
}

export async function GET(request: Request) {
  if (!isCurriculumV2ReadEnabled() || !isCurriculumV2XpEnabled()) {
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

  try {
    const query = parseCurriculumXpHistoryQuery(request);
    const data = await readCurriculumXpHistory(user.id, query);
    return NextResponse.json({ data }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (isCurriculumXpReadError(error)) {
      return curriculumReadErrorResponse(error.code, error.issueCode);
    }
    console.error("curriculum V2 XP history internal error");
    return curriculumReadErrorResponse("INTERNAL_ERROR");
  }
}
