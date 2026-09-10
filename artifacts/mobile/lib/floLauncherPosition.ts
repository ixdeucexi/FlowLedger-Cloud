export type FloPoint = { x: number; y: number };
export type FloBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};
export const FLO_DRAG_THRESHOLD = 8;
let sessionAnchor: FloPoint = { x: 1, y: 1 };

const finite = (value: number, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, finite(value, minimum)));

export function floLauncherBounds(
  frame: { width: number; height: number },
  footprint: { width: number; height: number },
  insets: { top: number; right: number; bottom: number; left: number },
  desktop: boolean,
): FloBounds {
  const maxLeft = Math.max(0, finite(frame.width) - footprint.width);
  const maxTop = Math.max(0, finite(frame.height) - footprint.height);
  const minX = Math.min(maxLeft, Math.max(0, insets.left) + 12);
  const minY = Math.min(maxTop, Math.max(0, insets.top) + 12);
  return {
    minX,
    minY,
    maxX: Math.max(
      minX,
      maxLeft - Math.max(0, insets.right) - (desktop ? 24 : 16),
    ),
    maxY: Math.max(
      minY,
      maxTop - Math.max(0, insets.bottom) - (desktop ? 24 : 98),
    ),
  };
}

export function clampFloPosition(point: FloPoint, bounds: FloBounds): FloPoint {
  return {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY),
  };
}

export function rememberFloPosition(point: FloPoint, bounds: FloBounds) {
  const position = clampFloPosition(point, bounds);
  sessionAnchor = {
    x:
      bounds.maxX > bounds.minX
        ? (position.x - bounds.minX) / (bounds.maxX - bounds.minX)
        : sessionAnchor.x,
    y:
      bounds.maxY > bounds.minY
        ? (position.y - bounds.minY) / (bounds.maxY - bounds.minY)
        : sessionAnchor.y,
  };
}

export function readFloPosition(bounds: FloBounds): FloPoint {
  return clampFloPosition(
    {
      x: bounds.minX + sessionAnchor.x * (bounds.maxX - bounds.minX),
      y: bounds.minY + sessionAnchor.y * (bounds.maxY - bounds.minY),
    },
    bounds,
  );
}

export function shouldStartFloDrag(dx: number, dy: number) {
  return (
    Number.isFinite(dx) &&
    Number.isFinite(dy) &&
    Math.hypot(dx, dy) >= FLO_DRAG_THRESHOLD
  );
}

export function createFloDragSession() {
  let origin: FloPoint = { x: 0, y: 0 };
  let current = origin;
  let suppress = false;
  let dragging = false;
  const begin = (point: FloPoint) => {
    origin = { ...point };
    current = origin;
    suppress = false;
    dragging = false;
  };
  return {
    begin,
    pressIn(point: FloPoint, event: object) {
      // Pointer origin is captured synchronously by the wrapper. Pressable can
      // deliver its press-in later, after the drag has already taken over.
      if ("key" in event && (event.key === "Enter" || event.key === " ")) {
        begin(point);
      }
    },
    move(dx: number, dy: number, bounds: FloBounds): FloPoint | null {
      dragging = dragging || shouldStartFloDrag(dx, dy);
      if (!dragging) return null;
      suppress = true;
      current = clampFloPosition(
        { x: origin.x + dx, y: origin.y + dy },
        bounds,
      );
      return current;
    },
    finish(bounds: FloBounds) {
      current = clampFloPosition(current, bounds);
      return current;
    },
    cancel(bounds: FloBounds) {
      suppress = true;
      current = clampFloPosition(current, bounds);
      return current;
    },
    suppressActivation() {
      suppress = true;
    },
    canActivate() {
      return !suppress;
    },
  };
}
