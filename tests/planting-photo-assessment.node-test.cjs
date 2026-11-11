const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlantingPhotoAssessor } = require("../src/services/planting-photo-assessment.service");

function usageDb() {
  const docs = new Map();
  return {
    docs,
    collection: () => ({ doc: (id) => ({ id }) }),
    runTransaction: (fn) =>
      fn({
        get: async (ref) => ({
          exists: docs.has(ref.id),
          data: () => ({ requests: docs.get(ref.id) || 0 }),
        }),
        set: (ref, data) => docs.set(ref.id, data.requests),
      }),
  };
}

test("AI assessment gates both providers behind the staging enable flag", async () => {
  let requests = 0;
  const assess = createPlantingPhotoAssessor({
    db: usageDb(),
    env: {
      PLANTING_AI_ENABLED: "false",
      GEMINI_API_KEY: "gemini-test-key",
      PLANTNET_API_KEY: "plantnet-test-key",
    },
    fetchImpl: async () => {
      requests += 1;
      throw new Error("Providers must not be called while disabled.");
    },
  });

  const result = await assess({
    photos: [{ buffer: Buffer.from("image"), contentType: "image/jpeg" }],
    baseline: { kind: "sapling", stage: "sapling", species: "Neem" },
  });

  assert.equal(result.status, "not_configured");
  assert.equal(requests, 0);
});

test("enabled AI checks one photo with Gemini and returns Pl@ntNet family suggestions", async () => {
  const db = usageDb();
  const requests = [];
  const assess = createPlantingPhotoAssessor({
    db,
    now: () => new Date("2026-11-11T12:00:00.000Z"),
    env: {
      PLANTING_AI_ENABLED: "true",
      PLANTING_AI_DAILY_LIMIT: "20",
      GEMINI_API_KEY: "gemini-test-key",
      PLANTNET_API_KEY: "plantnet-test-key",
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes("my-api.plantnet.org")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            version: "test",
            results: [
              {
                score: 0.94,
                species: {
                  scientificNameWithoutAuthor: "Azadirachta indica",
                  family: { scientificNameWithoutAuthor: "Meliaceae" },
                },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary: "A plant is visible.",
                      flags: [],
                      speciesSuggestions: [],
                      visiblePlant: true,
                      likelyStage: "sapling",
                      imageQuality: "good",
                    }),
                  },
                ],
              },
            },
          ],
        }),
      };
    },
  });

  const result = await assess({
    photos: [{ buffer: Buffer.from("one-photo"), contentType: "image/jpeg" }],
    baseline: { kind: "sapling", stage: "sapling", species: "Neem" },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.visiblePlant, true);
  assert.deepEqual(result.familySuggestions, ["Meliaceae"]);
  assert.equal(requests.length, 2);
  const plantNetImages = await requests
    .find((request) => request.url.includes("my-api.plantnet.org"))
    .options.body.getAll("images");
  const geminiPayload = JSON.parse(
    requests
      .find((request) => request.url.includes("generativelanguage.googleapis.com"))
      .options.body,
  );
  assert.equal(plantNetImages.length, 1);
  assert.equal(
    geminiPayload.contents[0].parts.filter((part) => part.inline_data).length,
    1,
  );
  assert.equal([...db.docs.values()][0], 2);
});
