import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/haptics";
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
import guideSlidesContent from "@/lib/userGuideContent.json";

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
  sections: readonly GuideSection[];
  callout: { title: string; body: string };
}

const GUIDE_SLIDES = guideSlidesContent as readonly GuideSlide[];

const GUIDE_SLIDE_INDEXES = GUIDE_SLIDES.map((_, index) => index);

interface GuideSlidePageProps {
  active: boolean;
  index: number;
  pageWidth: number;
  pageHeight: number;
  colors: ReturnType<typeof useColors>;
}

const GuideSlidePage = memo(function GuideSlidePage({
  active,
  index,
  pageWidth,
  pageHeight,
  colors,
}: GuideSlidePageProps) {
  const slide = GUIDE_SLIDES[index];
  const isCover = index === 0;

  return (
    <ScrollView
      accessibilityElementsHidden={!active}
      accessibilityLabel={`Guide page ${index + 1} of ${GUIDE_SLIDES.length}: ${slide.title}`}
      directionalLockEnabled
      nestedScrollEnabled
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
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
            accessibilityRole="header"
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

        {slide.sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text
              accessibilityRole="header"
              style={[styles.sectionTitle, { color: colors.foreground }]}
            >
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
        active={index === currentPage}
        index={index}
        pageWidth={pageWidth}
        pageHeight={pageHeight}
        colors={colors}
      />
    ),
    [colors, currentPage, pageHeight, pageWidth],
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
          <Text
            accessibilityRole="header"
            style={[styles.headerTitle, { color: colors.foreground }]}
          >
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
        extraData={currentPage}
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
          <Text
            accessibilityLabel={`Guide page ${currentPage + 1} of ${GUIDE_SLIDES.length}: ${GUIDE_SLIDES[currentPage]?.title ?? ""}`}
            accessibilityLiveRegion="polite"
            style={[styles.pageCount, { color: colors.mutedForeground }]}
          >
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
    minHeight: 96,
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
  headerTitle: { fontFamily: "Inter_800ExtraBold", fontSize: 23, letterSpacing: -0.45, marginTop: 1 },
  headerHint: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 2 },
  closeButton: {
    width: 46,
    height: 46,
    borderRadius: 18,
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
    borderRadius: 28,
    overflow: "hidden",
    padding: 20,
  },
  compactHeroCard: { minHeight: 0, padding: 14 },
  heroGlow: { position: "absolute", width: 180, height: 180, borderRadius: 90, right: -70, top: -100, opacity: 0.55 },
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
  section: { gap: 9 },
  sectionTitle: { fontFamily: "Inter_800ExtraBold", fontSize: 18 },
  itemList: { gap: 8 },
  itemCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
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
    borderRadius: 20,
    padding: 15,
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
