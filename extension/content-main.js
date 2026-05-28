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

  function isVendorPath(file) {
    if (!file) return true;
    // node_modules + vendor chunks
    if (/\/node_modules\//.test(file)) return true;
    if (/chunks\/node_modules/.test(file)) return true;
    if (/chunks\/_next/.test(file)) return true;
    if (/\/react-dom|\/react\/|\/scheduler\//.test(file)) return true;
    // Turbopack-specific vendor chunks
    if (/chunks\/turbopack-/.test(file)) return true;
    if (/chunks\/[^/]*next_dist/.test(file)) return true;
    if (/chunks\/[^/]*react-server-dom/.test(file)) return true;
    if (/chunks\/[^/]*_pnpm_/.test(file)) return true;
    // React/Next framework files detected by filename
    const filename = file.split("/").pop() || file;
    if (/^(react|react-dom|react-dom-client|scheduler|use-sync-external-store)(\.|\.[^.]+\.)?(production|development)?\.[mc]?js$/i.test(filename)) return true;
    if (/^react-jsx(-dev)?-runtime(\.[^.]+)*\.[mc]?js$/i.test(filename)) return true;
    if (/^(next|next-error|next-flight|next-app)([-./]|$)/i.test(filename)) return true;
    if (file === "<anonymous>") return true;
    return false;
  }

  function isBundledChunk(file) {
    if (!file) return false;
    return /\/_next\/static\/chunks\//.test(file)
      || /(^|\/)chunks\/[^/]+\.js/.test(file)
      || /^webpack-internal:/.test(file)
      || /^webpack:\/\//.test(file);
  }

  // Find ALL valid stack frames; the caller picks which to use.
  function allStackFrames(stack) {
    if (!stack) return [];
    const text = typeof stack === "string" ? stack : (stack.stack || String(stack));
    const out = [];
    for (const line of text.split("\n")) {
      const m = line.match(/(?:\(|@|\s)((?:[a-z]+:\/\/[^\s()]+?|[^\s()]+?\.[tj]sx?)):(\d+):(\d+)/);
      if (m) out.push({ file: m[1], line: parseInt(m[2], 10), column: parseInt(m[3], 10), isVendor: isVendorPath(m[1]) });
    }
    return out;
  }

  function looksLikeUserSource(file) {
    if (!file) return false;
    // App / project source directories
    if (/(?:^|\/)(src|app|pages|components|hooks|features|views|screens|routes)\//i.test(file)) return true;
    // .tsx/.jsx are almost always user code (libraries ship as .js/.mjs)
    if (/\.(?:tsx|jsx)$/.test(file)) return true;
    return false;
  }

  function isLibraryDist(file) {
    if (!file) return false;
    // Common library output directories — heuristic to skip third-party bundles
    return /(?:^|\/)dist\//.test(file)
      || /(?:^|\/)esm\//.test(file)
      || /(?:^|\/)cjs\//.test(file)
      || /\.mjs$/.test(file);
  }

  function firstUserFrame(stack) {
    const frames = allStackFrames(stack);
    // Best: user-source patterns (src/, app/, .tsx, etc.)
    const userSource = frames.find((f) => !f.isVendor && !isBundledChunk(f.file) && looksLikeUserSource(f.file));
    if (userSource) return userSource;
    // Next: non-vendor non-chunk non-library frames
    const userPlain = frames.find((f) => !f.isVendor && !isBundledChunk(f.file) && !isLibraryDist(f.file));
    if (userPlain) return userPlain;
    // Next: any non-vendor non-chunk
    const original = frames.find((f) => !f.isVendor && !isBundledChunk(f.file));
    if (original) return original;
    // Last: any non-vendor (including chunks)
    return frames.find((f) => !f.isVendor) || null;
  }

  function firstAnyFrame(stack) {
    return allStackFrames(stack)[0] || null;
  }

  // Cache resolved frames so repeat clicks on same chunk don't re-fetch
  const sourceMapCache = new Map();
  const decodedMapCache = new Map(); // url → { sources, lineMap, sourceRoot }

  // ── Inline source map decoder (VLQ-based) ──────────────────────────────────

  const VLQ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const VLQ_TABLE = (() => {
    const t = new Int8Array(128).fill(-1);
    for (let i = 0; i < VLQ_CHARS.length; i++) t[VLQ_CHARS.charCodeAt(i)] = i;
    return t;
  })();

  function decodeVlqSegment(str, out) {
    out.length = 0;
    let value = 0, shift = 0;
    for (let i = 0; i < str.length; i++) {
      const n = VLQ_TABLE[str.charCodeAt(i)];
      if (n < 0) continue;
      const cont = n & 32;
      value += (n & 31) << shift;
      if (cont) {
        shift += 5;
      } else {
        out.push(value & 1 ? -(value >>> 1) : value >>> 1);
        value = 0; shift = 0;
      }
    }
  }

  function buildLineMap(mappings) {
    const lines = mappings.split(";");
    const lineMap = new Array(lines.length);
    let srcIdx = 0, srcLine = 0, srcCol = 0;
    const tmp = [];
    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      const line = lines[lineNo];
      const segs = [];
      if (line) {
        let genCol = 0;
        const segStrs = line.split(",");
        for (const s of segStrs) {
          if (!s) continue;
          decodeVlqSegment(s, tmp);
          genCol += tmp[0];
          if (tmp.length >= 4) {
            srcIdx += tmp[1];
            srcLine += tmp[2];
            srcCol += tmp[3];
            segs.push([genCol, srcIdx, srcLine, srcCol]);
          }
        }
      }
      lineMap[lineNo] = segs;
    }
    return lineMap;
  }

  function lookupPosition(lineMap, sources, sourceRoot, genLine, genCol) {
    const segs = lineMap[genLine - 1];
    if (!segs || segs.length === 0) return null;
    // Find largest segment with genCol <= input
    let lo = 0, hi = segs.length - 1, best = segs[0];
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (segs[mid][0] <= genCol) { best = segs[mid]; lo = mid + 1; }
      else hi = mid - 1;
    }
    let file = sources[best[1]] || null;
    if (file && sourceRoot && !/^[a-z]+:\/\//.test(file)) file = sourceRoot + file;
    // Strip common bundler prefixes
    if (file) file = file
      .replace(/^webpack:\/\/_N_E\//, "")
      .replace(/^webpack:\/\/\//, "")
      .replace(/^\[project\]\//, "")
      .replace(/^\[turbopack\]\//, "")
      .replace(/^file:\/\//, "");
    // URL-decode source paths (Next.js route groups like (marketing) become %28marketing%29)
    if (file) {
      try { file = decodeURIComponent(file); } catch { /* leave as-is on invalid encoding */ }
    }
    return { file, line: best[2] + 1, column: best[3] };
  }

  async function getDecodedMap(chunkUrl) {
    if (decodedMapCache.has(chunkUrl)) return decodedMapCache.get(chunkUrl);
    let result = null;
    try {
      let mapJson = null;

      // 1. Try sibling .map file
      try {
        const res = await fetch(chunkUrl + ".map");
        if (res.ok) mapJson = await res.json();
      } catch { /* */ }

      // 2. Fallback: fetch chunk and read sourceMappingURL
      if (!mapJson) {
        const chunkRes = await fetch(chunkUrl);
        if (chunkRes.ok) {
          const text = await chunkRes.text();
          const m = text.match(/\/\/# sourceMappingURL=([^\s]+)/);
          if (m) {
            const mapUrl = m[1].trim();
            if (mapUrl.startsWith("data:")) {
              const b64 = (mapUrl.split(",")[1] || "").trim();
              // Skip un-evaluated template literals (Turbopack runtime writes "${btoa(...)}")
              if (!b64.startsWith("$")) {
                try { mapJson = JSON.parse(atob(b64)); } catch { /* */ }
              }
            } else {
              const abs = new URL(mapUrl, chunkUrl).toString();
              const mapRes = await fetch(abs);
              if (mapRes.ok) mapJson = await mapRes.json();
            }
          }
        }
      }

      if (mapJson) {
        if (Array.isArray(mapJson.sections)) {
          // Indexed source map (used by Turbopack to concatenate sub-maps)
          const sections = [];
          for (const sec of mapJson.sections) {
            const sub = sec.map;
            if (sub && sub.mappings && Array.isArray(sub.sources)) {
              sections.push({
                offsetLine: sec.offset?.line ?? 0,
                offsetCol: sec.offset?.column ?? 0,
                sources: sub.sources,
                sourceRoot: sub.sourceRoot || "",
                lineMap: buildLineMap(sub.mappings),
              });
            }
          }
          result = { type: "indexed", sections };
        } else if (mapJson.mappings && Array.isArray(mapJson.sources)) {
          result = {
            type: "flat",
            sources: mapJson.sources,
            sourceRoot: mapJson.sourceRoot || "",
            lineMap: buildLineMap(mapJson.mappings),
          };
        }
      }
    } catch { /* */ }
    decodedMapCache.set(chunkUrl, result);
    return result;
  }

  function lookupIndexed(sections, genLine, genCol) {
    // Section offsets are 0-based; genLine is 1-based per stack-trace convention.
    // Find the last section whose offset is <= (genLine-1, genCol).
    let target = null;
    for (const sec of sections) {
      if (sec.offsetLine > genLine - 1) break;
      if (sec.offsetLine === genLine - 1 && sec.offsetCol > genCol) break;
      target = sec;
    }
    if (!target) return null;
    const adjLine = genLine - target.offsetLine;
    const adjCol = (genLine - 1 === target.offsetLine) ? genCol - target.offsetCol : genCol;
    return lookupPosition(target.lineMap, target.sources, target.sourceRoot, adjLine, adjCol);
  }

  async function resolveViaSourceMap(file, lineNumber, column) {
    const absUrl = file.startsWith("/") ? new URL(file, window.location.origin).toString() : file;
    const decoded = await getDecodedMap(absUrl);
    if (!decoded) return null;
    const pos = decoded.type === "indexed"
      ? lookupIndexed(decoded.sections, lineNumber, column || 0)
      : lookupPosition(decoded.lineMap, decoded.sources, decoded.sourceRoot, lineNumber, column || 0);
    if (!pos || !pos.file) return null;
    return { sourceFile: pos.file, sourceLine: pos.line };
  }

  async function resolveNextJsFrame(file, lineNumber, column) {
    const cacheKey = `${file}:${lineNumber}:${column}`;
    if (sourceMapCache.has(cacheKey)) return sourceMapCache.get(cacheKey);
    const result = await tryResolveNextJsFrame(file, lineNumber, column);
    sourceMapCache.set(cacheKey, result);
    return result;
  }

  async function tryResolveNextJsFrame(file, lineNumber, column) {
    // Turbopack only accepts paths, not full URLs. Strip the origin if present.
    let filePath = file;
    try {
      const parsed = new URL(file, window.location.origin);
      if (parsed.origin === window.location.origin) filePath = parsed.pathname + parsed.search;
    } catch { /* not a URL, keep as is */ }

    const body = {
      frames: [{ file: filePath, methodName: "", lineNumber: lineNumber || 0, column: column || 0, arguments: [] }],
      isServer: false,
      isEdgeServer: false,
      isAppDirectory: true,
    };
    try {
      const res = await fetch("/__nextjs_original-stack-frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        // Shape: PromiseSettledResult<OriginalStackFrameResponse>[]
        const r = Array.isArray(data) ? data[0] : data;
        if (r?.status !== "rejected") {
          const resp = r?.value || r;
          const f = resp?.originalStackFrame;
          // Turbopack sometimes returns the same chunk with null line/column when
          // its source map lookup fails — treat that as "couldn't resolve" and
          // fall through to our own decoder.
          const line = f?.lineNumber ?? f?.line ?? f?.line1;
          const isSameFileNoPos = f && f.file === filePath && line == null;
          if (f?.file && !isSameFileNoPos && line != null) {
            return { sourceFile: f.file, sourceLine: line };
          }
        }
      }
    } catch { /* */ }

    // Fallback: fetch the chunk's source map directly and decode it
    return await resolveViaSourceMap(filePath, lineNumber, column);
  }

  async function extractReactInfo(el) {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
    if (!key) return {};

    let fiber = el[key];
    let depth = 0;
    // Track candidates by priority so we can prefer real user source over library bundles
    let bestUserSource = null;   // frame matching src/, app/, .tsx, etc.
    let bestUser = null;         // first non-vendor non-chunk frame (may be library)
    let firstNamed = null;       // first fiber with a component name
    let firstSourced = null;     // first fiber with any source at all
    // Also collect chunk candidates to resolve in priority order if needed
    const chunkCandidates = [];  // { name, frame } pairs whose source is a chunk

    while (fiber && depth < 30) {
      depth++;
      const name = extractComponentName(fiber.type) || extractComponentName(fiber.elementType);

      let userFrame = null, anyFrame = null;
      if (fiber._debugSource && fiber._debugSource.fileName) {
        const f = {
          file: fiber._debugSource.fileName,
          line: fiber._debugSource.lineNumber,
          column: null,
          isVendor: isVendorPath(fiber._debugSource.fileName),
        };
        anyFrame = f;
        if (!f.isVendor) userFrame = f;
      } else if (fiber._debugStack) {
        const allFrames = allStackFrames(fiber._debugStack);
        anyFrame = allFrames[0] || null;
        userFrame = firstUserFrame(fiber._debugStack);
      }

      if (!bestUserSource && userFrame && looksLikeUserSource(userFrame.file)) {
        bestUserSource = { name, frame: userFrame };
      }
      if (!bestUser && userFrame) bestUser = { name, frame: userFrame };
      if (!firstNamed && name) firstNamed = { name, frame: userFrame || anyFrame };
      if (!firstSourced && anyFrame) firstSourced = { name, frame: anyFrame };
      if (userFrame && isBundledChunk(userFrame.file)) {
        chunkCandidates.push({ name, frame: userFrame });
      }

      // Once we have a clearly user-source frame AND a name, we're done
      if (bestUserSource && firstNamed) break;
      fiber = fiber.return;
    }

    // If we already found a non-chunk user-source frame, use it directly
    if (bestUserSource) {
      return {
        componentName: bestUserSource.name || firstNamed?.name || null,
        sourceFile: bestUserSource.frame.file,
        sourceLine: bestUserSource.frame.line,
      };
    }

    // Otherwise, try resolving chunk candidates in order; prefer one that maps to user source
    let resolvedUser = null;
    let resolvedAny = null;
    for (const cand of chunkCandidates) {
      const r = await resolveNextJsFrame(cand.frame.file, cand.frame.line, cand.frame.column);
      if (!r) continue;
      if (!resolvedAny) resolvedAny = { name: cand.name, ...r };
      if (looksLikeUserSource(r.sourceFile)) {
        resolvedUser = { name: cand.name, ...r };
        break;
      }
    }
    const picked = resolvedUser || resolvedAny;
    if (picked) {
      return {
        componentName: firstNamed?.name || picked.name || null,
        sourceFile: picked.sourceFile,
        sourceLine: picked.sourceLine,
      };
    }

    // Fall back to whatever we have
    const fallback = bestUser?.frame || firstSourced?.frame || null;
    return {
      componentName: firstNamed?.name || bestUser?.name || null,
      sourceFile: fallback?.file ?? null,
      sourceLine: fallback?.line ?? null,
    };
  }

  window.addEventListener("message", async (e) => {
    if (e.source !== window) return;
    const data = e.data;
    if (!data || data.type !== "__WA_REACT_EXTRACT") return;
    const { requestId, marker } = data;
    const el = document.querySelector(`[data-wa-marker="${marker}"]`);
    const result = el ? await extractReactInfo(el) : { error: "marker not found" };
    window.postMessage({ type: "__WA_REACT_RESULT", requestId, result }, "*");
  });
})();
