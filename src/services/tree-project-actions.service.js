const crypto = require('node:crypto');

const SITE_ACTIONS = [
  ['weed-removal', 'Weed or invasive species removal'],
  ['land-preparation', 'Land levelling or tilling'],
  ['pit-digging', 'Pit digging'],
  ['soil-amendment', 'Soil amendment'],
  ['fencing', 'Fencing or protection'],
  ['irrigation', 'Irrigation setup'],
];

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

function createTreeProjectActions({ db, getBucket }) {
  const catalog = new Map(SITE_ACTIONS.map(([id, name]) => [id, name]));

  async function list(projectRef) {
    const snapshot = await projectRef.collection('treeSiteActions').get();
    const stored = new Map(snapshot.docs.map(doc => [doc.id, { id: doc.id, ...doc.data() }]));
    const definitions = [
      ...SITE_ACTIONS.map(([id, name]) => ({ id, name })),
      ...[...stored.values()]
        .filter(item => item.custom === true && !catalog.has(item.id))
        .map(item => ({ id: item.id, name: item.name })),
    ];
    const actions = await Promise.all(definitions.map(async ({ id, name }) => {
      const current = stored.get(id) || {};
      const evidenceSnapshot = await projectRef.collection('treeSiteActions').doc(id).collection('evidence').orderBy('createdAt', 'desc').limit(100).get();
      const evidence = await Promise.all(evidenceSnapshot.docs.map(async doc => {
        const { storagePath, ...item } = doc.data();
        const [url] = await getBucket().file(storagePath).getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1000 });
        return { id: doc.id, ...item, url };
      }));
      return { id, name, status: current.status || 'not_started', evidence };
    }));
    return { actions };
  }

  async function create(projectRef, rawName, uid) {
    if (typeof rawName !== 'string' || !rawName.trim() || rawName.trim().length > 120) {
      const error = new Error('Enter an action name of up to 120 characters.');
      error.status = 400;
      throw error;
    }
    const name = rawName.trim();
    const current = await projectRef.collection('treeSiteActions').get();
    if (current.docs.some(doc => doc.data().name?.toLowerCase() === name.toLowerCase())) {
      const error = new Error('This site preparation action is already listed.');
      error.status = 409;
      throw error;
    }
    const customCount = current.docs.filter(doc => doc.data().custom === true).length;
    if (customCount >= 50) {
      const error = new Error('This project has reached its custom action limit.');
      error.status = 400;
      throw error;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const action = { name, status: 'not_started', custom: true, createdAt: now, createdByUid: uid, updatedAt: now, updatedByUid: uid };
    await db.runTransaction(async tx => {
      tx.create(projectRef.collection('treeSiteActions').doc(id), action);
      tx.create(projectRef.collection('activity').doc(), {
        type: 'tree_site_action_created', actionId: id, actionName: name,
        createdByUid: uid, createdAt: now,
      });
    });
    return { id, ...action, evidence: [] };
  }

  async function actionName(projectRef, actionId) {
    const fixedName = catalog.get(actionId);
    if (fixedName) return fixedName;
    const ref = projectRef.collection('treeSiteActions').doc(actionId);
    const snapshot = await ref.get();
    if (snapshot.exists && snapshot.data().custom === true) return snapshot.data().name;
    const error = new Error('Choose a supported planting-site action.');
    error.status = 400;
    throw error;
  }

  async function update(projectRef, actionId, body, uid) {
    const name = await actionName(projectRef, actionId);
    const status = body.status;
    if (!['not_started', 'in_progress', 'completed'].includes(status)) {
      const error = new Error('Choose Not started, In progress or Completed.');
      error.status = 400;
      throw error;
    }
    const ref = projectRef.collection('treeSiteActions').doc(actionId);
    const now = new Date().toISOString();
    await db.runTransaction(async tx => {
      tx.set(ref, { name, status, updatedAt: now, updatedByUid: uid }, { merge: true });
      tx.create(projectRef.collection('activity').doc(), {
        type: 'tree_site_action_status_updated', actionId, actionName: name,
        status, createdByUid: uid, createdAt: now,
      });
    });
    return { id: actionId, name, status, updatedAt: now };
  }

  async function addEvidence(projectRef, orgId, actionId, uid, file, body) {
    const name = await actionName(projectRef, actionId);
    if (!file?.buffer) {
      const error = new Error('Choose an image or PDF to upload.');
      error.status = 400;
      throw error;
    }
    const stage = body.stage;
    if (!['baseline', 'in_progress', 'after_work'].includes(stage)) {
      const error = new Error('Choose a verification stage.');
      error.status = 400;
      throw error;
    }
    const mimeType = file.mimetype;
    const isPdf = mimeType === 'application/pdf' && file.buffer.subarray(0, 5).toString() === '%PDF-';
    const detectedImageType = detectImageType(file.buffer);
    const isImage = detectedImageType != null && detectedImageType === mimeType;
    if (!isPdf && !isImage) {
      const error = new Error('Upload a JPEG, PNG, WebP image or PDF document.');
      error.status = 400;
      throw error;
    }
    if (file.size > (isPdf ? 15 : 8) * 1024 * 1024) {
      const error = new Error(isPdf ? 'Choose a document smaller than 15 MB.' : 'Choose an image smaller than 8 MB.');
      error.status = 400;
      throw error;
    }
    const safeExtension = isPdf ? 'pdf' : mimeType.split('/')[1].replace('jpeg', 'jpg');
    const evidenceId = crypto.randomUUID();
    const storagePath = `partner-projects/${orgId}/${projectRef.id}/site-actions/${actionId}/${evidenceId}.${safeExtension}`;
    const storageFile = getBucket().file(storagePath);
    await storageFile.save(file.buffer, { resumable: false, contentType: mimeType, metadata: { cacheControl: 'private, max-age=0' } });
    const now = new Date().toISOString();
    const evidence = {
      projectId: projectRef.id,
      actionId,
      actionName: name,
      stage,
      caption: typeof body.caption === 'string' ? body.caption.trim().slice(0, 500) : '',
      fileName: typeof file.originalname === 'string' ? file.originalname.replace(/[\\/\0-\x1f]/g, '').slice(0, 180) : `evidence.${safeExtension}`,
      contentType: mimeType,
      storagePath,
      createdByUid: uid,
      createdAt: now,
    };
    try {
      await db.runTransaction(async tx => {
        tx.create(projectRef.collection('treeSiteActions').doc(actionId).collection('evidence').doc(evidenceId), evidence);
        tx.set(projectRef.collection('treeSiteActions').doc(actionId), { name, status: 'in_progress', updatedAt: now, updatedByUid: uid }, { merge: true });
        tx.create(projectRef.collection('activity').doc(), { type: 'tree_site_evidence_added', actionId, actionName: name, stage, createdByUid: uid, createdAt: now });
      });
    } catch (error) {
      await storageFile.delete({ ignoreNotFound: true }).catch(() => {});
      throw error;
    }
    const [url] = await storageFile.getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1000 });
    const { storagePath: _privatePath, ...publicEvidence } = evidence;
    return { evidence: { id: evidenceId, ...publicEvidence, url } };
  }

  return { list, create, update, addEvidence };
}

module.exports = { createTreeProjectActions, SITE_ACTIONS };
