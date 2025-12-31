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
    
    // Upload file
    await file.save(fileBuffer, {
      metadata: {
        contentType: mimeType,
        metadata: {
          firebaseStorageDownloadTokens: generateToken()
        }
      },
      public: true
    });
    
    // Make file publicly accessible
    await file.makePublic();
    
    // Get public URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
    
    return publicUrl;
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
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
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
