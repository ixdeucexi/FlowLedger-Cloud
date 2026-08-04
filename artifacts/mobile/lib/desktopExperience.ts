export const DESKTOP_BREAKPOINT = 900;
export const WIDE_DESKTOP_BREAKPOINT = 1400;

export type DesktopExperienceEnvironment = {
  platform: string;
  viewportWidth: number;
  userAgent?: string;
  userAgentMobile?: boolean;
  maxTouchPoints?: number;
  standalone?: boolean;
};

const PHONE_USER_AGENT =
  /iPhone|iPod|Android[^;)]*Mobile|Windows Phone|IEMobile|Opera Mini|BlackBerry|webOS/i;
const TABLET_USER_AGENT = /iPad|Android/i;
const MAC_USER_AGENT = /Macintosh/i;

function isPhoneEnvironment({
  userAgent = "",
  userAgentMobile = false,
}: DesktopExperienceEnvironment) {
  return userAgentMobile || PHONE_USER_AGENT.test(userAgent);
}

function isTabletEnvironment({
  userAgent = "",
  maxTouchPoints = 0,
}: DesktopExperienceEnvironment) {
  const ipadUsingDesktopUserAgent =
    MAC_USER_AGENT.test(userAgent) && maxTouchPoints > 1;
  return TABLET_USER_AGENT.test(userAgent) || ipadUsingDesktopUserAgent;
}

/**
 * Keeps the existing phone and installed tablet PWA experience intact while
 * enabling the responsive desktop workspace for browser-sized web sessions.
 */
export function shouldUseDesktopExperience(
  environment: DesktopExperienceEnvironment,
) {
  if (environment.platform !== "web") return false;
  if (environment.viewportWidth < DESKTOP_BREAKPOINT) return false;
  if (isPhoneEnvironment(environment)) return false;
  if (environment.standalone && isTabletEnvironment(environment)) return false;
  return true;
}
