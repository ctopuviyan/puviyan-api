const { HTTP_STATUS } = require('../config/constants');
const employeeManagementService = require('../services/employee-management.service');

/**
 * Upload CSV to bulk onboard employees
 * POST /partner/orgs/:orgId/employees/upload
 */
async function uploadEmployeeCSV(req, res, next) {
  try {
    const { orgId } = req.params;
    const csvContent = req.body.csvContent || req.file?.buffer?.toString('utf-8');

    if (!csvContent) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: 'CSV content is required',
      });
    }

    const result = await employeeManagementService.uploadEmployeeCSV({
      partnerUid: req.partnerUser.uid,
      orgId,
      csvContent,
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get employees for an organization
 * GET /partner/orgs/:orgId/employees
 */
async function getEmployees(req, res, next) {
  try {
    const { orgId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const result = await employeeManagementService.getEmployees({
      partnerUid: req.partnerUser.uid,
      orgId,
      limit,
      offset,
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  uploadEmployeeCSV,
  getEmployees,
};
