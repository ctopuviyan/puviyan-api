const express = require('express');
const router = express.Router();
const multer = require('multer');
const uploadController = require('../controllers/upload.controller');
const { apiLimiter } = require('../middleware/rateLimit.middleware');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

/**
 * Upload single image
 */
router.post('/image', apiLimiter, upload.single('image'), uploadController.uploadImage);

/**
 * Upload multiple images
 */
router.post('/images', apiLimiter, upload.array('images', 4), uploadController.uploadMultipleImages);

module.exports = router;
