"use strict";

const textTabButtons = document.querySelectorAll(".tool-tab");
const textPanel = document.getElementById("text-panel");
const imagePanel = document.getElementById("image-panel");
const claimInput = document.getElementById("claim-input");
const charCount = document.getElementById("char-count");
const textMessage = document.getElementById("text-message");
const textResults = document.getElementById("text-results");
const imageInput = document.getElementById("image-input");
const dropzone = document.getElementById("dropzone");
const imageMessage = document.getElementById("image-message");
const imageResults = document.getElementById("image-results");
const analyzeTextButton = document.getElementById("analyze-text");
let previewUrl = null;

for (const tab of textTabButtons) {
  tab.addEventListener("click", () => selectPanel(tab));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tab.id === "text-tab" ? document.getElementById("image-tab") : document.getElementById("text-tab");
    selectPanel(next);
    next.focus();
  });
}

function selectPanel(selectedTab) {
  for (const tab of textTabButtons) {
    const selected = tab === selectedTab;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  const showText = selectedTab.id === "text-tab";
  textPanel.hidden = !showText;
  imagePanel.hidden = showText;
}

claimInput.addEventListener("input", () => {
  charCount.textContent = `${claimInput.value.length.toLocaleString()} / 5,000`;
  textMessage.textContent = "";
});

document.getElementById("clear-text").addEventListener("click", () => {
  claimInput.value = "";
  charCount.textContent = "0 / 5,000";
  textMessage.textContent = "";
  textResults.hidden = true;
  claimInput.focus();
});

document.getElementById("analyze-text").addEventListener("click", analyzeText);

async function analyzeText() {
  const text = claimInput.value.trim();
  textMessage.textContent = "";
  if (text.length < 20) {
    textMessage.textContent = "Add at least 20 characters so there is enough context to review.";
    claimInput.focus();
    return;
  }

  const signals = [];
  const sensationalPattern = /\b(shocking|unbelievable|miracle|exposed|cover[- ]?up|secret|explosive|you won't believe|they don't want you to know|breaking)\b/gi;
  const absolutePattern = /\b(always|never|everyone|nobody|no one|guaranteed|undeniable|proves|100 percent|100%)\b/gi;
  const attributionPattern = /\b(according to|said|report(?:ed)? by|study|researchers?|officials?|spokesperson|data from|published in|statement from)\b/i;
  const urlPattern = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
  const sensationalMatches = uniqueMatches(text, sensationalPattern);
  const absoluteMatches = uniqueMatches(text, absolutePattern);
  const urls = text.match(urlPattern) || [];
  const hasAttribution = attributionPattern.test(text);
  const hasSpecificDetail = /\b(?:19|20)\d{2}\b|\b\d+(?:\.\d+)?%|\b\d{2,}\b/.test(text);
  const hasQuestionOrExclaim = /[!?]{2,}|!/.test(text);
  const uppercaseWords = text.match(/\b[A-Z]{3,}\b/g) || [];
  const regularWords = text.match(/\b[\p{L}\p{N}]+\b/gu) || [];
  const hasHeavyCaps = regularWords.length >= 8 && uppercaseWords.length / regularWords.length > 0.18;

  if (sensationalMatches.length) {
    signals.push({
      review: true,
      title: "Emotive or sensational wording",
      detail: `Found wording such as ${formatExamples(sensationalMatches)}. Emotional language can draw attention; check the underlying evidence.`
    });
  } else {
    signals.push({ review: false, title: "Sensational wording", detail: "No common sensational phrases stood out. This does not establish accuracy." });
  }

  if (absoluteMatches.length || hasQuestionOrExclaim || hasHeavyCaps) {
    const cues = [];
    if (absoluteMatches.length) cues.push(formatExamples(absoluteMatches));
    if (hasQuestionOrExclaim) cues.push("repeated punctuation or exclamation");
    if (hasHeavyCaps) cues.push("heavy use of all-caps words");
    signals.push({ review: true, title: "Strong or emphatic language", detail: `Noticed ${cues.join("; ")}. Look for qualified wording and supporting evidence.` });
  } else {
    signals.push({ review: false, title: "Strong or emphatic language", detail: "No prominent absolutes or emphatic formatting stood out." });
  }

  if (hasAttribution) {
    signals.push({ review: false, title: "Attribution cue", detail: "The text appears to mention a source or study. Follow the reference and check what it actually says." });
  } else {
    signals.push({ review: true, title: "No clear attribution detected", detail: "We could not spot a common source-attribution phrase. Find the original statement, report, or study." });
  }

  if (hasSpecificDetail) {
    signals.push({ review: false, title: "Checkable details", detail: "Dates or numbers appear in the text. Verify them against original records and independent reporting." });
  } else {
    signals.push({ review: true, title: "Few specific details detected", detail: "Look for a date, named source, location, or other detail that can be independently checked." });
  }

  if (urls.length) {
    signals.push({ review: false, title: "Links included", detail: `Found ${urls.length} link${urls.length === 1 ? "" : "s"}. A link alone is not evidence; check its publisher, date, and cited source.` });
  }

  const reviewCount = signals.filter((signal) => signal.review).length;
  const summary = reviewCount
    ? `${reviewCount} signal${reviewCount === 1 ? "" : "s"} to follow up`
    : "A few language signals found";
  const query = createSearchQuery(text);
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  const newsUrl = `https://news.google.com/search?q=${encodeURIComponent(query)}`;

  analyzeTextButton.disabled = true;
  analyzeTextButton.textContent = "Searching fact-checks…";
  let factCheck;
  try {
    const response = await fetch("/api/fact-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: text })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Fact-check request failed (${response.status}).`);
    factCheck = { claims: data.claims || [] };
  } catch (error) {
    factCheck = { error: error.message || "Could not reach the local fact-check service." };
  } finally {
    analyzeTextButton.disabled = false;
    analyzeTextButton.innerHTML = 'Find fact-checks <span aria-hidden="true">-&gt;</span>';
  }

  textResults.replaceChildren();
  textResults.append(
    createSummary(summary, "Language cues are not a truth verdict. Published fact-checks below are matched by text and may refer to a different or outdated claim."),
    createSignalList(signals),
    createFactCheckResults(factCheck),
    createSearchLinks([
      { href: searchUrl, label: "Search the web for this claim" },
      { href: newsUrl, label: "Compare news coverage" }
    ])
  );
  textResults.hidden = false;
}

function createFactCheckResults(result) {
  const section = document.createElement("section");
  section.className = "fact-check-results";
  const heading = document.createElement("h3");
  heading.className = "image-detail-heading";
  heading.textContent = "Published fact-check reviews";
  section.append(heading);

  if (result.error) {
    const message = document.createElement("p");
    message.className = "fact-check-empty";
    message.textContent = result.error;
    section.append(message);
    return section;
  }

  if (!result.claims.length) {
    const message = document.createElement("p");
    message.className = "fact-check-empty";
    message.textContent = "No matching published reviews were found. That does not mean the claim is true—check primary sources and other coverage.";
    section.append(message);
    return section;
  }

  for (const claim of result.claims) {
    const card = document.createElement("article");
    card.className = "fact-check-card";
    const claimText = document.createElement("p");
    claimText.className = "matched-claim";
    claimText.textContent = claim.text || "Related claim";
    card.append(claimText);
    for (const review of claim.reviews || []) {
      const publisher = document.createElement("p");
      publisher.className = "fact-check-publisher";
      publisher.textContent = [review.publisher, review.date].filter(Boolean).join(" · ");
      card.append(publisher);
      if (review.rating) {
        const rating = document.createElement("p");
        rating.className = "fact-check-rating";
        rating.textContent = `Publisher's rating: ${review.rating}`;
        card.append(rating);
      }
      if (review.title && review.url && /^https?:\/\//i.test(review.url)) {
        const link = document.createElement("a");
        link.href = review.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = review.title;
        card.append(link);
      }
    }
    section.append(card);
  }
  return section;
}

function uniqueMatches(text, pattern) {
  return [...new Set(text.match(pattern) || [])].slice(0, 4).map((match) => match.toLowerCase());
}

function formatExamples(matches) {
  return matches.map((match) => `“${match}”`).join(", ");
}

function createSearchQuery(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > 150 ? `${cleaned.slice(0, 147)}...` : cleaned;
}

function createSummary(title, detail) {
  const wrapper = document.createElement("div");
  wrapper.className = "result-summary";
  const icon = document.createElement("span");
  icon.className = "summary-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "i";
  const content = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = detail;
  content.append(heading, paragraph);
  wrapper.append(icon, content);
  return wrapper;
}

function createSignalList(signals) {
  const list = document.createElement("ul");
  list.className = "signal-list";
  for (const signal of signals) {
    const item = document.createElement("li");
    item.className = `signal-item${signal.review ? " needs-review" : ""}`;
    const marker = document.createElement("span");
    marker.className = "signal-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = signal.review ? "!" : "✓";
    const content = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = signal.title;
    const detail = document.createElement("p");
    detail.textContent = signal.detail;
    content.append(heading, detail);
    item.append(marker, content);
    list.append(item);
  }
  return list;
}

function createSearchLinks(links) {
  const wrapper = document.createElement("div");
  wrapper.className = "search-links";
  for (const linkInfo of links) {
    const link = document.createElement("a");
    link.href = linkInfo.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = linkInfo.label;
    wrapper.append(link);
  }
  return wrapper;
}

document.getElementById("image-tab").addEventListener("click", () => imageInput.focus());
document.getElementById("text-tab").addEventListener("click", () => claimInput.focus());
imageInput.addEventListener("change", () => {
  const file = imageInput.files && imageInput.files[0];
  if (file) inspectImage(file);
});

dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    imageInput.click();
  }
});

for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
  });
}
dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer && event.dataTransfer.files[0];
  if (file) inspectImage(file);
});

async function inspectImage(file) {
  imageMessage.textContent = "";
  imageResults.hidden = true;
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  const supportedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!supportedTypes.includes(file.type)) {
    imageMessage.textContent = "Choose a JPG, PNG, WEBP, or GIF image.";
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    imageMessage.textContent = "This image is larger than 15 MB. Choose a smaller file.";
    return;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const metadata = file.type === "image/jpeg"
      ? readJpegMetadata(new Uint8Array(await file.arrayBuffer()))
      : { fields: [], supported: false };
    const properties = [
      ["File type", file.type.replace("image/", "").toUpperCase()],
      ["File size", formatBytes(file.size)],
      ["Dimensions", `${bitmap.width.toLocaleString()} × ${bitmap.height.toLocaleString()} px`],
      ["Last modified", Number.isFinite(file.lastModified) && file.lastModified > 0 ? new Date(file.lastModified).toLocaleDateString() : "Not provided"]
    ];
    if (metadata.fields.length) {
      for (const field of metadata.fields) properties.push([field.label, field.value]);
    } else {
      properties.push(["EXIF metadata", metadata.supported ? "No readable EXIF fields found" : "Not inspected for this format"]);
    }

    const imageUrl = URL.createObjectURL(file);
    previewUrl = imageUrl;
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "Preview of the selected image";
    image.onload = () => {
      URL.revokeObjectURL(imageUrl);
      if (previewUrl === imageUrl) previewUrl = null;
    };

    const frame = document.createElement("div");
    frame.className = "preview-frame";
    frame.append(image);
    const details = document.createElement("div");
    const heading = document.createElement("h3");
    heading.className = "image-detail-heading";
    heading.textContent = "File details";
    const list = document.createElement("dl");
    list.className = "detail-list";
    for (const [label, value] of properties) {
      const row = document.createElement("div");
      row.className = "detail-row";
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value;
      row.append(term, description);
      list.append(row);
    }
    details.append(heading, list);

    const modelResult = document.createElement("div");
    modelResult.className = "model-result";
    modelResult.setAttribute("role", "status");
    modelResult.textContent = "Loading the local AI-image model. The first run downloads about 343 MB; this image is not sent to an external service.";
    const caveat = document.createElement("p");
    caveat.className = "image-caveat";
    caveat.textContent = "This model was trained to distinguish selected DALL·E and Stable Diffusion images from real images. Scores are not calibrated probabilities; other generators, edits, screenshots, and compression can fool it. It cannot prove authenticity or detect every manipulation.";
    const links = createSearchLinks([
      { href: "https://lens.google.com/", label: "Open Google Lens (upload is external)" },
      { href: "https://www.bing.com/visualsearch", label: "Open Bing Visual Search (upload is external)" }
    ]);
    links.classList.add("reverse-links");

    imageResults.replaceChildren(frame, details, modelResult, caveat, links);
    imageResults.hidden = false;
    bitmap.close();
    await analyzeImageModel(file, modelResult);
  } catch (error) {
    imageMessage.textContent = `Could not inspect this image: ${error.message || "the file could not be decoded."}`;
  }
}

async function analyzeImageModel(file, resultElement) {
  try {
    const response = await fetch("/api/image-check", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Image model request failed (${response.status}).`);
    resultElement.replaceChildren();

    const title = document.createElement("strong");
    title.textContent = data.assessment;
    const score = document.createElement("p");
    score.textContent = `AI-generation signal: ${data.aiScore}% · Real-image signal: ${data.realScore}%`;
    const explanation = document.createElement("p");
    explanation.textContent = `Model scores (not calibrated probabilities): ${(data.scores || []).map((item) => `${item.label} ${item.score}%`).join(" · ")}.`;
    resultElement.append(title, score, explanation);
  } catch (error) {
    resultElement.textContent = error.message || "The local image model could not analyze this image.";
  }
}

fetch("/api/health").then(async (response) => {
  if (!response.ok) throw new Error("Local server unavailable");
  const status = await response.json();
  const serviceStatus = document.getElementById("service-status");
  const missingSetup = [];
  if (!status.imageDependenciesReady) missingSetup.push("install image dependencies");
  if (!status.factCheckConfigured) missingSetup.push("fact-check API key needed");
  serviceStatus.textContent = missingSetup.length
    ? `Local server ready · ${missingSetup.join(" · ")}`
    : "Local server ready";
}).catch(() => {
  document.getElementById("service-status").textContent = "Start the local server with start.bat";
});

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readJpegMetadata(bytes) {
  const fields = [];
  let offset = 2;
  while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const segmentStart = offset + 4;
    const segmentEnd = offset + 2 + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.length) break;
    if (marker === 0xe1 && bytes[segmentStart] === 0x45 && bytes[segmentStart + 1] === 0x78 &&
        bytes[segmentStart + 2] === 0x69 && bytes[segmentStart + 3] === 0x66 &&
        bytes[segmentStart + 4] === 0 && bytes[segmentStart + 5] === 0) {
      fields.push(...parseExifTiff(bytes, segmentStart + 6, segmentEnd));
      break;
    }
    offset = segmentEnd;
  }
  return { fields, supported: true };
}

function parseExifTiff(bytes, tiffStart, segmentEnd) {
  const fields = [];
  if (tiffStart + 8 > segmentEnd) return fields;
  const littleEndian = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
  const bigEndian = bytes[tiffStart] === 0x4d && bytes[tiffStart + 1] === 0x4d;
  if (!littleEndian && !bigEndian) return fields;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read16 = (position) => view.getUint16(position, littleEndian);
  const read32 = (position) => view.getUint32(position, littleEndian);
  if (read16(tiffStart + 2) !== 42) return fields;

  const firstIfdPosition = tiffStart + read32(tiffStart + 4);
  if (firstIfdPosition + 2 > segmentEnd) return fields;
  const tags = new Map([
    [0x010f, "Camera make"],
    [0x0110, "Camera model"],
    [0x0131, "Software"],
    [0x9003, "Date taken"],
    [0x0132, "Date modified"]
  ]);
  const pendingIfds = [firstIfdPosition];
  const visitedIfds = new Set();
  while (pendingIfds.length) {
    const ifdPosition = pendingIfds.pop();
    if (visitedIfds.has(ifdPosition) || ifdPosition + 2 > segmentEnd) continue;
    visitedIfds.add(ifdPosition);
    const count = Math.min(read16(ifdPosition), 256);
    for (let index = 0; index < count; index += 1) {
      const entry = ifdPosition + 2 + index * 12;
      if (entry + 12 > segmentEnd) break;
      const tag = read16(entry);
      const type = read16(entry + 2);
      const valueCount = read32(entry + 4);
      if (tag === 0x8769 && type === 4 && valueCount === 1) {
        const exifIfd = tiffStart + read32(entry + 8);
        if (exifIfd + 2 <= segmentEnd) pendingIfds.push(exifIfd);
        continue;
      }
      if (!tags.has(tag) || type !== 2 || valueCount < 1 || valueCount > 256) continue;
      const valueStart = valueCount <= 4 ? entry + 8 : tiffStart + read32(entry + 8);
      if (valueStart < tiffStart || valueStart + valueCount > segmentEnd) continue;
      let value = "";
      for (let byteIndex = 0; byteIndex < valueCount; byteIndex += 1) {
        const character = bytes[valueStart + byteIndex];
        if (character === 0) break;
        if (character >= 32 && character <= 126) value += String.fromCharCode(character);
      }
      if (value.trim()) fields.push({ label: tags.get(tag), value: value.trim() });
    }
  }
  return fields;
}
