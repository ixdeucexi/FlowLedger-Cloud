import { FlowWaveBackground } from "@/components/FlowWaveBackground";
import { useThemeMode } from "@/context/ThemeContext";

type Props = {
  variant?: "blue" | "green" | "purple";
};

export function PremiumBackdrop({ variant = "blue" }: Props) {
  const { lightningFlashesEnabled } = useThemeMode();
  return <FlowWaveBackground variant={variant} flashesEnabled={lightningFlashesEnabled} />;
}
