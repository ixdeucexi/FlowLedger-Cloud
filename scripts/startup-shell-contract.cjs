const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_STYLE_SHA256 = "43ccfa5bfe03140c99863764c84e75672480072d4eab44827ed585fa4c8242d5";
const EXPECTED_CONTROLLER_SHA256 = "122db0d9fc5d8baa041e43d2f2e2dc809221836fd8d7de2866bde02b2b7ec388";
const EXPECTED_NOSCRIPT_SHA256 = "cd9d9810020d0dc0ad6f4239233d4e185e61c50a45d3e8522bc3ce58ea5efbce";
const EXPECTED_DOCUMENT_SHA256 = "ad31de4945544104da03fa98fdc279734f7e086ffbcb4af2f65d049411f6b578";

function stripMarkupComments(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function attributeValue(openTag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = openTag.match(new RegExp(
    `(?:^|\\s)${escaped}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+)))?(?=\\s|/?>)`,
    "i",
  ));
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? "";
}

function elements(source, tagName) {
  const matches = [];
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  for (const match of source.matchAll(pattern)) {
    matches.push({ openTag: match[0], position: match.index ?? -1 });
  }
  return matches;
}

function elementById(source, tagName, id) {
  return elements(source, tagName).find(element => attributeValue(element.openTag, "id") === id) ?? null;
}

function styleById(source, id) {
  const pattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  for (const match of source.matchAll(pattern)) {
    if (attributeValue(match[0].slice(0, match[0].indexOf(">") + 1), "id") === id) {
      return {
        openTag: match[0].slice(0, match[0].indexOf(">") + 1),
        content: match[1],
        position: match.index ?? -1,
      };
    }
  }
  return null;
}

function scripts(source) {
  const matches = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of source.matchAll(pattern)) {
    matches.push({
      openTag: `<script${match[1]}>`,
      content: match[2],
      position: match.index ?? -1,
      endPosition: (match.index ?? -1) + match[0].length,
    });
  }
  return matches;
}

function normalizedSha256(source) {
  return crypto.createHash("sha256")
    .update(trimHtmlWhitespace(source.replace(/\r\n?/g, "\n")))
    .digest("hex");
}

function trimHtmlWhitespace(source) {
  return source.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
}

function canonicalStartupDocument(source, label) {
  const cloudflareBeacon = /<script type="module" src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js\/[a-z0-9]+" integrity="sha512-[A-Za-z0-9+/=]+" data-cf-beacon='[^']+' crossorigin="anonymous"><\/script>/gi;
  const beaconMatches = [...source.matchAll(cloudflareBeacon)];
  if (beaconMatches.length > 1) {
    throw new Error(`${label} contains duplicate Cloudflare beacon scripts.`);
  }
  let canonical = source;
  if (beaconMatches.length === 1) {
    const beacon = beaconMatches[0];
    const entry = /<script\s+src=(?:"\/_expo\/static\/js\/web\/entry-[a-f0-9]{32}\.js"|'\/_expo\/static\/js\/web\/entry-[a-f0-9]{32}\.js')\s+defer\s*>\s*<\/script>/.exec(source);
    const bodyClosures = [...source.matchAll(/<\/body\s*>/gi)];
    const entryEnd = (entry?.index ?? -1) + (entry?.[0].length ?? 0);
    const beaconStart = beacon.index ?? -1;
    const beaconEnd = beaconStart + beacon[0].length;
    const bodyStart = bodyClosures[0]?.index ?? -1;
    if (
      !entry
      || bodyClosures.length !== 1
      || beaconStart < entryEnd
      || bodyStart < beaconEnd
      || trimHtmlWhitespace(source.slice(entryEnd, beaconStart)) !== ""
      || trimHtmlWhitespace(source.slice(beaconEnd, bodyStart)) !== ""
    ) {
      throw new Error(`${label} Cloudflare beacon is outside its reviewed post-bundle body slot.`);
    }
    canonical = `${source.slice(0, entryEnd)}\n${source.slice(bodyStart)}`;
  }
  canonical = canonical.replace(/\r\n?/g, "\n");
  canonical = canonical
    .replace(/<html\s+lang=(['"])[^'"]*\1\s*>/i, '<html lang="%LANG%">')
    .replace(/<title>[\s\S]*?<\/title>/i, "<title>%TITLE%</title>")
    .replace(
      /\/_expo\/static\/js\/web\/entry-[a-f0-9]{32}\.js/g,
      "/_expo/static/js/web/entry-HASH.js",
    );
  return trimHtmlWhitespace(canonical);
}

function assertRegularNonemptyFileBelow(rootDirectory, targetFile, label = "Release artifact") {
  let rootReal;
  let targetReal;
  let targetStat;
  try {
    rootReal = fs.realpathSync(rootDirectory);
    targetReal = fs.realpathSync(targetFile);
    targetStat = fs.lstatSync(targetFile);
  } catch {
    throw new Error(`${label} is missing or cannot be resolved.`);
  }
  const relativeRealPath = path.relative(rootReal, targetReal);
  if (
    relativeRealPath === ""
    || relativeRealPath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeRealPath)
    || !targetStat.isFile()
    || targetStat.isSymbolicLink()
    || targetStat.size === 0
  ) {
    throw new Error(`${label} must be a nonempty regular file physically contained below ${rootDirectory}.`);
  }
  return targetReal;
}

function assertExecutableJavaScriptResponse(response, expectedUrl, label = "Production bundle") {
  if (response.redirected === true || response.url !== expectedUrl) {
    throw new Error(`${label} redirected to ${response.url || "an unknown URL"}.`);
  }
  const mime = (response.headers?.get?.("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (mime !== "application/javascript" && mime !== "text/javascript") {
    throw new Error(`${label} returned non-JavaScript content type ${JSON.stringify(mime || "missing")}.`);
  }
}

function javascriptTokens(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    if (/\s/.test(current)) {
      index += 1;
      continue;
    }
    if (current === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (current === '"' || current === "'" || current === "`") {
      const quote = current;
      let value = "";
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\" && index + 1 < source.length) {
          value += source[index + 1];
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        value += source[index];
        index += 1;
      }
      tokens.push(`string:${value}`);
      continue;
    }
    const identifier = source.slice(index).match(/^[A-Za-z_$][\w$]*/)?.[0];
    if (identifier) {
      tokens.push(identifier);
      index += identifier.length;
      continue;
    }
    const punctuator = ["===", "!==", "=>", "==", "!=", "?.", "&&", "||", "++", "--"]
      .find(candidate => source.startsWith(candidate, index));
    if (punctuator) {
      tokens.push(punctuator);
      index += punctuator.length;
      continue;
    }
    tokens.push(current);
    index += 1;
  }
  return tokens;
}

function tokenSequenceIndex(tokens, expected, fromIndex = 0) {
  for (let index = fromIndex; index <= tokens.length - expected.length; index += 1) {
    if (expected.every((token, offset) => tokens[index + offset] === token)) return index;
  }
  return -1;
}

function functionBodyTokens(tokens, signature) {
  const signaturePosition = tokenSequenceIndex(tokens, signature);
  if (signaturePosition < 0) return null;
  const openingBrace = signaturePosition + signature.length - 1;
  let depth = 0;
  for (let index = openingBrace; index < tokens.length; index += 1) {
    if (tokens[index] === "{") depth += 1;
    if (tokens[index] === "}") depth -= 1;
    if (depth === 0) return tokens.slice(openingBrace + 1, index);
  }
  return null;
}

function requireAttribute(element, name, expected, label) {
  const actual = attributeValue(element.openTag, name);
  if (actual === null || (expected !== undefined && actual !== expected)) {
    throw new Error(`${label} must have ${name}${expected === undefined ? "" : `=${JSON.stringify(expected)}`}.`);
  }
}

function assertDeclaration(block, property, valuePattern, label) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*${valuePattern}\\s*(?:;|$)`, "i");
  if (!pattern.test(block)) {
    throw new Error(`${label} must declare ${property}.`);
  }
}

function assertStartupShell(source, label = "PWA HTML") {
  if (typeof source !== "string" || source.length === 0) {
    throw new Error(`${label} is empty.`);
  }
  const html = stripMarkupComments(source);
  const styleElements = elements(html, "style")
    .filter(element => attributeValue(element.openTag, "id") === "expo-reset");
  if (styleElements.length !== 1) {
    throw new Error(`${label} must contain exactly one active expo-reset style element.`);
  }
  const style = styleById(html, "expo-reset");
  if (!style) throw new Error(`${label} is missing the active expo-reset style element.`);
  if (
    attributeValue(style.openTag, "media") !== null
    || attributeValue(style.openTag, "disabled") !== null
    || normalizedSha256(style.content) !== EXPECTED_STYLE_SHA256
  ) {
    throw new Error(`${label} expo-reset startup CSS does not match the reviewed active release contract.`);
  }

  const hiddenRule = style.content.match(
    /(?:^|})\s*#flowledger-web-startup-cover\[data-state\s*=\s*["']hidden["']\]\s*,\s*#flowledger-web-startup-cover\[hidden\]\s*\{([^}]*)\}/i,
  );
  if (!hiddenRule) {
    throw new Error(`${label} is missing the active startup-cover hidden rule.`);
  }
  assertDeclaration(hiddenRule[1], "display", "none\\s*!important", label);
  assertDeclaration(hiddenRule[1], "opacity", "0", label);
  assertDeclaration(hiddenRule[1], "visibility", "hidden", label);
  assertDeclaration(hiddenRule[1], "pointer-events", "none", label);
  assertDeclaration(hiddenRule[1], "transition", "none", label);

  const allStyleElements = elements(html, "style");
  const noscriptMatches = [...html.matchAll(/<noscript\b([^>]*)>([\s\S]*?)<\/noscript\s*>/gi)];
  if (
    allStyleElements.length !== 2
    || noscriptMatches.length !== 1
    || noscriptMatches[0][1].trim() !== ""
    || normalizedSha256(noscriptMatches[0][2]) !== EXPECTED_NOSCRIPT_SHA256
  ) {
    throw new Error(`${label} must contain only the reviewed active CSS and exact noscript fallback.`);
  }

  const covers = elements(html, "div")
    .filter(element => attributeValue(element.openTag, "id") === "flowledger-web-startup-cover");
  if (covers.length !== 1) throw new Error(`${label} must contain exactly one startup-cover element.`);
  const cover = covers[0];
  requireAttribute(cover, "data-state", "visible", label);
  requireAttribute(cover, "data-reason", "initial", label);
  requireAttribute(cover, "data-generation", "0", label);
  requireAttribute(cover, "role", "progressbar", label);
  requireAttribute(cover, "aria-label", "Loading your FlowLedger plan", label);
  if (attributeValue(cover.openTag, "hidden") !== null || attributeValue(cover.openTag, "style") !== null) {
    throw new Error(`${label} startup cover cannot begin hidden or override its reviewed startup style inline.`);
  }

  const roots = elements(html, "div").filter(element => attributeValue(element.openTag, "id") === "root");
  if (roots.length !== 1) throw new Error(`${label} must contain exactly one React root element.`);
  const root = roots[0];
  requireAttribute(root, "inert", undefined, label);
  requireAttribute(root, "aria-hidden", "true", label);
  if (attributeValue(root.openTag, "hidden") !== null || attributeValue(root.openTag, "style") !== null) {
    throw new Error(`${label} React root cannot be hidden or carry an inline startup-style override.`);
  }
  if (root.position <= cover.position) {
    throw new Error(`${label} must place the opaque startup cover before the inert React root.`);
  }
  const bodyOpen = /<body\b[^>]*>/i.exec(html);
  if (!bodyOpen || html.slice((bodyOpen.index ?? 0) + bodyOpen[0].length, cover.position).trim() !== "") {
    throw new Error(`${label} startup cover must be the first direct body element.`);
  }
  const coverThroughRoot = html.slice(cover.position + cover.openTag.length, root.position);
  if (!/<\/div>\s*<noscript\b[\s\S]*<\/noscript>\s*$/i.test(coverThroughRoot)) {
    throw new Error(`${label} React root must follow the direct startup cover and noscript fallback.`);
  }

  const scriptTags = scripts(html);
  const coverLookup = ["document", ".", "getElementById", "(", "string:flowledger-web-startup-cover", ")"];
  const rootLookup = ["document", ".", "getElementById", "(", "string:root", ")"];
  const controller = scriptTags.find(script => {
    if (script.position <= root.position || attributeValue(script.openTag, "src") !== null) return false;
    const tokens = javascriptTokens(script.content);
    return tokenSequenceIndex(tokens, coverLookup) >= 0 && tokenSequenceIndex(tokens, rootLookup) >= 0;
  });
  if (!controller) throw new Error(`${label} is missing the inline startup-cover controller after the root.`);
  if (!/^<script\s*>$/i.test(controller.openTag)) {
    throw new Error(`${label} startup controller must be an active inline JavaScript element.`);
  }
  if (html.slice(root.position + root.openTag.length, controller.position).trim() !== "</div>") {
    throw new Error(`${label} startup controller must directly follow the inert, empty React root.`);
  }
  if (normalizedSha256(controller.content) !== EXPECTED_CONTROLLER_SHA256) {
    throw new Error(`${label} startup controller does not match the reviewed executable release contract.`);
  }
  const controllerTokens = javascriptTokens(controller.content);
  const armBody = functionBodyTokens(controllerTokens, [
    "const", "arm", "=", "(", "reason", ")", "=>", "{",
  ]);
  if (!armBody) throw new Error(`${label} startup controller is missing an executable arm function.`);
  const inertRoot = ["root", ".", "setAttribute", "(", "string:inert", ",", "string:", ")", ";"];
  const hideRootFromAccessibility = [
    "root", ".", "setAttribute", "(", "string:aria-hidden", ",", "string:true", ")", ";",
  ];
  const showCover = ["cover", ".", "hidden", "=", "false", ";"];
  const markCoverVisible = [
    "cover", ".", "dataset", ".", "state", "=", "string:visible", ";",
  ];
  const inertPosition = tokenSequenceIndex(armBody, inertRoot);
  const ariaPosition = tokenSequenceIndex(armBody, hideRootFromAccessibility);
  const showPosition = tokenSequenceIndex(armBody, showCover);
  const visiblePosition = tokenSequenceIndex(armBody, markCoverVisible);
  if (inertPosition < 0 || ariaPosition < 0 || showPosition < 0 || visiblePosition < 0) {
    throw new Error(`${label} startup arm function is missing an executable cover/root barrier statement.`);
  }
  if (inertPosition > showPosition || ariaPosition > showPosition || showPosition > visiblePosition) {
    throw new Error(`${label} startup controller must inert the root before visibly re-arming the cover.`);
  }
  for (const [description, sequence] of [
    ["visibility-change listener", ["document", ".", "addEventListener", "(", "string:visibilitychange"]],
    ["hidden-state check", ["document", ".", "visibilityState", "===", "string:hidden"]],
    ["pagehide listener", ["window", ".", "addEventListener", "(", "string:pagehide"]],
    ["resume arm call", ["arm", "(", "string:resume", ")"]],
  ]) {
    if (tokenSequenceIndex(controllerTokens, sequence) < 0) {
      throw new Error(`${label} startup controller is missing an executable ${description}.`);
    }
  }

  const bundles = scriptTags.filter(script => {
    const src = attributeValue(script.openTag, "src");
    return typeof src === "string"
      && /^\/_expo\/static\/js\/web\/entry-[a-f0-9]{32}\.js$/.test(src);
  });
  if (bundles.length !== 1) throw new Error(`${label} must reference exactly one hashed Expo entry bundle.`);
  const bundle = bundles[0];
  requireAttribute(bundle, "defer", undefined, label);
  if (!/^<script\s+src=(?:"\/_expo\/static\/js\/web\/entry-[a-f0-9]{32}\.js"|'\/_expo\/static\/js\/web\/entry-[a-f0-9]{32}\.js')\s+defer\s*>$/.test(bundle.openTag)) {
    throw new Error(`${label} hashed Expo entry must be a directly executable deferred script.`);
  }
  if (bundle.content.trim() !== "") {
    throw new Error(`${label} hashed Expo entry script element must not contain inline fallback content.`);
  }
  if (bundle.position <= controller.position) {
    throw new Error(`${label} must install the startup controller before the deferred Expo bundle.`);
  }
  if (html.slice(controller.endPosition, bundle.position).trim() !== "") {
    throw new Error(`${label} deferred Expo bundle must directly follow the startup controller.`);
  }
  if (normalizedSha256(canonicalStartupDocument(source, label)) !== EXPECTED_DOCUMENT_SHA256) {
    throw new Error(`${label} active document does not match the reviewed startup release shell.`);
  }

  return { bundlePath: attributeValue(bundle.openTag, "src") };
}

module.exports = {
  assertExecutableJavaScriptResponse,
  assertRegularNonemptyFileBelow,
  assertStartupShell,
};
