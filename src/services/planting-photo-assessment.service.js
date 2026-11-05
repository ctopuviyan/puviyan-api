const { fail } = require("./partner-project-policy");

function createPlantingPhotoAssessor({
  db,
  fetchImpl = global.fetch,
  env = process.env,
  now = () => new Date(),
}) {
  const geminiEnabled =
    env.PLANTING_AI_ENABLED === "true" && !!env.GEMINI_API_KEY;
  const geminiKey = env.GEMINI_API_KEY;
  const model = env.PLANTING_AI_MODEL || "gemini-2.5-flash-lite";
  const plantNetKey = env.PLANTNET_API_KEY;
  const plantNetProject = env.PLANTNET_PROJECT || "all";
  const dailyLimit = Number(env.PLANTING_AI_DAILY_LIMIT || 500);

  async function identifySpecies(photos, baseline) {
    const stage = baseline.stage;
    if (
      !plantNetKey ||
      baseline.kind === "seed_spot" ||
      ["sown", "not_germinated", "dead", "missing"].includes(stage)
    )
      return null;
    const form = new FormData();
    for (const [i, photo] of photos
      .filter((p) => !p.reference)
      .slice(0, 2)
      .entries()) {
      form.append(
        "images",
        new Blob([photo.buffer], { type: photo.contentType }),
        `plant-${i + 1}.jpg`,
      );
      form.append("organs", "auto");
    }
    if (!form.has("images")) return null;
    const url = new URL(
      `https://my-api.plantnet.org/v2/identify/${encodeURIComponent(plantNetProject)}`,
    );
    url.searchParams.set("api-key", plantNetKey);
    url.searchParams.set("nb-results", "3");
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return { unavailable: true };
      const payload = await response.json();
      const candidates = (payload.results || [])
        .slice(0, 3)
        .map((item) => {
          const name =
            item.species?.scientificNameWithoutAuthor ||
            item.species?.scientificName ||
            item.species?.commonNames?.[0];
          return typeof name === "string"
            ? `${name} (${Math.round((item.score || 0) * 100)}%)`
            : null;
        })
        .filter(Boolean);
      return {
        candidates,
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
      "Assess only visible content: whether a plant/seedling is visible, likely visible growth stage, whether image is blurry/obstructed, whether a ruler/scale is visible, and whether this appears to be a context photo.",
      "Return JSON only with keys: summary (short string), flags (string array), speciesSuggestions (array of up to 3 common names or empty), visiblePlant (boolean or null), likelyStage (one of seed, seedling, sapling, tree, unclear), imageQuality (good, limited, poor).",
      `User-declared record: ${JSON.stringify(declared).slice(0, 300)}`,
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
              maxOutputTokens: 350,
            },
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) return { unavailable: true, provider: "google", model };
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
              .slice(0, 3)
          : [],
        visiblePlant:
          typeof parsed.visiblePlant === "boolean" ? parsed.visiblePlant : null,
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
    const plantNetEligible =
      !!plantNetKey &&
      baseline.kind !== "seed_spot" &&
      !["sown", "not_germinated", "dead", "missing"].includes(baseline.stage);
    const calls = Number(geminiEnabled) + Number(plantNetEligible);
    if (!calls)
      return {
        status: "not_configured",
        reason:
          "Image assessment services are not configured for this planting stage.",
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

    const [visual, plantnet] = await Promise.all([
      geminiEnabled ? inspectEvidence(photos, baseline) : null,
      plantNetEligible ? identifySpecies(photos, baseline) : null,
    ]);
    const speciesSuggestions = plantnet?.candidates?.length
      ? plantnet.candidates
      : visual?.speciesSuggestions || [];
    const flags = [
      ...new Set([
        ...(visual?.flags || []),
        ...(visual?.unavailable ? ["visual_assessment_unavailable"] : []),
        ...(plantnet?.unavailable
          ? ["species_identification_unavailable"]
          : []),
      ]),
    ];
    if (!visual && !plantnet?.candidates?.length)
      return {
        status: "unavailable",
        provider: "google+plantnet",
        reason: "Image services could not return an assessment.",
        flags,
      };
    return {
      status: "completed",
      provider: [visual?.provider, plantnet?.provider]
        .filter(Boolean)
        .join("+"),
      model: [visual?.model, plantnet?.model].filter(Boolean).join("+") || null,
      summary:
        visual?.summary ||
        "Species suggestions are available; visual verification needs human review.",
      flags,
      speciesSuggestions,
      visiblePlant: visual?.visiblePlant ?? null,
      likelyStage: visual?.likelyStage || null,
      imageQuality: visual?.imageQuality || null,
    };
  };
}
module.exports = { createPlantingPhotoAssessor };
