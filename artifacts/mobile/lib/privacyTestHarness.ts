import * as moneyPrivacy from "./moneyPrivacy";

/**
 * Existing financial handler tests run in a tiny VM with presentation primitives
 * represented by native element names. Keep that explicit revealed-mode boundary
 * while the dedicated privacy tests/browser checks exercise concealed rendering.
 */
export function revealedPrivacyModule(name: string): Record<string, unknown> | undefined {
  if (name.endsWith("/PrivacyPrimitives")) return {
    PrivacyText: "Text", PrivacyView: "View", PrivacyPressable: "Pressable", PrivacyTextInput: "TextInput",
  };
  if (name.endsWith("/moneyPrivacy")) return moneyPrivacy;
  if (name.endsWith("/usePrivacyAlerts")) return {
    usePrivacyAlerts: () => ({ alert() {}, formError() {} }),
  };
  return undefined;
}

/** Preserve each harness's existing notice spies when extracting real handlers. */
export function revealedPrivacyBindings(bindings: Record<string, unknown>): Record<string, unknown> {
  const native = (bindings.Alert ?? bindings.NativeAlert) as { alert?: (...args: unknown[]) => unknown } | undefined;
  const oldFormError = bindings.showFormError as ((...args: unknown[]) => unknown) | undefined;
  const alert = native?.alert ? native.alert.bind(native) : oldFormError ?? (() => {});
  const formError = oldFormError ?? alert;
  return {
    ...bindings,
    privacyAlert: bindings.privacyAlert ?? alert,
    privacyFormError: bindings.privacyFormError ?? formError,
    privacyAlerts: bindings.privacyAlerts ?? { alert, formError },
  };
}
