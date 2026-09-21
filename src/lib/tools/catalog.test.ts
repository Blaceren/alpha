import { describe, expect, it } from "vitest";
import { validateAtaUnlockVocabulary } from "@/lib/curriculum/package/ata-profile";
import { ATA_CHECKPOINTS, ATA_TOOL_UNLOCK_COUNT } from "@/lib/curriculum/product-ata-100";
import {
  CURRICULUM_TOOLS,
  PRODUCT_TOOL_CODES,
  RETIRED_CURRICULUM_TOOL_CODES,
  SECRET_TOOL,
  isProductToolCode,
} from "@/lib/curriculum/product-vocabulary";
import { EXPIRY_OPTIONS, TRADING_ASSETS } from "./reference";

describe("TOOLS-V2 catalog", () => {
  it("is the six tools of the first block, in unlock order", () => {
    expect(CURRICULUM_TOOLS.map((tool) => [tool.code, tool.unlockLevel])).toEqual([
      ["tool.trade_card", 5],
      ["tool.trading_journal", 10],
      ["tool.risk_calculator", 15],
      ["tool.entry_checklist", 20],
      ["tool.personal_stats", 25],
      ["tool.news_calendar", 30],
    ]);
    expect(ATA_TOOL_UNLOCK_COUNT).toBe(CURRICULUM_TOOLS.length);
  });

  it("passes the product unlock vocabulary check", () => {
    expect(validateAtaUnlockVocabulary()).toEqual([]);
  });

  it("releases tools only at L10…L30 among checkpoints", () => {
    const released = ATA_CHECKPOINTS.filter((checkpoint) => checkpoint.toolCode !== null).map(
      (checkpoint) => checkpoint.levelNumber,
    );
    expect(released).toEqual([10, 15, 20, 25, 30]);
  });

  it("keeps retired codes valid for content, but out of the catalog", () => {
    const catalogCodes = new Set<string>(CURRICULUM_TOOLS.map((tool) => tool.code));
    for (const code of RETIRED_CURRICULUM_TOOL_CODES) {
      expect(isProductToolCode(code)).toBe(true);
      expect(catalogCodes.has(code)).toBe(false);
    }
    expect(PRODUCT_TOOL_CODES.has(SECRET_TOOL.code)).toBe(true);
    expect(PRODUCT_TOOL_CODES.size).toBe(CURRICULUM_TOOLS.length + RETIRED_CURRICULUM_TOOL_CODES.length + 1);
  });

  it("keeps every tool code inside the content-block code pattern", () => {
    const pattern = /^tool\.[a-z0-9]+(?:_[a-z0-9]+)*$/;
    for (const code of PRODUCT_TOOL_CODES) expect(code, code).toMatch(pattern);
  });
});

describe("TOOLS-V2 reference lists", () => {
  it("have unique, non-empty codes and labels", () => {
    for (const list of [TRADING_ASSETS, EXPIRY_OPTIONS]) {
      const codes = list.map((item) => item.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const item of list) expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("orders expiries from shortest to longest", () => {
    const seconds = EXPIRY_OPTIONS.map((item) => item.seconds);
    expect([...seconds].sort((a, b) => a - b)).toEqual(seconds);
  });
});
