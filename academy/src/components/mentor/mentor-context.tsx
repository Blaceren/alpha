import type { MentorMessage } from "@/domain/home";
import { MentorMediaPlaceholder } from "@/components/mentor/mentor-media-placeholder";

/** Alex Curie contextual message tied to the current step. Name is separate text. */
export function MentorContext({
  message,
  frameSize = 56,
  showName = true,
}: {
  message: MentorMessage;
  frameSize?: number;
  showName?: boolean;
}) {
  return (
    <figure className="mentor">
      <MentorMediaPlaceholder size={frameSize} />
      <figcaption>
        {showName && (
          <p className="who">
            Alex Curie <span>· наставник курса</span>
          </p>
        )}
        <p className="quote">{message.text}</p>
      </figcaption>
    </figure>
  );
}
