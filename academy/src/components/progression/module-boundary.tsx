/** A faint seam where the route crosses from one module field into the next.
 *  Rendered inside the decorative route SVG (aria-hidden). */
export function ModuleBoundary({ x, y1, y2 }: { x: number; y1: number; y2: number }) {
  return (
    <line
      x1={x}
      y1={y1}
      x2={x}
      y2={y2}
      stroke="var(--gate-boundary)"
      strokeWidth={1}
      strokeDasharray="3 6"
      opacity={0.3}
      vectorEffect="non-scaling-stroke"
    />
  );
}
