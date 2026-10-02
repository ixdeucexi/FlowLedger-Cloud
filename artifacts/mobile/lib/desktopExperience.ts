export const DESKTOP_BREAKPOINT = 1024;
export const WIDE_DESKTOP_BREAKPOINT = 1400;

export type DesktopExperienceEnvironment = {
  platform: string;
  viewportWidth: number;
  userAgent?: string;
  userAgentMobile?: boolean;
  maxTouchPoints?: number;
  standalone?: boolean;
};

/**
 * FlowLedger intentionally uses one responsive product experience everywhere.
 *
 * The former desktop workspace rendered separate page components, so website
 * users could miss controls that already existed in the PWA. Keeping this
 * decision in one helper prevents browser width or install state from silently
 * switching users onto a second, incomplete implementation.
 */
export function shouldUseDesktopExperience(
  _environment: DesktopExperienceEnvironment,
) {
  return false;
}
