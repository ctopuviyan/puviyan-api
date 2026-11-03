const { admin } = require('../config/firebase.config');

// Existing upload endpoints publish reward images. Tree photos require a private bucket.
// Resolve only on a photo operation so missing photo setup cannot break existing API startup.
function getPartnerTreeBucket() {
  const name = process.env.PARTNER_TREE_PHOTO_BUCKET;
  if (!name) {
    const error = new Error('Tree photo storage is not configured for this environment.');
    error.status = 503;
    throw error;
  }
  return admin.storage().bucket(name);
}
module.exports = { getPartnerTreeBucket };
