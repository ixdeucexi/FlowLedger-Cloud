import { useEffect } from "react";
import { overlayActivity } from "@/lib/overlayActivity";
export function useOverlayActivity(active: boolean) {
  useEffect(() => {
    if (active) return overlayActivity.register();
  }, [active]);
}
