import { FlowWaveBackground } from "@/components/FlowWaveBackground";

type Props = {
  variant?: "blue" | "green" | "purple";
};

export function PremiumBackdrop({ variant = "blue" }: Props) {
  return <FlowWaveBackground variant={variant} />;
}
