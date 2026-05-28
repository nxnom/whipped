// Main-world helper — runs in the page's JS context so it can see React's
// __reactFiber$xxx properties on DOM nodes (which are invisible from the
// extension's isolated world).
//
// Protocol:
//   isolated → main:  postMessage({type: "__WA_REACT_EXTRACT", requestId, marker})
//                     where `marker` is the value of a data-wa-marker attribute
//                     set on the target element.
//   main → isolated:  postMessage({type: "__WA_REACT_RESULT", requestId, result})

(function () {
  if (window.__waReactExtractInstalled) return;
  window.__waReactExtractInstalled = true;

  function extractComponentName(type) {
    if (!type) return null;
    if (typeof type === "string") return null;
    if (typeof type === "function") return type.displayName || type.name || null;
    if (typeof type === "object") {
      if (type.displayName) return type.displayName;
      if (type.type) return extractComponentName(type.type);
      if (type.render) return extractComponentName(type.render);
    }
    return null;
  }

  function extractSourceFromStack(stack) {
    if (!stack) return { sourceFile: null, sourceLine: null };
    const text = typeof stack === "string" ? stack : (stack.stack || String(stack));
    const lines = text.split("\n");
    for (const line of lines) {
      const m = line.match(/(?:\(|\s)([^()\s]+?\.(?:tsx|jsx|ts|js)):(\d+):\d+/);
      if (m) {
        const file = m[1];
        if (!file.includes("node_modules") && !file.includes("/react-dom") && !file.includes("/react/") && !file.includes("/scheduler/")) {
          return { sourceFile: file, sourceLine: parseInt(m[2], 10) };
        }
      }
    }
    return { sourceFile: null, sourceLine: null };
  }

  function extractReactInfo(el) {
    const allKeys = Object.keys(el);
    const key = allKeys.find((k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
    const debugKeys = allKeys.filter((k) => k.startsWith("__"));
    if (!key) return { error: "no fiber key", debugKeys };

    let fiber = el[key];
    let componentName = null, sourceFile = null, sourceLine = null;
    const trace = [];
    let depth = 0;

    while (fiber && depth < 30) {
      depth++;
      const typeOf = typeof fiber.type;
      const typeDesc =
        typeOf === "string" ? fiber.type :
        typeOf === "function" ? (fiber.type.displayName || fiber.type.name || "[anon fn]") :
        typeOf === "object" && fiber.type ? (fiber.type.displayName || "[obj]") :
        String(typeOf);
      trace.push({
        i: depth,
        type: typeDesc,
        hasSrc: !!fiber._debugSource,
        hasStk: !!fiber._debugStack,
      });

      if (!componentName) {
        componentName = extractComponentName(fiber.type) || extractComponentName(fiber.elementType);
      }
      if (!sourceFile) {
        if (fiber._debugSource) {
          sourceFile = fiber._debugSource.fileName || null;
          sourceLine = fiber._debugSource.lineNumber || null;
        } else if (fiber._debugStack) {
          const parsed = extractSourceFromStack(fiber._debugStack);
          sourceFile = parsed.sourceFile;
          sourceLine = parsed.sourceLine;
        }
      }
      if (componentName && sourceFile) break;
      fiber = fiber.return;
    }
    return { componentName, sourceFile, sourceLine, trace };
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const data = e.data;
    if (!data || data.type !== "__WA_REACT_EXTRACT") return;
    const { requestId, marker } = data;
    const el = document.querySelector(`[data-wa-marker="${marker}"]`);
    const result = el ? extractReactInfo(el) : { error: "marker not found" };
    window.postMessage({ type: "__WA_REACT_RESULT", requestId, result }, "*");
  });
})();
