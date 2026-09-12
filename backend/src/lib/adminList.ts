import { validationErrorResponse, type ValidationDetail } from "@/lib/validation";

export type AdminListQuery = {
  q: string;
  page: number;
  pageSize: number;
  skip: number;
  sort?: string;
  order: "asc" | "desc";
};

export function parseAdminListQuery(
  request: Request,
  allowedSorts: string[],
  defaultSort: string,
) {
  const { searchParams } = new URL(request.url);
  const details: ValidationDetail[] = [];
  const pageRaw = Number(searchParams.get("page") ?? "1");
  const pageSizeRaw = Number(searchParams.get("pageSize") ?? "20");
  const sortRaw = searchParams.get("sort") ?? defaultSort;
  const orderRaw = searchParams.get("order") ?? "asc";

  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize =
    Number.isInteger(pageSizeRaw) && pageSizeRaw > 0
      ? Math.min(pageSizeRaw, 100)
      : 20;

  if (!allowedSorts.includes(sortRaw)) {
    details.push({ field: "sort", message: "Недопустимое поле сортировки" });
  }

  if (orderRaw !== "asc" && orderRaw !== "desc") {
    details.push({ field: "order", message: "order должен быть asc или desc" });
  }

  if (details.length > 0) {
    return {
      success: false as const,
      response: validationErrorResponse(details),
    };
  }

  return {
    success: true as const,
    query: {
      q: searchParams.get("q")?.trim() ?? "",
      page,
      pageSize,
      skip: (page - 1) * pageSize,
      sort: sortRaw,
      order: orderRaw as "asc" | "desc",
    } satisfies AdminListQuery,
    searchParams,
  };
}

export function parseEnumFilter<T extends string>(
  searchParams: URLSearchParams,
  field: string,
  allowedValues: readonly T[],
  details: ValidationDetail[],
) {
  const value = searchParams.get(field);

  if (!value) {
    return undefined;
  }

  if (!allowedValues.includes(value as T)) {
    details.push({ field, message: "Недопустимое значение фильтра" });
    return undefined;
  }

  return value as T;
}

export function parseBooleanFilter(
  searchParams: URLSearchParams,
  field: string,
  details: ValidationDetail[],
) {
  const value = searchParams.get(field);

  if (!value) {
    return undefined;
  }

  if (value !== "true" && value !== "false") {
    details.push({ field, message: "Значение должно быть true или false" });
    return undefined;
  }

  return value === "true";
}

export function parseNumberFilter(
  searchParams: URLSearchParams,
  field: string,
  details: ValidationDetail[],
) {
  const value = searchParams.get(field);

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    details.push({ field, message: "Значение должно быть числом" });
    return undefined;
  }

  return parsed;
}

export function paginatedResponse<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
) {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
  };
}
