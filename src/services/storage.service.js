const crypto = require('node:crypto');
const { admin } = require('../config/firebase.config');
const { ApiError } = require('../middleware/error.middleware');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

/**
 * Storage Service - Handle Firebase Storage operations
 */

/**
 * Upload image to Firebase Storage
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileName - Original file name
 * @param {string} folder - Storage folder (e.g., 'rewards', 'partners')
 * @param {string} mimeType - File MIME type
 * @returns {Promise<string>} - Public URL of uploaded file
 */
async function uploadImage(fileBuffer, fileName, folder = 'rewards', mimeType = 'image/jpeg') {
  try {
    const bucket = admin.storage().bucket();
    
    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `${folder}/${timestamp}_${sanitizedFileName}`;
    
    const file = bucket.file(storagePath);
    
    const downloadToken = generateToken();
    await file.save(fileBuffer, {
      metadata: {
        contentType: mimeType,
        metadata: { firebaseStorageDownloadTokens: downloadToken }
      }
    });

    // Keep profile images in the partner service's private bucket. Firebase's
    // download token grants access to this object without making the bucket or
    // object public through Cloud Storage IAM/ACLs. Preserve legacy behavior for
    // the shared consumer/portal API.
    if (process.env.API_SERVICE_SURFACE === 'partner') {
      return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(downloadToken)}`;
    }

    await file.makePublic();
    return `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
  } catch (error) {
    console.error('Error uploading image:', error);
    throw new ApiError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      ERROR_CODES.SYS_INTERNAL_ERROR,
      `Failed to upload image: ${error.message}`
    );
  }
}

/**
 * Delete image from Firebase Storage
 * @param {string} imageUrl - Public URL of the image
 * @returns {Promise<boolean>}
 */
async function deleteImage(imageUrl) {
  try {
    const bucket = admin.storage().bucket();
    
    // Extract file path from URL
    const urlPattern = new RegExp(`https://storage.googleapis.com/${bucket.name}/(.+)`);
    const match = imageUrl.match(urlPattern);
    
    if (!match) {
      throw new Error('Invalid image URL format');
    }
    
    const filePath = decodeURIComponent(match[1]);
    const file = bucket.file(filePath);
    
    await file.delete();
    
    return true;
  } catch (error) {
    console.error('Error deleting image:', error);
    // Don't throw error for delete failures - just log
    return false;
  }
}

/**
 * Generate random token for Firebase Storage
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate image file
 * @param {string} mimeType - File MIME type
 * @param {number} fileSize - File size in bytes
 * @returns {boolean}
 */
function validateImage(mimeType, fileSize) {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  const maxSize = 5 * 1024 * 1024; // 5MB
  
  if (!allowedTypes.includes(mimeType)) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VAL_VALIDATION_ERROR,
      'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'
    );
  }
  
  if (fileSize > maxSize) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VAL_VALIDATION_ERROR,
      'File size exceeds 5MB limit.'
    );
  }
  
  return true;
}

module.exports = {
  uploadImage,
  deleteImage,
  validateImage
};
