const SIX_MONTHS = 6;

function addUtcMonths(value, months = SIX_MONTHS) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

function createInAppProjectNotifications({ db, now = () => new Date() }) {
  const notifications = db.collection('partnerProjectNotifications');

  async function projectCreated({ projectId, project, orgId }) {
    const ref = notifications.doc(`project_created_${projectId}_${orgId}`);
    await ref.create({
      type: 'project_created',
      projectId,
      projectName: project.name,
      recipientOrgId: orgId,
      title: 'New project created',
      message: `${project.name} is ready to manage.`,
      status: 'unread',
      createdAt: now().toISOString(),
    }).catch((error) => {
      if (error.code !== 6 && error.code !== 'already-exists') throw error;
    });
  }

  async function materializeDueGrowthReminders(orgId) {
    const timestamp = now().toISOString();
    const dueTrees = await db.collectionGroup('trees')
      .where('orgId', '==', orgId)
      .where('growthReminderStatus', '==', 'scheduled')
      .where('growthReminderDueAt', '<=', timestamp)
      .orderBy('growthReminderDueAt', 'asc')
      .limit(100)
      .get();

    for (const treeDoc of dueTrees.docs) {
      const projectRef = treeDoc.ref.parent.parent;
      if (!projectRef) continue;
      const projectSnapshot = await projectRef.get();
      if (!projectSnapshot.exists) continue;
      const project = projectSnapshot.data();
      const dueAt = treeDoc.data().growthReminderDueAt;
      const notificationRef = notifications.doc(
        `tree_growth_${projectRef.id}_${treeDoc.id}_${String(dueAt).replace(/[^0-9]/g, '')}`,
      );

      await db.runTransaction(async (tx) => {
        const [current, existing] = await Promise.all([
          tx.get(treeDoc.ref),
          tx.get(notificationRef),
        ]);
        if (!current.exists || current.data().growthReminderStatus !== 'scheduled') return;
        if (Date.parse(current.data().growthReminderDueAt) > now().getTime()) return;
        if (!existing.exists) {
          tx.create(notificationRef, {
            type: 'tree_growth_due',
            projectId: projectRef.id,
            plantingId: treeDoc.id,
            projectName: project.name || 'Tree planting project',
            recipientOrgId: orgId,
            title: 'Six-month tree growth check due',
            message: `It’s time to photograph and review the growth of a planting in ${project.name || 'your project'}.`,
            status: 'unread',
            createdAt: now().toISOString(),
            dueAt: current.data().growthReminderDueAt,
          });
        }
        tx.update(treeDoc.ref, {
          growthReminderStatus: 'sent',
          growthReminderSentAt: now().toISOString(),
        });
      });
    }
  }

  return { projectCreated, materializeDueGrowthReminders };
}

module.exports = { addUtcMonths, createInAppProjectNotifications };
