const crypto = require("node:crypto");
const { geohashForLocation, geohashQueryBounds } = require("geofire-common");
const {
  fail,
  contextFor,
  assertProject,
  assertProjectBoundary,
  text,
  validDate,
} = require("./partner-project-policy");
const {
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
} = require("./planting-monitoring-policy");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
function createPlantingMonitoring({
  db,
  getBucket,
  logger = console,
  now = () => new Date(),
  assess = async () => ({ status: "not_configured" }),
}) {
  const projects = db.collection("partnerProjects"),
    cells = db.collection("partnerPlantingCells"),
    locations = db.collection("partnerPlantingLocations"),
    images = db.collection("partnerPlantingImages"),
    sessions = db.collection("partnerCaptureSessions");
  const stamp = () => now().toISOString();
  const locationId = (projectId, treeId) => `${projectId}_${treeId}`;
  async function actor(tx, context, projectRef, write = false, review = false) {
    const [user, project] = await Promise.all([
      tx.get(db.collection("partnerUsers").doc(context.uid)),
      tx.get(projectRef),
    ]);
    const c = contextFor(context.uid, user.exists ? user.data() : null);
    assertProject(c, project.exists ? project.data() : null, write);
    if (project.data().scope !== "plant_trees")
      fail(400, "Planting records belong to Plant Trees projects.");
    if (review && !canReview(c))
      fail(403, "An organisation reviewer is required.");
    return { context: c, project: project.data() };
  }
  async function validSession(tx, context, projectId, data, plantingId) {
    if (!data.captureSessionId) return { legacy: true };
    const ref = sessions.doc(id(data.captureSessionId)),
      doc = await tx.get(ref),
      s = doc.data();
    if (
      !doc.exists ||
      s.uid !== context.uid ||
      s.projectId !== projectId ||
      s.plantingId !== (plantingId || null) ||
      s.used ||
      Date.parse(s.expiresAt) <= now().getTime()
    )
      fail(
        409,
        "This capture session expired or was used. Start a new capture.",
      );
    if (
      Date.parse(data.capturedAt) < Date.parse(s.createdAt) - 30000 ||
      Date.parse(data.locationCapturedAt) < Date.parse(s.createdAt) - 30000
    )
      fail(
        400,
        "Take fresh photos and refresh GPS after starting the capture.",
      );
    return { ref, legacy: false };
  }
  function audit(tx, context, projectId, target, action, detail = {}) {
    tx.create(db.collection("partnerPlantingAudit").doc(), {
      actorUid: context.uid,
      orgId: context.orgId,
      projectId,
      target,
      action,
      detail,
      createdAt: stamp(),
    });
  }
  async function storePhotos(
    project,
    projectId,
    treeId,
    obsId,
    photos,
    commit,
    ref,
  ) {
    const paths = [];
    let committed = false;
    try {
      for (const photo of photos) {
        const path = `partner-projects/${project.orgId}/${projectId}/${treeId}/observations/${obsId}/${crypto.randomUUID()}`;
        paths.push(path);
        await getBucket()
          .file(path)
          .save(photo.buffer, {
            resumable: false,
            contentType: photo.contentType,
            metadata: { cacheControl: "private, max-age=0" },
          });
      }
      const result = await commit(paths);
      committed = result.created;
      if (!committed)
        for (const path of paths)
          await getBucket().file(path).delete({ ignoreNotFound: true });
      return result;
    } catch (error) {
      // A lost commit acknowledgement must not delete an image referenced by Firestore.
      if (paths.length) {
        try {
          const check = await ref.get();
          committed = check.exists && check.data().storagePath === paths[0];
        } catch (_) {
          logger.error("Planting photo requires reconciliation", { paths });
          throw error;
        }
      }
      if (!committed)
        for (const path of paths)
          await getBucket()
            .file(path)
            .delete({ ignoreNotFound: true })
            .catch(() => logger.error("Orphan planting photo", { path }));
      throw error;
    }
  }
  async function sign(data) {
    const result = publicRecord(data);
    if (data.storagePath)
      [result.photoUrl] = await getBucket()
        .file(data.storagePath)
        .getSignedUrl({
          action: "read",
          expires: now().getTime() + 15 * 60000,
        });
    if (data.contextStoragePath)
      [result.contextPhotoUrl] = await getBucket()
        .file(data.contextStoragePath)
        .getSignedUrl({
          action: "read",
          expires: now().getTime() + 15 * 60000,
        });
    return result;
  }
  async function checkedPhotoHashes(tx, photos) {
    const docs = await Promise.all(
      photos.map((p) => tx.get(images.doc(p.sha256))),
    );
    if (docs.some((d) => d.exists))
      fail(
        409,
        "A supplied photo has already been used. Take a new photo rather than registering the same evidence again.",
      );
    if (new Set(photos.map((p) => p.sha256)).size !== photos.length)
      fail(400, "Use different close-up and planting-context photos.");
  }
  function saveHashes(tx, photos, projectId, treeId, obsId) {
    for (const p of photos)
      tx.create(images.doc(p.sha256), {
        projectId,
        treeId,
        observationId: obsId,
        createdAt: stamp(),
      });
  }
  async function saveAssessment(
    context,
    projectId,
    treeId,
    obsId,
    photos,
    baseline,
  ) {
    let assessmentPhotos = photos.map((p) => ({
      buffer: p.buffer,
      contentType: p.contentType,
    }));
    if (baseline.previousStoragePath) {
      try {
        const [prior] = await getBucket()
          .file(baseline.previousStoragePath)
          .download();
        assessmentPhotos = [
          { buffer: prior, contentType: "image/jpeg", reference: true },
          ...assessmentPhotos,
        ];
      } catch (_) {
        baseline.previousImageUnavailable = true;
      }
    }
    let result;
    try {
      result = await assess({
        photos: assessmentPhotos,
        baseline,
        projectId,
        treeId,
        observationId: obsId,
      });
    } catch (_) {
      result = {
        status: "unavailable",
        reason: "AI assessment failed; manual review is required.",
      };
    }
    // AI is advisory: it can never write approval, growth measurements or planting coordinates.
    const allowed = ["not_configured", "unavailable", "completed"];
    if (!result || !allowed.includes(result.status))
      result = {
        status: "unavailable",
        reason: "Invalid AI response; manual review is required.",
      };
    const safe = {
      status: result.status,
      provider: result.provider || null,
      model: result.model || null,
      summary: String(result.summary || result.reason || "").slice(0, 1500),
      flags: Array.isArray(result.flags)
        ? result.flags.filter((v) => typeof v === "string").slice(0, 20)
        : [],
      speciesSuggestions: Array.isArray(result.speciesSuggestions)
        ? result.speciesSuggestions.slice(0, 5)
        : [],
      familySuggestions: Array.isArray(result.familySuggestions)
        ? result.familySuggestions.filter((v) => typeof v === "string").slice(0, 5)
        : [],
      visiblePlant:
        typeof result.visiblePlant === "boolean" ? result.visiblePlant : null,
      likelyStage:
        typeof result.likelyStage === "string" ? result.likelyStage : null,
      imageQuality:
        typeof result.imageQuality === "string" ? result.imageQuality : null,
      assessedAt: stamp(),
    };
    const treeRef = projects.doc(projectId).collection("trees").doc(treeId);
    await Promise.all([
      treeRef.collection("observations").doc(obsId).set(
        { aiAssessment: safe },
        { merge: true },
      ),
      treeRef.set(
        { aiAssessment: safe, updatedAt: safe.assessedAt },
        { merge: true },
      ),
    ]);
    return safe;
  }
  return {
    async beginCapture(context, projectId, body = {}) {
      const projectRef = projects.doc(id(projectId)),
        plantingId = body.plantingId == null ? null : id(body.plantingId),
        ref = sessions.doc();
      return db.runTransaction(async (tx) => {
        await actor(tx, context, projectRef, true);
        if (plantingId) {
          const tree = await tx.get(
            projectRef.collection("trees").doc(plantingId),
          );
          if (!tree.exists) fail(404, "Planting not found.");
        }
        const data = {
          uid: context.uid,
          projectId,
          plantingId,
          createdAt: stamp(),
          expiresAt: new Date(now().getTime() + 15 * 60000).toISOString(),
          used: false,
        };
        tx.create(ref, data);
        return { id: ref.id, expiresAt: data.expiresAt };
      });
    },
    async baseline(context, projectId, input, primary, contextPhoto) {
      const projectRef = projects.doc(id(projectId)),
        legacy = input.monitoringVersion !== 2;
      const data = captureMetadata(input, {
        baseline: true,
        legacy,
        now: now().getTime(),
      });
      const ref = projectRef.collection("trees").doc(data.recordId),
        obsRef = ref.collection("observations").doc("baseline");
      const photos = [
        await inspectPhoto(primary),
        ...(contextPhoto ? [await inspectPhoto(contextPhoto)] : []),
      ];
      if (!legacy && photos.length < 2)
        fail(400, "Add both a close-up and a wider planting-context photo.");
      const fingerprint = sha(
        JSON.stringify(data) + photos.map((p) => p.sha256).join(":"),
      );
      const initial = await projectRef.get();
      assertProject(context, initial.exists ? initial.data() : null, true);
      assertProjectBoundary(initial.data(), data);
      if (initial.data().scope !== "plant_trees")
        fail(400, "Choose a Plant Trees project.");
      const cell = spatialCells(data),
        pointId = locationId(projectId, ref.id);
      const result = await storePhotos(
        initial.data(),
        projectId,
        ref.id,
        "baseline",
        photos,
        async (paths) =>
          db.runTransaction(async (tx) => {
            const { project } = await actor(tx, context, projectRef, true),
              existing = await tx.get(ref);
            assertProjectBoundary(project, data);
            if (existing.exists) {
              if (
                existing.data().createdByUid !== context.uid ||
                existing.data().fingerprint !== fingerprint
              )
                fail(409, "This record ID already has different evidence.");
              return { id: ref.id, created: false, saved: true };
            }
            const session = await validSession(
              tx,
              context,
              projectId,
              data,
              null,
            );
            if (data.eventId) {
              const event = await tx.get(
                projectRef.collection("events").doc(data.eventId),
              );
              if (!event.exists)
                fail(
                  400,
                  "The selected event does not belong to this project.",
                );
            }
            const neighbours = await Promise.all(
              cell.keys.map((key) => tx.get(cells.doc(key))),
            );
            const nearby = neighbours.flatMap((d) => d.data()?.points || []);
            if (nearby.some((p) => distance(data, p) <= 5))
              fail(
                409,
                "A planting is already registered within five metres. Open the existing record and add a growth observation.",
              );
            await checkedPhotoHashes(tx, photos);
            const centre =
              neighbours.find((d) => d.id === cell.centre)?.data()?.points ||
              [];
            if (centre.length >= 200)
              fail(
                409,
                "This location needs index reconciliation before another registration.",
              );
            const flags = [];
            if (session.legacy) flags.push("legacy_capture_without_session");
            if (photos.length < 2) flags.push("missing_planting_context");
            if (data.photoSource !== "camera")
              flags.push("gallery_capture_unverified");
            if (data.accuracyMeters > 5)
              flags.push("gps_accuracy_exceeds_spacing");
            if (
              nearby.some(
                (p) =>
                  distance(data, p) -
                    data.accuracyMeters -
                    (p.accuracyMeters || 0) <=
                  5,
              )
            )
              flags.push("spacing_uncertain_due_to_gps");
            if (
              nearby.some((p) =>
                similar(photos[0].perceptualHash, p.perceptualHash),
              )
            )
              flags.push("visually_similar_nearby_photo");
            const point = {
              projectId,
              treeId: ref.id,
              orgId: project.orgId,
              latitude: data.latitude,
              longitude: data.longitude,
              accuracyMeters: data.accuracyMeters,
              perceptualHash: photos[0].perceptualHash,
            };
            const createdAt = stamp();
            const root = {
              ...data,
              monitoringVersion: 2,
              orgId: project.orgId,
              departmentId: project.departmentId || null,
              projectId,
              createdByUid: context.uid,
              createdAt,
              updatedAt: createdAt,
              storagePath: paths[0],
              contextStoragePath: paths[1] || null,
              fingerprint,
              perceptualHash: photos[0].perceptualHash,
              verificationStatus: "submitted",
              latestReviewStatus: "pending",
              evidenceState:
                data.kind === "seed_spot"
                  ? "awaiting_germination"
                  : "awaiting_review",
              latestObservationAt: data.capturedAt,
              observationCount: 1,
              nextCheckDueAt: dueAt(data.capturedAt, data.intervalDays),
              revision: 1,
              flags,
            };
            const obs = {
              ...data,
              observationType: "baseline",
              createdAt,
              createdByUid: context.uid,
              storagePath: paths[0],
              contextStoragePath: paths[1] || null,
              fingerprint,
              imageHashes: photos.map((p) => p.sha256),
              perceptualHash: photos[0].perceptualHash,
              flags,
              reviewStatus: "pending",
              revision: 1,
              aiAssessment: { status: "not_configured" },
            };
            tx.create(ref, root);
            tx.create(obsRef, obs);
            tx.set(cells.doc(cell.centre), {
              points: [...centre, point],
              updatedAt: createdAt,
            });
            tx.create(locations.doc(pointId), {
              ...point,
              geohash: geohashForLocation([data.latitude, data.longitude]),
              createdAt,
            });
            saveHashes(tx, photos, projectId, ref.id, "baseline");
            if (session.ref)
              tx.update(session.ref, {
                used: true,
                usedAt: createdAt,
                recordId: ref.id,
              });
            audit(tx, context, projectId, ref.id, "planting.created", {
              kind: data.kind,
              flags,
            });
            return { id: ref.id, created: true, saved: true, flags };
          }),
        ref,
      );
      if (result.created)
        result.aiAssessment = await saveAssessment(
          context,
          projectId,
          ref.id,
          "baseline",
          photos,
          { kind: data.kind, stage: data.stage, species: data.species },
        );
      return result;
    },
    async detail(context, projectId, treeId) {
      const projectRef = projects.doc(id(projectId)),
        p = await projectRef.get();
      assertProject(context, p.exists ? p.data() : null);
      const ref = projectRef.collection("trees").doc(id(treeId)),
        tree = await ref.get();
      if (!tree.exists) fail(404, "Planting not found.");
      const docs = await ref.collection("observations").limit(500).get();
      const observations = await Promise.all(
        docs.docs.map(async (d) => ({
          id: d.id,
          ...(await sign(d.data())),
          canReview:
            canReview(context) && d.data().createdByUid !== context.uid,
        })),
      );
      if (!observations.length)
        observations.push({
          id: "legacy-baseline",
          ...(await sign(tree.data())),
          observationType: "baseline",
          reviewStatus: "legacy_unreviewed",
          canReview: false,
        });
      observations.sort((a, b) =>
        String(a.capturedAt).localeCompare(String(b.capturedAt)),
      );
      const measured = observations.filter(
        (o) =>
          o.reviewStatus === "approved" &&
          o.heightCm != null &&
          ["ruler", "tape"].includes(o.measurementMethod) &&
          o.scaleReferenceVisible,
      );
      const growth =
        measured.length >= 2
          ? {
              heightChangeCm: measured.at(-1).heightCm - measured[0].heightCm,
              from: measured[0].capturedAt,
              to: measured.at(-1).capturedAt,
              basis: "reviewed_user_measurements",
            }
          : null;
      return {
        planting: { id: tree.id, ...(await sign(tree.data())) },
        observations,
        growth,
        overdue:
          Date.parse(
            tree.data().nextCheckDueAt || dueAt(tree.data().capturedAt, 30),
          ) < now().getTime(),
        canObserve: context.canWrite && (!context.collaborations?.[p.data().orgId] || (context.providerCanWrite && context.collaborations[p.data().orgId] === 'write')),
        canReview: canReview(context) && (!context.collaborations?.[p.data().orgId] || (context.providerCanWrite && context.collaborations[p.data().orgId] === 'write')),
        aiConfigured:
          (process.env.PLANTING_AI_ENABLED === "true" &&
            !!process.env.GEMINI_API_KEY) ||
          !!process.env.PLANTNET_API_KEY,
      };
    },
    async observe(context, projectId, treeId, input, primary, contextPhoto) {
      const projectRef = projects.doc(id(projectId)),
        ref = projectRef.collection("trees").doc(id(treeId)),
        initial = await ref.get();
      if (!initial.exists) fail(404, "Planting not found.");
      const data = captureMetadata(input, {
          tree: initial.data(),
          now: now().getTime(),
        }),
        obsRef = ref.collection("observations").doc(data.recordId),
        photos = [
          await inspectPhoto(primary),
          ...(contextPhoto ? [await inspectPhoto(contextPhoto)] : []),
        ];
      const fingerprint = sha(
        JSON.stringify(data) + photos.map((p) => p.sha256).join(":"),
      );
      const p = await projectRef.get();
      assertProject(context, p.exists ? p.data() : null, true);
      assertProjectBoundary(p.data(), data);
      const result = await storePhotos(
        p.data(),
        projectId,
        ref.id,
        obsRef.id,
        photos,
        async (paths) =>
          db.runTransaction(async (tx) => {
            const { project } = await actor(tx, context, projectRef, true);
            assertProjectBoundary(project, data);
            const [current, existing] = await Promise.all([
              tx.get(ref),
              tx.get(obsRef),
            ]);
            if (!current.exists) fail(404, "Planting not found.");
            if (existing.exists) {
              if (
                existing.data().createdByUid !== context.uid ||
                existing.data().fingerprint !== fingerprint
              )
                fail(
                  409,
                  "This observation ID already has different evidence.",
                );
              return { id: obsRef.id, created: false, saved: true };
            }
            const session = await validSession(
                tx,
                context,
                projectId,
                data,
                ref.id,
              ),
              tree = current.data();
            if (
              Date.parse(data.capturedAt) <=
              Date.parse(tree.latestObservationAt || tree.capturedAt)
            )
              fail(
                409,
                "A growth observation must be newer than the existing photos.",
              );
            const displacement = distance(data, tree);
            if (displacement > 25)
              fail(
                409,
                "Move to the registered planting location before adding ground evidence.",
              );
            await checkedPhotoHashes(tx, photos);
            const flags = [];
            if (data.photoSource !== "camera")
              flags.push("gallery_capture_unverified");
            if (displacement > 5 || data.accuracyMeters > 5)
              flags.push("location_match_uncertain");
            if (similar(photos[0].perceptualHash, tree.perceptualHash))
              flags.push("visually_similar_previous_photo");
            if (data.heightCm != null && data.measurementMethod === "estimated")
              flags.push("height_is_estimated");
            const createdAt = stamp();
            tx.create(obsRef, {
              ...data,
              observationType: "follow_up",
              createdByUid: context.uid,
              createdAt,
              storagePath: paths[0],
              contextStoragePath: paths[1] || null,
              fingerprint,
              imageHashes: photos.map((p) => p.sha256),
              perceptualHash: photos[0].perceptualHash,
              flags,
              reviewStatus: "pending",
              revision: 1,
              aiAssessment: { status: "not_configured" },
            });
            tx.update(ref, {
              latestObservationAt: data.capturedAt,
              updatedAt: createdAt,
              latestReviewStatus: "pending",
              observationCount: (tree.observationCount || 1) + 1,
              revision: (tree.revision || 1) + 1,
            });
            saveHashes(tx, photos, projectId, ref.id, obsRef.id);
            tx.update(session.ref, {
              used: true,
              usedAt: createdAt,
              recordId: obsRef.id,
            });
            audit(tx, context, projectId, obsRef.id, "observation.created", {
              treeId: ref.id,
              flags,
            });
            return { id: obsRef.id, created: true, saved: true, flags };
          }),
        obsRef,
      );
      if (result.created)
        result.aiAssessment = await saveAssessment(
          context,
          projectId,
          ref.id,
          obsRef.id,
          photos,
          {
            kind: initial.data().kind || "tree",
            stage: initial.data().stage || "tree",
            species: initial.data().species,
            previousStoragePath: initial.data().storagePath,
          },
        );
      return result;
    },
    async review(context, projectId, treeId, obsId, body) {
      if (!["approved", "rejected", "more_evidence"].includes(body.decision))
        fail(400, "Choose approve, reject or request more evidence.");
      if (!Number.isInteger(body.version) || body.version < 1)
        fail(400, "An observation version is required.");
      const note = body.note ? text(body.note, "Review note", 1500) : "";
      const projectRef = projects.doc(id(projectId)),
        ref = projectRef.collection("trees").doc(id(treeId)),
        obsRef = ref.collection("observations").doc(id(obsId));
      return db.runTransaction(async (tx) => {
        await actor(tx, context, projectRef, true, true);
        const [tree, obs] = await Promise.all([tx.get(ref), tx.get(obsRef)]);
        if (!tree.exists || !obs.exists) fail(404, "Observation not found.");
        const old = obs.data();
        if (old.createdByUid === context.uid)
          fail(403, "Another organisation reviewer must assess your evidence.");
        if (old.revision !== body.version)
          fail(409, "This observation changed. Refresh before reviewing.");
        if (old.reviewStatus !== "pending")
          fail(409, "This observation has already been reviewed.");
        if (
          (body.decision !== "approved" ||
            old.flags?.length ||
            old.aiAssessment?.flags?.length) &&
          !note
        )
          fail(
            400,
            "Add a note explaining the review decision and any flagged evidence.",
          );
        const reviewedAt = stamp();
        tx.update(obsRef, {
          reviewStatus: body.decision,
          reviewNote: note,
          reviewedBy: context.uid,
          reviewedAt,
          revision: old.revision + 1,
        });
        tx.update(ref, {
          updatedAt: reviewedAt,
          latestReviewStatus: body.decision,
        });
        const last = tree.data().lastApprovedObservationAt;
        if (
          body.decision === "approved" &&
          (!last || Date.parse(old.capturedAt) > Date.parse(last))
        ) {
          const evidenceState =
            tree.data().kind === "seed_spot" &&
            ["sown", "not_germinated"].includes(old.stage)
              ? "awaiting_germination"
              : old.observationType === "baseline"
                ? "planting_evidence_reviewed"
                : "growth_evidence_reviewed";
          tx.update(ref, {
            lastApprovedObservationAt: old.capturedAt,
            reviewedStage: old.stage,
            evidenceState,
            verificationStatus:
              old.observationType === "baseline"
                ? "verified"
                : "growth_verified",
            nextCheckDueAt: dueAt(
              old.capturedAt,
              tree.data().intervalDays || 30,
            ),
            revision: (tree.data().revision || 1) + 1,
          });
        }
        tx.create(obsRef.collection("reviews").doc(), {
          decision: body.decision,
          note,
          reviewedBy: context.uid,
          reviewedAt,
        });
        audit(tx, context, projectId, obsId, "observation.reviewed", {
          treeId,
          decision: body.decision,
          note,
        });
        return { success: true, reviewStatus: body.decision };
      });
    },
    async schedule(context, projectId, treeId, body) {
      number(body.intervalDays, "monitoring interval", 1, 365);
      if (
        !Number.isInteger(body.intervalDays) ||
        !Number.isInteger(body.version)
      )
        fail(400, "Use whole days and a current version.");
      const projectRef = projects.doc(id(projectId)),
        ref = projectRef.collection("trees").doc(id(treeId));
      return db.runTransaction(async (tx) => {
        await actor(tx, context, projectRef, true);
        const doc = await tx.get(ref);
        if (!doc.exists) fail(404, "Planting not found.");
        const d = doc.data();
        if (d.createdByUid !== context.uid && !canReview(context))
          fail(
            403,
            "Only the recorder or an organisation reviewer can change the schedule.",
          );
        if ((d.revision || 1) !== body.version)
          fail(409, "This planting changed. Refresh first.");
        tx.update(ref, {
          intervalDays: body.intervalDays,
          nextCheckDueAt: dueAt(
            d.lastApprovedObservationAt || d.capturedAt,
            body.intervalDays,
          ),
          revision: (d.revision || 1) + 1,
        });
        audit(tx, context, projectId, treeId, "planting.schedule.updated", {
          intervalDays: body.intervalDays,
        });
        return { success: true };
      });
    },
    async nearby(context, projectId, query) {
      const p = await projects.doc(id(projectId)).get();
      assertProject(context, p.exists ? p.data() : null);
      const point = {
          latitude: number(Number(query.latitude), "latitude", -90, 90),
          longitude: number(Number(query.longitude), "longitude", -180, 180),
        },
        radius = number(
          Number(query.radiusMeters || 100),
          "search radius",
          1,
          1000,
        );
      const bounds = geohashQueryBounds(
          [point.latitude, point.longitude],
          radius,
        ),
        docs = await Promise.all(
          bounds.map(([start, end]) =>
            locations
              .orderBy("geohash")
              .startAt(start)
              .endAt(end)
              .limit(501)
              .get(),
          ),
        );
      if (docs.some((s) => s.docs.length > 500))
        fail(422, "Too many locations in this area. Narrow the search radius.");
      const unique = new Map();
      for (const s of docs)
        for (const d of s.docs) {
          const value = d.data();
          if (
            value.projectId === projectId &&
            value.orgId === p.data().orgId &&
            distance(point, value) <= radius
          )
            unique.set(value.treeId, {
              id: value.treeId,
              distanceMeters: Math.round(distance(point, value)),
              latitude: value.latitude,
              longitude: value.longitude,
            });
        }
      return {
        plantings: [...unique.values()].sort(
          (a, b) => a.distanceMeters - b.distanceMeters,
        ),
        radiusMeters: radius,
      };
    },
    async remote(context, projectId, body, photo) {
      const projectRef = projects.doc(id(projectId));
      id(body.recordId);
      if (!["satellite", "drone", "fixed_camera"].includes(body.source))
        fail(400, "Choose satellite, drone or fixed-camera imagery.");
      const capturedAt = validDate(body.capturedAt, "Source capture time");
      if (Date.parse(capturedAt) > now().getTime() + 5 * 60000)
        fail(400, "Source images cannot be dated in the future.");
      const bbox = body.bbox;
      if (!Array.isArray(bbox) || bbox.length !== 4)
        fail(400, "Supply a geographic footprint [west, south, east, north].");
      number(bbox[0], "west longitude", -180, 180);
      number(bbox[2], "east longitude", -180, 180);
      number(bbox[1], "south latitude", -90, 90);
      number(bbox[3], "north latitude", -90, 90);
      if (bbox[0] === bbox[2] || bbox[1] >= bbox[3])
        fail(400, "Use a valid image footprint.");
      const resolutionMeters =
        body.resolutionMeters == null
          ? null
          : number(body.resolutionMeters, "image resolution", 0.001, 1000);
      if (body.source === "satellite" && resolutionMeters == null)
        fail(400, "Satellite imagery must include its source resolution.");
      const sourceName = text(
          body.sourceName,
          "Image provider or camera name",
          150,
        ),
        notes = body.notes ? text(body.notes, "Notes", 1500) : "";
      const inspected = await inspectPhoto(photo),
        ref = projectRef.collection("remoteEvidence").doc(body.recordId),
        p = await projectRef.get();
      assertProject(context, p.exists ? p.data() : null, true);
      const fingerprint = sha(
        JSON.stringify({
          source: body.source,
          capturedAt,
          bbox,
          resolutionMeters,
          sourceName,
          notes,
        }) + inspected.sha256,
      );
      return storePhotos(
        p.data(),
        projectId,
        "remote",
        ref.id,
        [inspected],
        async (paths) =>
          db.runTransaction(async (tx) => {
            await actor(tx, context, projectRef, true);
            const old = await tx.get(ref);
            if (old.exists) {
              if (
                old.data().createdByUid !== context.uid ||
                old.data().fingerprint !== fingerprint
              )
                fail(409, "This remote record has different evidence.");
              return { id: ref.id, created: false, saved: true };
            }
            await checkedPhotoHashes(tx, [inspected]);
            tx.create(ref, {
              source: body.source,
              sourceName,
              capturedAt,
              bbox,
              resolutionMeters,
              notes,
              storagePath: paths[0],
              fingerprint,
              createdByUid: context.uid,
              createdAt: stamp(),
              evidenceLevel: "site_context_only",
              provenance: "uploader_reported",
              reviewStatus: "not_individual_plant_verification",
            });
            saveHashes(tx, [inspected], projectId, "remote", ref.id);
            audit(tx, context, projectId, ref.id, "remote.imagery.uploaded", {
              source: body.source,
            });
            return { id: ref.id, created: true, saved: true };
          }),
        ref,
      );
    },
    async remoteList(context, projectId) {
      const projectRef = projects.doc(id(projectId)),
        p = await projectRef.get();
      assertProject(context, p.exists ? p.data() : null);
      const docs = await projectRef
        .collection("remoteEvidence")
        .limit(500)
        .get();
      return {
        imagery: await Promise.all(
          docs.docs.map(async (d) => ({ id: d.id, ...(await sign(d.data())) })),
        ),
        note: "Site imagery provides context; it does not verify individual seed or sapling growth.",
      };
    },
  };
}
module.exports = { createPlantingMonitoring };
