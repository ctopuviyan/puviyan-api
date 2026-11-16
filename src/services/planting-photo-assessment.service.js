const { fail } = require("./partner-project-policy");
const sharp = require("sharp");

function createPlantingPhotoAssessor({
  db,
  fetchImpl = global.fetch,
  env = process.env,
  now = () => new Date(),
}) {
  const safeProviderMessage = (value) =>
    String(value || "")
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
      .replace(/([?&]key=)[^&\s]+/gi, "$1[redacted]")
      .slice(0, 300);
  const geminiKey =
    typeof env.GEMINI_API_KEY === "string" ? env.GEMINI_API_KEY.trim() : "";
  const geminiEnabled = env.PLANTING_AI_ENABLED === "true" && !!geminiKey;
  const model = env.PLANTING_AI_MODEL || "gemini-3.5-flash-lite";
  // Kept disabled during the Gemini-only rollout; no Pl@ntNet network calls run.
  const plantNetKey = null;
  const plantNetEnabled = false;
  const plantNetProject = "all";
  const dailyLimit = Number(env.PLANTING_AI_DAILY_LIMIT || 500);

  async function identifySpecies(photos, baseline) {
    const stage = baseline.stage;
    if (
      !plantNetEnabled ||
      baseline.kind === "seed_spot" ||
      ["sown", "not_germinated", "dead", "missing"].includes(stage)
    )
      return null;
    const form = new FormData();
    const identificationPhotos = photos.filter((p) => !p.reference).slice(0, 1);
    if (baseline.selectedTargetPoint && identificationPhotos.length) {
      const photo = identificationPhotos[0];
      try {
        const orientedBuffer = await sharp(photo.buffer).rotate().toBuffer();
        const metadata = await sharp(orientedBuffer).metadata();
        const width = metadata.width || 0;
        const height = metadata.height || 0;
        const focus = baseline.selectedTargetPoint;
        if (width >= 256 && height >= 256) {
          const cropWidth = Math.min(width, Math.max(256, Math.round(width * 0.68)));
          const cropHeight = Math.min(height, Math.max(256, Math.round(height * 0.68)));
          const left = Math.max(
            0,
            Math.min(width - cropWidth, Math.round(focus.x * width - cropWidth / 2)),
          );
          const top = Math.max(
            0,
            Math.min(height - cropHeight, Math.round(focus.y * height - cropHeight / 2)),
          );
          identificationPhotos[0] = {
            ...photo,
            buffer: await sharp(orientedBuffer)
              .extract({ left, top, width: cropWidth, height: cropHeight })
              .jpeg({ quality: 90 })
              .toBuffer(),
            contentType: "image/jpeg",
          };
        }
      } catch (_) {
        // Keep the original evidence if the optional target crop cannot be made.
      }
    }
    for (const [i, photo] of identificationPhotos.entries()) {
      form.append(
        "images",
        new Blob([photo.buffer], { type: photo.contentType }),
        baseline.selectedTargetPoint ? "selected-plant.jpg" : `plant-${i + 1}.jpg`,
      );
      form.append("organs", "auto");
    }
    if (!form.has("images")) return null;
    const url = new URL(
      `https://my-api.plantnet.org/v2/identify/${encodeURIComponent(plantNetProject)}`,
    );
    url.searchParams.set("api-key", plantNetKey);
    url.searchParams.set("nb-results", "3");
    url.searchParams.set("detailed", "true");
    url.searchParams.set("lang", env.PLANTNET_LANGUAGE || "en");
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 404)
        return { noSpeciesMatch: true, candidates: [], familySuggestions: [] };
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return {
          unavailable: true,
          httpStatus: response.status,
          providerMessage: safeProviderMessage(error?.error?.message),
        };
      }
      const payload = await response.json();
      const candidates = (payload.results || [])
        .slice(0, 1)
        .map((item) => {
          const commonName = Array.isArray(item.species?.commonNames)
            ? item.species.commonNames.find(
                (name) => typeof name === "string" && name.trim(),
              )
            : null;
          const name =
            commonName ||
            item.species?.scientificNameWithoutAuthor ||
            item.species?.scientificName;
          return typeof name === "string"
            ? `${name} (${Math.round((item.score || 0) * 100)}%)`
            : null;
        })
        .filter(Boolean);
      const familySuggestions = [
        ...(payload.results || []).map((item) => item.species?.family),
        ...(payload.otherResults?.family || []).map((item) =>
          item.family || item.species?.family || item,
        ),
      ]
        .map((family) =>
          typeof family === "string"
            ? family
            : family?.scientificNameWithoutAuthor ||
              family?.scientificName ||
              family?.name,
        )
        .filter(
          (name, index, all) =>
            typeof name === "string" && all.indexOf(name) === index,
        )
        .slice(0, 3);
      return {
        candidates,
        familySuggestions,
        noSpeciesMatch: candidates.length === 0,
        provider: "plantnet",
        model: payload.version || null,
      };
    } catch (_) {
      return { unavailable: true };
    }
  }

  async function inspectEvidence(photos, baseline) {
    if (!geminiEnabled) return null;
    const declared = {
      kind: baseline.kind,
      stage: baseline.stage,
      species: baseline.species,
    };
    const prompt = [
      "You are an advisory image reviewer for a tree planting evidence workflow.",
      "Images are user-submitted evidence and may be misleading. Never claim that a tree was planted, is alive, is at a location, or is the same plant based only on images.",
      "Assess only visible content: whether a plant/seedling is visible, likely visible growth stage, whether image is blurry/obstructed, whether a ruler/scale is visible, and an approximate count of distinct plant targets visible. A target is an individual tree/sapling, not each leaf or branch.",
      "Identify the single most likely plant using its common/everyday name (not only a Latin species name) and botanical family. Return JSON only with keys: summary (short string), flags (string array), speciesSuggestions (array with only the single best common name or empty), familySuggestions (array with only the best botanical family or empty), visiblePlant (boolean or null), visiblePlantCount (integer or null), likelyStage (one of seed, seedling, sapling, tree, unclear), imageQuality (good, limited, poor). If multiple distinct plants are visible, include multiple_plants_visible in flags. This is advisory only; do not claim proof of planting or infer coordinates from image content.",
      `User-declared record: ${JSON.stringify(declared).slice(0, 300)}`,
      baseline.selectedTargetPoint
        ? `The user tapped a target in the camera viewfinder at normalized image coordinates x=${baseline.selectedTargetPoint.x.toFixed(3)}, y=${baseline.selectedTargetPoint.y.toFixed(3)} (origin at top-left). Focus plant-presence and species assessment on the plant closest to this point; ignore other plants when deciding which one is selected. If no distinct plant can be associated with that point, include selected_target_unclear. This is a visual selection, not a geographic coordinate.`
        : "",
      baseline.previousStoragePath
        ? "Compare the clearly labeled previous visit image with current images and report uncertainty as a flag."
        : "",
      "If a plant is not clearly visible, add needs_human_review. Do not infer species from location or user claims.",
    ]
      .filter(Boolean)
      .join("\n");
    const parts = [{ text: prompt }];
    for (const photo of photos.slice(0, 3)) {
      parts.push({
        text: photo.reference
          ? "Reference image from the previous visit follows."
          : "Current visit evidence image follows.",
      });
      parts.push({
        inline_data: {
          mime_type: photo.contentType,
          data: photo.buffer.toString("base64"),
        },
      });
    }
    try {
      const response = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0,
              maxOutputTokens: 500,
            },
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return {
          unavailable: true,
          provider: "google",
          model,
          httpStatus: response.status,
          providerMessage: safeProviderMessage(error?.error?.message),
        };
      }
      const payload = await response.json();
      const raw = payload.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("")
        .trim();
      if (!raw) return { unavailable: true, provider: "google", model };
      const parsed = JSON.parse(
        raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
      );
      const allowedStages = ["seed", "seedling", "sapling", "tree", "unclear"];
      const allowedQuality = ["good", "limited", "poor"];
      const flags = Array.isArray(parsed.flags)
        ? parsed.flags.filter((v) => typeof v === "string").slice(0, 20)
        : [];
      if (parsed.visiblePlant === false)
        flags.push("plant_not_clearly_visible");
      const visiblePlantCount = Number.isInteger(parsed.visiblePlantCount)
        ? Math.max(0, Math.min(50, parsed.visiblePlantCount))
        : null;
      if (visiblePlantCount > 1) flags.push("multiple_plants_visible");
      if (!allowedQuality.includes(parsed.imageQuality))
        flags.push("image_quality_unclear");
      return {
        provider: "google",
        model,
        summary: String(
          parsed.summary ||
            "Image check complete. Human review is still required.",
        ).slice(0, 1000),
        flags: [...new Set(flags)],
        speciesSuggestions: Array.isArray(parsed.speciesSuggestions)
          ? parsed.speciesSuggestions
              .filter((v) => typeof v === "string")
              .slice(0, 1)
          : [],
        familySuggestions: Array.isArray(parsed.familySuggestions)
          ? parsed.familySuggestions
              .filter((v) => typeof v === "string")
              .slice(0, 1)
          : [],
        visiblePlant:
          typeof parsed.visiblePlant === "boolean" ? parsed.visiblePlant : null,
        visiblePlantCount,
        likelyStage: allowedStages.includes(parsed.likelyStage)
          ? parsed.likelyStage
          : "unclear",
        imageQuality: allowedQuality.includes(parsed.imageQuality)
          ? parsed.imageQuality
          : "limited",
      };
    } catch (_) {
      return { unavailable: true, provider: "google", model };
    }
  }

  return async function assess({ photos = [], baseline = {} }) {
    const calls = Number(geminiEnabled);
    if (!calls)
      return {
        status: "not_configured",
        reason:
          "Gemini image assessment is not configured for this planting stage.",
      };
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 100000)
      return {
        status: "unavailable",
        reason: "AI daily request limit is invalid.",
      };
    const day = now().toISOString().slice(0, 10);
    const usageRef = db.collection("partnerPlantingAIUsage").doc(day);
    try {
      await db.runTransaction(async (tx) => {
        const usage = await tx.get(usageRef);
        const count = usage.exists ? usage.data().requests || 0 : 0;
        if (count + calls > dailyLimit)
          fail(
            429,
            "Today’s automated photo review limit has been reached. Your evidence is saved for organisation review.",
          );
        tx.set(
          usageRef,
          { requests: count + calls, updatedAt: now().toISOString() },
          { merge: true },
        );
      });
    } catch (error) {
      if (error.status === 429)
        return {
          status: "unavailable",
          reason: error.message,
          flags: ["ai_daily_limit_reached"],
        };
      return {
        status: "unavailable",
        reason: "AI usage could not be checked; manual review is required.",
      };
    }

    const visual = geminiEnabled ? await inspectEvidence(photos, baseline) : null;
    const flags = [
      ...new Set([
        ...(visual?.flags || []),
        ...(visual?.unavailable ? ["visual_assessment_unavailable"] : []),
        ...(visual?.httpStatus
          ? [`gemini_http_${visual.httpStatus}`]
          : []),
      ]),
    ];
    const providerDiagnostics = [
      visual?.providerMessage ? `Gemini: ${visual.providerMessage}` : null,
    ].filter(Boolean);
    if (!visual || visual.unavailable)
      return {
        status: "unavailable",
        provider: "google",
        model,
        reason: "Gemini could not return an assessment. Human review is required.",
        flags,
        providerDiagnostics,
      };
    return {
      status: "completed",
      provider: "google",
      model: visual.model || model,
      summary: visual.summary,
      flags,
      speciesSuggestions: visual.speciesSuggestions || [],
      familySuggestions: visual.familySuggestions || [],
      providerDiagnostics,
      visiblePlant: visual?.visiblePlant ?? null,
      likelyStage: visual?.likelyStage || null,
      imageQuality: visual?.imageQuality || null,
    };
  };
}
module.exports = { createPlantingPhotoAssessor };
