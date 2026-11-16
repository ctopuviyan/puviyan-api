const crypto = require("node:crypto");

const FACTOR_LIBRARY_VERSION = "PIA-TREE-CARBON-FACTORS-V1";
const METHODOLOGY_VERSION = "modelled_linear_allocation_v2_provisional_survival";
const FACTOR_SOURCE =
  "PIA Tree Carbon Impact MVP factor library; conservative planning factors supplied by the product owner (low confidence, not verified credits).";
const CREDITING_PERIOD_YEARS = 20;
const DAYS_PER_YEAR = 365.25;
const CREDITING_PERIOD_DAYS = CREDITING_PERIOD_YEARS * DAYS_PER_YEAR;
const DAY_MS = 24 * 60 * 60 * 1000;

const FACTORS = [
  { id: "TEC-GRANDIS-V1", species: "Teak", scientificName: "Tectona grandis", aliases: ["teak", "tectona grandis"], nativeStatus: "Native / naturalised in India", lifetimeTonnes: 0.5, annualKg: 25, confidence: "Low" },
  { id: "AZA-INDICA-V1", species: "Neem", scientificName: "Azadirachta indica", aliases: ["neem", "azadirachta indica"], nativeStatus: "Native to Indian subcontinent", lifetimeTonnes: 0.35, annualKg: 17.5, confidence: "Low" },
  { id: "MAN-INDICA-V1", species: "Mango", scientificName: "Mangifera indica", aliases: ["mango", "mangifera indica"], nativeStatus: "Cultivated / native region", lifetimeTonnes: 0.4, annualKg: 20, confidence: "Low" },
  { id: "SYZ-CUMINI-V1", species: "Jamun", scientificName: "Syzygium cumini", aliases: ["jamun", "syzygium cumini"], nativeStatus: "Native to Indian subcontinent", lifetimeTonnes: 0.35, annualKg: 17.5, confidence: "Low" },
  { id: "FIC-RELIGIOSA-V1", species: "Peepal", scientificName: "Ficus religiosa", aliases: ["peepal", "ficus religiosa"], nativeStatus: "Native to Indian subcontinent", lifetimeTonnes: 0.6, annualKg: 30, confidence: "Low" },
  { id: "FIC-BENGHALENSIS-V1", species: "Banyan", scientificName: "Ficus benghalensis", aliases: ["banyan", "ficus benghalensis"], nativeStatus: "Native to Indian subcontinent", lifetimeTonnes: 0.8, annualKg: 40, confidence: "Low" },
  { id: "TER-ARJUNA-V1", species: "Arjun", scientificName: "Terminalia arjuna", aliases: ["arjun", "terminalia arjuna"], nativeStatus: "Native to Indian subcontinent", lifetimeTonnes: 0.4, annualKg: 20, confidence: "Low" },
  { id: "PON-PINNATA-V1", species: "Karanj", scientificName: "Pongamia pinnata", aliases: ["karanj", "pongamia pinnata"], nativeStatus: "Native to Indian subcontinent", lifetimeTonnes: 0.4, annualKg: 20, confidence: "Low" },
  { id: "DAL-SISSOO-V1", species: "Shisham", scientificName: "Dalbergia sissoo", aliases: ["shisham", "dalbergia sissoo"], nativeStatus: "Native to Indian subcontinent", lifetimeTonnes: 0.45, annualKg: 22.5, confidence: "Low" },
];
const FALLBACK = {
  id: "GLOBAL-TREE-FALLBACK-V1",
  species: "Global fallback",
  scientificName: null,
  aliases: [],
  nativeStatus: "Any unknown species",
  lifetimeTonnes: 0.3,
  annualKg: 15,
  confidence: "Low",
};
const TERMINAL_STAGES = new Set(["dead", "missing", "harvested", "removed"]);
const round = (value, digits = 6) => Number(value.toFixed(digits));
const normalized = (value) =>
  String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function factorFor(species) {
  const candidates = String(species || "")
    .split(/[()]/)
    .map(normalized)
    .filter(Boolean);
  return FACTORS.find((factor) =>
    factor.aliases.some((alias) => candidates.includes(normalized(alias))),
  ) || FALLBACK;
}

function makeSummary(projectId, records, calculatedAt) {
  const calculatedAtMs = Date.parse(calculatedAt);
  const bySpecies = new Map();
  const plantings = {};
  let estimatedTco2e = 0;
  let projectedLifetimeTco2e = 0;
  let eligiblePlantings = 0;
  let ineligiblePlantings = 0;
  let dataErrorPlantings = 0;
  let verifiedSurvivingTrees = 0;
  let assumedSurvivingTrees = 0;
  let provisionalSurvivingTrees = 0;
  let unverifiedPlantings = 0;
  let provisionalPlantings = 0;

  for (const record of records) {
    const plantedAt = typeof record.capturedAt === "string" ? Date.parse(record.capturedAt) : NaN;
    const plantedCount = record.kind === "seed_spot"
      ? Number(record.seedCount || 0)
      : 1;
    const stage = record.latestVerifiedStage || record.reviewedStage || null;
    const surviving = TERMINAL_STAGES.has(stage)
      ? 0
      : record.latestVerifiedSurvivingCount;
    const validSurvival = Number.isInteger(surviving) && surviving >= 0;
    const countExceedsPlanted = validSurvival && surviving > plantedCount;
    const missingDate = !Number.isFinite(plantedAt);
    const missingSurvival = !validSurvival;
    // Until a survival survey is verified, assume every recorded planting is
    // alive for a provisional planning estimate. Keep that assumption explicit.
    const assumedSurviving = validSurvival ? surviving : plantedCount;
    const eligible = !missingDate && !countExceedsPlanted;
    const factor = factorFor(record.species);
    const key = `${normalized(record.species) || "unknown species"}|${factor.id}`;
    const elapsedDays = Number.isFinite(plantedAt)
      ? Math.max(0, (calculatedAtMs - plantedAt) / DAY_MS)
      : null;
    const progress = elapsedDays == null
      ? null
      : Math.min(elapsedDays / CREDITING_PERIOD_DAYS, 1);
    const recordLifetimeTonnes = eligible ? factor.lifetimeTonnes * assumedSurviving : 0;
    const recordToDateTonnes = eligible ? recordLifetimeTonnes * progress : 0;
    const recordResult = {
      status: countExceedsPlanted
        ? "data_error"
        : missingDate
          ? "missing_planting_date"
          : missingSurvival
            ? "awaiting_survival_verification"
            : "eligible",
      calculationEligible: eligible,
      survivalVerificationStatus: missingSurvival ? "awaiting_verification" : "verified",
      provisionalEstimate: eligible && missingSurvival,
      factorId: factor.id,
      factorVersion: FACTOR_LIBRARY_VERSION,
      lifetimeFactorTco2ePerSurvivingTree: factor.lifetimeTonnes,
      annualizedKgCo2ePerSurvivingTreePerYear: factor.annualKg,
      confidence: factor.confidence,
      source: FACTOR_SOURCE,
      plantedCount,
      verifiedSurvivingCount: validSurvival ? surviving : null,
      assumedSurvivingCount: eligible ? assumedSurviving : null,
      provisionalSurvivingCount: eligible && missingSurvival ? plantedCount : 0,
      plantingDate: Number.isFinite(plantedAt) ? new Date(plantedAt).toISOString() : null,
      elapsedDays: elapsedDays == null ? null : round(elapsedDays, 3),
      creditingProgress: progress == null ? null : round(progress, 8),
      estimatedKgCo2e: eligible ? round(recordToDateTonnes * 1000, 3) : null,
      projectedLifetimeKgCo2e: eligible ? round(recordLifetimeTonnes * 1000, 3) : null,
      remainingProjectedKgCo2e: eligible ? round((recordLifetimeTonnes - recordToDateTonnes) * 1000, 3) : null,
      error: countExceedsPlanted ? "Verified surviving count exceeds the recorded planted count." : null,
      manualOverride: record.manualOverride || null,
    };
    plantings[record.id] = recordResult;

    if (!bySpecies.has(key)) {
      bySpecies.set(key, {
        species: record.species || "Unknown species",
        factorSpecies: factor.species,
        scientificName: factor.scientificName,
        nativeStatus: factor.nativeStatus,
        factorId: factor.id,
        factorVersion: FACTOR_LIBRARY_VERSION,
        source: FACTOR_SOURCE,
        confidence: factor.confidence,
        lifetimeTonnesPerSurvivingTree: factor.lifetimeTonnes,
        annualizedKgPerSurvivingTreePerYear: factor.annualKg,
        plantedCount: 0,
        verifiedSurvivingCount: 0,
        assumedSurvivingCount: 0,
        provisionalSurvivingCount: 0,
        eligiblePlantings: 0,
        ineligiblePlantings: 0,
        provisionalPlantings: 0,
        plantingsAwaitingSurvivalVerification: 0,
        dataErrorPlantings: 0,
        estimatedTco2e: 0,
        projectedLifetimeTco2e: 0,
      });
    }
    const group = bySpecies.get(key);
    group.plantedCount += Number.isFinite(plantedCount) ? plantedCount : 0;
    if (eligible) {
      group.eligiblePlantings++;
      if (validSurvival) group.verifiedSurvivingCount += surviving;
      group.assumedSurvivingCount += assumedSurviving;
      if (missingSurvival) group.provisionalSurvivingCount += plantedCount;
      group.estimatedTco2e += recordToDateTonnes;
      group.projectedLifetimeTco2e += recordLifetimeTonnes;
      eligiblePlantings++;
      assumedSurvivingTrees += assumedSurviving;
      if (validSurvival) verifiedSurvivingTrees += surviving;
      if (missingSurvival) {
        group.provisionalPlantings++;
        provisionalPlantings++;
        provisionalSurvivingTrees += plantedCount;
      }
      estimatedTco2e += recordToDateTonnes;
      projectedLifetimeTco2e += recordLifetimeTonnes;
    } else {
      group.ineligiblePlantings++;
      ineligiblePlantings++;
    }
    if (missingSurvival) {
      group.plantingsAwaitingSurvivalVerification++;
      unverifiedPlantings++;
    }
    if (countExceedsPlanted) {
      group.dataErrorPlantings++;
      dataErrorPlantings++;
    }
  }

  const species = [...bySpecies.values()]
    .map((row) => ({
      ...row,
      estimatedTco2e: round(row.estimatedTco2e),
      projectedLifetimeTco2e: round(row.projectedLifetimeTco2e),
      remainingProjectedTco2e: round(row.projectedLifetimeTco2e - row.estimatedTco2e),
    }))
    .sort((a, b) => a.species.localeCompare(b.species));
  const summary = {
    service: "PIA Tree Carbon Impact",
    methodology: METHODOLOGY_VERSION,
    factorVersion: FACTOR_LIBRARY_VERSION,
    factorSource: FACTOR_SOURCE,
    calculationTimestamp: calculatedAt,
    calculationDate: new Date(calculatedAt).toISOString().slice(0, 10),
    projectId,
    creditingPeriodYears: CREDITING_PERIOD_YEARS,
    daysPerYear: DAYS_PER_YEAR,
    creditingPeriodDays: CREDITING_PERIOD_DAYS,
    units: { estimated: "tCO2e", projectedLifetime: "tCO2e", perPlanting: "kgCO2e" },
    primaryMetricLabel: "Estimated CO2e sequestered to date",
    secondaryMetricLabel: "Projected lifetime CO2e sequestration",
    survivalAssumption: "Uses the latest verified surviving count where available; otherwise provisionally assumes all recorded planted trees are alive until survival is verified.",
    disclaimer: "Modelled estimate only. Not a verified carbon credit, measured carbon stock, or claim of permanent carbon removal.",
    totalPlantings: records.length,
    eligiblePlantings,
    ineligiblePlantings,
    dataErrorPlantings,
    plantingsAwaitingSurvivalVerification: unverifiedPlantings,
    provisionalPlantings,
    verifiedSurvivingTrees,
    assumedSurvivingTrees,
    provisionalSurvivingTrees,
    estimatedTco2e: round(estimatedTco2e),
    projectedLifetimeTco2e: round(projectedLifetimeTco2e),
    remainingProjectedTco2e: round(projectedLifetimeTco2e - estimatedTco2e),
    species,
  };
  return { summary, plantings };
}

function createPiaTreeCarbonImpact({ db, now = () => new Date() }) {
  const projects = db.collection("partnerProjects");

  async function calculateProject(projectId, project, suppliedRecords) {
    if (!project || project.scope !== "plant_trees") return null;
    const projectRef = projects.doc(projectId);
    let records = suppliedRecords;
    if (!records) {
      const snapshot = await projectRef.collection("trees").get();
      records = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }
    const calculatedAt = now().toISOString();
    const { summary, plantings } = makeSummary(projectId, records, calculatedAt);
    const snapshotInput = records.map((record) => ({
      plantingId: record.id,
      plantingDate: record.capturedAt || null,
      species: record.species || null,
      kind: record.kind || null,
      plantedCount: record.kind === "seed_spot" ? Number(record.seedCount || 0) : 1,
      verifiedSurvivingCount: record.latestVerifiedSurvivingCount ?? null,
      latestVerifiedStage: record.latestVerifiedStage || record.reviewedStage || null,
      latestVerifiedAt: record.latestVerifiedSurvivalAt || null,
      latestVerifiedReviewedAt: record.latestVerifiedSurvivalReviewedAt || null,
      latestVerifiedReviewedByUid: record.latestVerifiedSurvivalReviewedByUid || null,
      latestVerifiedObservationId: record.latestVerifiedSurvivalObservationId || null,
      impact: plantings[record.id],
    }));
    const calculationId = `${summary.calculationDate}_${crypto
      .createHash("sha256")
      .update(JSON.stringify({ version: FACTOR_LIBRARY_VERSION, methodology: METHODOLOGY_VERSION, records: snapshotInput.map((r) => [r.plantingId, r.plantingDate, r.species, r.plantedCount, r.verifiedSurvivingCount, r.latestVerifiedStage, r.latestVerifiedAt, r.latestVerifiedReviewedAt, r.latestVerifiedObservationId]) }))
      .digest("hex")
      .slice(0, 24)}`;
    summary.calculationId = calculationId;
    const snapshotRef = projectRef.collection("piaTreeCarbonImpactCalculations").doc(calculationId);
    const snapshot = {
      ...summary,
      inputs: snapshotInput,
      outputs: {
        estimatedTco2e: summary.estimatedTco2e,
        projectedLifetimeTco2e: summary.projectedLifetimeTco2e,
        remainingProjectedTco2e: summary.remainingProjectedTco2e,
        bySpecies: summary.species,
      },
    };
    try {
      await snapshotRef.create(snapshot);
    } catch (error) {
      if (error.code !== 6 && error.code !== "already-exists") throw error;
    }
    const cached = project.piaTreeCarbonImpact;
    if (
      project.piaTreeCarbonImpactDirty === true ||
      !cached ||
      cached.calculationId !== calculationId
    ) {
      await projectRef.set(
        { piaTreeCarbonImpact: summary, piaTreeCarbonImpactDirty: false },
        { merge: true },
      );
    }
    return { summary, plantings };
  }

  async function calculateOrganisation(orgId, projectDocuments) {
    const projectResults = [];
    for (const document of projectDocuments) {
      const project = document.data();
      if (project.scope !== "plant_trees") continue;
      const cached = project.piaTreeCarbonImpact;
      const today = now().toISOString().slice(0, 10);
      if (
        cached &&
        project.piaTreeCarbonImpactDirty !== true &&
        cached.factorVersion === FACTOR_LIBRARY_VERSION &&
        cached.methodology === METHODOLOGY_VERSION &&
        cached.calculationDate === today
      ) {
        projectResults.push(cached);
      } else {
        const result = await calculateProject(document.id, project);
        projectResults.push(result.summary);
      }
    }
    const totals = projectResults.reduce(
      (sum, item) => {
        for (const key of ["estimatedTco2e", "projectedLifetimeTco2e", "remainingProjectedTco2e"]) sum[key] += item[key] || 0;
        for (const key of ["totalPlantings", "eligiblePlantings", "ineligiblePlantings", "dataErrorPlantings", "plantingsAwaitingSurvivalVerification", "provisionalPlantings", "verifiedSurvivingTrees", "assumedSurvivingTrees", "provisionalSurvivingTrees"]) sum[key] += item[key] || 0;
        return sum;
      },
      { estimatedTco2e: 0, projectedLifetimeTco2e: 0, remainingProjectedTco2e: 0, totalPlantings: 0, eligiblePlantings: 0, ineligiblePlantings: 0, dataErrorPlantings: 0, plantingsAwaitingSurvivalVerification: 0, provisionalPlantings: 0, verifiedSurvivingTrees: 0, assumedSurvivingTrees: 0, provisionalSurvivingTrees: 0 },
    );
    const bySpecies = new Map();
    for (const project of projectResults) {
      for (const row of project.species || []) {
        const key = `${normalized(row.species)}|${row.factorId}`;
        const old = bySpecies.get(key) || { ...row, estimatedTco2e: 0, projectedLifetimeTco2e: 0, remainingProjectedTco2e: 0, plantedCount: 0, verifiedSurvivingCount: 0, assumedSurvivingCount: 0, provisionalSurvivingCount: 0, eligiblePlantings: 0, ineligiblePlantings: 0, provisionalPlantings: 0, plantingsAwaitingSurvivalVerification: 0, dataErrorPlantings: 0 };
        for (const field of ["estimatedTco2e", "projectedLifetimeTco2e", "remainingProjectedTco2e", "plantedCount", "verifiedSurvivingCount", "assumedSurvivingCount", "provisionalSurvivingCount", "eligiblePlantings", "ineligiblePlantings", "provisionalPlantings", "plantingsAwaitingSurvivalVerification", "dataErrorPlantings"]) old[field] += row[field] || 0;
        bySpecies.set(key, old);
      }
    }
    const calculationTimestamp = now().toISOString();
    const summary = {
      service: "PIA Tree Carbon Impact",
      methodology: METHODOLOGY_VERSION,
      factorVersion: FACTOR_LIBRARY_VERSION,
      factorSource: FACTOR_SOURCE,
      calculationTimestamp,
      calculationDate: calculationTimestamp.slice(0, 10),
      organisationId: orgId,
      projectCount: projectResults.length,
      ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round(value)])),
      species: [...bySpecies.values()].sort((a, b) => a.species.localeCompare(b.species)),
      disclaimer: "Modelled estimate only. Not a verified carbon credit, measured carbon stock, or claim of permanent carbon removal.",
    };
    const inputFingerprint = projectResults.map((item) => item.calculationId).sort().join("|");
    const calculationId = `${summary.calculationDate}_${crypto.createHash("sha256").update(inputFingerprint).digest("hex").slice(0, 24)}`;
    summary.calculationId = calculationId;
    const snapshotRef = db.collection("organizations").doc(orgId).collection("piaTreeCarbonImpactCalculations").doc(calculationId);
    try {
      await snapshotRef.create({
        ...summary,
        inputs: { projectCalculationIds: projectResults.map((item) => item.calculationId) },
        outputs: { estimatedTco2e: summary.estimatedTco2e, projectedLifetimeTco2e: summary.projectedLifetimeTco2e, remainingProjectedTco2e: summary.remainingProjectedTco2e, bySpecies: summary.species },
      });
    } catch (error) {
      if (error.code !== 6 && error.code !== "already-exists") throw error;
    }
    return { summary, projects: projectResults };
  }

  return { calculateProject, calculateOrganisation };
}

module.exports = {
  FACTOR_LIBRARY_VERSION,
  CREDITING_PERIOD_YEARS,
  CREDITING_PERIOD_DAYS,
  FACTOR_SOURCE,
  FACTORS,
  FALLBACK,
  factorFor,
  createPiaTreeCarbonImpact,
};
