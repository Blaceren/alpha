import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ApiCrmDataProvider,
  API_SUPPORTED_CAPABILITIES,
  assertApiCapability,
  createApiCrmDataProvider,
  UnsupportedApiCapability,
} from "./api-crm-data-provider";

const PAGE = { items: [], nextCursor: null };

describe("ApiCrmDataProvider — users read", () => {
  it("delegates to the users client", async () => {
    const client = vi.fn(
      async (input: unknown, options?: unknown) => {
        void input;
        void options;
        return { status: "success", page: PAGE } as const;
      },
    );
    const provider = new ApiCrmDataProvider(client as never);

    const result = await provider.listUsers({ limit: 10, search: "Лена" });

    expect(client).toHaveBeenCalledTimes(1);
    expect(client.mock.calls[0]?.[0]).toEqual({ limit: 10, search: "Лена" });
    expect(result.status).toBe("success");
  });

  it("passes the abort signal through", async () => {
    const client = vi.fn(
      async (input: unknown, options?: unknown) => {
        void input;
        void options;
        return { status: "success", page: PAGE } as const;
      },
    );
    const provider = new ApiCrmDataProvider(client as never);
    const controller = new AbortController();

    await provider.listUsers({}, { signal: controller.signal });

    const options = client.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined;
    expect(options?.signal).toBe(controller.signal);
  });

  it("createApiCrmDataProvider builds the provider", () => {
    expect(createApiCrmDataProvider()).toBeInstanceOf(ApiCrmDataProvider);
  });

  it("delegates getUserDetail to the detail client with the id verbatim", async () => {
    const listClient = vi.fn(async () => ({ status: "success", page: PAGE }) as const);
    const detailClient = vi.fn(
      async (userId: unknown, options?: unknown) => {
        void userId;
        void options;
        return { status: "not_found" } as const;
      },
    );
    const provider = new ApiCrmDataProvider(listClient as never, detailClient as never);
    const controller = new AbortController();

    const result = await provider.getUserDetail("0071", { signal: controller.signal });

    // The opaque id is passed through untouched — never parsed to a number.
    expect(detailClient.mock.calls[0]?.[0]).toBe("0071");
    expect((detailClient.mock.calls[0]?.[1] as { signal?: AbortSignal })?.signal).toBe(controller.signal);
    expect(result.status).toBe("not_found");
    expect(listClient).not.toHaveBeenCalled();
  });
});

describe("unsupported capabilities fail closed", () => {
  it("lists exactly the two supported capabilities", () => {
    expect([...API_SUPPORTED_CAPABILITIES]).toEqual(["listUsers", "getUserDetail"]);
  });

  it.each([
    "getUser360",
    "getUserTimeline",
    "getUserNotes",
    "getUserNotesView",
    "addNote",
    "deleteNote",
    "assignPrimaryOwner",
    "getPrimaryOwnerCandidates",
    "getAuditRecords",
    "getTodayWorkspace",
    "searchUsers",
    "getUserTimeline",
    "getSegments",
  ])("throws UnsupportedApiCapability for %s", (capability) => {
    // Never an empty list: "no notes" and "notes are not connected" must not
    // look the same to a caller.
    expect(() => assertApiCapability(capability)).toThrow(UnsupportedApiCapability);
  });

  it("does not throw for the supported capabilities", () => {
    expect(() => assertApiCapability("listUsers")).not.toThrow();
    expect(() => assertApiCapability("getUserDetail")).not.toThrow();
  });

  it("exposes no mutation method", () => {
    const provider = createApiCrmDataProvider();
    for (const method of [
      "addNote",
      "deleteNote",
      "updateNoteBody",
      "setNotePinned",
      "setNoteVisibility",
      "assignPrimaryOwner",
    ]) {
      expect((provider as unknown as Record<string, unknown>)[method]).toBeUndefined();
    }
  });

  it("exposes exactly the two accepted read methods and nothing else", () => {
    const provider = createApiCrmDataProvider();
    const own = Object.getOwnPropertyNames(Object.getPrototypeOf(provider)).filter(
      (n) => n !== "constructor",
    );
    expect(own.sort()).toEqual(["getUserDetail", "listUsers"]);
  });
});

describe("the API provider never reaches mock code", () => {
  const read = (relative: string) =>
    fs.readFileSync(path.join(process.cwd(), relative), "utf8");

  /**
   * Only the import statements matter. Prose comments legitimately mention
   * MockCrmDataProvider to explain why it is absent, and a raw substring scan
   * would flag exactly the documentation that proves the point.
   */
  const importsOf = (source: string) =>
    source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line) || /\bfrom\s+"/.test(line))
      .join("\n");

  const API_MODULES = [
    "src/data/api/api-crm-data-provider.ts",
    "src/application/api/users-client.ts",
    "src/features/users-api/api-users-workspace.tsx",
    "src/features/users-api/use-api-users-query.ts",
    "src/application/api/user-detail-client.ts",
    "src/features/users-api/api-user-detail-workspace.tsx",
    "src/features/users-api/use-api-user-detail-query.ts",
  ];

  it.each(API_MODULES)("%s imports no mock provider, fixtures or mock users feature", (file) => {
    const imports = importsOf(read(file));
    for (const banned of [
      "MockCrmDataProvider",
      "data/mock",
      "fixtures",
      "getCrmDataProvider",
      "getCrmMutations",
      "features/users/",
      "domain/users/user",
    ]) {
      expect(imports, `${file} must not import ${banned}`).not.toContain(banned);
    }
  });

  it("no API module imports the mock UserSummary type", () => {
    // Importing it is what would let a fabricated mock-shaped object be built;
    // naming it in a comment that explains its absence is not.
    for (const file of API_MODULES) {
      expect(importsOf(read(file)), file).not.toContain("UserSummary");
    }
  });

  it("no browser module contains the backend origin", () => {
    for (const file of [
      "src/application/api/users-client.ts",
      "src/data/api/api-crm-data-provider.ts",
      "src/features/users-api/api-users-workspace.tsx",
      "src/features/users-api/use-api-users-query.ts",
      "src/application/api/user-detail-client.ts",
      "src/features/users-api/api-user-detail-workspace.tsx",
      "src/features/users-api/use-api-user-detail-query.ts",
      "src/components/crm-shell/api-shell.tsx",
    ]) {
      const source = read(file);
      expect(source, file).not.toContain("CRM_BACKEND_ORIGIN");
      expect(source, file).not.toContain("127.0.0.1");
    }
  });
});
