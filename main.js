const canvas = document.getElementById("viewport");
const ctx = canvas.getContext("2d");

const statusBar = document.getElementById("statusBar");
const artInput = document.getElementById("artInput");
const scaleSlider = document.getElementById("scaleSlider");
const speedSlider = document.getElementById("speedSlider");
const scaleValue = document.getElementById("scaleValue");
const speedValue = document.getElementById("speedValue");
const animateBtn = document.getElementById("animateBtn");
const exportGifBtn = document.getElementById("exportGifBtn");
const resetCurveBtn = document.getElementById("resetCurveBtn");
const loopToggle = document.getElementById("loopToggle");

canvas.style.touchAction = "none";

const GIF_WORKER_SRC =
  "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js";
const DEFAULT_ART_URL = "./mola.png";

const state = {
  controlPoints: [],
  draggingPointIndex: null,
  currentProgress: 0,
  arcTable: [],
  totalArcLength: 0,
  isAnimating: false,
  animationStart: 0,
  animationDuration: 6000,
  rafId: null,
  baseDuration: 6000,
  playbackSpeed: 1,
  artScale: 1,
  artAsset: {
    ready: false,
    width: 120,
    height: 120,
    name: "placeholder",
    type: "placeholder",
    image: null,
  },
  userProvidedAsset: false,
  gifWorkerUrl: null,
  gifWorkerPromise: null,
  loopAnimation: true,
};

const DEFAULT_POINTS = [
  { x: 80, y: canvas.height - 80 },
  { x: canvas.width * 0.35, y: 80 },
  { x: canvas.width * 0.65, y: canvas.height - 140 },
  { x: canvas.width - 80, y: 100 },
];

init();

function init() {
  state.controlPoints = DEFAULT_POINTS.map((pt) => ({ ...pt }));
  buildArcTable();
  attachEventListeners();
  handleScaleChange({ target: scaleSlider });
  handleSpeedChange({ target: speedSlider });
  loopToggle.checked = state.loopAnimation;
  renderScene();
  setStatus("Drop in an SVG or PNG, or start shaping the default path.");
  preloadDefaultArtwork();
}

function attachEventListeners() {
  artInput.addEventListener("change", handleAssetUpload);
  scaleSlider.addEventListener("input", handleScaleChange);
  speedSlider.addEventListener("input", handleSpeedChange);
  loopToggle.addEventListener("change", handleLoopToggle);
  animateBtn.addEventListener("click", toggleAnimation);
  exportGifBtn.addEventListener("click", exportGif);
  resetCurveBtn.addEventListener("click", resetCurve);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerUp);
}

async function handleAssetUpload(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const isSvg = isSvgFile(file);
  const isPng = isPngFile(file);

  if (!isSvg && !isPng) {
    setStatus("Please choose an SVG or PNG file.", "error");
    return;
  }

  state.userProvidedAsset = true;

  try {
    if (isSvg) {
      const text = await file.text();
      const sanitizedSvg = sanitizeSvgBackground(text);
      const dimensions = extractSvgSize(sanitizedSvg);
      const svgBlob = new Blob([sanitizedSvg], { type: "image/svg+xml" });
      const image = await loadImageFromBlob(svgBlob);
      setArtAsset({
        image,
        width: dimensions.width || image.naturalWidth || 140,
        height: dimensions.height || image.naturalHeight || 140,
        name: file.name,
        type: "svg",
      });
    } else {
      const image = await loadImageFromBlob(file);
      setArtAsset({
        image,
        width: image.naturalWidth || 512,
        height: image.naturalHeight || 512,
        name: file.name,
        type: "png",
      });
    }

    state.currentProgress = 0;
    renderScene();
    setStatus(`Loaded ${file.name}`, "success");
  } catch (error) {
    console.error(error);
    setStatus("Could not load that file. Try another?", "error");
  } finally {
    event.target.value = "";
  }
}

function extractSvgSize(svgText) {
  let width = 140;
  let height = 140;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const svgEl = doc.documentElement;
    const viewBox = svgEl.getAttribute("viewBox");
    const widthAttr = parseSvgUnit(svgEl.getAttribute("width"));
    const heightAttr = parseSvgUnit(svgEl.getAttribute("height"));
    if (widthAttr && heightAttr) {
      width = widthAttr;
      height = heightAttr;
    } else if (viewBox) {
      const parts = viewBox.split(/[\s,]+/).map(Number);
      if (parts.length === 4) {
        width = Math.abs(parts[2]);
        height = Math.abs(parts[3]);
      }
    } else if (widthAttr && !heightAttr) {
      width = widthAttr;
      height = widthAttr;
    }
  } catch {
    // ignore, fall back to default dimensions
  }
  return { width, height };
}

function parseSvgUnit(value) {
  if (!value) return null;
  const parsed = parseFloat(value.replace(/[a-zA-Z%]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isSvgFile(file) {
  if (!file) return false;
  const name = (file.name || "").toLowerCase();
  return /svg/i.test(file.type) || name.endsWith(".svg");
}

function isPngFile(file) {
  if (!file) return false;
  const name = (file.name || "").toLowerCase();
  return /png/i.test(file.type) || name.endsWith(".png");
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function setArtAsset({ image, width, height, name, type }) {
  state.artAsset.image = image;
  state.artAsset.width = width;
  state.artAsset.height = height;
  state.artAsset.name = name;
  state.artAsset.type = type;
  state.artAsset.ready = true;
}

async function preloadDefaultArtwork() {
  try {
    const image = await loadImageFromUrl(DEFAULT_ART_URL);
    if (state.userProvidedAsset) {
      return;
    }
    if (!image?.naturalWidth || !image?.naturalHeight) {
      throw new Error("Default image missing dimensions");
    }
    setArtAsset({
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      name: "mola.png",
      type: "png",
    });
    scaleSlider.value = "1";
    state.artScale = 1;
    scaleValue.textContent = "1.00×";
    renderScene();
    setStatus("Default artwork loaded. Drop in a new SVG or PNG anytime.");
  } catch (error) {
    console.warn("Could not load default artwork", error);
  }
}

function ensureGifWorkerUrl() {
  if (state.gifWorkerUrl) {
    return Promise.resolve(state.gifWorkerUrl);
  }
  if (!state.gifWorkerPromise) {
    state.gifWorkerPromise = fetch(GIF_WORKER_SRC)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch gif worker (${response.status})`);
        }
        return response.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        state.gifWorkerUrl = url;
        return url;
      })
      .catch((error) => {
        console.error("Could not prepare GIF worker", error);
        throw error;
      })
      .finally(() => {
        state.gifWorkerPromise = null;
      });
  }
  return state.gifWorkerPromise;
}

function sanitizeSvgBackground(svgText) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const svgEl = doc.documentElement;
    if (!svgEl) {
      return svgText;
    }
    const viewport = getSvgViewportSize(svgEl);
    const rects = Array.from(doc.querySelectorAll("rect"));

    rects.forEach((rect) => {
      const fill = resolveFillValue(rect);
      if (!isWhiteFill(fill)) {
        return;
      }
      if (!coversViewport(rect, viewport)) {
        return;
      }
      rect.remove();
    });

    enforceTransparentBackground(svgEl);

    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  } catch (error) {
    console.warn("Could not sanitize SVG background", error);
    return svgText;
  }
}

function getSvgViewportSize(svgEl) {
  const widthAttr = parseSvgUnit(svgEl.getAttribute("width"));
  const heightAttr = parseSvgUnit(svgEl.getAttribute("height"));
  if (widthAttr && heightAttr) {
    return { width: widthAttr, height: heightAttr };
  }
  const viewBox = svgEl.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
      return { width: Math.abs(parts[2]), height: Math.abs(parts[3]) };
    }
  }
  return null;
}

function resolveFillValue(element) {
  const fillAttr = (element.getAttribute("fill") || "").trim();
  if (fillAttr && fillAttr.toLowerCase() !== "none") {
    return fillAttr;
  }
  const styleAttr = element.getAttribute("style") || "";
  const match = styleAttr.match(/fill\s*:\s*([^;]+)/i);
  if (match) {
    const value = match[1].trim();
    if (value && value.toLowerCase() !== "none") {
      return value;
    }
  }
  return null;
}

function isWhiteFill(value) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (["white", "#fff", "#ffffff"].includes(normalized)) {
    return true;
  }
  if (normalized.startsWith("#") && (normalized.length === 4 || normalized.length === 7)) {
    const hex = normalized.length === 4
      ? normalized
          .slice(1)
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : normalized.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return r >= 245 && g >= 245 && b >= 245;
  }
  if (normalized.startsWith("rgb")) {
    const numbers = normalized.match(/[\d.]+/g);
    if (numbers && numbers.length >= 3) {
      const [r, g, b] = numbers.map((n) => Number(n));
      return r >= 245 && g >= 245 && b >= 245;
    }
  }
  return false;
}

function coversViewport(rect, viewport) {
  const widthAttr = rect.getAttribute("width");
  const heightAttr = rect.getAttribute("height");
  if (!widthAttr || !heightAttr) {
    return false;
  }

  const x = parseSvgUnit(rect.getAttribute("x")) ?? 0;
  const y = parseSvgUnit(rect.getAttribute("y")) ?? 0;
  const nearOrigin = Math.abs(x) <= 1 && Math.abs(y) <= 1;

  if (/%$/.test(widthAttr) || /%$/.test(heightAttr)) {
    const widthPct = parseFloat(widthAttr);
    const heightPct = parseFloat(heightAttr);
    if (!Number.isFinite(widthPct) || !Number.isFinite(heightPct)) {
      return false;
    }
    return widthPct >= 99 && heightPct >= 99 && nearOrigin;
  }

  if (!viewport) {
    return false;
  }

  const width = parseSvgUnit(widthAttr);
  const height = parseSvgUnit(heightAttr);
  if (!width || !height) {
    return false;
  }
  const tolerance = Math.max(2, Math.min(viewport.width, viewport.height) * 0.02);

  return (
    Math.abs(width - viewport.width) <= tolerance &&
    Math.abs(height - viewport.height) <= tolerance &&
    nearOrigin
  );
}

function enforceTransparentBackground(svgEl) {
  const existingStyle = svgEl.getAttribute("style") || "";
  if (/background/i.test(existingStyle)) {
    const updated = existingStyle.replace(/background\s*:[^;]+/gi, "").trim();
    svgEl.setAttribute(
      "style",
      `${updated ? `${updated};` : ""}background:none`
    );
  } else {
    svgEl.setAttribute(
      "style",
      `${existingStyle ? `${existingStyle};` : ""}background:none`
    );
  }
}

function handleScaleChange(event) {
  const value = Number(event.target.value);
  state.artScale = value;
  scaleValue.textContent = `${value.toFixed(2)}×`;
  renderScene();
}

function handleSpeedChange(event) {
  const value = Number(event.target.value);
  state.playbackSpeed = value;
  speedValue.textContent = `${value.toFixed(2)}×`;
  if (state.isAnimating) {
    // restart animation with new speed
    stopAnimation();
    startAnimation();
  } else {
    renderScene();
  }
}

function handleLoopToggle(event) {
  state.loopAnimation = Boolean(event.target.checked);
}

function toggleAnimation() {
  if (state.isAnimating) {
    stopAnimation();
  } else {
    startAnimation();
  }
}

function startAnimation() {
  state.isAnimating = true;
  state.animationStart = performance.now();
  state.animationDuration = state.baseDuration / state.playbackSpeed;
  state.currentProgress = 0;
  animateBtn.textContent = "Stop";
  statusBar.dataset.variant = "";
  state.rafId = requestAnimationFrame(stepAnimation);
}

function stopAnimation() {
  state.isAnimating = false;
  state.currentProgress = 0;
  state.animationStart = 0;
  animateBtn.textContent = "Animate";
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  renderScene();
}

function stepAnimation(timestamp) {
  if (!state.isAnimating) return;
  if (!state.animationStart) {
    state.animationStart = timestamp;
  }
  const elapsed = timestamp - state.animationStart;
  const duration = state.animationDuration || 1;
  let progress = Math.min(1, elapsed / duration);
  state.currentProgress = progress;
  renderScene();

  if (progress >= 1) {
    if (state.loopAnimation) {
      state.animationStart = timestamp;
      state.currentProgress = 0;
      state.rafId = requestAnimationFrame(stepAnimation);
      return;
    }
    state.isAnimating = false;
    animateBtn.textContent = "Animate";
    state.rafId = null;
    return;
  }

  state.rafId = requestAnimationFrame(stepAnimation);
}

function resetCurve() {
  state.controlPoints = DEFAULT_POINTS.map((pt) => ({ ...pt }));
  state.currentProgress = 0;
  buildArcTable();
  stopAnimation();
  renderScene();
  setStatus("Curve reset to default.", "success");
}

function onPointerDown(event) {
  const pos = getCanvasCoordinates(event);
  const hitIndex = findHandleIndex(pos);
  if (hitIndex === null) {
    return;
  }
  state.draggingPointIndex = hitIndex;
  canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function onPointerMove(event) {
  if (state.draggingPointIndex === null) return;
  const pos = clampToCanvas(getCanvasCoordinates(event));
  state.controlPoints[state.draggingPointIndex] = pos;
  buildArcTable();
  renderScene();
}

function onPointerUp(event) {
  if (state.draggingPointIndex === null) return;
  state.draggingPointIndex = null;
  canvas.releasePointerCapture?.(event.pointerId);
}

function findHandleIndex(position) {
  const radius = 18;
  for (let i = 0; i < state.controlPoints.length; i += 1) {
    const point = state.controlPoints[i];
    if (distance(point, position) <= radius) {
      return i;
    }
  }
  return null;
}

function getCanvasCoordinates(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function clampToCanvas(point) {
  return {
    x: Math.min(canvas.width - 20, Math.max(20, point.x)),
    y: Math.min(canvas.height - 20, Math.max(20, point.y)),
  };
}

function buildArcTable() {
  const steps = 300;
  const table = [];
  let lastPoint = cubicBezierPoint(0);
  let length = 0;
  table.push({ t: 0, length, x: lastPoint.x, y: lastPoint.y });

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const point = cubicBezierPoint(t);
    length += distance(point, lastPoint);
    table.push({ t, length, x: point.x, y: point.y });
    lastPoint = point;
  }

  state.arcTable = table;
  state.totalArcLength = length;
}

function cubicBezierPoint(t) {
  const [p0, p1, p2, p3] = state.controlPoints;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  const x =
    mt2 * mt * p0.x +
    3 * mt2 * t * p1.x +
    3 * mt * t2 * p2.x +
    t2 * t * p3.x;
  const y =
    mt2 * mt * p0.y +
    3 * mt2 * t * p1.y +
    3 * mt * t2 * p2.y +
    t2 * t * p3.y;
  return { x, y };
}

function getPointAtProgress(progress) {
  if (!state.arcTable.length) {
    buildArcTable();
  }
  const targetLength = progress * state.totalArcLength;
  const table = state.arcTable;
  if (!Number.isFinite(targetLength) || table.length === 0) {
    return { point: { ...state.controlPoints[0] }, t: 0 };
  }

  let low = 0;
  let high = table.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (table[mid].length < targetLength) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const idx = Math.min(Math.max(low, 1), table.length - 1);
  const prev = table[idx - 1];
  const next = table[idx];
  const span = Math.max(0.00001, next.length - prev.length);
  const mix = (targetLength - prev.length) / span;

  const point = {
    x: prev.x + (next.x - prev.x) * mix,
    y: prev.y + (next.y - prev.y) * mix,
  };
  const t = prev.t + (next.t - prev.t) * mix;
  return { point, t };
}

function renderScene(targetCtx = ctx, options = {}) {
  const {
    progress = state.currentProgress,
    showHandles = true,
    showCurve = true,
    showBackdrop = true,
  } = options;
  const { point, t } = getPointAtProgress(progress);
  const context = targetCtx;
  const { width, height } = context.canvas;

  context.save();
  context.clearRect(0, 0, width, height);
  if (showBackdrop) {
    drawBackdrop(context, width, height);
  }
  if (showCurve) {
    drawCurve(context);
  }
  if (showHandles) {
    drawHandles(context);
  }
  drawPayload(context, point, t, showHandles);
  context.restore();
}

function drawBackdrop(context, width, height) {
  context.strokeStyle = "rgba(255, 255, 255, 0.09)";
  context.lineWidth = 1;
  context.setLineDash([2, 38]);
  const grid = 40;
  context.beginPath();
  for (let x = 0; x <= width; x += grid) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += grid) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
  context.setLineDash([]);
}

function drawCurve(context) {
  const [p0, p1, p2, p3] = state.controlPoints;
  context.lineWidth = 4;
  context.strokeStyle = "rgba(99, 179, 255, 0.9)";
  context.beginPath();
  context.moveTo(p0.x, p0.y);
  context.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  context.stroke();

  context.save();
  context.setLineDash([8, 10]);
  context.lineWidth = 1.5;
  context.strokeStyle = "rgba(255, 255, 255, 0.2)";
  context.beginPath();
  context.moveTo(p0.x, p0.y);
  context.lineTo(p1.x, p1.y);
  context.lineTo(p2.x, p2.y);
  context.lineTo(p3.x, p3.y);
  context.stroke();
  context.restore();
}

function drawHandles(context) {
  state.controlPoints.forEach((point, index) => {
    context.fillStyle =
      index === 0 || index === state.controlPoints.length - 1
        ? "#2f85ff"
        : "#ffb347";
    context.strokeStyle = "rgba(0, 0, 0, 0.4)";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(point.x, point.y, 10, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });
}

function drawPayload(context, point, t, showIndicator) {
  const angle = getDirectionAngle(t);
  context.save();
  context.translate(point.x, point.y);
  context.rotate(angle);

  if (state.artAsset.ready) {
    const largestDimension = Math.max(
      1,
      state.artAsset.width,
      state.artAsset.height
    );
    const fit = 200 / largestDimension;
    const width = state.artAsset.width * fit * state.artScale;
    const height = state.artAsset.height * fit * state.artScale;
    context.drawImage(
      state.artAsset.image,
      -width / 2,
      -height / 2,
      width,
      height
    );
  } else {
    const size = 60 * state.artScale;
    context.fillStyle = "#ffffff";
    drawRoundedRect(context, -size / 2, -size / 3, size, (2 * size) / 3, size / 3);
    context.fillStyle = "#2f85ff";
    context.beginPath();
    context.arc(size / 2, 0, size / 3, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  if (showIndicator) {
    context.fillStyle = "#fff";
    context.beginPath();
    context.arc(point.x, point.y, 4, 0, Math.PI * 2);
    context.fill();
  }
}

function getDirectionAngle(t) {
  const tangent = cubicBezierTangent(t);
  if (!tangent || (tangent.x === 0 && tangent.y === 0)) {
    const lookAhead = Math.min(0.9999, t + 0.001);
    const current = cubicBezierPoint(t);
    const ahead = cubicBezierPoint(lookAhead);
    return Math.atan2(ahead.y - current.y, ahead.x - current.x);
  }
  return Math.atan2(tangent.y, tangent.x);
}

function cubicBezierTangent(t) {
  const [p0, p1, p2, p3] = state.controlPoints;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  const dx =
    3 * mt2 * (p1.x - p0.x) +
    6 * mt * t * (p2.x - p1.x) +
    3 * t2 * (p3.x - p2.x);
  const dy =
    3 * mt2 * (p1.y - p0.y) +
    6 * mt * t * (p2.y - p1.y) +
    3 * t2 * (p3.y - p2.y);
  return { x: dx, y: dy };
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
  context.fill();
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function setStatus(message, variant = "info") {
  statusBar.textContent = message;
  if (variant) {
    statusBar.dataset.variant = variant;
  } else {
    delete statusBar.dataset.variant;
  }
}

async function exportGif() {
  if (typeof GIF === "undefined") {
    setStatus("GIF exporter script is still loading. Try again.", "error");
    return;
  }
  if (exportGifBtn.disabled) {
    return;
  }
  exportGifBtn.disabled = true;
  setStatus("Rendering GIF… this may take a few seconds.");

  let workerScriptUrl;
  try {
    workerScriptUrl = await ensureGifWorkerUrl();
  } catch (error) {
    setStatus("Could not load GIF worker script.", "error");
    exportGifBtn.disabled = false;
    return;
  }

  const offscreen = document.createElement("canvas");
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  const offCtx = offscreen.getContext("2d");
  const duration = state.baseDuration / state.playbackSpeed;
  const durationSeconds = duration / 1000;
  const targetFps = 30;
  const frameCount = Math.max(targetFps, Math.round(durationSeconds * targetFps));
  const delay = Math.max(10, Math.round(duration / frameCount));

  const gif = new GIF({
    workerScript: workerScriptUrl,
    workers: 2,
    quality: 8,
    width: offscreen.width,
    height: offscreen.height,
  });

  for (let i = 0; i < frameCount; i += 1) {
    const progress = frameCount === 1 ? 1 : i / (frameCount - 1);
    renderScene(offCtx, {
      progress,
      showHandles: false,
      showCurve: false,
      showBackdrop: false,
    });
    gif.addFrame(offCtx, { copy: true, delay });
  }

  gif.on("progress", (value) => {
    setStatus(`Rendering GIF ${Math.round(value * 100)}%`);
  });

  gif.on("finished", (blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "path-animation.gif";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    exportGifBtn.disabled = false;
    setStatus("GIF exported successfully!", "success");
  });

  gif.on("abort", () => {
    exportGifBtn.disabled = false;
    setStatus("GIF export aborted.", "error");
  });

  gif.render();
}

