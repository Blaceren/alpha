import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AffiliateInputError } from "@/lib/crm/affiliates";
import { requireAffiliateCsrf, requireAffiliateReader } from "@/lib/crm/affiliate-routes";
import { assertFilterHierarchy } from "@/lib/analytics/request";
import {
  analyticsErrorResponse,
  beginAnalyticsRequest,
  serializePeriod,
} from "@/lib/analytics/routes";
import { resolveBusinessTimezone } from "@/lib/analytics/business-time";
import { serializeCutoff, serializeFilters } from "@/lib/analytics/cohort-routes";
import { buildAnalysisReport } from "@/lib/analysis/analysis-report";
import { loadCohortInput, loadEventDateInput } from "@/lib/analysis/analysis-input";
import { analysisInputFingerprint, parseAnalysisRequest } from "@/lib/analysis/analysis-request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// POST /api/crm/v1/affiliates/analytics/analysis
//
// A structured, machine-readable reading of the ALREADY-COMPUTED affiliate
// analytics: observations, warnings, positive signals and questions, each a code
// from a closed catalog with the evidence that produced it.
//
// THIS ROUTE ADDS NO ANALYTICS. It calls exactly the loaders the shipped
// summary, timeseries and breakdown routes call, and it writes no SQL, defines
// no metric and touches no migration. Every number it prints is carried in the
// response beside the sentence that mentions it.
//
// NO MODEL IS CALLED. The findings are produced by a deterministic rule set over
// a closed catalog; no key is read and no request leaves the process. The
// response says so in `engine.modelInvoked`.
//
// WHY POST FOR A READ. The request carries a mode, two period shapes, a cutoff,
// three dimension filters, a grouping and a breakdown dimension. As a query
// string that is a URL nobody can read or review, and this endpoint is meant to
// be called from a form. It writes nothing.
//
// WHY CSRF ANYWAY. The affiliate namespace's rule is "POST validates a token",
// and a read-only exception is the kind of precedent that gets copied to a route
// that does write. It also stops a third-party page from making an
// authenticated CRM browser issue analytics work.
//
// NO PII IS REACHABLE FROM HERE. The response type has no lead, no email, no
// User id, no Pocket or click identifier and no reveal capability; the loaders
// consume aggregate counts and rates only, and a dimension member is named by
// its numeric id.

/** A bound applied before parsing, so an oversized body is never materialised. */
const MAX_BODY_BYTES = 4096;

export async function POST(request: Request) {
  const { requestId, headers } = beginAnalyticsRequest();

  try {
    // ORDER: session (401) → StaffProfile (403) → affiliate read (403) → CSRF →
    // parse → load. A caller who fails any step reaches no database read.
    await requireAffiliateReader();
    await requireAffiliateCsrf(request);

    const raw = await request.text().catch(() => "");
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      throw new AffiliateInputError("crm.analysis.body_too_large");
    }

    let body: unknown = {};
    if (raw.trim() !== "") {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        throw new AffiliateInputError("crm.analysis.body_invalid");
      }
    }

    const timezone = resolveBusinessTimezone();
    const now = new Date();
    const parsed = parseAnalysisRequest(body, timezone, now);

    // Existence and parentage of the named dimensions, through the accepted
    // owner. Archived and paused entities remain valid historical filters.
    await assertFilterHierarchy(parsed.filters);

    const input =
      parsed.mode === "event_date"
        ? await loadEventDateInput(prisma, {
            period: parsed.period,
            filters: parsed.filters,
            group: parsed.group,
            dimension: parsed.dimension,
          })
        : await loadCohortInput(prisma, {
            period: parsed.period,
            filters: parsed.filters,
            group: parsed.group,
            dimension: parsed.dimension,
            cutoff: parsed.cutoff!,
          });

    const report = buildAnalysisReport(input, analysisInputFingerprint(parsed));

    return NextResponse.json(
      {
        ...report,
        // The request, echoed as the server resolved it: an operator must be
        // able to see which window and which filters produced these sentences.
        //
        // `group` and `dimension` are TWO DIFFERENT THINGS and both are echoed.
        // `group` is the time bucket width (day | week | month); `dimension` is
        // the breakdown axis (affiliate | campaign | tracking_link). Neither
        // implies the other, and an operator reading only one of them would
        // misread the report.
        request: {
          mode: parsed.mode,
          period: serializePeriod(parsed.period),
          cutoff: parsed.cutoff === null ? null : serializeCutoff(parsed.cutoff),
          filters: serializeFilters(parsed.filters),
          group: parsed.group,
          dimension: parsed.dimension,
        },
        // PRODUCT-RC-1 — echoed in the BODY as well as the `X-Request-Id`
        // header. The error envelope has always carried it; a success that
        // carried it only in a header meant an operator who pasted a saved JSON
        // report into a ticket had thrown away the one value that lets support
        // find the corresponding server-side request.
        requestId,
        generatedAt: now.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    return analyticsErrorResponse(error, requestId, headers);
  }
}
