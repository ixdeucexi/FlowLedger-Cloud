import {
  defaultAlgorithmToggles,
  type AlgorithmId,
} from "@/lib/algorithmCatalog";

export interface DecisionHubSettings {
  algorithmSuiteEnabled: boolean;
  algorithmToggles: Record<AlgorithmId, boolean>;
}

export const DEFAULT_DECISION_HUB_SETTINGS: DecisionHubSettings = {
  algorithmSuiteEnabled: true,
  algorithmToggles: defaultAlgorithmToggles(),
};
