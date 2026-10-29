import { FlowWaveBackground } from "@/components/FlowWaveBackground";

type Props = { variant?: "blue" | "green" | "purple" };

/** One palette-aware backdrop keeps native, mobile web and desktop settings aligned. */
export function PremiumBackdrop({ variant = "blue" }: Props) {
  return <FlowWaveBackground variant={variant} />;
}
