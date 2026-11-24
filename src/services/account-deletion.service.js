const { fail } = require('./partner-project-policy');
const { getPartnerTreeBucket } = require('./partner-tree-storage.service');

function createAccountDeletion({ db, auth, getBucket = getPartnerTreeBucket, now = () => new Date(), logger = console } = {}) {
  const uidCollections = ['partnerUsers', 'partnerV2Users', 'partner_users'];
  const time = () => now().toISOString();

  async function deleteMatching(collection, field, value) {
    if (!value) return;
    const ref = db.collection(collection);
    while (true) {
      const snapshot = await ref.where(field, '==', value).limit(400).get();
      if (snapshot.empty) return;
      const batch = db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      if (snapshot.size < 400) return;
    }
  }

  async function deleteProjects(orgId) {
    let last = null;
    let count = 0;
    while (true) {
      let query = db.collection('partnerProjects')
        .where('orgId', '==', orgId)
        .orderBy('__name__')
        .limit(100);
      if (last) query = query.startAfter(last);
      const snapshot = await query.get();
      if (snapshot.empty) return count;

      // Resolve storage before deleting any records so a missing bucket cannot
      // leave an account half-deleted with orphaned planting images.
      const bucket = getBucket();
      for (const project of snapshot.docs) {
        const prefix = `partner-projects/${orgId}/${project.id}/`;
        await bucket.deleteFiles({ prefix, force: true });
        await deleteMatching('partnerPlantingLocations', 'projectId', project.id);
        await deleteMatching('partnerProjectNotifications', 'projectId', project.id);
        await db.recursiveDelete(project.ref);
        count += 1;
      }
      last = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.size < 100) return count;
    }
  }

  async function deleteAccount(identity, confirmation) {
    if (!identity?.uid) fail(401, 'Please sign in to continue.');
    if (confirmation !== 'DELETE') fail(400, 'Type DELETE to confirm permanent account deletion.');
    const authTime = Number(identity.authTime || 0);
    if (!authTime || now().getTime() / 1000 - authTime > 10 * 60) {
      fail(401, 'For your security, sign in again before deleting your account.');
    }

    const uid = identity.uid;
    const [v2, partner, legacy] = await Promise.all(
      uidCollections.map((name) => db.collection(name).doc(uid).get()),
    );
    const member = v2.exists ? v2 : partner;
    const memberData = member.exists ? member.data() : (legacy.exists ? legacy.data() : {});
    const orgId = typeof memberData.orgId === 'string' ? memberData.orgId : null;
    const orgRef = orgId ? db.collection('organizations').doc(orgId) : null;
    const org = orgRef ? await orgRef.get() : null;
    const organizationOwner = Boolean(org?.exists && (
      (org.data().ownerUids || []).includes(uid) ||
      (org.data().status === 'deleting' && org.data().deletedByUid === uid)
    ));
    let deletedProjects = 0;

    if (organizationOwner) {
      await orgRef.set({ status: 'deleting', deletedByUid: uid, updatedAt: time() }, { merge: true });
      deletedProjects = await deleteProjects(orgId);
      const deletedAt = time();
      await orgRef.set({
        status: 'deleted',
        ownerUids: [],
        deletedByUid: null,
        deletedAt,
        updatedAt: deletedAt,
      }, { merge: true });
      await Promise.all([
        deleteMatching('partnerV2Invitations', 'orgId', orgId),
        deleteMatching('partnerV2InvitationKeys', 'orgId', orgId),
        deleteMatching('partnerV2Collaborators', 'actionOwnerOrgId', orgId),
        deleteMatching('partnerV2Collaborators', 'providerOrgId', orgId),
        deleteMatching('partnerProjectNotifications', 'recipientOrgId', orgId),
      ]);
    }

    // Firebase Auth is shared with the partner portal. Removing this UID also
    // removes that login; other team members' Firebase identities are retained.
    for (const collection of uidCollections) {
      await db.collection(collection).doc(uid).delete().catch((error) => {
        if (error.code !== 5 && error.code !== 'not-found') throw error;
      });
    }
    try {
      await auth.deleteUser(uid);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') {
        logger.error?.('Firebase account deletion failed after data cleanup', { uid, code: error.code });
        throw error;
      }
    }
    return { deleted: true, organizationDeleted: organizationOwner, deletedProjects };
  }

  return { deleteAccount };
}

module.exports = { createAccountDeletion };
