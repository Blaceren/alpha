/**
 * Provider result envelope, pagination, and error contracts.
 * Source of truth: docs/DATA_PROVIDER_CONTRACT.md §0.
 */
import type { Freshness } from "@/domain/shared/primitives";

export type CrmErrorCode =
  | "unauthorized"
  | "not_found"
  | "invalid_input"
  | "rate_limited"
  | "upstream_unavailable"
  | "stale_data"
  | "conflict"
  | "internal";

/** Discriminated-union-friendly error object. */
export interface CrmError {
  code: CrmErrorCode;
  message: string;
  retriable: boolean;
  details?: Record<string, unknown>;
}

export type ResultStatus = "ok" | "loading" | "stale" | "empty" | "error";

/** Uniform result wrapper carrying loading/stale/error state + freshness. */
export interface Result<T> {
  data: T | null;
  status: ResultStatus;
  freshness: Freshness | null;
  error: CrmError | null;
}

export interface PageInfo {
  cursor: string | null;
  nextCursor: string | null;
  total: number | null;
  pageSize: number;
}

export interface Paginated<T> {
  items: T[];
  page: PageInfo;
}

export interface PageParams {
  cursor?: string | null;
  pageSize?: number;
}

export interface SortParam<F extends string> {
  field: F;
  dir: "asc" | "desc";
}

/** Convenience constructors keep provider implementations terse and consistent. */
export function ok<T>(data: T, freshness: Freshness | null = null): Result<T> {
  return { data, status: "ok", freshness, error: null };
}

export function empty<T>(data: T): Result<T> {
  return { data, status: "empty", freshness: null, error: null };
}

export function stale<T>(data: T, freshness: Freshness): Result<T> {
  return { data, status: "stale", freshness, error: null };
}

export function fail<T>(error: CrmError): Result<T> {
  return { data: null, status: "error", freshness: null, error };
}
