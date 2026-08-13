import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useBudget } from "@/context/BudgetContext";
import { isActiveTransaction } from "@/lib/billMatching";
import { desktopPlannerDestination } from "@/lib/desktopActions";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

type DesktopWorkspacePageProps = {
  pathname: string;
  section?: string;
  onOpenPlanner: () => void;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function currency(value: number, digits = 2) {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function shortDate(value?: string) {
  if (!value) return "Not set";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Stat({ label, value, detail, icon, tone = "purple" }: {
  label: string;
  value: string;
  detail: string;
  icon: FeatherName;
  tone?: "purple" | "blue" | "green" | "amber";
}) {
  const iconTone = {
    purple: styles.purpleIcon,
    blue: styles.blueIcon,
    green: styles.greenIcon,
    amber: styles.amberIcon,
  }[tone];
  const iconColor = {
    purple: "#c4b5fd",
    blue: "#8fb7ff",
    green: "#6ee7b7",
    amber: "#fcd34d",
  }[tone];
  return (
    <View style={styles.stat}>
      <View style={[styles.statIcon, iconTone]}>
        <Feather name={icon} size={17} color={iconColor} />
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statDetail}>{detail}</Text>
    </View>
  );
}

function PageHeader({ eyebrow, title, description, action, onAction }: {
  eyebrow: string;
  title: string;
  description: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderCopy}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action}
        onPress={onAction}
        style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.76 : 1 }]}
      >
        <Text style={styles.primaryButtonText}>{action}</Text>
        <Feather name="arrow-up-right" size={15} color="#ffffff" />
      </Pressable>
    </View>
  );
}

function Panel({ title, subtitle, children, aside }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.panelTitle}>{title}</Text>
          {subtitle ? <Text style={styles.panelSubtitle}>{subtitle}</Text> : null}
        </View>
        {aside}
      </View>
      {children}
    </View>
  );
}

function StatusPill({ label, tone = "neutral" }: {
  label: string;
  tone?: "neutral" | "green" | "amber" | "rose" | "blue";
}) {
  const pillTone = {
    neutral: styles.neutralPill,
    green: styles.greenPill,
    amber: styles.amberPill,
    rose: styles.rosePill,
    blue: styles.bluePill,
  }[tone];
  const dotTone = {
    neutral: styles.neutralDot,
    green: styles.greenDot,
    amber: styles.amberDot,
    rose: styles.roseDot,
    blue: styles.blueDot,
  }[tone];
  const textTone = {
    neutral: styles.neutralPillText,
    green: styles.greenPillText,
    amber: styles.amberPillText,
    rose: styles.rosePillText,
    blue: styles.bluePillText,
  }[tone];
  return (
    <View style={[styles.pill, pillTone]}>
      <View style={[styles.pillDot, dotTone]} />
      <Text style={[styles.pillText, textTone]}>{label}</Text>
    </View>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <View style={styles.emptyRow}>
      <Feather name="inbox" size={18} color="#66758e" />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function BillsPage({ debtOnly, onOpenPlanner, onOpenSnowball }: { debtOnly: boolean; onOpenPlanner: () => void; onOpenSnowball: () => void }) {
  const {
    bills,
    connectedBankAccounts,
    getBillMonthlyTotal,
    getPaidAmount,
    selectedYear,
  } = useBudget();
  const month = new Date().getMonth();
  const rows = bills
    .filter((bill) => debtOnly ? bill.is_debt : !bill.is_debt)
    .sort((left, right) => left.due_day - right.due_day);
  const planned = rows.reduce((sum, bill) => sum + getBillMonthlyTotal(bill, month, selectedYear), 0);
  const paid = rows.reduce((sum, bill) => sum + getPaidAmount(bill.id, month, selectedYear), 0);
  const remaining = Math.max(0, planned - paid);
  const debtBalance = rows.reduce((sum, bill) => sum + Math.max(0, bill.balance), 0);
  const linkedCards = connectedBankAccounts.filter((account) =>
    account.account_type === "credit" || account.account_subtype === "credit card",
  );

  return (
    <>
      <PageHeader
        eyebrow={debtOnly ? "Debt strategy" : "Monthly plan"}
        title={debtOnly ? "Debt payoff" : "Bills & commitments"}
        description={debtOnly
          ? "Balances, minimums, and snowball priority in one desktop view."
          : "See every recurring commitment and what remains this month."}
        action={debtOnly ? "Open snowball planner" : "Manage bills"}
        onAction={debtOnly ? onOpenSnowball : onOpenPlanner}
      />
      <View style={styles.statGrid}>
        <Stat label={debtOnly ? "Total debt" : "Planned this month"} value={currency(debtOnly ? debtBalance : planned)} detail={`${rows.length} active ${debtOnly ? "debt" : "bill"}${rows.length === 1 ? "" : "s"}`} icon={debtOnly ? "credit-card" : "file-text"} tone="purple" />
        <Stat label="Paid" value={currency(paid)} detail={`${MONTHS[month]} ${selectedYear}`} icon="check-circle" tone="green" />
        <Stat label="Remaining" value={currency(remaining)} detail="Still scheduled this month" icon="clock" tone="amber" />
        <Stat label="Connected cards" value={String(linkedCards.length)} detail={linkedCards.length ? "Plaid liability data available" : "Connect cards when ready"} icon="link" tone="blue" />
      </View>
      <Panel
        title={debtOnly ? "Payoff order" : "Commitment schedule"}
        subtitle={debtOnly ? "Current snowball order uses the same plan as mobile" : `Due dates and progress for ${MONTHS[month]}`}
        aside={<StatusPill label="Live plan" tone="green" />}
      >
        <View style={styles.tableHeader}>
          <Text style={[styles.columnLabel, styles.nameColumn]}>{debtOnly ? "Account" : "Bill"}</Text>
          <Text style={[styles.columnLabel, styles.statusColumn]}>Status</Text>
          <Text style={[styles.columnLabel, styles.dateColumn]}>Due</Text>
          <Text style={[styles.columnLabel, styles.moneyColumn]}>{debtOnly ? "Minimum" : "Planned"}</Text>
          <Text style={[styles.columnLabel, styles.moneyColumn]}>{debtOnly ? "Balance" : "Remaining"}</Text>
        </View>
        {rows.length ? rows.map((bill, index) => {
          const total = getBillMonthlyTotal(bill, month, selectedYear);
          const billPaid = getPaidAmount(bill.id, month, selectedYear);
          const isPaid = billPaid + 0.005 >= total;
          return (
            <View key={bill.id} style={[styles.tableRow, index > 0 && styles.tableDivider]}>
              <View style={styles.nameColumn}>
                <View style={styles.rowNameWrap}>
                  <View style={[styles.rowIcon, bill.is_debt && styles.rowIconPurple]}>
                    <Feather name={bill.is_debt ? "credit-card" : "file-text"} size={15} color={bill.is_debt ? "#c4b5fd" : "#8fb7ff"} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{bill.name}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>{bill.category}{debtOnly && bill.interest_rate ? ` · ${bill.interest_rate}% APR` : ""}</Text>
                  </View>
                </View>
              </View>
              <View style={styles.statusColumn}><StatusPill label={isPaid ? "Paid" : "Scheduled"} tone={isPaid ? "green" : "amber"} /></View>
              <Text style={[styles.rowText, styles.dateColumn]}>{bill.due_day ? `${MONTHS[month].slice(0, 3)} ${bill.due_day}` : "—"}</Text>
              <Text style={[styles.rowMoney, styles.moneyColumn]}>{currency(total)}</Text>
              <Text style={[styles.rowMoney, styles.moneyColumn]}>{currency(debtOnly ? bill.balance : Math.max(0, total - billPaid))}</Text>
            </View>
          );
        }) : <EmptyRow text={debtOnly ? "No debts are in your plan yet." : "No bills are scheduled yet."} />}
      </Panel>
    </>
  );
}

function ActivityPage({ onOpenReview }: { onOpenReview: () => void }) {
  const { getTransactionsForMonth, pendingBankTransactions, selectedYear } = useBudget();
  const month = new Date().getMonth();
  const rows = getTransactionsForMonth(month, selectedYear)
    .filter(isActiveTransaction)
    .sort((left, right) => right.date.localeCompare(left.date));
  const income = rows.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
  const spending = rows.filter((row) => row.amount < 0).reduce((sum, row) => sum + Math.abs(row.amount), 0);
  const review = rows.filter((row) => row.review_status === "needs_review").length + pendingBankTransactions.length;

  return (
    <>
      <PageHeader eyebrow="Ledger" title="Activity" description="A web-first ledger for imported and manual activity across your plan." action="Open review center" onAction={onOpenReview} />
      <View style={styles.statGrid}>
        <Stat label="Inflows" value={currency(income)} detail={`${MONTHS[month]} inflows`} icon="arrow-down-left" tone="green" />
        <Stat label="Outflows" value={currency(spending)} detail={`${MONTHS[month]} outflows`} icon="arrow-up-right" tone="purple" />
        <Stat label="Needs review" value={String(review)} detail="Imported and unmatched activity" icon="alert-circle" tone="amber" />
        <Stat label="Transactions" value={String(rows.length)} detail="Posted activity this month" icon="repeat" tone="blue" />
      </View>
      <Panel title="Transaction ledger" subtitle="Your newest posted activity appears first" aside={<StatusPill label={`${MONTHS[month]} ${selectedYear}`} tone="blue" />}>
        <View style={styles.tableHeader}>
          <Text style={[styles.columnLabel, styles.activityNameColumn]}>Transaction</Text>
          <Text style={[styles.columnLabel, styles.categoryColumn]}>Category</Text>
          <Text style={[styles.columnLabel, styles.statusColumn]}>Review</Text>
          <Text style={[styles.columnLabel, styles.dateColumn]}>Date</Text>
          <Text style={[styles.columnLabel, styles.moneyColumn]}>Amount</Text>
        </View>
        {rows.length ? rows.slice(0, 18).map((row, index) => {
          const positive = row.amount >= 0;
          const needsReview = row.review_status === "needs_review";
          return (
            <View key={row.id} style={[styles.tableRow, index > 0 && styles.tableDivider]}>
              <View style={styles.activityNameColumn}>
                <View style={styles.rowNameWrap}>
                  <View style={[styles.rowIcon, positive && styles.rowIconGreen]}>
                    <Feather name={positive ? "arrow-down-left" : "shopping-bag"} size={15} color={positive ? "#6ee7b7" : "#8fb7ff"} />
                  </View>
                  <Text style={[styles.rowName, { flex: 1 }]} numberOfLines={1}>{row.merchant_name || row.note || "Transaction"}</Text>
                </View>
              </View>
              <Text style={[styles.rowText, styles.categoryColumn]} numberOfLines={1}>{row.category || (positive ? "Income" : "Uncategorized")}</Text>
              <View style={styles.statusColumn}><StatusPill label={needsReview ? "Review" : "Ready"} tone={needsReview ? "amber" : "green"} /></View>
              <Text style={[styles.rowText, styles.dateColumn]}>{shortDate(row.date)}</Text>
              <Text style={[styles.rowMoney, positive && styles.positiveMoney, styles.moneyColumn]}>{positive ? "+" : "−"}{currency(Math.abs(row.amount))}</Text>
            </View>
          );
        }) : <EmptyRow text="Your transaction ledger will appear here." />}
      </Panel>
    </>
  );
}

function CalendarPage({ onOpenPlanner }: { onOpenPlanner: () => void }) {
  const { getDailyBalances, getMonthlyIncome, getMonthlyBills, getBillMonthlyTotal, selectedYear } = useBudget();
  const month = new Date().getMonth();
  const today = new Date().getDate();
  const balances = getDailyBalances(month, selectedYear);
  const visibleDays = balances.filter((day) => day.day >= today).slice(0, 16);
  const monthlyIncome = getMonthlyIncome(month, selectedYear);
  const bills = getMonthlyBills(month, selectedYear);
  const plannedBills = bills.reduce((sum, bill) => sum + getBillMonthlyTotal(bill, month, selectedYear), 0);
  const lowest = balances.reduce((value, day) => Math.min(value, day.balance), balances[0]?.balance ?? 0);

  return (
    <>
      <PageHeader eyebrow="Forecast" title={`${MONTHS[month]} cash-flow calendar`} description="Follow the balance path day by day without switching into a phone-sized calendar." action="Open full calendar" onAction={onOpenPlanner} />
      <View style={styles.statGrid}>
        <Stat label="Monthly income" value={currency(monthlyIncome)} detail="Scheduled inflows" icon="trending-up" tone="green" />
        <Stat label="Planned bills" value={currency(plannedBills)} detail={`${bills.length} commitments`} icon="calendar" tone="purple" />
        <Stat label="Tightest forecast point" value={currency(lowest)} detail="Use this to build more room" icon="trending-up" tone={lowest >= 0 ? "blue" : "amber"} />
        <Stat label="Forecast days" value={String(balances.length)} detail="Shared with the PWA forecast" icon="activity" tone="blue" />
      </View>
      <Panel title="Upcoming balance path" subtitle="The next forecasted days and the events that change them" aside={<StatusPill label="Live forecast" tone="green" />}>
        <View style={styles.calendarGrid}>
          {visibleDays.map((day) => {
            const tone = day.net > 0 ? "green" : day.net < 0 ? "amber" : "neutral";
            const signalTone = tone === "green" ? styles.greenDot : tone === "amber" ? styles.amberDot : styles.neutralDot;
            return (
              <View key={day.day} style={[styles.dayCard, day.day === today && styles.dayCardToday]}>
                <View style={styles.dayTopline}>
                  <Text style={styles.dayNumber}>{day.day}</Text>
                  {day.day === today ? <StatusPill label="Today" tone="blue" /> : null}
                </View>
                <Text style={styles.dayBalance}>{currency(day.balance, 0)}</Text>
                <Text style={styles.dayLabel}>projected balance</Text>
                <View style={styles.dayFooter}>
                  <View style={[styles.daySignal, signalTone]} />
                  <Text style={[styles.dayNet, day.net > 0 && styles.positiveMoney]}>{day.net >= 0 ? "+" : "−"}{currency(Math.abs(day.net), 0)}</Text>
                </View>
              </View>
            );
          })}
        </View>
      </Panel>
    </>
  );
}

function IncomePage({ onOpenPlanner }: { onOpenPlanner: () => void }) {
  const { incomes, getMonthlyIncome, selectedYear } = useBudget();
  const month = new Date().getMonth();
  const total = getMonthlyIncome(month, selectedYear);
  return (
    <>
      <PageHeader eyebrow="Cash in" title="Income" description="Track recurring income sources and the dates your forecast expects them." action="Manage income" onAction={onOpenPlanner} />
      <View style={styles.statGrid}>
        <Stat label="Monthly income" value={currency(total)} detail={`${MONTHS[month]} ${selectedYear}`} icon="arrow-down-left" tone="green" />
        <Stat label="Income sources" value={String(incomes.length)} detail="Active recurring sources" icon="layers" tone="blue" />
        <Stat label="Average source" value={currency(incomes.length ? total / incomes.length : 0)} detail="Monthly contribution" icon="bar-chart-2" tone="purple" />
        <Stat label="Forecast status" value={incomes.length ? "Active" : "Setup"} detail="Used by desktop and PWA" icon="activity" tone="amber" />
      </View>
      <Panel title="Income sources" subtitle="Recurring sources feeding your monthly forecast" aside={<StatusPill label="Shared plan" tone="green" />}>
        <View style={styles.tableHeader}>
          <Text style={[styles.columnLabel, styles.nameColumn]}>Source</Text>
          <Text style={[styles.columnLabel, styles.categoryColumn]}>Frequency</Text>
          <Text style={[styles.columnLabel, styles.dateColumn]}>Next expected</Text>
          <Text style={[styles.columnLabel, styles.moneyColumn]}>Amount</Text>
        </View>
        {incomes.length ? incomes.map((income, index) => (
          <View key={income.id} style={[styles.tableRow, index > 0 && styles.tableDivider]}>
            <View style={styles.nameColumn}><View style={styles.rowNameWrap}><View style={[styles.rowIcon, styles.rowIconGreen]}><Feather name="briefcase" size={15} color="#6ee7b7" /></View><Text style={[styles.rowName, { flex: 1 }]} numberOfLines={1}>{income.name}</Text></View></View>
            <Text style={[styles.rowText, styles.categoryColumn]}>{income.frequency}</Text>
            <Text style={[styles.rowText, styles.dateColumn]}>{shortDate(income.next_payment_date)}</Text>
            <Text style={[styles.rowMoney, styles.positiveMoney, styles.moneyColumn]}>{currency(income.amount)}</Text>
          </View>
        )) : <EmptyRow text="Add your first recurring income source." />}
      </Panel>
    </>
  );
}

function GoalsPage({ onOpenPlanner }: { onOpenPlanner: () => void }) {
  const { goals } = useBudget();
  const active = goals.filter((goal) => !goal.closed_at && !goal.archived_at);
  const current = active.reduce((sum, goal) => sum + Math.max(0, goal.current_amount), 0);
  const target = active.reduce((sum, goal) => sum + Math.max(0, goal.target_amount), 0);
  const progress = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  return (
    <>
      <PageHeader eyebrow="Build wealth" title="Goals" description="See savings and planned spending goals as a portfolio, not a stack of app cards." action="Manage goals" onAction={onOpenPlanner} />
      <View style={styles.statGrid}>
        <Stat label="Overall progress" value={`${Math.round(progress)}%`} detail={`${currency(current)} funded`} icon="target" tone="green" />
        <Stat label="Target total" value={currency(target)} detail={`${active.length} active goals`} icon="flag" tone="purple" />
        <Stat label="Remaining" value={currency(Math.max(0, target - current))} detail="Across active goals" icon="clock" tone="amber" />
        <Stat label="Portfolio" value={active.length ? "Active" : "Setup"} detail="Shared with the PWA" icon="shield" tone="blue" />
      </View>
      <View style={styles.goalGrid}>
        {active.length ? active.map((goal) => {
          const percent = goal.target_amount > 0 ? Math.min(100, (goal.current_amount / goal.target_amount) * 100) : 0;
          return (
            <View key={goal.id} style={styles.goalCard}>
              <View style={styles.goalCardTop}>
                <View style={styles.goalIcon}><Feather name={goal.goal_type === "savings" ? "shield" : "shopping-bag"} size={17} color="#c4b5fd" /></View>
                <StatusPill label={goal.goal_type === "savings" ? "Savings" : "Planned"} tone="blue" />
              </View>
              <Text style={styles.goalName}>{goal.name}</Text>
              <Text style={styles.goalAmount}>{currency(goal.current_amount)} <Text style={styles.goalTarget}>of {currency(goal.target_amount)}</Text></Text>
              <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${percent}%` }]} /></View>
              <View style={styles.goalFooter}><Text style={styles.goalPercent}>{Math.round(percent)}% funded</Text><Text style={styles.goalDate}>{shortDate(goal.target_date)}</Text></View>
            </View>
          );
        }) : <Panel title="No active goals"><EmptyRow text="Add a goal to start building your portfolio." /></Panel>}
      </View>
    </>
  );
}

function ReportsPage({ onOpenPlanner }: { onOpenPlanner: () => void }) {
  const { getCashFlow, getMonthlyIncome, getMonthlyBills, getBillMonthlyTotal, selectedYear } = useBudget();
  const month = new Date().getMonth();
  const cashFlow = getCashFlow(month, selectedYear);
  const income = getMonthlyIncome(month, selectedYear);
  const bills = getMonthlyBills(month, selectedYear);
  const planned = bills.reduce((sum, bill) => sum + getBillMonthlyTotal(bill, month, selectedYear), 0);
  const billShare = income > 0 ? Math.min(100, (planned / income) * 100) : 0;
  const remainingShare = income > 0 ? Math.max(0, Math.min(100, (cashFlow.remaining / income) * 100)) : 0;
  return (
    <>
      <PageHeader eyebrow="Financial intelligence" title="Reports" description="A desktop reporting surface built from the same live plan as your PWA." action="Open detailed reports" onAction={onOpenPlanner} />
      <View style={styles.statGrid}>
        <Stat label="Income" value={currency(income)} detail={`${MONTHS[month]} total`} icon="trending-up" tone="green" />
        <Stat label="Bills planned" value={currency(planned)} detail={`${Math.round(billShare)}% of income`} icon="file-text" tone="purple" />
        <Stat label="Cash remaining" value={currency(cashFlow.remaining)} detail="After current plan" icon="pie-chart" tone={cashFlow.remaining >= 0 ? "blue" : "amber"} />
        <Stat label="Plan status" value={cashFlow.remaining >= 0 ? "Balanced" : "Review"} detail={`${MONTHS[month]} outlook`} icon="activity" tone={cashFlow.remaining >= 0 ? "green" : "amber"} />
      </View>
      <View style={styles.reportGrid}>
        <Panel title="Income allocation" subtitle="How the current monthly plan uses income">
          <View style={styles.reportMetric}><Text style={styles.reportLabel}>Bills & commitments</Text><Text style={styles.reportValue}>{Math.round(billShare)}%</Text></View>
          <View style={styles.reportTrack}><View style={[styles.reportFillPurple, { width: `${billShare}%` }]} /></View>
          <View style={styles.reportMetric}><Text style={styles.reportLabel}>Remaining cash flow</Text><Text style={styles.reportValue}>{Math.round(remainingShare)}%</Text></View>
          <View style={styles.reportTrack}><View style={[styles.reportFillGreen, { width: `${remainingShare}%` }]} /></View>
        </Panel>
        <Panel title="Monthly movement" subtitle="Current plan summary">
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Monthly income</Text><Text style={styles.summaryValue}>{currency(cashFlow.monthlyIncome)}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Bills due</Text><Text style={styles.summaryValue}>{currency(cashFlow.totalBillsDue)}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Bills paid</Text><Text style={styles.summaryValue}>{currency(cashFlow.totalPaid)}</Text></View>
          <View style={[styles.summaryRow, styles.summaryTotal]}><Text style={styles.summaryTotalLabel}>Remaining</Text><Text style={styles.summaryTotalValue}>{currency(cashFlow.remaining)}</Text></View>
        </Panel>
      </View>
    </>
  );
}

function SettingsPage({ onOpenPlanner, onOpenMoneySettings }: { onOpenPlanner: () => void; onOpenMoneySettings: () => void }) {
  const { settings, connectedBankAccounts, accounts, forecastConfidence, activeHousehold } = useBudget();
  const confidenceLabel = forecastConfidence.label;
  const settingRows = [
    { icon: "pie-chart" as const, label: "Zero-based budgeting", detail: "Plan every available dollar", value: settings.zeroBasedBudgetEnabled ? "On" : "Off" },
    { icon: "trending-down" as const, label: "Debt payoff", detail: `${settings.paymentMethod === "avalanche" ? "Avalanche" : "Snowball"} strategy`, value: settings.debtPayoffEnabled ? "On" : "Off" },
    { icon: "shield" as const, label: "Safety floor", detail: "Protected minimum balance", value: currency(settings.safety_floor) },
    { icon: "calendar" as const, label: "Forecast horizon", detail: "Forward-looking plan", value: `${settings.forecast_horizon_months} months` },
  ];
  return (
    <>
      <PageHeader eyebrow="Workspace" title="Settings" description="Account, forecasting, and planning preferences in a desktop settings hub." action="Edit settings" onAction={onOpenPlanner} />
      <View style={styles.statGrid}>
        <Stat label="Workspace" value={activeHousehold?.name || "Personal"} detail="Active budget" icon="users" tone="purple" />
        <Stat label="Manual accounts" value={String(accounts.length)} detail="Active balance sources" icon="database" tone="blue" />
        <Stat label="Connected accounts" value={String(connectedBankAccounts.length)} detail="Plaid-linked sources" icon="link" tone="green" />
        <Stat label="Forecast confidence" value={confidenceLabel} detail="Current data quality" icon="shield" tone="amber" />
      </View>
      <Panel title="Planning preferences" subtitle="These settings apply everywhere you use FlowLedger">
        {settingRows.map((row, index) => (
          <Pressable
            key={row.label}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${row.label}`}
            onPress={onOpenMoneySettings}
            style={({ pressed }) => [styles.settingRow, index > 0 && styles.tableDivider, { opacity: pressed ? 0.72 : 1 }]}
          >
            <View style={styles.settingIcon}><Feather name={row.icon} size={16} color="#b9a7ff" /></View>
            <View style={{ flex: 1 }}><Text style={styles.rowName}>{row.label}</Text><Text style={styles.rowMeta}>{row.detail}</Text></View>
            <Text style={styles.settingValue}>{row.value}</Text>
            <Feather name="chevron-right" size={16} color="#5f6d84" />
          </Pressable>
        ))}
      </Panel>
    </>
  );
}

export function DesktopWorkspacePage({ pathname, section, onOpenPlanner }: DesktopWorkspacePageProps) {
  const router = useRouter();
  const { dashboardFilter } = useBudget();
  const normalized = pathname === "/(tabs)" ? "/" : pathname;
  let content: React.ReactNode;

  if (normalized === "/bills") {
    content = <BillsPage debtOnly={dashboardFilter === "debt"} onOpenPlanner={onOpenPlanner} onOpenSnowball={() => router.push("/snowball-plan" as never)} />;
  } else if (normalized === "/transactions") {
    content = <ActivityPage onOpenReview={() => router.push(desktopPlannerDestination("review") as never)} />;
  } else if (normalized === "/monthly") {
    content = <CalendarPage onOpenPlanner={onOpenPlanner} />;
  } else if (normalized === "/more" && section === "money") {
    content = <IncomePage onOpenPlanner={onOpenPlanner} />;
  } else if (normalized === "/more" && section === "goals") {
    content = <GoalsPage onOpenPlanner={onOpenPlanner} />;
  } else if (normalized === "/more" && section === "reports") {
    content = <ReportsPage onOpenPlanner={onOpenPlanner} />;
  } else {
    content = <SettingsPage onOpenPlanner={onOpenPlanner} onOpenMoneySettings={() => router.push({ pathname: "/(tabs)/more", params: { section: "money", mode: "planner" } } as never)} />;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View pointerEvents="none" style={styles.ambientLayer}>
        <View style={styles.ambientPurple} />
        <View style={styles.ambientBlue} />
      </View>
      {content}
      <View style={styles.footer}><Text style={styles.footerText}>FlowLedger Algo · One plan across desktop and PWA</Text></View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#050816" },
  content: { width: "100%", maxWidth: 1460, alignSelf: "center", paddingHorizontal: 42, paddingTop: 38, paddingBottom: 36, gap: 22, position: "relative" },
  ambientLayer: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  ambientPurple: { position: "absolute", width: 560, height: 560, borderRadius: 280, top: -370, right: 30, backgroundColor: "rgba(124,58,237,0.10)", shadowColor: "#7c3aed", shadowOpacity: 0.3, shadowRadius: 100, shadowOffset: { width: 0, height: 0 } },
  ambientBlue: { position: "absolute", width: 480, height: 480, borderRadius: 240, bottom: -350, left: -180, backgroundColor: "rgba(37,99,235,0.08)", shadowColor: "#2563eb", shadowOpacity: 0.28, shadowRadius: 100, shadowOffset: { width: 0, height: 0 } },
  pageHeader: { minHeight: 116, flexDirection: "row", alignItems: "flex-end", gap: 32, paddingBottom: 4 },
  pageHeaderCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: "#9f7aea", fontSize: 12, lineHeight: 16, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 1.45, marginBottom: 10 },
  title: { color: "#f8fafc", fontSize: 36, lineHeight: 42, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.25 },
  description: { color: "#8e9db4", fontSize: 15, lineHeight: 22, fontFamily: "Inter_500Medium", maxWidth: 690, marginTop: 8 },
  primaryButton: { height: 43, borderRadius: 12, paddingHorizontal: 17, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "rgba(216,180,254,0.32)", backgroundColor: "#8738ea", shadowColor: "#7c3aed", shadowOpacity: 0.4, shadowRadius: 22, shadowOffset: { width: 0, height: 10 } },
  primaryButtonText: { color: "#ffffff", fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  statGrid: { flexDirection: "row", gap: 14 },
  stat: { flex: 1, minWidth: 0, minHeight: 148, borderRadius: 18, borderWidth: 1, borderColor: "rgba(148,163,184,0.14)", backgroundColor: "rgba(8,14,31,0.86)", padding: 17, shadowColor: "#000000", shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 14 } },
  statIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, marginBottom: 14 },
  purpleIcon: { backgroundColor: "rgba(139,92,246,0.12)", borderColor: "rgba(167,139,250,0.22)" },
  blueIcon: { backgroundColor: "rgba(59,130,246,0.12)", borderColor: "rgba(96,165,250,0.22)" },
  greenIcon: { backgroundColor: "rgba(34,197,94,0.11)", borderColor: "rgba(74,222,128,0.21)" },
  amberIcon: { backgroundColor: "rgba(245,158,11,0.11)", borderColor: "rgba(251,191,36,0.22)" },
  purpleText: { color: "#c4b5fd" }, blueText: { color: "#8fb7ff" }, greenText: { color: "#6ee7b7" }, amberText: { color: "#fcd34d" },
  statLabel: { color: "#8492a8", fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.75, textTransform: "uppercase" },
  statValue: { color: "#f8fafc", fontSize: 26, lineHeight: 32, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.75, marginTop: 5 },
  statDetail: { color: "#6f7f97", fontSize: 11, lineHeight: 16, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  panel: { borderRadius: 20, borderWidth: 1, borderColor: "rgba(148,163,184,0.14)", backgroundColor: "rgba(8,14,31,0.90)", padding: 20, overflow: "hidden", shadowColor: "#000000", shadowOpacity: 0.24, shadowRadius: 28, shadowOffset: { width: 0, height: 16 } },
  panelHeader: { minHeight: 54, flexDirection: "row", alignItems: "flex-start", gap: 14, paddingBottom: 16 },
  panelTitle: { color: "#eef3fb", fontSize: 19, lineHeight: 24, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.35 },
  panelSubtitle: { color: "#74839a", fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium", marginTop: 4 },
  tableHeader: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "rgba(148,163,184,0.12)" },
  tableRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 10 },
  tableDivider: { borderTopWidth: 1, borderTopColor: "rgba(148,163,184,0.08)" },
  columnLabel: { color: "#65738a", fontSize: 11, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.8 },
  nameColumn: { flex: 2.1, minWidth: 0 }, activityNameColumn: { flex: 2.4, minWidth: 0 }, categoryColumn: { flex: 1.2, minWidth: 0 }, statusColumn: { width: 100 }, dateColumn: { width: 120 }, moneyColumn: { width: 120, textAlign: "right" },
  rowNameWrap: { flexDirection: "row", alignItems: "center", gap: 11, minWidth: 0 },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(96,165,250,0.18)", backgroundColor: "rgba(59,130,246,0.10)" },
  rowIconPurple: { borderColor: "rgba(167,139,250,0.20)", backgroundColor: "rgba(139,92,246,0.11)" }, rowIconGreen: { borderColor: "rgba(74,222,128,0.18)", backgroundColor: "rgba(34,197,94,0.10)" },
  rowName: { color: "#dce5f2", fontSize: 13, lineHeight: 18, fontFamily: "Inter_700Bold" },
  rowMeta: { color: "#6f7d93", fontSize: 11, lineHeight: 15, fontFamily: "Inter_500Medium", marginTop: 2 },
  rowText: { color: "#91a0b5", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  rowMoney: { color: "#e8eef7", fontSize: 13, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  positiveMoney: { color: "#6ee7b7" },
  pill: { alignSelf: "flex-start", minHeight: 24, borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6 },
  pillDot: { width: 5, height: 5, borderRadius: 3 },
  pillText: { fontSize: 11, fontFamily: "Inter_800ExtraBold", textTransform: "uppercase", letterSpacing: 0.5 },
  neutralPill: { backgroundColor: "rgba(100,116,139,0.10)", borderColor: "rgba(148,163,184,0.16)" }, neutralDot: { backgroundColor: "#94a3b8" }, neutralPillText: { color: "#aab7ca" },
  greenPill: { backgroundColor: "rgba(34,197,94,0.09)", borderColor: "rgba(74,222,128,0.18)" }, greenDot: { backgroundColor: "#4ade80" }, greenPillText: { color: "#86efac" },
  amberPill: { backgroundColor: "rgba(245,158,11,0.09)", borderColor: "rgba(251,191,36,0.18)" }, amberDot: { backgroundColor: "#fbbf24" }, amberPillText: { color: "#fcd34d" },
  rosePill: { backgroundColor: "rgba(244,63,94,0.09)", borderColor: "rgba(251,113,133,0.18)" }, roseDot: { backgroundColor: "#fb7185" }, rosePillText: { color: "#fda4af" },
  bluePill: { backgroundColor: "rgba(59,130,246,0.09)", borderColor: "rgba(96,165,250,0.18)" }, blueDot: { backgroundColor: "#60a5fa" }, bluePillText: { color: "#93c5fd" },
  emptyRow: { minHeight: 110, alignItems: "center", justifyContent: "center", gap: 9 }, emptyText: { color: "#75839a", fontSize: 13, fontFamily: "Inter_500Medium" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  dayCard: { flexBasis: "11.5%", flexGrow: 1, minWidth: 122, minHeight: 132, borderRadius: 15, borderWidth: 1, borderColor: "rgba(148,163,184,0.11)", backgroundColor: "rgba(3,8,22,0.58)", padding: 13 },
  dayCardToday: { borderColor: "rgba(96,165,250,0.35)", backgroundColor: "rgba(37,99,235,0.08)", shadowColor: "#2563eb", shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  dayTopline: { minHeight: 25, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, dayNumber: { color: "#dce6f4", fontSize: 15, fontFamily: "Inter_800ExtraBold" }, dayBalance: { color: "#f8fafc", fontSize: 18, fontFamily: "Inter_800ExtraBold", marginTop: 14 }, dayLabel: { color: "#66758c", fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 3 }, dayFooter: { marginTop: "auto", flexDirection: "row", alignItems: "center", gap: 6 }, daySignal: { width: 6, height: 6, borderRadius: 3 }, dayNet: { color: "#9aa8bb", fontSize: 11, fontFamily: "Inter_700Bold" },
  goalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 }, goalCard: { flexBasis: "31%", flexGrow: 1, minWidth: 280, minHeight: 220, borderRadius: 20, borderWidth: 1, borderColor: "rgba(167,139,250,0.16)", backgroundColor: "rgba(8,14,31,0.9)", padding: 19 }, goalCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, goalIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(167,139,250,0.20)", backgroundColor: "rgba(139,92,246,0.12)" }, goalName: { color: "#f1f5f9", fontSize: 19, lineHeight: 24, fontFamily: "Inter_800ExtraBold", marginTop: 23 }, goalAmount: { color: "#e8eef7", fontSize: 17, fontFamily: "Inter_800ExtraBold", marginTop: 7 }, goalTarget: { color: "#718097", fontSize: 12, fontFamily: "Inter_600SemiBold" }, progressTrack: { width: "100%", height: 7, borderRadius: 999, backgroundColor: "rgba(148,163,184,0.13)", overflow: "hidden", marginTop: 22 }, progressFill: { height: 7, borderRadius: 999, backgroundColor: "#8b5cf6", shadowColor: "#8b5cf6", shadowOpacity: 0.55, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } }, goalFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 }, goalPercent: { color: "#a899ff", fontSize: 11, fontFamily: "Inter_700Bold" }, goalDate: { color: "#69778d", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  reportGrid: { flexDirection: "row", gap: 14 }, reportMetric: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18 }, reportLabel: { color: "#8f9db1", fontSize: 12, fontFamily: "Inter_600SemiBold" }, reportValue: { color: "#e9eef7", fontSize: 14, fontFamily: "Inter_800ExtraBold" }, reportTrack: { height: 9, borderRadius: 999, backgroundColor: "rgba(148,163,184,0.12)", overflow: "hidden", marginTop: 8 }, reportFillPurple: { height: 9, borderRadius: 999, backgroundColor: "#8b5cf6" }, reportFillGreen: { height: 9, borderRadius: 999, backgroundColor: "#22c55e" }, summaryRow: { minHeight: 45, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "rgba(148,163,184,0.08)" }, summaryLabel: { color: "#8593a8", fontSize: 12, fontFamily: "Inter_600SemiBold" }, summaryValue: { color: "#dce5f2", fontSize: 13, fontFamily: "Inter_800ExtraBold" }, summaryTotal: { borderBottomWidth: 0, marginTop: 4 }, summaryTotalLabel: { color: "#c4b5fd", fontSize: 13, fontFamily: "Inter_800ExtraBold" }, summaryTotalValue: { color: "#6ee7b7", fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  settingRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 8 }, settingIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(167,139,250,0.18)", backgroundColor: "rgba(139,92,246,0.10)" }, settingValue: { color: "#e4eaf4", fontSize: 13, fontFamily: "Inter_800ExtraBold", marginRight: 12 },
  footer: { minHeight: 54, alignItems: "center", justifyContent: "center" }, footerText: { color: "#4e5b70", fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
