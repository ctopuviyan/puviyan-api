const crypto = require("node:crypto");
const sharp = require("sharp");
const {
  fail,
  text,
  validDate,
  imageType,
} = require("./partner-project-policy");
const EARTH_RADIUS = 6371000;
const KINDS = ["seed_spot", "sapling", "tree"];
const STAGES = [
  "sown",
  "not_germinated",
  "germinated",
  "seedling",
  "sapling",
  "tree",
  "dead",
  "missing",
];
function id(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    fail(400, "Invalid identifier.");
  return value;
}
function number(value, name, min, max) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    fail(400, `Invalid ${name}.`);
  return value;
}
function distance(a, b) {
  const rad = Math.PI / 180,
    p1 = a.latitude * rad,
    p2 = b.latitude * rad;
  const h =
    Math.sin((p2 - p1) / 2) ** 2 +
    Math.cos(p1) *
      Math.cos(p2) *
      Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}
// Earth-centred 25m cubes avoid longitude wrap/pole boundary holes. Transactions
// read every neighbouring cube and update the centre cube, serialising 5m conflicts.
function spatialCells(point) {
  const lat = (point.latitude * Math.PI) / 180,
    lon = (point.longitude * Math.PI) / 180;
  const cell = [
    Math.floor((EARTH_RADIUS * Math.cos(lat) * Math.cos(lon)) / 25),
    Math.floor((EARTH_RADIUS * Math.cos(lat) * Math.sin(lon)) / 25),
    Math.floor((EARTH_RADIUS * Math.sin(lat)) / 25),
  ];
  const keys = [];
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++)
        keys.push(`${cell[0] + x}_${cell[1] + y}_${cell[2] + z}`);
  return { centre: cell.join("_"), keys };
}
function captureMetadata(
  input,
  { baseline = false, tree = null, legacy = false, now = Date.now() } = {},
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail(400, "Capture metadata is required.");
  if (!/^[a-f0-9]{32}$/.test(input.recordId || ""))
    fail(400, "A valid record ID is required.");
  const data = {
    recordId: input.recordId,
    latitude: number(input.latitude, "latitude", -90, 90),
    longitude: number(input.longitude, "longitude", -180, 180),
    accuracyMeters: number(
      input.accuracyMeters,
      "GPS accuracy",
      0,
      legacy ? 100 : 20,
    ),
    capturedAt: validDate(input.capturedAt, "Capture time"),
    locationCapturedAt: validDate(input.locationCapturedAt, "GPS time"),
    photoSource: input.photoSource,
    notes:
      input.notes == null || input.notes === ""
        ? ""
        : text(input.notes, "Notes", 1000),
  };
  // Empty notes are valid, while non-string/oversized notes are not.
  if (input.notes == null || input.notes === "") data.notes = "";
  if (!["camera", "gallery"].includes(data.photoSource))
    fail(400, "Choose a ground camera or gallery source.");
  for (const date of [data.capturedAt, data.locationCapturedAt])
    if (
      Date.parse(date) > now + 5 * 60000 ||
      Date.parse(date) < now - 24 * 3600000
    )
      fail(
        400,
        "Ground photos and GPS fixes must be captured within the last 24 hours.",
      );
  data.stage = baseline
    ? input.kind === "seed_spot"
      ? "sown"
      : input.kind === "sapling"
        ? "sapling"
        : "tree"
    : input.stage;
  if (!STAGES.includes(data.stage))
    fail(400, "Choose a supported growth stage.");
  data.measurementMethod = input.measurementMethod || "none";
  if (!["none", "estimated", "ruler", "tape"].includes(data.measurementMethod))
    fail(400, "Choose a supported measurement method.");
  data.scaleReferenceVisible = input.scaleReferenceVisible === true;
  data.heightCm =
    input.heightCm == null ? null : number(input.heightCm, "height", 0, 20000);
  if (data.heightCm != null && data.measurementMethod === "none")
    fail(400, "Describe how the height was measured.");
  if (
    data.heightCm != null &&
    ["ruler", "tape"].includes(data.measurementMethod) &&
    !data.scaleReferenceVisible
  )
    fail(400, "Include the ruler or tape in the photo.");
  data.survivingCount =
    input.survivingCount == null
      ? null
      : number(
          input.survivingCount,
          "surviving plant count",
          0,
          tree?.seedCount || 1,
        );
  if (data.survivingCount != null && !Number.isInteger(data.survivingCount))
    fail(400, "Use a whole-number plant count.");
  if (input.captureSessionId != null)
    data.captureSessionId = id(input.captureSessionId);
  if (!legacy && !data.captureSessionId)
    fail(400, "Start a fresh capture session before taking photos.");
  if (baseline) {
    data.kind = input.kind || "tree";
    if (!KINDS.includes(data.kind))
      fail(400, "Choose seed planting spot, sapling or tree.");
    data.species =
      input.species == null || input.species === ""
        ? null
        : text(input.species, "Species", 100);
    data.intervalDays =
      input.intervalDays ?? (data.kind === "seed_spot" ? 7 : 30);
    number(data.intervalDays, "monitoring interval", 1, 365);
    if (!Number.isInteger(data.intervalDays))
      fail(400, "Use whole days for the monitoring interval.");
    data.seedCount =
      data.kind === "seed_spot"
        ? number(input.seedCount, "number of seeds", 1, 100000)
        : 1;
    if (!Number.isInteger(data.seedCount))
      fail(400, "Use a whole-number seed count.");
    data.eventId = input.eventId == null ? null : id(input.eventId);
  }
  return data;
}
async function inspectPhoto(buffer) {
  imageType(buffer);
  try {
    const image = sharp(buffer, {
        limitInputPixels: 20000000,
        failOn: "error",
      }),
      meta = await image.metadata();
    if (
      !["jpeg", "png"].includes(meta.format) ||
      (meta.pages || 1) > 1 ||
      meta.width < 256 ||
      meta.height < 256
    )
      fail(400, "Use a clear JPEG/PNG photo at least 256 × 256 pixels.");
    const normalised = await image
      .rotate()
      .resize({
        width: 1800,
        height: 1800,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88 })
      .toBuffer();
    const pixels = await sharp(normalised)
      .resize(9, 8, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer();
    let bits = 0n;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        bits =
          (bits << 1n) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1n : 0n);
    return {
      buffer: normalised,
      contentType: "image/jpeg",
      sha256: crypto.createHash("sha256").update(normalised).digest("hex"),
      perceptualHash: bits.toString(16).padStart(16, "0"),
      width: meta.width,
      height: meta.height,
    };
  } catch (error) {
    if (error.status) throw error;
    fail(
      400,
      "The photo is damaged, too large or not a supported JPEG/PNG image.",
    );
  }
}
function similar(a, b) {
  if (!a || !b) return false;
  let bits = BigInt("0x" + a) ^ BigInt("0x" + b),
    count = 0;
  while (bits) {
    count += Number(bits & 1n);
    bits >>= 1n;
  }
  return count <= 4;
}
function dueAt(date, days) {
  return new Date(Date.parse(date) + days * 86400000).toISOString();
}
function canReview(c) {
  return (
    c.superAdmin ||
    c.roles.some((r) =>
      ["sustainability_action_owner", "sustainability_service_provider", "org_admin", "partner_admin"].includes(r),
    )
  );
}
function publicRecord(data) {
  const {
    storagePath,
    contextStoragePath,
    fingerprint,
    imageHashes,
    perceptualHash,
    contextPerceptualHash,
    captureSessionId,
    ...safe
  } = data;
  return safe;
}
module.exports = {
  id,
  number,
  distance,
  spatialCells,
  captureMetadata,
  inspectPhoto,
  similar,
  dueAt,
  canReview,
  publicRecord,
  KINDS,
  STAGES,
};
