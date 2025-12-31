const storageService = require('../services/storage.service');
const { HTTP_STATUS } = require('../config/constants');

/**
 * Upload Controller - Handle file uploads
 */

/**
 * Upload single image
 */
async function uploadImage(req, res, next) {
  try {
    if (!req.file) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        errorCode: 'VAL-001',
        message: 'No file uploaded'
      });
    }

    const { buffer, originalname, mimetype, size } = req.file;
    const folder = req.body.folder || 'rewards';

    // Validate image
    storageService.validateImage(mimetype, size);

    // Upload to Firebase Storage
    const imageUrl = await storageService.uploadImage(buffer, originalname, folder, mimetype);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      imageUrl,
      message: 'Image uploaded successfully'
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Upload multiple images
 */
async function uploadMultipleImages(req, res, next) {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        errorCode: 'VAL-001',
        message: 'No files uploaded'
      });
    }

    const folder = req.body.folder || 'rewards';
    const uploadPromises = req.files.map(file => {
      storageService.validateImage(file.mimetype, file.size);
      return storageService.uploadImage(file.buffer, file.originalname, folder, file.mimetype);
    });

    const imageUrls = await Promise.all(uploadPromises);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      imageUrls,
      count: imageUrls.length,
      message: 'Images uploaded successfully'
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  uploadImage,
  uploadMultipleImages
};
