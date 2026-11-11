const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { store } = require("./helpers/partner-fixture.cjs");
const {
  createPlantingMonitoring,
} = require("../src/services/planting-monitoring.service");
const {
  distance,
  spatialCells,
} = require("../src/services/planting-monitoring-policy");

async function image(color) {
  return sharp({
    create: { width: 320, height: 320, channels: 3, background: color },
  })
    .jpeg()
    .toBuffer();
}
function memoryBucket() {
  const files = new Map();
  return {
    files,
    getBucket: () => ({
      file: (path) => ({
        save: async (bytes) => files.set(path, bytes),
        delete: async () => files.delete(path),
        getSignedUrl: async () => [`https://private.example/${path}`],
        download: async () => [files.get(path)],
      }),
    }),
  };
}
function metadata(recordId, captureSessionId, offset = 0) {
  const time = new Date(Date.now() + offset).toISOString();
  return {
    recordId,
    captureSessionId,
    kind: "sapling",
    intervalDays: 30,
    latitude: 13.0827,
    longitude: 80.2707,
    accuracyMeters: 20,
    capturedAt: time,
    locationCapturedAt: time,
    photoSource: "camera",
    stage: "sapling",
    measurementMethod: "none",
    notes: "",
  };
}

test("plant spacing uses metre distances and neighbouring global cells", () => {
  const point = { latitude: 13.0827, longitude: 80.2707 };
  assert.equal(distance(point, point), 0);
  assert.ok(spatialCells(point).keys.length === 27);
  assert.ok(distance(point, { latitude: 13.0827, longitude: 80.2708 }) > 5);
});

test("species is optional at planting submission and can be confirmed from AI suggestions", async () => {
  const { db, c } = store();
  db.data.set("partnerProjects/planting1", {
    orgId: "orgA",
    scope: "plant_trees",
    status: "active",
  });
  const { getBucket } = memoryBucket();
  const service = createPlantingMonitoring({
    db,
    getBucket,
    assess: async () => ({
      status: "completed",
      provider: "plantnet",
      visiblePlant: true,
      speciesSuggestions: ["Azadirachta indica (94%)"],
      familySuggestions: ["Meliaceae"],
    }),
  });
  const owner = c("admin");
  const session = await service.beginCapture(owner, "planting1");
  const recordId = "f".repeat(32);
  const created = await service.baseline(
    owner,
    "planting1",
    metadata(recordId, session.id),
    await image({ r: 40, g: 130, b: 40 }),
  );
  assert.equal(created.created, true);
  let detail = await service.detail(owner, "planting1", recordId);
  assert.equal(detail.planting.species, null);
  assert.equal(detail.planting.accuracyMeters, 20);

  const confirmed = await service.confirmSpecies(owner, "planting1", recordId, {
    speciesSuggestion: "Azadirachta indica (94%)",
  });
  assert.equal(confirmed.species, "Azadirachta indica");
  detail = await service.detail(owner, "planting1", recordId);
  assert.equal(detail.planting.species, "Azadirachta indica");
  assert.equal(detail.planting.speciesConfirmedByUid, "admin");
});

test("planting baseline, five-metre conflict, follow-up history and second-person review", async () => {
  const { db, c } = store();
  db.data.set("partnerProjects/planting1", {
    orgId: "orgA",
    scope: "plant_trees",
    status: "active",
  });
  db.data.set("partnerUsers/reviewer", {
    orgId: "orgA",
    roles: ["org_admin"],
    status: "active",
  });
  const { files, getBucket } = memoryBucket();
  const service = createPlantingMonitoring({
    db,
    getBucket,
    assess: async () => ({ status: "not_configured" }),
  });
  const owner = c("admin");
  const reviewer = c("reviewer");
  const close = await image({ r: 30, g: 130, b: 40 });

  const session = await service.beginCapture(owner, "planting1");
  const created = await service.baseline(
    owner,
    "planting1",
    metadata("a".repeat(32), session.id),
    close,
  );
  assert.equal(created.created, true);
  assert.equal(files.size, 1);

  const duplicateSession = await service.beginCapture(owner, "planting1");
  await assert.rejects(
    service.baseline(
      owner,
      "planting1",
      metadata("b".repeat(32), duplicateSession.id),
      await image({ r: 90, g: 110, b: 30 }),
    ),
    (error) => error.status === 409 && /five metres/.test(error.message),
  );

  const followSession = await service.beginCapture(owner, "planting1", {
    plantingId: "a".repeat(32),
  });
  const follow = metadata("c".repeat(32), followSession.id, 1000);
  delete follow.kind;
  delete follow.species;
  delete follow.intervalDays;
  const observation = await service.observe(
    owner,
    "planting1",
    "a".repeat(32),
    follow,
    await image({ r: 55, g: 145, b: 35 }),
    await image({ r: 100, g: 90, b: 20 }),
  );
  assert.equal(observation.created, true);

  const detail = await service.detail(reviewer, "planting1", "a".repeat(32));
  assert.equal(detail.observations.length, 2);
  assert.equal(detail.observations[0].canReview, true);
  const approved = await service.review(
    reviewer,
    "planting1",
    "a".repeat(32),
    "baseline",
    {
      decision: "approved",
      version: 1,
      note: "Plant and location evidence reviewed.",
    },
  );
  assert.equal(approved.reviewStatus, "approved");
  const reviewed = await service.detail(reviewer, "planting1", "a".repeat(32));
  assert.equal(reviewed.planting.verificationStatus, "verified");
});

test("an explicit AI non-plant result blocks the planting record before photo storage", async () => {
  const { db, c } = store();
  db.data.set("partnerProjects/planting1", {
    orgId: "orgA",
    scope: "plant_trees",
    status: "active",
  });
  const { files, getBucket } = memoryBucket();
  const service = createPlantingMonitoring({
    db,
    getBucket,
    assess: async () => ({
      status: "completed",
      provider: "google+plantnet",
      visiblePlant: false,
      flags: ["plant_not_clearly_visible"],
    }),
  });
  const owner = c("admin");
  const session = await service.beginCapture(owner, "planting1");

  await assert.rejects(
    service.baseline(
      owner,
      "planting1",
      metadata("d".repeat(32), session.id),
      await image({ r: 120, g: 70, b: 35 }),
    ),
    (error) => error.status === 422 && /does not clearly show a plant/.test(error.message),
  );

  assert.equal(files.size, 0);
  assert.equal(db.data.has(`partnerProjects/planting1/trees/${"d".repeat(32)}`), false);

  const seedSession = await service.beginCapture(owner, "planting1");
  const seedMetadata = metadata("e".repeat(32), seedSession.id);
  seedMetadata.kind = "seed_spot";
  seedMetadata.stage = "sown";
  seedMetadata.seedCount = 1;
  const seed = await service.baseline(
    owner,
    "planting1",
    seedMetadata,
    await image({ r: 80, g: 100, b: 30 }),
  );
  assert.equal(seed.created, true);
});
