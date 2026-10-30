import { Platform } from "react-native";
import { decodeScenarioDraft, type ScenarioDraft } from "./planSimulationLibrary";

export function scenarioExportDocument(draft: ScenarioDraft) {
  const value = decodeScenarioDraft(draft, true);
  if (!value || value.invalidDefinition) throw new Error("Reset unsupported changes before exporting this working scenario. Your saved record is kept.");
  const name = value.name.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "scenario";
  return {
    filename: `FlowLedger-${name}.json`,
    content: JSON.stringify({ kind: "flowledger-plan-scenario", schemaVersion: 1, name: value.name, horizonMonths: value.horizonMonths, changes: value.changes }, null, 2),
  };
}

/** Exporting a customer's own definition stays available after a plan change. */
export async function exportPlanScenario(draft: ScenarioDraft, isCurrent: () => boolean): Promise<boolean> {
  const documentData = scenarioExportDocument(draft);
  if (!isCurrent()) return false;
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([documentData.content], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    try {
      if (!isCurrent()) return false;
      link.href = url;
      link.download = documentData.filename;
      document.body.appendChild(link);
      link.click();
      return true;
    } finally {
      link.remove();
      // Let the browser consume the download before releasing its Blob URL.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
  const [fileSystem, sharing] = await Promise.all([import("expo-file-system/legacy"), import("expo-sharing")]);
  if (!isCurrent()) return false;
  if (!(await sharing.isAvailableAsync()) || !fileSystem.cacheDirectory) throw new Error("File sharing is unavailable on this device.");
  if (!isCurrent()) return false;
  const uri = `${fileSystem.cacheDirectory}${Date.now()}-${Math.random().toString(36).slice(2)}-${documentData.filename}`;
  try {
    await fileSystem.writeAsStringAsync(uri, documentData.content, { encoding: fileSystem.EncodingType.UTF8 });
    if (!isCurrent()) return false;
    await sharing.shareAsync(uri, { mimeType: "application/json", dialogTitle: "Export scenario" });
    return true;
  } finally {
    await fileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  }
}
