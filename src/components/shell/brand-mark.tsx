/**
 * The Alfa Trade Academy mark, in the authenticated shell.
 *
 * WHAT THIS REPLACES. It used to draw a rounded square with a rising polyline
 * inside it — a generic chart glyph, not the ATA mark — and print the words
 * "Alfa Trade Academy" beside it. That was two brand lockups where the product
 * has one, and neither of them was the asset of record.
 *
 * THE ASSET OF RECORD, AND NOTHING ELSE. `/brand/ata-logo.svg` is byte-identical
 * to the frozen `HomeATA/assets/ata-logo.svg` (sha256 29e945f5…, 1643 bytes,
 * 362 × 200). It is the same file the accepted Public Home header renders, so
 * the two surfaces cannot drift into two marks.
 *
 * THE IMAGE IS DECORATIVE. `alt=""`, because the link around it already carries
 * the accessible name — one name for one control, never two. The intrinsic
 * 362 × 200 is declared so the browser reserves the right box before the file
 * arrives and the bar cannot shift as it loads; the visual size and the natural
 * ratio are the stylesheet's job, and it never stretches the mark.
 */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "brand brand--compact" : "brand"}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the asset of
          record is a fixed-size SVG served from /public; the optimizer has
          nothing to add and would only put a second URL in front of it. */}
      <img src="/brand/ata-logo.svg" alt="" width={362} height={200} />
    </span>
  );
}
