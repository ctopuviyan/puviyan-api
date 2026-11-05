// Staging-only, idempotent index migration for existing partner tree records.
// Default is dry-run. Pass --apply after reviewing the printed target/counts.
const {
  initializeFirebase,
  getFirestore,
} = require("../src/config/firebase.config");
const { spatialCells } = require("../src/services/planting-monitoring-policy");
const { geohashForLocation } = require("geofire-common");

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (projectId !== "puviyan-stage")
    throw new Error(
      "Refusing to run: FIREBASE_PROJECT_ID must be puviyan-stage.",
    );
  const apply = process.argv.includes("--apply");
  initializeFirebase();
  const db = getFirestore();
  const projects = await db.collection("partnerProjects").get();
  const groups = new Map();
  let scanned = 0;
  let skipped = 0;
  for (const projectDoc of projects.docs) {
    if (projectDoc.data().scope !== "plant_trees") continue;
    const trees = await projectDoc.ref.collection("trees").limit(5001).get();
    if (trees.size > 5000)
      throw new Error(
        `Project ${projectDoc.id} has more than 5,000 trees; migrate it in paginated batches.`,
      );
    for (const treeDoc of trees.docs) {
      scanned++;
      const tree = treeDoc.data();
      if (
        !Number.isFinite(tree.latitude) ||
        !Number.isFinite(tree.longitude) ||
        tree.latitude < -90 ||
        tree.latitude > 90 ||
        tree.longitude < -180 ||
        tree.longitude > 180
      ) {
        skipped++;
        continue;
      }
      const point = {
        projectId: projectDoc.id,
        treeId: treeDoc.id,
        orgId: tree.orgId || projectDoc.data().orgId,
        latitude: tree.latitude,
        longitude: tree.longitude,
        accuracyMeters: Number(tree.accuracyMeters) || 100,
        perceptualHash: tree.perceptualHash || null,
      };
      const cell = spatialCells(point);
      if (!groups.has(cell.centre)) groups.set(cell.centre, []);
      groups.get(cell.centre).push(point);
    }
  }
  for (const [cellId, points] of groups) {
    if (points.length > 200)
      throw new Error(
        `Cell ${cellId} has more than 200 records; resolve dense-area migration manually.`,
      );
  }
  console.log(
    JSON.stringify({
      targetProject: projectId,
      mode: apply ? "apply" : "dry-run",
      scanned,
      skipped,
      locationCells: groups.size,
      records: [...groups.values()].reduce((n, points) => n + points.length, 0),
    }),
  );
  if (!apply) return;

  for (const [cellId, additions] of groups) {
    const cellRef = db.collection("partnerPlantingCells").doc(cellId);
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(cellRef);
      const points = snapshot.exists ? snapshot.data().points || [] : [];
      const byId = new Map(
        points.map((p) => [`${p.projectId}_${p.treeId}`, p]),
      );
      for (const p of additions) byId.set(`${p.projectId}_${p.treeId}`, p);
      if (byId.size > 200)
        throw new Error(`Cell ${cellId} exceeds the 200-point index limit.`);
      tx.set(cellRef, {
        points: [...byId.values()],
        updatedAt: new Date().toISOString(),
      });
    });
  }
  const locations = [];
  for (const [cellId, points] of groups) {
    for (const point of points)
      locations.push({
        id: `${point.projectId}_${point.treeId}`,
        cellId,
        point,
      });
  }
  for (let i = 0; i < locations.length; i += 400) {
    const batch = db.batch();
    for (const item of locations.slice(i, i + 400)) {
      const { point } = item;
      const ref = db.collection("partnerPlantingLocations").doc(item.id);
      batch.set(
        ref,
        {
          ...point,
          geohash: geohashForLocation([point.latitude, point.longitude]),
          createdAt: new Date().toISOString(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
  console.log("Planting location index backfill completed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
