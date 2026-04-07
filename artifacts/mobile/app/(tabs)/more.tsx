import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Haptics from "expo-haptics";
import React, { useCallback, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import colors from "@/constants/colors";
import { useBudget } from "@/context/BudgetContext";
import { useColors } from "@/hooks/useColors";

export default function MoreScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { bills, importBills } = useBudget();
  const [importing, setImporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (bills.length === 0) {
      Alert.alert("No Data", "Add some bills before exporting.");
      return;
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const csvHeader = "Name,Amount,Category,Priority\n";
      const csvRows = bills
        .map(b => `"${b.name}",${b.amount},"${b.category}",${b.priority}`)
        .join("\n");
      const csvContent = csvHeader + csvRows;

      if (Platform.OS === "web") {
        const blob = new Blob([csvContent], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "budget_export.csv";
        a.click();
        URL.revokeObjectURL(url);
        Alert.alert("Exported", "Your budget data has been downloaded.");
      } else {
        const fileUri = FileSystem.documentDirectory + "budget_export.csv";
        await FileSystem.writeAsStringAsync(fileUri, csvContent);
        await Sharing.shareAsync(fileUri, { mimeType: "text/csv" });
      }
    } catch {
      Alert.alert("Error", "Failed to export data.");
    }
  }, [bills]);

  const handleImport = useCallback(async () => {
    try {
      setImporting(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel"],
      });

      if (result.canceled || !result.assets?.length) {
        setImporting(false);
        return;
      }

      const file = result.assets[0];
      let content: string;

      if (Platform.OS === "web") {
        const response = await fetch(file.uri);
        content = await response.text();
      } else {
        content = await FileSystem.readAsStringAsync(file.uri);
      }

      const lines = content.split("\n").filter(l => l.trim());
      if (lines.length < 2) {
        Alert.alert("Invalid File", "The file appears to be empty or invalid.");
        setImporting(false);
        return;
      }

      const imported: { name: string; amount: number; category: string; priority: number }[] = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",").map(p => p.replace(/"/g, "").trim());
        if (parts.length >= 2) {
          const amount = parseFloat(parts[1]);
          if (!isNaN(amount)) {
            imported.push({
              name: parts[0] || `Bill ${i}`,
              amount,
              category: parts[2] || "Other",
              priority: parseInt(parts[3]) || i,
            });
          }
        }
      }

      if (imported.length === 0) {
        Alert.alert("No Data", "No valid bills found in the file.");
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        importBills(imported);
        Alert.alert("Imported", `Successfully imported ${imported.length} bills.`);
      }
    } catch {
      Alert.alert("Error", "Failed to import file.");
    } finally {
      setImporting(false);
    }
  }, [importBills]);

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const menuItems = [
    {
      icon: "upload" as const,
      title: "Import Bills",
      description: "Import bills from a CSV file",
      onPress: handleImport,
      color: c.primary,
    },
    {
      icon: "download" as const,
      title: "Export Bills",
      description: "Export bills to a CSV file",
      onPress: handleExport,
      color: "#6366f1",
    },
  ];

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: c.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 12 + webTopPad, paddingBottom: insets.bottom + 100 },
      ]}
    >
      <Text style={[styles.title, { color: c.foreground }]}>More</Text>
      <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
        Import, export & manage your data
      </Text>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>Data</Text>
        {menuItems.map((item, i) => (
          <Pressable
            key={i}
            onPress={item.onPress}
            style={({ pressed }) => [
              styles.menuItem,
              { backgroundColor: c.card, borderRadius: colors.radius, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <View style={[styles.menuIcon, { backgroundColor: item.color + "15" }]}>
              <Feather name={item.icon} size={20} color={item.color} />
            </View>
            <View style={styles.menuInfo}>
              <Text style={[styles.menuTitle, { color: c.foreground }]}>{item.title}</Text>
              <Text style={[styles.menuDesc, { color: c.mutedForeground }]}>{item.description}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={c.mutedForeground} />
          </Pressable>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>CSV Format</Text>
        <View style={[styles.formatBox, { backgroundColor: c.card, borderRadius: colors.radius }]}>
          <Text style={[styles.formatText, { color: c.mutedForeground }]}>
            Name,Amount,Category,Priority{"\n"}
            "Electric Bill",150,"Utilities",1{"\n"}
            "Rent",1200,"Housing",2
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>Info</Text>
        <View style={[styles.infoCard, { backgroundColor: c.card, borderRadius: colors.radius }]}>
          <Feather name="info" size={18} color={c.primary} />
          <Text style={[styles.infoText, { color: c.mutedForeground }]}>
            Your data is stored locally on this device. Export regularly to keep a backup.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  menuInfo: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  menuDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  formatBox: {
    padding: 14,
  },
  formatText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
  },
  infoText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 18,
  },
});
