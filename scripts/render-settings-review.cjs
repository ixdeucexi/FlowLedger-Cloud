// Isolated component review: real MoreHub + React Native Web, fictional props.
// No server, auth session, database, or financial data is used. This checks
// layout only; it does not replace signed-in application/device interaction QA.
const fs = require("node:fs");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const mobile = path.resolve(__dirname, "../artifacts/mobile");
const resolveMobile = name => require.resolve(name, { paths: [mobile] });
const React = require(resolveMobile("react"));
const { renderToStaticMarkup } = require(resolveMobile("react-dom/server"));
const native = require(resolveMobile("react-native-web"));
const colors = {
  background: "#050816", card: "#0f1729", border: "#293143",
  foreground: "#f8fafc", mutedForeground: "#a6afbf", primary: "#a855f7",
  warning: "#fbbf24", success: "#22c55e", destructive: "#fb7185",
};
const output = path.resolve(mobile, "../../tmp/settings-review");
fs.mkdirSync(output, { recursive: true });

for (const { width, fontScale } of [
  { width: 320, fontScale: 1 },
  { width: 390, fontScale: 1 },
  { width: 390, fontScale: 1.5 },
]) {
  const cache = new Map();
  const mockIcon = ({ size, color }) => React.createElement(native.Text,
    { style: { fontSize: size, lineHeight: size + 2, color }, 'aria-hidden': true }, "◇");
  const bindings = {
    "@expo/vector-icons": { Feather: mockIcon },
    "@expo/vector-icons/Feather": { __esModule: true, default: mockIcon },
    "@/hooks/useColors": { useColors: () => colors },
    "react-native": {
      ...native,
      useWindowDimensions: () => ({ width, height: 844, scale: 1, fontScale }),
      Text: ({ style, ...props }) => {
        const flat = native.StyleSheet.flatten(style) || {};
        return React.createElement(native.Text, { ...props, style: [flat, {
          ...(flat.fontSize ? { fontSize: flat.fontSize * fontScale } : {}),
          ...(flat.lineHeight ? { lineHeight: flat.lineHeight * fontScale } : {}),
        }] });
      },
    },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: file,
    }).outputText;
    const mod = new Module(file, module);
    mod.filename = file;
    mod.paths = Module._nodeModulePaths(mobile);
    mod.require = name => {
      if (Object.hasOwn(bindings, name)) return bindings[name];
      if (name.startsWith("@/")) {
        const stem = path.resolve(mobile, name.slice(2));
        return load(fs.existsSync(`${stem}.tsx`) ? `${stem}.tsx` : `${stem}.ts`);
      }
      return require(resolveMobile(name));
    };
    cache.set(file, mod);
    mod._compile(compiled, file);
    return mod.exports;
  }
  const { MoreHub } = load(path.join(mobile, "components/settings/MoreHub.tsx"));
  const noop = () => {};
  const props = {
    householdName: "Personal", householdRole: "Owner", identity: "Fictional reviewer",
    membershipLabel: "Founding Free", isAdmin: false, unreadNotificationCount: 2,
    statuses: { notifications: { label: "2 reminders", tone: "attention" },
      accounts: { label: "3 accounts" }, security: { label: "Protected" } },
    onOpenSection: noop, onOpenSearch: noop, onOpenCommands: noop, onOpenNotifications: noop,
  };
  native.AppRegistry.registerComponent("SettingsReview", () => () => React.createElement(MoreHub, props));
  const { element, getStyleElement } = native.AppRegistry.getApplication("SettingsReview");
  const markup = renderToStaticMarkup(element);
  const css = renderToStaticMarkup(getStyleElement());
  // Inspect the actual rendered RN Web classes, not StyleSheet.flatten:
  // an undefined override can leave a base aspect-ratio class active in CSS.
  const quickButtons = [...markup.matchAll(/<button\b[^>]*>/g)].filter(([tag]) =>
    /aria-label="(?:Search\.|Quick Actions\.|Alerts\.)/.test(tag));
  assert.equal(quickButtons.length, 3, "All quick-access actions must render");
  for (const [tag] of quickButtons) {
    const classes = (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
    const activeCss = classes.map(name => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return css.match(new RegExp("\\." + escaped + "\\{([^}]*)\\}"))?.[1] ?? "";
    }).join(";");
    const inlineStyle = tag.match(/style="([^"]*)"/)?.[1] ?? "";
    const styles = activeCss + ";" + inlineStyle;
    if (fontScale >= 1.5) {
      assert.doesNotMatch(styles, /aspect-ratio\s*:/, "Large-font cards must size to content, without a retained square CSS rule");
    } else {
      assert.match(styles, /aspect-ratio\s*:\s*1\s*;/, "Normal-font quick access must remain square");
    }
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<style>body{margin:0;background:${colors.background};font-family:Arial,sans-serif}#fixture{box-sizing:border-box;width:100%;max-width:${width}px;padding:16px;margin:auto}*{font-family:Arial,sans-serif!important}</style></head><body><main id="fixture" data-review="isolated-layout-only" data-font-scale="${fontScale}">${markup}</main></body></html>`;
  const file = path.join(output, `settings-${width}-${fontScale}.html`);
  fs.writeFileSync(file, html);
  console.log(file);
}
