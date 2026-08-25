import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { PremiumBackdrop } from "@/components/PremiumBackdrop";
import { useColors } from "@/hooks/useColors";
import { useBackDismiss } from "@/hooks/useBackDismiss";
import { useDesktopExperience } from "@/hooks/useDesktopExperience";
import {
  ALGORITHM_GUIDE,
  FLOWLEDGER_MONEY_RULES,
  FLOW_GUIDE_SECTIONS,
  STABILITY_PATH_GUIDE,
  flowGuideSectionIndex,
  guideTabScrollOffset,
} from "@/lib/flowledgerGuide";
import { FLOW_SCORE_GUIDE, FLOW_SCORE_MAX_POINTS } from "@/lib/flowScorePolicy";
import type { StabilityStage } from "@/lib/stability";

function param(value: string | string[] | undefined, fallback: string) {
  return Array.isArray(value) ? value[0] ?? fallback : value ?? fallback;
}

function optionalParam(value: string | string[] | undefined) {
  const normalized = Array.isArray(value) ? value[0] : value;
  return normalized?.trim() ? normalized : undefined;
}

function amount(value: string | string[] | undefined) {
  const normalized = optionalParam(value);
  if (normalized === undefined) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function currency(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function HowFlowLedgerWorksScreen() {
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const isDesktop = useDesktopExperience();
  const { height } = useWindowDimensions();
  const params = useLocalSearchParams<{
    section?: string;
    stage?: string;
    stageLabel?: string;
    protectedDays?: string;
    protectedAmount?: string;
    reserveTarget?: string;
    backupTarget?: string;
    safeUntilPayday?: string;
    nextPaycheckLabel?: string;
    nextAction?: string;
    nextMilestone?: string;
    nextMilestoneAmount?: string;
    lowestBalance?: string;
    safetyFloor?: string;
    confidence?: string;
    flowScore?: string;
    flowScoreLabel?: string;
    flowScorePlanCoverage?: string;
    flowScoreMustPay?: string;
    flowScoreBackup?: string;
  }>();
  const routeSection = param(params.section, "overview");
  const [sectionIndex, setSectionIndex] = useState(() => flowGuideSectionIndex(routeSection));
  const sectionNavRef = useRef<ScrollView>(null);
  const contentScrollRef = useRef<ScrollView>(null);
  const sectionNavViewport = useRef({ width: 0, height: 0 });
  const sectionTabLayouts = useRef<Record<number, { x: number; y: number; width: number; height: number }>>({});
  const section = FLOW_GUIDE_SECTIONS[sectionIndex];
  const lastSection = sectionIndex === FLOW_GUIDE_SECTIONS.length - 1;

  const scrollSectionTabIntoView = useCallback((index: number, animated = true) => {
    const tab = sectionTabLayouts.current[index];
    const viewport = sectionNavViewport.current;
    if (!tab) return;

    if (isDesktop && viewport.height > 0) {
      sectionNavRef.current?.scrollTo({
        y: guideTabScrollOffset(tab.y, tab.height, viewport.height),
        animated,
      });
      return;
    }

    if (!isDesktop && viewport.width > 0) {
      sectionNavRef.current?.scrollTo({
        x: guideTabScrollOffset(tab.x, tab.width, viewport.width),
        animated,
      });
    }
  }, [isDesktop]);

  useEffect(() => {
    setSectionIndex(flowGuideSectionIndex(routeSection));
  }, [routeSection]);

  useEffect(() => {
    contentScrollRef.current?.scrollTo({ y: 0, animated: false });
    const frame = requestAnimationFrame(() => scrollSectionTabIntoView(sectionIndex));
    return () => cancelAnimationFrame(frame);
  }, [scrollSectionTabIntoView, sectionIndex]);

  const facts = useMemo(() => readGuideFacts(params), [
    params.backupTarget,
    params.confidence,
    params.flowScore,
    params.flowScoreBackup,
    params.flowScoreLabel,
    params.flowScoreMustPay,
    params.flowScorePlanCoverage,
    params.lowestBalance,
    params.nextAction,
    params.nextMilestone,
    params.nextMilestoneAmount,
    params.nextPaycheckLabel,
    params.protectedAmount,
    params.protectedDays,
    params.reserveTarget,
    params.safeUntilPayday,
    params.safetyFloor,
    params.stage,
    params.stageLabel,
  ]);
  const currentStageIndex = facts
    ? STABILITY_PATH_GUIDE.findIndex(step => step.id === facts.stage)
    : null;

  const close = () => router.canGoBack() ? router.back() : router.replace("/(tabs)" as any);
  useBackDismiss(true, close);
  const goTo = (index: number) => {
    const bounded = Math.max(0, Math.min(FLOW_GUIDE_SECTIONS.length - 1, index));
    setSectionIndex(bounded);
    router.setParams({ section: FLOW_GUIDE_SECTIONS[bounded].id } as never);
  };
  const walkthroughHeight = isDesktop ? Math.min(864, Math.max(480, height - 36)) : undefined;

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: isDesktop ? 18 : insets.top }]}>
      <PremiumBackdrop variant="purple" />
      <View style={[styles.walkthrough, isDesktop ? styles.walkthroughDesktop : styles.walkthroughMobile, { backgroundColor: c.card, borderColor: c.border, height: walkthroughHeight }]}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <View style={styles.headerCopy}>
            <AppText tone="label" style={[styles.eyebrow, { color: c.primary }]}>HOW FLOWLEDGER WORKS</AppText>
            <AppText accessibilityRole="header" tone="title" style={[styles.title, { color: c.foreground }]}>{section.title}</AppText>
            <AppText style={[styles.subtitle, { color: c.mutedForeground }]}>{section.description}</AppText>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close How FlowLedger works" onPress={close} style={({ pressed }) => [styles.closeButton, { backgroundColor: c.muted, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
            <Feather name="x" size={20} color={c.foreground} />
          </Pressable>
        </View>

        <View style={[styles.body, isDesktop && styles.bodyDesktop]}>
          {isDesktop ? (
            <ScrollView
              ref={sectionNavRef}
              accessibilityRole="tablist"
              style={[styles.sectionNav, { borderRightColor: c.border }]}
              contentContainerStyle={styles.sectionNavContent}
              showsVerticalScrollIndicator={false}
              onLayout={({ nativeEvent: { layout } }) => {
                sectionNavViewport.current = layout;
                requestAnimationFrame(() => scrollSectionTabIntoView(sectionIndex, false));
              }}
            >
              {FLOW_GUIDE_SECTIONS.map((item, index) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: index === sectionIndex }}
                  onLayout={({ nativeEvent: { layout } }) => {
                    sectionTabLayouts.current[index] = layout;
                    if (index === sectionIndex) requestAnimationFrame(() => scrollSectionTabIntoView(index, false));
                  }}
                  onPress={() => goTo(index)}
                  style={({ pressed }) => [styles.navItem, index === sectionIndex && { backgroundColor: c.primary + "18", borderColor: c.primary + "45" }, { opacity: pressed ? 0.76 : 1 }]}
                >
                  <View style={[styles.navNumber, { backgroundColor: index <= sectionIndex ? c.primary : c.muted }]}><AppText tone="label" style={[styles.navNumberText, { color: index <= sectionIndex ? c.primaryForeground : c.foreground }]}>{index + 1}</AppText></View>
                  <View style={styles.navCopy}><AppText style={[styles.navTitle, { color: index === sectionIndex ? c.primary : c.foreground }]}>{item.title}</AppText><AppText numberOfLines={2} style={[styles.navDescription, { color: c.mutedForeground }]}>{item.description}</AppText></View>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <ScrollView
              ref={sectionNavRef}
              horizontal
              style={styles.mobileSectionNav}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.mobileStepStrip}
              accessibilityRole="tablist"
              onLayout={({ nativeEvent: { layout } }) => {
                sectionNavViewport.current = layout;
                requestAnimationFrame(() => scrollSectionTabIntoView(sectionIndex, false));
              }}
            >
              {FLOW_GUIDE_SECTIONS.map((item, index) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: index === sectionIndex }}
                  onLayout={({ nativeEvent: { layout } }) => {
                    sectionTabLayouts.current[index] = layout;
                    if (index === sectionIndex) requestAnimationFrame(() => scrollSectionTabIntoView(index, false));
                  }}
                  onPress={() => goTo(index)}
                  style={[styles.mobileStep, { backgroundColor: index === sectionIndex ? c.primary : c.muted, borderColor: index === sectionIndex ? c.primary : c.border }]}
                >
                  <AppText style={[styles.mobileStepText, { color: index === sectionIndex ? c.primaryForeground : c.mutedForeground }]}>{index + 1}. {item.title}</AppText>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <ScrollView ref={contentScrollRef} style={styles.contentScroll} contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
            <GuideSection
              id={section.id}
              c={c}
              facts={facts}
              currentStageIndex={currentStageIndex}
            />
          </ScrollView>
        </View>

        <View style={[styles.footer, !isDesktop && styles.footerMobile, { borderTopColor: c.border, paddingBottom: isDesktop ? 14 : Math.max(14, insets.bottom) }]}>
          <View style={styles.progressCopy}><AppText style={[styles.progressText, { color: c.mutedForeground }]}>Section {sectionIndex + 1} of {FLOW_GUIDE_SECTIONS.length}</AppText><View style={[styles.progressTrack, { backgroundColor: c.muted }]}><View style={[styles.progressFill, { backgroundColor: c.primary, width: `${((sectionIndex + 1) / FLOW_GUIDE_SECTIONS.length) * 100}%` }]} /></View></View>
          <View style={styles.footerActions}>
            {sectionIndex > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Previous section" onPress={() => goTo(sectionIndex - 1)} style={[styles.secondaryButton, { borderColor: c.border }]}><Feather name="arrow-left" size={15} color={c.foreground} /><AppText tone="button" style={[styles.secondaryText, { color: c.foreground }]}>Previous</AppText></Pressable> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={lastSection ? "Close How FlowLedger works" : "Next section"} onPress={() => lastSection ? close() : goTo(sectionIndex + 1)} style={[styles.primaryButton, { backgroundColor: c.primary }]}><AppText tone="button" style={[styles.primaryText, { color: c.primaryForeground }]}>{lastSection ? "Got it" : "Next"}</AppText><Feather name={lastSection ? "check" : "arrow-right"} size={15} color={c.primaryForeground} /></Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

type GuideFacts = {
  stage: StabilityStage;
  stageLabel: string;
  protectedDays: number;
  protectedAmount: number;
  reserveTarget: number;
  backupTarget: number;
  safeUntilPayday: boolean | null;
  nextPaycheckLabel?: string;
  nextAction: string;
  nextMilestone: string;
  nextMilestoneAmount: number;
  lowestBalance: number;
  safetyFloor: number;
  confidence: string;
  flowScore: number;
  flowScoreLabel: string;
  flowScorePlanCoverage: number | null;
  flowScoreMustPay: number | null;
  flowScoreBackup: number | null;
};

function readGuideFacts(params: Record<string, string | string[] | undefined>): GuideFacts | null {
  const stage = optionalParam(params.stage) as StabilityStage | undefined;
  const stageLabel = optionalParam(params.stageLabel);
  const nextAction = optionalParam(params.nextAction);
  const nextMilestone = optionalParam(params.nextMilestone);
  const confidence = optionalParam(params.confidence);
  const flowScoreLabel = optionalParam(params.flowScoreLabel);
  const safeUntilPayday = optionalParam(params.safeUntilPayday);
  const protectedDays = amount(params.protectedDays);
  const protectedAmount = amount(params.protectedAmount);
  const reserveTarget = amount(params.reserveTarget);
  const backupTarget = amount(params.backupTarget);
  const nextMilestoneAmount = amount(params.nextMilestoneAmount);
  const lowestBalance = amount(params.lowestBalance);
  const safetyFloor = amount(params.safetyFloor);
  const flowScore = amount(params.flowScore);
  const flowScorePlanCoverage = amount(params.flowScorePlanCoverage);
  const flowScoreMustPay = amount(params.flowScoreMustPay);
  const flowScoreBackup = amount(params.flowScoreBackup);
  const validStage = stage && STABILITY_PATH_GUIDE.some(step => step.id === stage);

  if (
    !validStage || !stageLabel || !nextAction || !nextMilestone || !confidence || !flowScoreLabel ||
    !safeUntilPayday || !["true", "false", "unknown"].includes(safeUntilPayday) ||
    protectedDays === null || protectedAmount === null || reserveTarget === null || backupTarget === null ||
    nextMilestoneAmount === null || lowestBalance === null || safetyFloor === null || flowScore === null
  ) return null;

  return {
    stage,
    stageLabel,
    protectedDays,
    protectedAmount,
    reserveTarget,
    backupTarget,
    safeUntilPayday: safeUntilPayday === "unknown" ? null : safeUntilPayday === "true",
    nextPaycheckLabel: optionalParam(params.nextPaycheckLabel),
    nextAction,
    nextMilestone,
    nextMilestoneAmount,
    lowestBalance,
    safetyFloor,
    confidence,
    flowScore,
    flowScoreLabel,
    flowScorePlanCoverage,
    flowScoreMustPay,
    flowScoreBackup,
  };
}

function GuideSection({ id, c, facts, currentStageIndex }: { id: (typeof FLOW_GUIDE_SECTIONS)[number]["id"]; c: ReturnType<typeof useColors>; facts: GuideFacts | null; currentStageIndex: number | null }) {
  if (id === "overview") return <>
    <InfoCard c={c} eyebrow={facts ? "YOUR CURRENT POSITION" : "YOUR PLAN"} title={facts?.stageLabel ?? "Live guidance appears when your plan is ready"} icon="compass">
      {facts ? <View style={styles.metricGrid}><Metric c={c} label="Safe to payday" value={facts.safeUntilPayday === true ? `Yes - ${facts.nextPaycheckLabel ?? "next payday"}` : facts.safeUntilPayday === false ? "Not yet" : "Needs pay date"} /><Metric c={c} label="Protected Days" value={`${facts.protectedDays} days`} /><Metric c={c} label="Forecast confidence" value={facts.confidence} /></View> : <AppText style={[styles.bodyText, { color: c.mutedForeground }]}>Add Must Pay bills, income, and current balances to see where you stand without guessing.</AppText>}
    </InfoCard>
    <SectionTitle c={c} title="One plan, one forecast" description="The same balances, bills, income, and plan shape every view." />
    <InfoCard c={c} title="How FlowLedger builds your guidance" icon="layers"><Bullet c={c} text="Posted bank activity and your saved plan feed one forecast." /><Bullet c={c} text="The tightest upcoming forecast point shows how much breathing room is protected." /><Bullet c={c} text="Guidance protects Must Pay bills and your safety floor first." /></InfoCard>
  </>;

  if (id === "flow-score") return <>
    <View style={[styles.scoreHero, { backgroundColor: c.primary + "14", borderColor: c.primary + "40" }]}><View><AppText tone="label" style={[styles.cardEyebrow, { color: c.primary }]}>YOUR FLOW SCORE</AppText><AppText tone="number" style={[styles.scoreValue, { color: c.foreground }]}>{facts ? `${facts.flowScore}/${FLOW_SCORE_MAX_POINTS}` : "Add your plan"}</AppText></View><AppText tone="title" style={[styles.scoreStatus, { color: c.primary }]}>{facts?.flowScoreLabel ?? "Not calculated"}</AppText></View>
    {facts && facts.flowScorePlanCoverage !== null && facts.flowScoreMustPay !== null && facts.flowScoreBackup !== null ? <View style={styles.metricGrid}><Metric c={c} label="Plan to next payday" value={`${facts.flowScorePlanCoverage}/40`} /><Metric c={c} label="Must Pay current" value={`${facts.flowScoreMustPay}/30`} /><Metric c={c} label="Backup progress" value={`${facts.flowScoreBackup}/30`} /></View> : null}
    <SectionTitle c={c} title="What shapes your score" description="Three clear parts add to 100. Forecast confidence is shown separately and never changes the number." />
    <InfoCard c={c}>{FLOW_SCORE_GUIDE.map(item => <View key={item.id} style={[styles.listRow, { borderBottomColor: c.border }]}><View style={styles.listCopy}><AppText style={[styles.listTitle, { color: c.foreground }]}>{item.label}</AppText><AppText style={[styles.listDescription, { color: c.mutedForeground }]}>{item.description}</AppText></View><AppText tone="label" style={[styles.points, { color: c.primary }]}>up to {item.points}</AppText></View>)}</InfoCard>
    {facts ? <InfoCard c={c} eyebrow="FORECAST CONFIDENCE" title={`${facts.confidence} - not scored`} icon="shield"><AppText style={[styles.bodyText, { color: c.mutedForeground }]}>Confidence tells you how current and complete the plan inputs are. It never adds or removes Flow Score points.</AppText></InfoCard> : null}
  </>;

  if (id === "protected-days") return <>
    <InfoCard c={c} eyebrow="PROTECTED DAYS" title={facts ? `${facts.protectedDays} days backed up` : "How long your backup can protect Must Pay expenses"} icon="shield"><AppText style={[styles.bodyText, { color: c.mutedForeground }]}>Protected Days estimates how many days of Must Pay expenses your backup money can cover.</AppText></InfoCard>
    <SectionTitle c={c} title="How the calculation works" description={facts ? "These values come directly from your active forecast." : "Your live amounts appear after your plan and forecast are ready."} />
    <InfoCard c={c}>
      {facts ? <>
        <Calculation c={c} label="Tightest upcoming forecast point" value={currency(facts.lowestBalance)} />
        <Calculation c={c} label="Minus safety floor" value={`- ${currency(facts.safetyFloor)}`} />
        <Calculation c={c} label="Backup money" value={currency(facts.protectedAmount)} emphasized />
        <Calculation c={c} label="30 days of Must Pay expenses" value={currency(facts.reserveTarget)} />
      </> : null}
      <Calculation c={c} label="One protected day" value="30-day Must Pay total / 30" />
      <Calculation c={c} label="Protected Days" value="Backup money / one protected day" emphasized />
    </InfoCard>
  </>;

  if (id === "stability") return <>
    <SectionTitle c={c} title="Your Stability Path" description="The path can move forward or backward when real balances, income, bills, or spending change." />
    {!facts ? <InfoCard c={c} eyebrow="YOUR POSITION"><AppText style={[styles.bodyText, { color: c.mutedForeground }]}>Your current step will be highlighted when Must Pay bills, income, and the forecast are ready.</AppText></InfoCard> : null}
    <InfoCard c={c}>{STABILITY_PATH_GUIDE.map((step, index) => { const active = currentStageIndex !== null && index === currentStageIndex; const complete = currentStageIndex !== null && index < currentStageIndex; return <View key={step.id} style={styles.pathRow}><View style={styles.pathRail}><View style={[styles.pathDot, { backgroundColor: active ? c.primary : complete ? c.success : c.muted, borderColor: active ? c.primary : complete ? c.success : c.border }]}>{complete ? <Feather name="check" size={11} color={c.isDark ? c.successForeground : c.foreground} /> : <AppText tone="label" style={[styles.pathNumber, { color: active ? c.primaryForeground : c.foreground }]}>{index + 1}</AppText>}</View>{index < STABILITY_PATH_GUIDE.length - 1 ? <View style={[styles.pathLine, { backgroundColor: complete ? c.success + "66" : c.border }]} /> : null}</View><View style={[styles.pathContent, active && { backgroundColor: c.primary + "0D", borderColor: c.primary + "45" }]}><View style={styles.pathHeading}><AppText style={[styles.listTitle, { color: active ? c.primary : c.foreground }]}>{step.title}</AppText>{active ? <AppText tone="label" style={[styles.currentPill, { color: c.primary, backgroundColor: c.primary + "18" }]}>CURRENT</AppText> : null}</View><AppText style={[styles.pathRange, { color: active ? c.primary : c.mutedForeground }]}>{step.range}</AppText><AppText style={[styles.listDescription, { color: c.mutedForeground }]}>{step.description}</AppText></View></View>; })}</InfoCard>
  </>;

  if (id === "backup") return <>
    <InfoCard c={c} eyebrow="180-DAY TARGET" title={facts ? currency(facts.backupTarget) : "Six months of Must Pay expenses"} icon="target"><AppText style={[styles.bodyText, { color: c.mutedForeground }]}>Your backup target is based on six months of Must Pay expenses. It changes when those required expenses change.</AppText></InfoCard>
    <SectionTitle c={c} title="Your next milestone" description="FlowLedger focuses on the next useful step, not the entire distance at once." />
    <InfoCard c={c}><AppText tone="title" style={[styles.nextTitle, { color: c.foreground }]}>{facts?.nextMilestone ?? "Your next milestone appears with your live plan"}</AppText>{facts && facts.nextMilestoneAmount > 0 ? <AppText tone="number" style={[styles.nextAmount, { color: c.primary }]}>{currency(facts.nextMilestoneAmount)} to go</AppText> : null}<View style={[styles.callout, { backgroundColor: c.primary + "10", borderColor: c.primary + "30" }]}><AppText tone="label" style={[styles.cardEyebrow, { color: c.primary }]}>{facts ? "NEXT ACTION" : "WHAT TO ADD"}</AppText><AppText style={[styles.bodyText, { color: c.foreground }]}>{facts?.nextAction ?? "Add Must Pay bills, income, and current balances so FlowLedger can identify the next useful step."}</AppText></View></InfoCard>
  </>;

  if (id === "algorithms") return <>
    <SectionTitle c={c} title="How FlowLedger builds your guidance" description="Each calculation answers one clear question using the same balances and forecast." />
    <View style={styles.algorithmGrid}>{ALGORITHM_GUIDE.map(item => <View key={item.id} style={[styles.algorithmCard, { backgroundColor: c.muted, borderColor: c.border }]}><View style={[styles.algorithmIcon, { backgroundColor: c.primary + "18" }]}><Feather name="activity" size={16} color={c.primary} /></View><View style={styles.listCopy}><AppText style={[styles.listTitle, { color: c.foreground }]}>{item.title}</AppText><AppText style={[styles.listDescription, { color: c.mutedForeground }]}>{item.description}</AppText></View></View>)}</View>
  </>;

  return <>
    <SectionTitle c={c} title="FAQs" description="Straight answers about what is counted and why your guidance can change." />
    <InfoCard c={c}>{[
      ["Why does checking drive the forecast?", "Checking represents the spendable cash used for day-to-day bills. Savings stays separate until you intentionally move it."],
      ["Are pending bank charges counted?", "Pending activity is visible, but the forecast waits for the final posted amount so a temporary authorization does not distort your plan."],
      ["Can matching a transaction count it twice?", "No. A posted transaction replaces or settles its planned item; it remains one cash event."],
      ["Why can my path move backward?", "New bills, spending, changed income, or a lower bank balance can reduce the number of protected days. The path recalculates from current facts."],
    ].map(([question, answer]) => <View key={question} style={[styles.faqRow, { borderBottomColor: c.border }]}><AppText style={[styles.faqQuestion, { color: c.foreground }]}>{question}</AppText><AppText style={[styles.listDescription, { color: c.mutedForeground }]}>{answer}</AppText></View>)}</InfoCard>
    <InfoCard c={c} eyebrow="MONEY RULES">{FLOWLEDGER_MONEY_RULES.map(rule => <Bullet key={rule} c={c} text={rule} />)}</InfoCard>
  </>;
}

function InfoCard({ c, eyebrow, title, icon, children }: { c: ReturnType<typeof useColors>; eyebrow?: string; title?: string; icon?: React.ComponentProps<typeof Feather>["name"]; children?: React.ReactNode }) {
  return <View style={[styles.card, { backgroundColor: c.muted, borderColor: c.border }]}>{(title || eyebrow) ? <View style={styles.cardHeader}>{icon ? <View style={[styles.cardIcon, { backgroundColor: c.primary + "18" }]}><Feather name={icon} size={18} color={c.primary} /></View> : null}<View style={styles.cardHeaderCopy}>{eyebrow ? <AppText tone="label" style={[styles.cardEyebrow, { color: c.primary }]}>{eyebrow}</AppText> : null}{title ? <AppText tone="title" style={[styles.cardTitle, { color: c.foreground }]}>{title}</AppText> : null}</View></View> : null}{children}</View>;
}

function Metric({ c, label, value }: { c: ReturnType<typeof useColors>; label: string; value: string }) { return <View style={[styles.metric, { backgroundColor: c.card, borderColor: c.border }]}><AppText tone="title" style={[styles.metricValue, { color: c.foreground }]}>{value}</AppText><AppText style={[styles.metricLabel, { color: c.mutedForeground }]}>{label}</AppText></View>; }
function SectionTitle({ c, title, description }: { c: ReturnType<typeof useColors>; title: string; description: string }) { return <View style={styles.sectionTitleWrap}><AppText tone="title" style={[styles.sectionTitle, { color: c.foreground }]}>{title}</AppText><AppText style={[styles.sectionDescription, { color: c.mutedForeground }]}>{description}</AppText></View>; }
function Bullet({ c, text }: { c: ReturnType<typeof useColors>; text: string }) { return <View style={styles.bulletRow}><Feather name="check-circle" size={17} color={c.success} /><AppText style={[styles.bulletText, { color: c.foreground }]}>{text}</AppText></View>; }
function Calculation({ c, label, value, emphasized = false }: { c: ReturnType<typeof useColors>; label: string; value: string; emphasized?: boolean }) { return <View style={[styles.calculation, { borderBottomColor: c.border }]}><AppText style={[styles.calculationLabel, { color: c.mutedForeground }]}>{label}</AppText><AppText style={[styles.calculationValue, { color: emphasized ? c.primary : c.foreground }]}>{value}</AppText></View>; }

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center" },
  walkthrough: { width: "100%", borderWidth: 0, overflow: "hidden" },
  walkthroughMobile: { flex: 1 },
  walkthroughDesktop: { flexGrow: 0, flexShrink: 0, width: "96%", maxWidth: 1160, borderWidth: 1, borderRadius: 26 },
  header: { minHeight: 94, borderBottomWidth: 1, paddingHorizontal: 20, paddingVertical: 16, flexDirection: "row", alignItems: "center", gap: 16 },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.3 },
  title: { fontSize: 28, lineHeight: 33, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.55, marginTop: 2 },
  subtitle: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", marginTop: 2 },
  closeButton: { width: 46, height: 46, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  body: { flex: 1 }, bodyDesktop: { flexDirection: "row" },
  sectionNav: { width: 242, minWidth: 242, maxWidth: 242, flexBasis: 242, flexGrow: 0, flexShrink: 0, borderRightWidth: 1 },
  sectionNavContent: { padding: 10, gap: 5 },
  navItem: { minHeight: 58, borderWidth: 1, borderColor: "transparent", borderRadius: 14, padding: 9, flexDirection: "row", alignItems: "center", gap: 9 },
  navNumber: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" }, navNumberText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  navCopy: { flex: 1, minWidth: 0 }, navTitle: { fontSize: 13, fontFamily: "Inter_700Bold" }, navDescription: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_500Medium", marginTop: 2 },
  mobileSectionNav: { height: 60, minHeight: 60, maxHeight: 60, flexBasis: 60, flexGrow: 0, flexShrink: 0 },
  mobileStepStrip: { gap: 7, paddingHorizontal: 14, paddingVertical: 8 }, mobileStep: { minHeight: 44, borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" }, mobileStepText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  contentScroll: { flex: 1 }, content: { padding: 18, paddingBottom: 30 }, contentDesktop: { width: "100%", maxWidth: 800, alignSelf: "center", paddingHorizontal: 24 },
  card: { borderWidth: 1, borderRadius: 24, padding: 17, marginBottom: 16 }, cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 13 }, cardIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" }, cardHeaderCopy: { flex: 1 }, cardEyebrow: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.9 }, cardTitle: { fontSize: 19, lineHeight: 24, fontFamily: "Inter_800ExtraBold", marginTop: 2 },
  sectionTitleWrap: { marginTop: 4, marginBottom: 10 }, sectionTitle: { fontSize: 19, lineHeight: 24, fontFamily: "Inter_800ExtraBold" }, sectionDescription: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", marginTop: 3 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, metric: { flexGrow: 1, flexBasis: 130, minHeight: 78, borderWidth: 1, borderRadius: 17, padding: 12, justifyContent: "center" }, metricValue: { fontSize: 17, fontFamily: "Inter_800ExtraBold" }, metricLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 3 },
  bodyText: { fontSize: 13, lineHeight: 20, fontFamily: "Inter_500Medium" }, bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, paddingVertical: 7 }, bulletText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  scoreHero: { borderWidth: 1, borderRadius: 24, padding: 18, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }, scoreValue: { fontSize: 32, fontFamily: "Inter_800ExtraBold", marginTop: 2 }, scoreStatus: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth }, listCopy: { flex: 1, minWidth: 0 }, listTitle: { fontSize: 14, fontFamily: "Inter_700Bold" }, listDescription: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium", marginTop: 3 }, points: { minWidth: 58, fontSize: 11, fontFamily: "Inter_800ExtraBold", textAlign: "right" },
  calculation: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth }, calculationLabel: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" }, calculationValue: { maxWidth: "56%", flexShrink: 1, fontSize: 13, lineHeight: 18, fontFamily: "Inter_800ExtraBold", textAlign: "right" },
  pathRow: { flexDirection: "row", alignItems: "stretch" }, pathRail: { width: 34, alignItems: "center" }, pathDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" }, pathNumber: { fontSize: 11, fontFamily: "Inter_800ExtraBold" }, pathLine: { flex: 1, width: 2, minHeight: 64 }, pathContent: { flex: 1, borderWidth: 1, borderColor: "transparent", borderRadius: 14, padding: 10, marginBottom: 8 }, pathHeading: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 }, currentPill: { fontSize: 11, fontFamily: "Inter_800ExtraBold", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 }, pathRange: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_700Bold", marginTop: 2 },
  nextTitle: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_800ExtraBold" }, nextAmount: { fontSize: 22, fontFamily: "Inter_800ExtraBold", marginTop: 6 }, callout: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 14 },
  algorithmGrid: { gap: 9 }, algorithmCard: { borderWidth: 1, borderRadius: 16, padding: 13, flexDirection: "row", alignItems: "flex-start", gap: 11 }, algorithmIcon: { width: 37, height: 37, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  faqRow: { paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth }, faqQuestion: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_700Bold" },
  footer: { minHeight: 78, borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, progressCopy: { flex: 1, maxWidth: 260 }, progressText: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginBottom: 6 }, progressTrack: { height: 5, borderRadius: 999, overflow: "hidden" }, progressFill: { height: "100%", borderRadius: 999 }, footerActions: { flexDirection: "row", alignItems: "center", gap: 8 }, secondaryButton: { minHeight: 44, borderWidth: 1, borderRadius: 13, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, secondaryText: { fontSize: 13, fontFamily: "Inter_700Bold" }, primaryButton: { minHeight: 44, minWidth: 100, borderRadius: 13, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, primaryText: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  footerMobile: { minHeight: 112, flexDirection: "column", alignItems: "stretch", gap: 9 },
});
