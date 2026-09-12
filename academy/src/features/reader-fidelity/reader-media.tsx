import type { LessonBlock } from "@/lib/curriculum/lesson-body";
import "@/features/lesson-reader/lesson-reader.css";

/**
 * IMAGE, VIDEO AND DOWNLOAD — the three block types the frozen Reader has no
 * vocabulary for, kept in the product's own.
 *
 * The frozen prototype's fixtures carry no media at all, so its stylesheet has
 * no `figure`, no player and no download rule. There is nothing to restore for
 * these three, and inventing a frozen-looking treatment would be designing
 * rather than restoring. The product's accepted rendering — `.lr-figure`,
 * `.lr-download` — carries them instead, unchanged, and `lesson-reader.css` is
 * imported for exactly those rules. Everything else in that file is dead here:
 * this surface emits none of its other classes.
 *
 * A published curriculum currently carries no video assets at all, so the video
 * branch is real but unexercised — and honest either way, because nothing here
 * invents a poster, a duration or a placeholder source.
 */
export function LessonMedia({
  block,
}: {
  block: Extract<LessonBlock, { type: "image" | "video" | "download" }>;
}) {
  if (block.type === "image") {
    return (
      <figure className="lr-figure">
        {/* eslint-disable-next-line @next/next/no-img-element -- the source is a
            published https asset of unknown intrinsic size, not a bundled file
            the optimizer can reason about. */}
        <img className="lr-figure__img" src={block.asset.url} alt={block.alt} loading="lazy" />
        {block.caption ? <figcaption className="lr-figure__cap">{block.caption}</figcaption> : null}
      </figure>
    );
  }

  if (block.type === "video") {
    return (
      <figure className="lr-figure">
        <video className="lr-figure__video" controls preload="metadata" playsInline>
          <source src={block.asset.url} type={block.asset.mimeType} />
          {block.captions ? (
            <track kind="captions" src={block.captions.url} label="Субтитры" default />
          ) : null}
        </video>
        <figcaption className="lr-figure__cap">{block.caption ?? block.title}</figcaption>
      </figure>
    );
  }

  return (
    <a className="lr-download" href={block.asset.url} rel="noopener">
      <span className="lr-download__label">{block.label}</span>
      {block.description ? <span className="lr-download__desc">{block.description}</span> : null}
    </a>
  );
}
