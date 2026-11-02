export type HexColor = `#${string}`;
export interface HsvColor { h: number; s: number; v: number }

/** Opaque hex only. Never accepts alpha, CSS functions, names or URLs. */
export function normalizeHexColor(value: unknown): HexColor | undefined {
  if (typeof value !== "string") return undefined;
  const hex = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex as HexColor;
  if (/^#[0-9a-f]{3}$/.test(hex)) return ("#" + [...hex.slice(1)].map(char => char + char).join("")) as HexColor;
  return undefined;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const rgbHex = (values: readonly number[]) => ("#" + values.map(value => Math.round(value).toString(16).padStart(2, "0")).join("")) as HexColor;

export function hexToHsv(value: unknown): HsvColor | null {
  const hex = normalizeHexColor(value);
  if (!hex) return null;
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), difference = max - min;
  const hue = !difference ? 0 : max === r ? ((g - b) / difference) % 6 : max === g ? (b - r) / difference + 2 : (r - g) / difference + 4;
  return { h: (hue * 60 + 360) % 360, s: max ? difference / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: HsvColor): HexColor | undefined {
  if (![h, s, v].every(Number.isFinite)) return undefined;
  const hue = ((h % 360) + 360) % 360 / 60, saturation = clamp(s), value = clamp(v);
  const chroma = value * saturation, x = chroma * (1 - Math.abs(hue % 2 - 1)), m = value - chroma;
  const rgb = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return rgbHex(rgb.map(channel => (channel + m) * 255));
}

/** Resolve existing internal RGBA surfaces over an opaque app background. */
export function compositeColor(color: string, background: string): HexColor {
  const opaque = normalizeHexColor(color);
  if (opaque) return opaque;
  const base = normalizeHexColor(background) ?? "#000000";
  const rgba = /^rgba\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d*(?:\.\d+)?)\s*\)$/.exec(color);
  if (!rgba) return base;
  const [r, g, b, alpha] = rgba.slice(1).map(Number);
  if (![r, g, b, alpha].every(Number.isFinite) || [r, g, b].some(channel => channel < 0 || channel > 255) || alpha < 0 || alpha > 1) return base;
  return rgbHex([r, g, b].map((channel, index) => channel * alpha + parseInt(base.slice(1 + index * 2, 3 + index * 2), 16) * (1 - alpha)));
}
