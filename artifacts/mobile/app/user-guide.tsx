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
import { FLOWLEDGER_USER_GUIDE_PAGE_TITLES } from "@/lib/userGuide";

const PAGE_ASPECT_RATIO = 1430 / 1105;

const USER_GUIDE_PAGES = [
  require("../assets/images/user-guide/page-1.png"),
  require("../assets/images/user-guide/page-2.png"),
  require("../assets/images/user-guide/page-3.png"),
  require("../assets/images/user-guide/page-4.png"),
  require("../assets/images/user-guide/page-5.png"),
  require("../assets/images/user-guide/page-6.png"),
  require("../assets/images/user-guide/page-7.png"),
  require("../assets/images/user-guide/page-8.png"),
] as const;
const USER_GUIDE_PAGE_INDEXES = USER_GUIDE_PAGES.map((_, index) => index);

interface GuidePageProps {
  index: number;
  pageWidth: number;
  imageWidth: number;
  imageHeight: number;
}

const GuidePage = memo(function GuidePage({
  index,
  pageWidth,
  imageWidth,
  imageHeight,
}: GuidePageProps) {
  return (
    <View style={[styles.page, { width: pageWidth }]}>
      <Image
        accessibilityLabel={`Page ${index + 1} of ${USER_GUIDE_PAGES.length}: ${FLOWLEDGER_USER_GUIDE_PAGE_TITLES[index]}`}
        source={USER_GUIDE_PAGES[index]}
        contentFit="contain"
        transition={120}
        style={[styles.pageImage, { width: imageWidth, height: imageHeight }]}
      />
    </View>
  );
});

export default function UserGuideScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const listRef = useRef<FlatList<number>>(null);
  const currentPageRef = useRef(0);
  const [currentPage, setCurrentPage] = useState(0);

  const availableHeight = Math.max(
    120,
    height - insets.top - insets.bottom - 220,
  );
  const imageWidth = Math.min(width - 28, availableHeight / PAGE_ASPECT_RATIO);
  const imageHeight = imageWidth * PAGE_ASPECT_RATIO;

  useEffect(() => {
    listRef.current?.scrollToOffset({
      offset: currentPageRef.current * width,
      animated: false,
    });
  }, [width]);

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
        Math.min(USER_GUIDE_PAGES.length - 1, nextPage),
      );
      currentPageRef.current = boundedPage;
      setCurrentPage(boundedPage);
      listRef.current?.scrollToOffset({
        offset: boundedPage * width,
        animated: true,
      });
      void Haptics.selectionAsync();
    },
    [width],
  );

  const handleNext = useCallback(() => {
    if (currentPage === USER_GUIDE_PAGES.length - 1) {
      closeGuide();
      return;
    }
    goToPage(currentPage + 1);
  }, [closeGuide, currentPage, goToPage]);

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextPage = Math.round(event.nativeEvent.contentOffset.x / width);
      const boundedPage = Math.max(
        0,
        Math.min(USER_GUIDE_PAGES.length - 1, nextPage),
      );
      currentPageRef.current = boundedPage;
      setCurrentPage(boundedPage);
    },
    [width],
  );

  const renderPage = useCallback(
    ({ item: index }: ListRenderItemInfo<number>) => (
      <GuidePage
        index={index}
        pageWidth={width}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
      />
    ),
    [imageHeight, imageWidth, width],
  );

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>GUIDE</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>
            How to use FlowLedger
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Swipe left or right to change pages
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
        data={USER_GUIDE_PAGE_INDEXES}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        horizontal
        initialNumToRender={2}
        keyExtractor={(index) => String(index)}
        maxToRenderPerBatch={2}
        onMomentumScrollEnd={handleMomentumEnd}
        pagingEnabled
        renderItem={renderPage}
        showsHorizontalScrollIndicator={false}
        windowSize={3}
      />

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <View style={styles.progressRow}>
          <Text style={[styles.pageCount, { color: colors.mutedForeground }]}>
            Page {currentPage + 1} of {USER_GUIDE_PAGES.length}
          </Text>
          <View accessibilityElementsHidden style={styles.dots}>
            {USER_GUIDE_PAGES.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      index === currentPage ? colors.primary : colors.border,
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
              currentPage === USER_GUIDE_PAGES.length - 1
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
              {currentPage === USER_GUIDE_PAGES.length - 1 ? "Done" : "Next"}
            </Text>
            <Feather
              name={
                currentPage === USER_GUIDE_PAGES.length - 1
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
    minHeight: 90,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerCopy: { flex: 1 },
  eyebrow: {
    fontFamily: "Inter_800ExtraBold",
    fontSize: 11,
    letterSpacing: 1.2,
  },
  title: { fontFamily: "Inter_800ExtraBold", fontSize: 21, marginTop: 2 },
  subtitle: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 3 },
  closeButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  page: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  pageImage: {
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
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
