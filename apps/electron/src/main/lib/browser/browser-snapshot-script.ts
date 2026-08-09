/**
 * Browser 语义快照内嵌脚本（移植自 synara semanticSnapshot.ts 的
 * BROWSER_AUTOMATION_BASE_STATE_BOOTSTRAP / BROWSER_AUTOMATION_STATE_BOOTSTRAP /
 * BROWSER_SEMANTIC_SNAPSHOT_EXPRESSION，world 名改为 lux-browser-automation-v1）。
 *
 * 这些字符串在隔离的 automation world 里作为 Runtime.evaluate 执行，负责：
 * - 维护 refs Map（ref → DOM 元素 + 指纹）
 * - 计算语义角色 / 显式名称 / 语义祖先上下文
 * - 收集可见交互元素（bounds/states/value/description）
 * - 收集可见文本
 */

export const BROWSER_AUTOMATION_WORLD_NAME = 'lux-browser-automation-v1'

const MAX_CONTEXT_ANCESTORS = 4
const MAX_DOM_ELEMENTS_VISITED = 20_000
const MAX_VISIBLE_TEXT_NODES_VISITED = 20_000
const MAX_SEMANTIC_ELEMENTS = 120

// Shared by snapshots and locator resolution so whichever operation reaches a
// page first installs the same bounded state without making ordinary locators
// pay the cost of the semantic fingerprint helpers.
export const BROWSER_AUTOMATION_BASE_STATE_BOOTSTRAP = String.raw`
  const key = "__luxBrowserAutomationV1";
  let state = globalThis[key];
  if (!state || typeof state !== "object") {
    state = {};
    globalThis[key] = state;
  }
  if (!Number.isSafeInteger(state.generation)) state.generation = 0;
  if (!(state.refs instanceof Map)) state.refs = new Map();
  if (!("currentTarget" in state)) state.currentTarget = null;
  if (typeof state.observe !== "function") state.observe = () => {};
`

export const BROWSER_AUTOMATION_STATE_BOOTSTRAP = String.raw`
  ${BROWSER_AUTOMATION_BASE_STATE_BOOTSTRAP}
  const identityText = (value, maximum = 256) => String(value ?? "").slice(0, maximum * 4)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, maximum);
  const implicitContextRole = (element) => {
    const tag = element?.localName || "";
    if (tag === "a" && element.hasAttribute?.("href")) return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return element.multiple ? "listbox" : "combobox";
    if (tag === "input") {
      const type = String(element.getAttribute?.("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "search") return "searchbox";
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type !== "hidden") return "textbox";
    }
    if (/^h[1-6]$/.test(tag)) return "heading";
    return ({ img: "img", ul: "list", ol: "list", li: "listitem", table: "table",
      tbody: "rowgroup", thead: "rowgroup", tfoot: "rowgroup", tr: "row", td: "cell",
      th: "columnheader", nav: "navigation", main: "main", form: "form", article: "article",
      aside: "complementary", header: "banner", footer: "contentinfo", section: "region",
      details: "group" })[tag] || "none";
  };
  const supportedContextRoles = new Set("alert alertdialog application article banner button cell checkbox columnheader combobox complementary contentinfo definition dialog directory document feed figure form grid gridcell group heading img link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status switch tab table tablist tabpanel term textbox timer toolbar tooltip tree treegrid treeitem".split(" "));
  const contextRoleFor = (element) => {
    const role = identityText(element?.getAttribute?.("role") || implicitContextRole(element), 64)
      .split(" ")[0].toLowerCase() || "none";
    return supportedContextRoles.has(role) ? role : "none";
  };
  const boundedDescendantText = (element) => {
    const parts = [];
    const frames = [];
    let length = 0;
    let visited = 0;
    const pushChildren = (node) => {
      const children = node?.childNodes;
      if (children && Number(children.length) > 0) frames.push({ children, index: 0 });
    };
    pushChildren(element);
    while (frames.length > 0 && length < 96 && visited < 48) {
      const frame = frames[frames.length - 1];
      if (frame.index >= frame.children.length) {
        frames.pop();
        continue;
      }
      const node = frame.children[frame.index++];
      visited += 1;
      if (node?.nodeType === 3) {
        const text = identityText(node.nodeValue, 96 - length);
        if (text) { parts.push(text); length += text.length + 1; }
        continue;
      }
      pushChildren(node);
    }
    return identityText(parts.join(" "), 96);
  };
  const explicitContextNameFor = (element) => {
    const labelledBy = identityText(element?.getAttribute?.("aria-labelledby"), 256);
    const root = element?.getRootNode?.();
    const labelled = labelledBy ? labelledBy.split(/\s+/).map((id) =>
      boundedDescendantText(root?.getElementById?.(id) || element?.ownerDocument?.getElementById?.(id))
    ).join(" ") : "";
    const labels = [];
    const labelElements = element?.labels;
    for (let index = 0; index < Math.min(Number(labelElements?.length) || 0, 8); index += 1) {
      labels.push(boundedDescendantText(labelElements[index]));
    }
    return identityText(element?.getAttribute?.("aria-label") || labelled || labels.join(" ") ||
      element?.getAttribute?.("alt") || element?.getAttribute?.("placeholder") ||
      element?.getAttribute?.("title"), 96);
  };
  const contextualTextRoles = new Set("article cell definition figure gridcell group listitem menuitem menuitemcheckbox menuitemradio option row rowheader tabpanel treeitem".split(" "));
  const composedParent = (element) => element?.parentElement || element?.getRootNode?.()?.host || null;
  state.semanticContext = (element) => {
    const context = [];
    const seen = new Set();
    const selfText = boundedDescendantText(element);
    let hasDistinctiveSemanticContext = false;
    let hasGenericContext = false;
    let ancestor = composedParent(element);
    for (let depth = 0; ancestor && depth < 16 && context.length < ${MAX_CONTEXT_ANCESTORS}; depth += 1) {
      if (seen.has(ancestor)) break;
      seen.add(ancestor);
      const role = contextRoleFor(ancestor);
      const semantic = role !== "none" && role !== "presentation";
      const explicitName = explicitContextNameFor(ancestor);
      const mayUseDescendantText = contextualTextRoles.has(role) ||
        (!semantic && !hasDistinctiveSemanticContext && !hasGenericContext);
      const name = explicitName || (mayUseDescendantText ? boundedDescendantText(ancestor) : "");
      const usefulGeneric = !semantic && name && name !== selfText &&
        !hasDistinctiveSemanticContext && !hasGenericContext;
      if (name && (semantic || usefulGeneric)) {
        if (usefulGeneric) hasGenericContext = true;
        else hasDistinctiveSemanticContext = true;
        const previous = context[context.length - 1];
        if (!previous || previous.role !== role || previous.name !== name) context.push({ role, name });
      }
      ancestor = composedParent(ancestor);
    }
    return context.reverse();
  };
  state.fingerprint = (element, semanticContext = state.semanticContext(element)) => JSON.stringify([
    element?.localName || "",
    identityText(element?.getAttribute?.("role"), 64),
    identityText(element?.getAttribute?.("type"), 64),
    identityText(element?.getAttribute?.("aria-label")),
    identityText(element?.getAttribute?.("aria-labelledby")),
    identityText(element?.getAttribute?.("placeholder")),
    identityText(element?.getAttribute?.("alt")),
    identityText(element?.getAttribute?.("title")),
    identityText(element?.getAttribute?.("href"), 2048),
    boundedDescendantText(element),
    semanticContext,
  ]);
`

export const BROWSER_SEMANTIC_SNAPSHOT_EXPRESSION = String.raw`(() => {
  ${BROWSER_AUTOMATION_STATE_BOOTSTRAP}

  const cssEscape = (value) => {
    if (!value) return "";
    try { return CSS.escape(value); } catch { return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
  };
  const looksSensitiveLocator = (value) => /^[_-]|__|v-[0-9]|ant-|css-|jsx-|ng-|data-react|ember|ember[0-9]/.test(value);
  const uniqueSelector = (element) => {
    const byId = (() => {
      if (!element.id || looksSensitiveLocator(element.id)) return null;
      const byId = "#" + cssEscape(element.id);
      try { return document.querySelectorAll(byId).length === 1 ? byId : null; } catch { return null; }
    })();
    if (byId) return byId;
    const segments = [];
    let current = element;
    while (current && current !== document.documentElement) {
      const parent = current.parentElement;
      const tag = current.localName.toLowerCase();
      if (!parent) { segments.unshift(tag); break; }
      const siblings = Array.from(parent.children).filter((candidate) => candidate.tagName === current.tagName);
      const index = siblings.indexOf(current) + 1;
      segments.unshift(tag + ":nth-of-type(" + Math.max(1, index) + ")");
      current = parent;
    }
    segments.unshift("html");
    const selector = segments.join(" > ");
    return selector.length <= 512 ? selector : null;
  };

  const clean = (value, maximum = 192) => String(value ?? "").slice(0, maximum * 4)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, maximum);
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
      style.visibility !== "hidden" && Number(style.opacity || 1) !== 0;
  };
  const roleFor = contextRoleFor;
  const textNameRoles = new Set("button heading link menuitem menuitemcheckbox menuitemradio option tab treeitem".split(" "));
  const explicitNameFor = (element) => {
    const labelledBy = clean(element.getAttribute("aria-labelledby"), 512);
    const root = element.getRootNode?.();
    const labelled = labelledBy ? labelledBy.split(/\s+/).map((id) =>
      boundedDescendantText(root?.getElementById?.(id) || document.getElementById(id))
    ).join(" ") : "";
    const labels = [];
    const labelElements = element.labels;
    for (let index = 0; index < Math.min(Number(labelElements?.length) || 0, 8); index += 1) {
      labels.push(boundedDescendantText(labelElements[index]));
    }
    return clean(element.getAttribute("aria-label") || labelled || labels.join(" ") || element.getAttribute("alt") ||
      element.getAttribute("placeholder") || element.getAttribute("title") || "");
  };
  const nameFor = (element, role) => explicitNameFor(element) ||
    (textNameRoles.has(role) ? clean(boundedDescendantText(element)) : "");
  const actionableRoles = new Set("button checkbox combobox link listbox menuitem menuitemcheckbox menuitemradio option radio scrollbar searchbox slider spinbutton switch tab textbox treeitem".split(" "));
  const informativeRoles = new Set("alert alertdialog article dialog document figure form heading img main navigation note status table toolbar".split(" "));
  const round = (value) => Math.round(value * 10) / 10;
  const elements = [];
  const candidates = [];
  const textRoots = [document];
  const seenShadowRoots = new Set();
  const traversalFrames = [];
  const pushTraversalFrame = (container) => {
    const children = container?.children;
    if (children && Number(children.length) > 0) traversalFrames.push({ children, index: 0 });
  };
  pushTraversalFrame(document);
  while (traversalFrames.length > 0 && candidates.length < ${MAX_DOM_ELEMENTS_VISITED}) {
    const frame = traversalFrames[traversalFrames.length - 1];
    if (frame.index >= frame.children.length) {
      traversalFrames.pop();
      continue;
    }
    const element = frame.children[frame.index++];
    if (!element) continue;
    candidates.push(element);
    pushTraversalFrame(element);
    const shadowRoot = element.shadowRoot;
    if (shadowRoot && !seenShadowRoots.has(shadowRoot)) {
      seenShadowRoots.add(shadowRoot);
      state.observe(shadowRoot);
      textRoots.push(shadowRoot);
      pushTraversalFrame(shadowRoot);
    }
  }
  const domTraversalTruncated = traversalFrames.some((frame) => frame.index < frame.children.length);
  state.refs.clear();
  const ranked = [];
  let candidateIndex = 0;
  for (const element of candidates) {
    if (!visible(element)) continue;
    const role = roleFor(element);
    const explicitName = explicitNameFor(element);
    const actionable = actionableRoles.has(role) || element.hasAttribute("tabindex") ||
      element.isContentEditable;
    const semantic = actionable || informativeRoles.has(role) || explicitName;
    if (!semantic) continue;
    const rect = element.getBoundingClientRect();
    const inViewport = rect.bottom >= -160 && rect.right >= -160 &&
      rect.top <= innerHeight + 160 && rect.left <= innerWidth + 160;
    ranked.push({
      element, role, rect, name: nameFor(element, role), index: candidateIndex++,
      priority: (inViewport ? 100 : 0) + (actionable ? 40 : 0) + (explicitName ? 10 : 0),
    });
  }
  ranked.sort((left, right) => right.priority - left.priority || left.index - right.index);
  const semanticTruncated = domTraversalTruncated || ranked.length > ${MAX_SEMANTIC_ELEMENTS};
  for (const candidate of ranked.slice(0, ${MAX_SEMANTIC_ELEMENTS})) {
    const { element, role, rect, name } = candidate;
    const ref = "e" + (elements.length + 1);
    const context = state.semanticContext(element);
    state.refs.set(ref, { element, fingerprint: state.fingerprint(element, context) });
    const states = [];
    for (const attribute of ["disabled", "checked", "selected", "expanded", "pressed", "readonly", "required"]) {
      const value = element.getAttribute(attribute) ?? element.getAttribute("aria-" + attribute);
      if (value !== null && value !== "false") states.push(attribute);
    }
    if (element.isContentEditable) states.push("editable");
    const rawValue = "value" in element ? element.value : undefined;
    const value = element.localName === "input" && element.type === "password"
      ? "redacted"
      : clean(rawValue, 1024);
    const item = {
      ref, role, name, context,
      bounds: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) }, states,
    };
    const selector = uniqueSelector(element);
    if (selector) item.selector = selector;
    const description = clean(element.getAttribute("aria-description") || element.getAttribute("aria-describedby"));
    if (description) item.description = description;
    if (value) item.value = value;
    elements.push(item);
  }
  const visibleTextParts = [];
  const seenText = new Set();
  let collectedTextLength = 0;
  let visitedTextNodes = 0;
  let textTraversalTruncated = false;
  const collectVisibleText = (root) => {
    if (collectedTextLength >= 9000 || visitedTextNodes >= ${MAX_VISIBLE_TEXT_NODES_VISITED}) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (collectedTextLength < 9000 && visitedTextNodes < ${MAX_VISIBLE_TEXT_NODES_VISITED}) {
      if (!walker.nextNode()) return;
      visitedTextNodes += 1;
      const node = walker.currentNode;
      const text = clean(node.nodeValue, 512);
      const parent = node.parentElement;
      if (!text || !parent || !visible(parent) || seenText.has(text)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.bottom < -40 || rect.right < -40 || rect.top > innerHeight + 40 || rect.left > innerWidth + 40) continue;
      seenText.add(text);
      visibleTextParts.push(text);
      collectedTextLength += text.length + 1;
    }
    if (visitedTextNodes >= ${MAX_VISIBLE_TEXT_NODES_VISITED}) textTraversalTruncated = true;
  };
  for (let index = 0; index < textRoots.length; index += 1) {
    collectVisibleText(textRoots[index]);
    if (collectedTextLength >= 9000 || visitedTextNodes >= ${MAX_VISIBLE_TEXT_NODES_VISITED}) {
      if (index + 1 < textRoots.length) textTraversalTruncated = true;
      break;
    }
  }
  const rawVisibleText = visibleTextParts.join(" ");
  const visibleText = rawVisibleText.slice(0, 9000);
  return {
    generation: state.generation,
    elements,
    visibleText,
    semanticTruncated,
    visibleTextTruncated: textTraversalTruncated || collectedTextLength >= 9000 || rawVisibleText.length > visibleText.length,
  };
})()`
