"use client";

import * as React from "react";
import { ReviewQueue } from "./review-queue";
import { ReportDetail } from "./report-detail";

/**
 * The reviewer workspace: queue and detail.
 *
 * Which view is shown is local state rather than a nested route, because the
 * api-mode shell matches pathnames exactly (see `app-shell.tsx`) and a submission
 * ref is an opaque base64url token that has no business in a URL a mentor might
 * copy or share. Going "back" re-mounts the queue, which refetches — so the
 * canonical state after a decision always comes from the server.
 */
export const REPORT_REVIEW_PATH = "/report-review";

export function ReportReviewWorkspace() {
  const [openRef, setOpenRef] = React.useState<string | null>(null);

  return openRef === null ? (
    <ReviewQueue onOpen={setOpenRef} />
  ) : (
    <ReportDetail submissionRef={openRef} onBack={() => setOpenRef(null)} />
  );
}
