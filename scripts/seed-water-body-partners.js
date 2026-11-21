// Seed the initial water-body partner directory in the partner Firebase project.
// Usage: require a partner Firebase service account and set PARTNER_FIREBASE_PROJECT_ID.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.stage') });
const admin = require('firebase-admin');

const projectId = process.env.PARTNER_FIREBASE_PROJECT_ID;
if (!projectId || projectId !== 'puviyan-partner-stage') {
  throw new Error('This seed script is staging-only and requires PARTNER_FIREBASE_PROJECT_ID=puviyan-partner-stage.');
}
const serviceAccountPath = process.env.PARTNER_FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) throw new Error('PARTNER_FIREBASE_SERVICE_ACCOUNT_PATH is required.');
const serviceAccount = require(path.resolve(__dirname, '..', serviceAccountPath));
if (serviceAccount.project_id !== projectId) throw new Error('Partner service account project does not match staging.');

const app = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId,
}, 'water-body-directory-seed');
const db = app.firestore();

const partners = [
  {
    id: 'exnora-international-foundation',
    name: 'ExNoRa International Foundation',
    partnerType: 'implementation',
    partnerTypes: ['implementation'],
    access: 'write',
    status: 'active',
  },
  {
    id: 'government-of-tamil-nadu',
    name: 'Government of Tamil Nadu',
    partnerType: 'supporting',
    partnerTypes: ['supporting'],
    access: 'read_only',
    status: 'active',
  },
  {
    id: 'puviyan-digital-solutions-private-limited',
    name: 'Puviyan Digital Solutions Private Limited',
    partnerType: 'managed_service',
    partnerTypes: ['managed_service'],
    accountType: 'sustainability_service_provider',
    access: 'write',
    status: 'active',
  },
];

(async () => {
  const managedServiceOrg = await db.collection('organizations')
    .where('name', '==', 'Puviyan Digital Solutions Private Limited')
    .limit(1)
    .get();
  const managedServiceOrgId = managedServiceOrg.docs[0]?.id;
  const batch = db.batch();
  for (const partner of partners) {
    const { id, ...data } = partner;
    batch.set(db.collection('partnerDirectory').doc(id), {
      ...data,
      ...(id === 'puviyan-digital-solutions-private-limited' && managedServiceOrgId
        ? { orgId: managedServiceOrgId }
        : {}),
      updatedAt: new Date().toISOString(),
      seededBy: 'water-body-rejuvenation-v1',
    }, { merge: true });
  }
  await batch.commit();
  console.log(`Seeded ${partners.length} partner records into ${projectId}. Puviyan service-provider org ${managedServiceOrgId ? 'was linked' : 'was not found; no Firebase account was created'}. Assurance partner records are intentionally empty until supplied.`);
  await app.delete();
})().catch(async (error) => {
  console.error(error.message);
  await app.delete();
  process.exit(1);
});
