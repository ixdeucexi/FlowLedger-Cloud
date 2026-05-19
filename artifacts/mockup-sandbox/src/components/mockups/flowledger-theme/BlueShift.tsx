export function BlueShift() {
  const bills = [
    { name: "Car Loan", due: "Due tomorrow", amount: 350, cat: "#2563eb" },
    { name: "Credit Card", due: "Due in 6 days", amount: 120, cat: "#22c55e" },
    { name: "Rent", due: "Due in 8 days", amount: 1200, cat: "#2563eb" },
  ];
  const stats = [
    { label: "Total Bills", value: "$1,670", sub: "3 bills", icon: "📄", color: "#2563eb" },
    { label: "Paid", value: "$545", sub: "1/3 paid", icon: "✓", color: "#22c55e" },
    { label: "Unpaid", value: "$1,125", sub: "2 unpaid", icon: "!", color: "#f59e0b" },
    { label: "Total Debt", value: "$6,700", sub: "3 debts", icon: "💳", color: "#ef4444" },
  ];

  return (
    <div style={{ background: "#0d1117", minHeight: "100vh", fontFamily: "'Inter', sans-serif", color: "#e2e8f0", maxWidth: 430, margin: "0 auto", padding: "0 0 100px" }}>
      {/* Status bar */}
      <div style={{ height: 44, background: "#0d1117" }} />

      {/* Header */}
      <div style={{ padding: "0 16px 16px" }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: "#e2e8f0" }}>FlowLedger</div>
        <div style={{ fontSize: 14, color: "#8b949e", marginTop: 4 }}>May 2026</div>
      </div>

      {/* Hero card — solid blue */}
      <div style={{ margin: "0 16px 14px", borderRadius: 20, background: "#2563eb", padding: "22px 22px 18px", boxShadow: "0 4px 24px rgba(37,99,235,0.4)" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.75)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 4 }}>Balance Today</div>
        <div style={{ fontSize: 44, fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>$4,510</div>
        <div style={{ display: "flex", gap: 24, marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.2)" }}>
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: "0.5px" }}>End of Month</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginTop: 3 }}>$4,040</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Lowest Balance</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#bfdbfe", marginTop: 3 }}>$4,040 · May 25</div>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>0% of bills paid this month</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.2)" }}>
            <div style={{ height: 4, width: "0%", borderRadius: 2, background: "#fff" }} />
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "0 16px 14px" }}>
        {stats.map((s, i) => (
          <div key={i} style={{ background: "#161b22", borderRadius: 14, padding: "14px 16px", border: "1px solid #21262d" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: s.color + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{s.icon}</div>
              <div style={{ fontSize: 10, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.label}</div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Quick action */}
      <div style={{ margin: "0 16px 14px", background: "#161b22", borderRadius: 14, padding: "14px 16px", border: "1px solid #21262d", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#2563eb20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚡</div>
          <span style={{ fontSize: 15, fontWeight: 500, color: "#e2e8f0" }}>What can I do?</span>
        </div>
        <span style={{ color: "#8b949e", fontSize: 18 }}>›</span>
      </div>

      {/* Upcoming bills */}
      <div style={{ padding: "0 16px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0", marginBottom: 10 }}>Upcoming Bills (7 days)</div>
        <div style={{ background: "#161b22", borderRadius: 14, border: "1px solid #21262d", overflow: "hidden" }}>
          {bills.map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", padding: "14px 16px", borderTop: i > 0 ? "1px solid #21262d" : "none" }}>
              <div style={{ width: 4, height: 36, borderRadius: 2, background: b.cat, marginRight: 14 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{b.name}</div>
                <div style={{ fontSize: 12, color: "#8b949e", marginTop: 2 }}>{b.due}</div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>${b.amount}</div>
              <div style={{ color: "#8b949e", marginLeft: 8 }}>›</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: 430, background: "#161b22", borderTop: "1px solid #21262d", display: "flex", justifyContent: "space-around", padding: "10px 0 24px" }}>
        {[["📊", "Dashboard", true], ["📄", "Bills", false], ["💳", "Debt", false], ["📅", "Monthly", false], ["•••", "More", false]].map(([icon, label, active], i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 18 }}>{icon}</span>
            <span style={{ fontSize: 10, fontWeight: active ? 600 : 400, color: active ? "#2563eb" : "#8b949e" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
