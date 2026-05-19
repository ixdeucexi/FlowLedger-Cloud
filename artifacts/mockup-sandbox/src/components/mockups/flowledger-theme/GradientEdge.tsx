export function GradientEdge() {
  const bills = [
    { name: "Car Loan", due: "Due tomorrow", amount: 350, pct: 50 },
    { name: "Credit Card", due: "Due in 6 days", amount: 120, pct: 44 },
    { name: "Rent", due: "Due in 8 days", amount: 1200, pct: 0 },
  ];

  return (
    <div style={{ background: "#0a0e1a", minHeight: "100vh", fontFamily: "'Inter', sans-serif", color: "#e2e8f0", maxWidth: 430, margin: "0 auto", padding: "0 0 100px", position: "relative", overflow: "hidden" }}>
      {/* Ambient glow */}
      <div style={{ position: "absolute", top: -80, left: -60, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(37,99,235,0.18) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 60, right: -80, width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,197,94,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* Status bar */}
      <div style={{ height: 44 }} />

      {/* Header */}
      <div style={{ padding: "0 16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, background: "linear-gradient(90deg, #2563eb, #22c55e)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>FlowLedger</div>
          <div style={{ fontSize: 13, color: "#6b7a99", marginTop: 2 }}>May 2026</div>
        </div>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: "linear-gradient(135deg, #2563eb, #22c55e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🔔</div>
      </div>

      {/* Hero card — gradient */}
      <div style={{ margin: "0 16px 16px", borderRadius: 22, background: "linear-gradient(135deg, #1d4ed8 0%, #16a34a 100%)", padding: "24px 22px 20px", position: "relative", overflow: "hidden", boxShadow: "0 8px 32px rgba(37,99,235,0.35)" }}>
        <div style={{ position: "absolute", top: -20, right: -20, width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
        <div style={{ position: "absolute", bottom: -30, left: 40, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 6 }}>Balance Today</div>
        <div style={{ fontSize: 48, fontWeight: 800, color: "#fff", lineHeight: 1.05 }}>$4,510</div>
        <div style={{ display: "flex", gap: 20, marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.18)" }}>
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.5px" }}>End of Month</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: "#fff", marginTop: 3 }}>$4,040</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Lowest Balance</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: "#bbf7d0", marginTop: 3 }}>$4,040 · May 25</div>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.2)" }}>
            <div style={{ height: 5, width: "0%", borderRadius: 3, background: "#fff" }} />
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 5 }}>0% of bills paid this month</div>
        </div>
      </div>

      {/* Stat row */}
      <div style={{ display: "flex", gap: 10, margin: "0 16px 14px", overflowX: "auto" }}>
        {[
          { label: "Bills", value: "$1,670", color: "#2563eb", bg: "rgba(37,99,235,0.12)" },
          { label: "Paid", value: "$545", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
          { label: "Unpaid", value: "$1,125", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
          { label: "Debt", value: "$6,700", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
        ].map((s, i) => (
          <div key={i} style={{ flex: "0 0 auto", background: s.bg, border: `1px solid ${s.color}30`, borderRadius: 14, padding: "12px 16px", minWidth: 90, textAlign: "center" }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "#6b7a99", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.4px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Action button */}
      <div style={{ margin: "0 16px 16px" }}>
        <div style={{ background: "linear-gradient(90deg, rgba(37,99,235,0.15), rgba(34,197,94,0.15))", border: "1px solid rgba(37,99,235,0.3)", borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #2563eb, #22c55e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚡</div>
            <span style={{ fontSize: 15, fontWeight: 500 }}>What can I do?</span>
          </div>
          <span style={{ color: "#4b5a7a", fontSize: 20 }}>›</span>
        </div>
      </div>

      {/* Upcoming bills */}
      <div style={{ padding: "0 16px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 10 }}>Upcoming Bills</div>
        <div style={{ background: "#111827", borderRadius: 16, border: "1px solid #1f2d44", overflow: "hidden" }}>
          {bills.map((b, i) => (
            <div key={i} style={{ padding: "14px 16px", borderTop: i > 0 ? "1px solid #1f2d44" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{b.name}</div>
                  <div style={{ fontSize: 12, color: "#6b7a99", marginTop: 2 }}>{b.due}</div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>${b.amount}</div>
              </div>
              <div style={{ height: 3, borderRadius: 2, background: "#1f2d44" }}>
                <div style={{ height: 3, width: `${b.pct}%`, borderRadius: 2, background: "linear-gradient(90deg, #2563eb, #22c55e)" }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: 430, background: "#0e1420", borderTop: "1px solid #1f2d44", display: "flex", justifyContent: "space-around", padding: "10px 0 24px" }}>
        {[["📊", "Dashboard", true], ["📄", "Bills", false], ["💳", "Debt", false], ["📅", "Monthly", false], ["•••", "More", false]].map(([icon, label, active], i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 18 }}>{icon}</span>
            <span style={{ fontSize: 10, fontWeight: active ? 700 : 400, color: active ? "#22c55e" : "#6b7a99" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
