import React from "react";
import { HIDDEN_MONEY, maskMoneyText } from "./moneyPrivacy";

/** Join adjacent primitives first: JSX `$` and `{amount}` must be masked together. */
export function privateTextChildren(children: React.ReactNode, hidden: boolean, sensitive = false): React.ReactNode {
  if (!hidden) return children;
  if (sensitive) return HIDDEN_MONEY;
  const plain = (node: React.ReactNode): string => {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(plain).join("");
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) return plain(node.props.children);
    return "";
  };
  const fullText = plain(children);
  // A currency sign and number can be split across nested styled Text elements.
  // While private, flatten only those rich currency strings so no digits survive.
  if (maskMoneyText(fullText, true) !== fullText && React.Children.toArray(children).some(React.isValidElement)) return maskMoneyText(fullText, true);
  const output: React.ReactNode[] = [];
  let run = "";
  const flush = () => { if (run) { output.push(maskMoneyText(run, true)); run = ""; } };
  React.Children.forEach(children, child => {
    if (typeof child === "string" || typeof child === "number") run += String(child);
    else { flush(); output.push(child); }
  });
  flush();
  return output;
}
