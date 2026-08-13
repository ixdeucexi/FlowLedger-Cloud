import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { flowLedgerUserGuidePageFromOffset } from "@/lib/userGuide";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

interface GuideItem {
  title: string;
  body: string;
  icon: FeatherName;
}

interface GuideSection {
  title: string;
  items: readonly GuideItem[];
}

interface GuideSlide {
  eyebrow: string;
  title: string;
  intro: string;
  icon: FeatherName;
  accent: string;
  image?: number;
  imageLabel?: string;
  imageCaption?: string;
  sections: readonly GuideSection[];
  callout: { title: string; body: string };
}

const GUIDE_SLIDES: readonly GuideSlide[] = [
  {
    eyebrow: "EVERYDAY MONEY PLANNING",
    title: "FlowLedger User Guide",
    intro:
      "A clear daily routine for your Dashboard, Activity, Forecast, debt plan, savings, and Flo.",
    icon: "compass",
    accent: "#9B5CFF",
    sections: [
      {
        title: "Your everyday path",
        items: [
          {
            title: "Dashboard",
            body: "See where your money stands now.",
            icon: "home",
          },
          {
            title: "Today's Decisions",
            body: "Handle one useful next step at a time.",
            icon: "sun",
          },
          {
            title: "Activity",
            body: "Review what changed in your accounts.",
            icon: "repeat",
          },
          {
            title: "Forecast",
            body: "Confirm what should happen next.",
            icon: "calendar",
          },
        ],
      },
    ],
    callout: {
      title: "FlowLedger plans—it does not send payments",
      body: "Continue paying bills and debts through your bank or provider.",
    },
  },
  {
    eyebrow: "STEP 1",
    title: "Start with a complete plan",
    intro: "Set up recurring money once, then review it whenever life changes.",
    icon: "check-circle",
    accent: "#22C7D6",
    image: require("../assets/images/user-guide/stability-sample.png"),
    imageLabel: "Example FlowLedger dashboard plan",
    imageCaption: "Fictional sample plan—your household will be different.",
    sections: [
      {
        title: "Setup checklist",
        items: [
          {
            title: "Checking",
            body: "Add or connect the account used for everyday cash flow.",
            icon: "credit-card",
          },
          {
            title: "Income",
            body: "Add recurring income and confirm each expected payday.",
            icon: "trending-up",
          },
          {
            title: "Bills",
            body: "Confirm amount, next date, and weekly, monthly, quarterly, or other frequency.",
            icon: "file-text",
          },
          {
            title: "Debts",
            body: "Enter the current balance, minimum payment, APR, and due date.",
            icon: "bar-chart-2",
          },
          {
            title: "Savings",
            body: "Add each account and give it a clear purpose name.",
            icon: "shield",
          },
          {
            title: "Forecast",
            body: "Make sure the next two weeks look like real life.",
            icon: "calendar",
          },
        ],
      },
    ],
    callout: {
      title: "One shared plan",
      body: "Phone and website use the same household data and calculations. Only the layout changes.",
    },
  },
  {
    eyebrow: "STEP 2",
    title: "Your daily 3-minute routine",
    intro:
      "Use the same short path each day. Go deeper only when something changed or needs review.",
    icon: "clock",
    accent: "#25D39B",
    image: require("../assets/images/user-guide/dashboard-sample.png"),
    imageLabel: "FlowLedger Dashboard and Today's Decisions",
    imageCaption:
      "Fictional sample data. Start on Dashboard, then follow the items that need attention.",
    sections: [
      {
        title: "Check these four places",
        items: [
          {
            title: "1. Dashboard",
            body: "Check balance, pending outflows, available money, and Flow Score.",
            icon: "home",
          },
          {
            title: "2. Today's Decisions",
            body: "Handle the few bills, debts, or choices that matter now.",
            icon: "sun",
          },
          {
            title: "3. Activity",
            body: "Review new transactions, matches, and anything needing attention.",
            icon: "repeat",
          },
          {
            title: "4. Forecast",
            body: "Scan upcoming days and confirm each projected close makes sense.",
            icon: "calendar",
          },
        ],
      },
    ],
    callout: {
      title: "If the day looks normal, you are done",
      body: "If something looks unfamiliar, open the related item before changing the plan.",
    },
  },
  {
    eyebrow: "STEP 3",
    title: "Bills, debts, and planned payments",
    intro:
      "Use Bills for recurring obligations. Switch to Debt to manage balances, minimums, or payoff order.",
    icon: "file-text",
    accent: "#F5B82E",
    image: require("../assets/images/user-guide/bills-debt-sample.png"),
    imageLabel: "FlowLedger Debt view and payoff planner",
    imageCaption:
      "Fictional sample data showing payoff order, rollover, and the planner entry.",
    sections: [
      {
        title: "Bills",
        items: [
          {
            title: "Keep the schedule current",
            body: "Edit amount, next date, and frequency when they change.",
            icon: "edit-3",
          },
          {
            title: "Record manual payments",
            body: "Mark a bill paid when it was paid outside a connected account.",
            icon: "check",
          },
          {
            title: "Close finished items",
            body: "Inactive bills should stop creating reminders and occurrences.",
            icon: "x-circle",
          },
        ],
      },
      {
        title: "Debt Payoff Planner",
        items: [
          {
            title: "Review the order",
            body: "See required payments and the current snowball or avalanche target.",
            icon: "list",
          },
          {
            title: "Check rollover",
            body: "Unused payoff money can move to the next debt in the plan.",
            icon: "corner-down-right",
          },
          {
            title: "Edit planned payments",
            body: "Change an amount or date when it no longer fits real life.",
            icon: "sliders",
          },
        ],
      },
    ],
    callout: {
      title: "Matched pending payments appear once",
      body: "A planned item matched to pending bank activity should show one Payment Pending item—not two charges.",
    },
  },
  {
    eyebrow: "STEP 4",
    title: "Forecast and Plan Simulator",
    intro:
      "Forecast shows when money should move and what each day's projected close will be.",
    icon: "calendar",
    accent: "#5CA6FF",
    image: require("../assets/images/user-guide/forecast-sample.png"),
    imageLabel: "FlowLedger Forecast calendar",
    imageCaption:
      "Fictional sample calendar. Open a day to review its projected close.",
    sections: [
      {
        title: "Read the calendar",
        items: [
          {
            title: "Inflows and outflows",
            body: "Calendar colors separate money coming in from bills and debts going out.",
            icon: "shuffle",
          },
          {
            title: "Open the day",
            body: "Tap a date to see every item behind its projected close.",
            icon: "search",
          },
          {
            title: "Verify status",
            body: "Matched pending payments should appear once with their current status.",
            icon: "check-square",
          },
          {
            title: "Ignore sync as an event",
            body: "Bank sync updates data; it is not itself a calendar cash event.",
            icon: "refresh-cw",
          },
        ],
      },
      {
        title: "Try a what-if",
        items: [
          {
            title: "Open Simulator",
            body: "Test income or expense changes without editing live data.",
            icon: "sliders",
          },
          {
            title: "Compare results",
            body: "Review the real plan beside the simulated outcome.",
            icon: "columns",
          },
          {
            title: "Leave safely",
            body: "Exit the simulator to return to the unchanged Forecast.",
            icon: "log-out",
          },
        ],
      },
    ],
    callout: {
      title: "Best daily habit",
      body: "Before the day ends, confirm the next few projected closes match what you expect.",
    },
  },
  {
    eyebrow: "STEP 5",
    title: "Savings and Flo",
    intro:
      "Use savings for purpose-based balances. Use Flo for explanations and guided next steps.",
    icon: "message-circle",
    accent: "#A76DFF",
    image: require("../assets/images/user-guide/flo-sample.png"),
    imageLabel: "Ask Flo conversation screen",
    imageCaption: "Fictional example of asking Flo about a household plan.",
    sections: [
      {
        title: "Savings",
        items: [
          {
            title: "Flip the full card",
            body: "Tap Savings on Dashboard to switch from checking to savings.",
            icon: "repeat",
          },
          {
            title: "Review accounts separately",
            body: "Each connected or manual savings balance appears on its own.",
            icon: "layers",
          },
          {
            title: "Name the purpose",
            body: "Use names like Emergency Fund, Vacation, Taxes, or Car Repair.",
            icon: "tag",
          },
        ],
      },
      {
        title: "Ask Flo",
        items: [
          {
            title: "Ask about the plan",
            body: "Check upcoming bills, recent changes, and items needing review.",
            icon: "help-circle",
          },
          {
            title: "Check sources",
            body: "Use freshness and source details when Flo provides them.",
            icon: "link",
          },
          {
            title: "Review before confirming",
            body: "Inspect every proposed plan change before applying it.",
            icon: "eye",
          },
          {
            title: "Hide when needed",
            body: "Press and hold the Flo icon to dismiss it for the current session.",
            icon: "eye-off",
          },
        ],
      },
    ],
    callout: {
      title: "Naming stays inside FlowLedger",
      body: "Renaming a savings account here does not rename the account at your bank.",
    },
  },
  {
    eyebrow: "STEP 6",
    title: "Notifications and in-app guidance",
    intro:
      "Use reminders to catch upcoming items and How It Works for a quick refresher.",
    icon: "bell",
    accent: "#FF9D4D",
    image: require("../assets/images/user-guide/notifications-sample.png"),
    imageLabel: "FlowLedger notifications panel",
    imageCaption: "Fictional reminders show how upcoming items are grouped.",
    sections: [
      {
        title: "Keep reminders useful",
        items: [
          {
            title: "Open the related item",
            body: "A reminder should take you directly to the bill or debt to review.",
            icon: "external-link",
          },
          {
            title: "Dismiss finished work",
            body: "Remove a reminder when it is complete.",
            icon: "x",
          },
          {
            title: "Close inactive items",
            body: "Paid-off or closed debts should stop creating future reminders.",
            icon: "archive",
          },
        ],
      },
      {
        title: "How It Works",
        items: [
          {
            title: "Start at Step 1",
            body: "The guide begins at the first section every time you open it fresh.",
            icon: "play",
          },
          {
            title: "Follow the highlighted step",
            body: "Next and Previous keep the selected tab and page in sync.",
            icon: "navigation",
          },
          {
            title: "Start at the top",
            body: "Every new guide page begins at the top of its content.",
            icon: "arrow-up",
          },
        ],
      },
    ],
    callout: {
      title: "Keep reminders accurate",
      body: "If a bill or debt is finished, update it so future reminders stop.",
    },
  },
  {
    eyebrow: "STEP 7",
    title: "When a number does not look right",
    intro:
      "Most differences come from status, recurrence, unmatched activity, or stale connected data.",
    icon: "tool",
    accent: "#FF6F91",
    sections: [
      {
        title: "Check in this order",
        items: [
          {
            title: "1. Refresh",
            body: "Refresh the app and allow connected accounts time to sync.",
            icon: "refresh-cw",
          },
          {
            title: "2. Check status",
            body: "See whether activity is pending, posted, matched, or needs review.",
            icon: "activity",
          },
          {
            title: "3. Check recurrence",
            body: "Confirm amount, next date, and the weekly, monthly, quarterly, or other frequency.",
            icon: "repeat",
          },
          {
            title: "4. Check active state",
            body: "Make sure the bill or debt is active—and close it if finished.",
            icon: "toggle-right",
          },
          {
            title: "5. Review Activity",
            body: "Look for unmatched or duplicate-looking items before changing a balance.",
            icon: "search",
          },
          {
            title: "6. Verify debt details",
            body: "Confirm balance and minimum payment when the bank did not provide them.",
            icon: "credit-card",
          },
          {
            title: "7. Recheck Forecast",
            body: "Open the affected day and verify the projected close after correcting data.",
            icon: "calendar",
          },
        ],
      },
      {
        title: "Quick glossary",
        items: [
          {
            title: "Pending",
            body: "Expected activity that has not fully posted or settled.",
            icon: "clock",
          },
          {
            title: "Available",
            body: "The balance after relevant pending outflows.",
            icon: "dollar-sign",
          },
          {
            title: "Flow Score",
            body: "A health signal based on the current FlowLedger plan.",
            icon: "bar-chart",
          },
          {
            title: "Projected close",
            body: "The expected balance at the end of a Forecast day.",
            icon: "flag",
          },
        ],
      },
    ],
    callout: {
      title: "Remember the routine",
      body: "Dashboard → Today's Decisions → Activity → Forecast. If those look right, your daily review is complete.",
    },
  },
] as const;

const GUIDE_SLIDE_INDEXES = GUIDE_SLIDES.map((_, index) => index);

interface GuideSlidePageProps {
  index: number;
  pageWidth: number;
  pageHeight: number;
  colors: ReturnType<typeof useColors>;
}

const GuideSlidePage = memo(function GuideSlidePage({
  index,
  pageWidth,
  pageHeight,
  colors,
}: GuideSlidePageProps) {
  const slide = GUIDE_SLIDES[index];
  const isCover = index === 0;

  return (
    <ScrollView
      accessibilityLabel={`Guide page ${index + 1} of ${GUIDE_SLIDES.length}: ${slide.title}`}
      directionalLockEnabled
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      style={{ width: pageWidth, height: pageHeight }}
      contentContainerStyle={styles.slideScrollContent}
    >
      <View style={styles.slideInner}>
        <View
          style={[
            styles.heroCard,
            !isCover ? styles.compactHeroCard : null,
            {
              backgroundColor: colors.card,
              borderColor: slide.accent + "55",
            },
          ]}
        >
          <View
            accessibilityElementsHidden
            style={[styles.heroGlow, { backgroundColor: slide.accent + "1F" }]}
          />
          {isCover ? (
            <Image
              accessibilityLabel="FlowLedger"
              source={require("../assets/images/startup_f_transparent.png")}
              contentFit="contain"
              style={styles.logo}
            />
          ) : (
            <View
              style={[
                styles.heroIcon,
                styles.compactHeroIcon,
                {
                  backgroundColor: slide.accent + "20",
                  borderColor: slide.accent + "55",
                },
              ]}
            >
              <Feather name={slide.icon} size={24} color={slide.accent} />
            </View>
          )}
          <Text style={[styles.eyebrow, { color: slide.accent }]}>
            {slide.eyebrow}
          </Text>
          <Text
            style={[
              styles.slideTitle,
              !isCover ? styles.compactSlideTitle : null,
              { color: colors.foreground },
            ]}
          >
            {slide.title}
          </Text>
          <Text
            style={[
              styles.intro,
              !isCover ? styles.compactIntro : null,
              { color: colors.mutedForeground },
            ]}
          >
            {slide.intro}
          </Text>
        </View>

        {slide.image ? (
          <View
            style={[
              styles.previewCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Image
              accessibilityLabel={slide.imageLabel}
              source={slide.image}
              contentFit="contain"
              transition={140}
              style={[
                styles.previewImage,
                {
                  height: Math.min(540, Math.max(430, pageWidth * 1.15)),
                },
              ]}
            />
            <Text
              style={[styles.previewCaption, { color: colors.mutedForeground }]}
            >
              {slide.imageCaption}
            </Text>
          </View>
        ) : null}

        {slide.sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {section.title}
            </Text>
            <View style={styles.itemList}>
              {section.items.map((item) => (
                <View
                  key={item.title}
                  style={[
                    styles.itemCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.itemIcon,
                      { backgroundColor: slide.accent + "1C" },
                    ]}
                  >
                    <Feather name={item.icon} size={17} color={slide.accent} />
                  </View>
                  <View style={styles.itemCopy}>
                    <Text
                      style={[styles.itemTitle, { color: colors.foreground }]}
                    >
                      {item.title}
                    </Text>
                    <Text
                      style={[
                        styles.itemBody,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {item.body}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}

        <View
          style={[
            styles.callout,
            {
              backgroundColor: slide.accent + "16",
              borderColor: slide.accent + "55",
            },
          ]}
        >
          <Feather name="zap" size={18} color={slide.accent} />
          <View style={styles.calloutCopy}>
            <Text style={[styles.calloutTitle, { color: colors.foreground }]}>
              {slide.callout.title}
            </Text>
            <Text
              style={[styles.calloutBody, { color: colors.mutedForeground }]}
            >
              {slide.callout.body}
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
});

export default function UserGuideScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const pageWidth = Math.max(width, 1);
  const pageHeight = Math.max(240, height - insets.top - insets.bottom - 184);
  const listRef = useRef<FlatList<number>>(null);
  const currentPageRef = useRef(0);
  const [currentPage, setCurrentPage] = useState(0);

  useEffect(() => {
    listRef.current?.scrollToOffset({
      offset: currentPageRef.current * pageWidth,
      animated: false,
    });
  }, [pageWidth]);

  const closeGuide = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/more?section=help" as never);
    }
  }, [router]);

  const goToPage = useCallback(
    (nextPage: number) => {
      const boundedPage = Math.max(
        0,
        Math.min(GUIDE_SLIDES.length - 1, nextPage),
      );
      currentPageRef.current = boundedPage;
      setCurrentPage(boundedPage);
      listRef.current?.scrollToOffset({
        offset: boundedPage * pageWidth,
        animated: true,
      });
      void Haptics.selectionAsync();
    },
    [pageWidth],
  );

  const handleNext = useCallback(() => {
    if (currentPage === GUIDE_SLIDES.length - 1) {
      closeGuide();
      return;
    }
    goToPage(currentPage + 1);
  }, [closeGuide, currentPage, goToPage]);

  const handleHorizontalScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextPage = flowLedgerUserGuidePageFromOffset(
        event.nativeEvent.contentOffset.x,
        pageWidth,
        GUIDE_SLIDES.length,
      );
      if (nextPage === currentPageRef.current) return;
      currentPageRef.current = nextPage;
      setCurrentPage(nextPage);
    },
    [pageWidth],
  );

  const renderSlide = useCallback(
    ({ item: index }: ListRenderItemInfo<number>) => (
      <GuideSlidePage
        index={index}
        pageWidth={pageWidth}
        pageHeight={pageHeight}
        colors={colors}
      />
    ),
    [colors, pageHeight, pageWidth],
  );

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerEyebrow, { color: colors.primary }]}>
            GUIDE
          </Text>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            How to use FlowLedger
          </Text>
          <Text style={[styles.headerHint, { color: colors.mutedForeground }]}>
            Swipe sideways • Scroll each page
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close user guide"
          hitSlop={8}
          onPress={closeGuide}
          style={({ pressed }) => [
            styles.closeButton,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather name="x" size={22} color={colors.foreground} />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        accessibilityLabel="FlowLedger User Guide pages"
        data={GUIDE_SLIDE_INDEXES}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({
          length: pageWidth,
          offset: pageWidth * index,
          index,
        })}
        horizontal
        initialNumToRender={2}
        keyExtractor={(index) => String(index)}
        maxToRenderPerBatch={2}
        nestedScrollEnabled
        onScroll={handleHorizontalScroll}
        pagingEnabled
        renderItem={renderSlide}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
        windowSize={3}
      />

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <View style={styles.progressRow}>
          <Text style={[styles.pageCount, { color: colors.mutedForeground }]}>
            Page {currentPage + 1} of {GUIDE_SLIDES.length}
          </Text>
          <View accessibilityElementsHidden style={styles.dots}>
            {GUIDE_SLIDES.map((slide, index) => (
              <View
                key={slide.title}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      index === currentPage ? slide.accent : colors.border,
                    width: index === currentPage ? 18 : 6,
                  },
                ]}
              />
            ))}
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous guide page"
            accessibilityState={{ disabled: currentPage === 0 }}
            disabled={currentPage === 0}
            onPress={() => goToPage(currentPage - 1)}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: currentPage === 0 ? 0.4 : pressed ? 0.72 : 1,
              },
            ]}
          >
            <Feather name="arrow-left" size={18} color={colors.foreground} />
            <Text style={[styles.actionText, { color: colors.foreground }]}>
              Previous
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              currentPage === GUIDE_SLIDES.length - 1
                ? "Finish user guide"
                : "Next guide page"
            }
            onPress={handleNext}
            style={({ pressed }) => [
              styles.actionButton,
              styles.primaryAction,
              { backgroundColor: colors.primary, opacity: pressed ? 0.78 : 1 },
            ]}
          >
            <Text
              style={[styles.actionText, { color: colors.primaryForeground }]}
            >
              {currentPage === GUIDE_SLIDES.length - 1 ? "Done" : "Next"}
            </Text>
            <Feather
              name={
                currentPage === GUIDE_SLIDES.length - 1
                  ? "check"
                  : "arrow-right"
              }
              size={18}
              color={colors.primaryForeground}
            />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    minHeight: 88,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerCopy: { flex: 1 },
  headerEyebrow: {
    fontFamily: "Inter_800ExtraBold",
    fontSize: 10,
    letterSpacing: 1.25,
  },
  headerTitle: { fontFamily: "Inter_800ExtraBold", fontSize: 20, marginTop: 1 },
  headerHint: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 2 },
  closeButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pager: { flex: 1, minHeight: 0 },
  slideScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  slideInner: { width: "100%", maxWidth: 720, alignSelf: "center", gap: 14 },
  heroCard: {
    minHeight: 176,
    borderWidth: 1,
    borderRadius: 24,
    overflow: "hidden",
    padding: 20,
  },
  compactHeroCard: { minHeight: 0, padding: 14 },
  heroGlow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    right: -72,
    top: -108,
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  compactHeroIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    marginBottom: 8,
  },
  logo: { width: 72, height: 72, borderRadius: 20, marginBottom: 14 },
  eyebrow: {
    fontFamily: "Inter_800ExtraBold",
    fontSize: 10,
    letterSpacing: 1.2,
  },
  slideTitle: {
    fontFamily: "Inter_800ExtraBold",
    fontSize: 26,
    lineHeight: 31,
    marginTop: 5,
    maxWidth: 560,
  },
  compactSlideTitle: {
    fontSize: 22,
    lineHeight: 26,
    marginTop: 3,
  },
  intro: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    maxWidth: 600,
  },
  compactIntro: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  previewCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 9,
    alignItems: "center",
  },
  previewImage: { width: "100%", borderRadius: 14 },
  previewCaption: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 8,
  },
  section: { gap: 9 },
  sectionTitle: { fontFamily: "Inter_800ExtraBold", fontSize: 18 },
  itemList: { gap: 8 },
  itemCard: {
    borderWidth: 1,
    borderRadius: 17,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
  },
  itemIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  itemCopy: { flex: 1, paddingTop: 1 },
  itemTitle: { fontFamily: "Inter_700Bold", fontSize: 14, lineHeight: 18 },
  itemBody: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  callout: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
  },
  calloutCopy: { flex: 1 },
  calloutTitle: { fontFamily: "Inter_700Bold", fontSize: 13, lineHeight: 18 },
  calloutBody: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  footer: {
    minHeight: 96,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  pageCount: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  dots: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { height: 6, borderRadius: 999 },
  actions: { flexDirection: "row", gap: 10 },
  actionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryAction: { borderWidth: 0 },
  actionText: { fontFamily: "Inter_700Bold", fontSize: 14 },
});
