/**
 * PHASE-C CORRECTIONS — a minimal, dependency-free DOCX reader.
 *
 * WHY THIS EXISTS AND WHY IT HAS NO DEPENDENCY
 * The video-production Blueprint arrives as a `.docx`. Extracting it must be
 * reproducible by anyone auditing this repository years from now, so the reader
 * is written against two things that cannot drift: the ZIP container format and
 * `node:zlib`. Adding `jszip`/`adm-zip` for one build-time script would put a
 * third-party parser between an auditor and the source of the product's
 * assessment bank, and would require a lockfile change to verify a document.
 *
 * A `.docx` is a ZIP whose entries are either STORED (method 0) or DEFLATE
 * (method 8). `zlib.inflateRawSync` handles the second; the first is a copy.
 * Nothing here executes document content, resolves a relationship, follows an
 * external reference or opens a socket — it reads bytes and returns text.
 *
 * WHAT IT READS, AND WHY THAT IS ENOUGH
 * WordprocessingML is large; this reader understands the subset the Blueprint
 * uses — `w:p` with `w:pStyle`, `w:t`, `w:tab`, `w:br`, `w:tbl`/`w:tr`/`w:tc`,
 * and the `w:sdt` wrapper. Every other element is descended into, so an
 * unexpected element could lose its FORMATTING but never its TEXT. That is the
 * safe direction: a formatting loss is caught by the structural QA in
 * `videoBlueprintSource.ts`, which refuses any document that does not yield
 * exactly 58 lessons with exactly 4 takes and 4 questions each.
 *
 * SCOPE. DEV/AUDIT tooling under `scripts/`. Nothing in `src/` imports it, no
 * runtime path reaches it, and it never runs during a build or a request.
 */
import { inflateRawSync } from "node:zlib";

/* ------------------------------------------------------------------ *
 * ZIP container
 * ------------------------------------------------------------------ */

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;

/** Read one named entry out of a ZIP archive. Returns null when absent. */
export function readZipEntry(archive: Buffer, entryName: string): Buffer | null {
  const eocd = findEndOfCentralDirectory(archive);
  if (eocd === null) throw new Error("not a ZIP archive: no end-of-central-directory record");

  const entryCount = archive.readUInt16LE(eocd + 10);
  let cursor = archive.readUInt32LE(eocd + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(cursor) !== CENTRAL_FILE_HEADER) {
      throw new Error(`corrupt ZIP central directory at entry ${index}`);
    }
    const compressionMethod = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localHeaderOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    if (name === entryName) {
      // The local header repeats the name/extra lengths, and only they locate
      // the payload — the central copy may legitimately differ in extra fields.
      const localNameLength = archive.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
      const start = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const raw = archive.subarray(start, start + compressedSize);
      if (compressionMethod === 0) return Buffer.from(raw);
      if (compressionMethod === 8) {
        const inflated = inflateRawSync(raw);
        if (inflated.length !== uncompressedSize) {
          throw new Error(`ZIP entry ${entryName}: inflated size disagrees with the directory`);
        }
        return inflated;
      }
      throw new Error(`ZIP entry ${entryName}: unsupported compression method ${compressionMethod}`);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function findEndOfCentralDirectory(archive: Buffer): number | null {
  // The record sits at the tail, after a comment of at most 0xffff bytes.
  const earliest = Math.max(0, archive.length - 22 - 0xffff);
  for (let offset = archive.length - 22; offset >= earliest; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * WordprocessingML → structured blocks
 * ------------------------------------------------------------------ */

/**
 * One document block.
 *
 * `style` is the raw `w:pStyle/@w:val`. The Blueprint uses SEMANTIC styles —
 * `Takeaway`, `Question`, `Meta`, `Heading1..3` — and those, not text patterns,
 * are what the extractor keys on. A style is a stronger contract than a prefix:
 * it survives a wording change and cannot be produced by accident inside prose.
 */
export type DocxBlock =
  | { kind: "paragraph"; style: string; text: string }
  | { kind: "table"; rows: string[][] };

type Tag = { name: string; attrs: string; closing: boolean; selfClosing: boolean };
type Token = Tag | { text: string };

function* tokenize(xml: string): Generator<Token> {
  let cursor = 0;
  while (cursor < xml.length) {
    const open = xml.indexOf("<", cursor);
    if (open === -1) {
      if (cursor < xml.length) yield { text: xml.slice(cursor) };
      return;
    }
    if (open > cursor) yield { text: xml.slice(cursor, open) };
    const close = xml.indexOf(">", open);
    if (close === -1) return;
    const inner = xml.slice(open + 1, close);
    cursor = close + 1;
    if (inner.startsWith("?") || inner.startsWith("!")) continue;
    const closing = inner.startsWith("/");
    const selfClosing = inner.endsWith("/");
    const body = inner.replace(/^\//, "").replace(/\/$/, "");
    const space = body.search(/\s/);
    yield {
      name: space === -1 ? body : body.slice(0, space),
      attrs: space === -1 ? "" : body.slice(space + 1),
      closing,
      selfClosing,
    };
  }
}

function attr(attrs: string, name: string): string {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match ? decodeXmlText(match[1]) : "";
}

export function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function parseBody(xml: string): DocxBlock[] {
  const blocks: DocxBlock[] = [];

  let paragraphParts: string[] = [];
  let paragraphStyle = "";
  let inTextRun = false;

  let tableRows: string[][] | null = null;
  let currentRow: string[] | null = null;
  let cellDepth = 0;
  let cellParagraphs: string[] = [];

  const emitParagraph = () => {
    const text = paragraphParts.join("");
    if (cellDepth > 0) cellParagraphs.push(text.trim());
    else blocks.push({ kind: "paragraph", style: paragraphStyle, text });
    paragraphParts = [];
    paragraphStyle = "";
  };

  for (const token of tokenize(xml)) {
    if ("text" in token) {
      if (inTextRun) paragraphParts.push(decodeXmlText(token.text));
      continue;
    }
    switch (token.name) {
      case "w:p":
        if (token.closing) emitParagraph();
        else if (token.selfClosing) {
          paragraphParts = [];
          emitParagraph();
        } else {
          paragraphParts = [];
          paragraphStyle = "";
        }
        break;
      case "w:pStyle":
        if (!token.closing) paragraphStyle = attr(token.attrs, "w:val");
        break;
      case "w:t":
        inTextRun = !token.closing && !token.selfClosing;
        break;
      case "w:tab":
        if (!token.closing) paragraphParts.push("\t");
        break;
      case "w:br":
        if (!token.closing) paragraphParts.push("\n");
        break;
      case "w:tbl":
        if (token.closing) {
          if (tableRows) blocks.push({ kind: "table", rows: tableRows });
          tableRows = null;
        } else if (!token.selfClosing) tableRows = [];
        break;
      case "w:tr":
        if (token.closing) {
          if (tableRows && currentRow) tableRows.push(currentRow);
          currentRow = null;
        } else if (!token.selfClosing) currentRow = [];
        break;
      case "w:tc":
        if (token.closing) {
          cellDepth -= 1;
          if (currentRow) currentRow.push(cellParagraphs.filter((p) => p.length > 0).join(" "));
          cellParagraphs = [];
        } else if (!token.selfClosing) {
          cellDepth += 1;
          cellParagraphs = [];
        }
        break;
      default:
        break;
    }
  }
  return blocks;
}

/** Every block of `word/document.xml`, in document order. */
export function readDocxBlocks(archive: Buffer): DocxBlock[] {
  const document = readZipEntry(archive, "word/document.xml");
  if (!document) throw new Error("not a DOCX: word/document.xml is missing");
  return parseBody(document.toString("utf8"));
}

/** `docProps/core.xml`, for provenance (title, subject, creator, keywords). */
export function readDocxCoreProperties(archive: Buffer): Record<string, string> {
  const core = readZipEntry(archive, "docProps/core.xml");
  if (!core) return {};
  const xml = core.toString("utf8");
  const properties: Record<string, string> = {};
  for (const match of xml.matchAll(/<((?:dc|cp|dcterms):[A-Za-z]+)\b[^>]*>([^<]*)<\/\1>/g)) {
    properties[match[1]] = decodeXmlText(match[2]);
  }
  return properties;
}
