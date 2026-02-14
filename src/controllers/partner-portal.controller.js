const { HTTP_STATUS } = require('../config/constants');
const partnerPortalService = require('../services/partner-portal.service');

async function getMe(req, res, next) {
  try {
    const result = await partnerPortalService.getPartnerMe({
      partnerUid: req.partnerUser.uid,
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function saveEventDraft(req, res, next) {
  try {
    const { draftId, data } = req.body || {};

    const result = await partnerPortalService.saveEventDraft({
      partnerUid: req.partnerUser.uid,
      partnerEmail: req.partnerUser.email || null,
      draftId: draftId || null,
      data,
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function listEventDrafts(req, res, next) {
  try {
    const { limit } = req.query;

    const result = await partnerPortalService.listEventDrafts({
      partnerUid: req.partnerUser.uid,
      limit: parseInt(limit) || 50,
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function getEventDraft(req, res, next) {
  try {
    const { draftId } = req.params;

    const result = await partnerPortalService.getEventDraft({
      partnerUid: req.partnerUser.uid,
      draftId,
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function publishEventDraft(req, res, next) {
  try {
    const { draftId } = req.params;

    const result = await partnerPortalService.publishEventDraft({
      partnerUid: req.partnerUser.uid,
      partnerEmail: req.partnerUser.email || null,
      draftId,
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function listPartnerEvents(req, res, next) {
  try {
    const { status, limit } = req.query;

    const result = await partnerPortalService.listPartnerEvents({
      partnerUid: req.partnerUser.uid,
      status: status || null,
      limit: parseInt(limit) || 50,
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function createOrg(req, res, next) {
  try {
    const { orgName, orgId } = req.body || {};

    const result = await partnerPortalService.createOrg({
      partnerUid: req.partnerUser.uid,
      orgName,
      requestedOrgId: orgId || null,
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function joinOrg(req, res, next) {
  try {
    const { orgId, inviteCode } = req.body || {};

    const result = await partnerPortalService.joinOrg({
      partnerUid: req.partnerUser.uid,
      orgId,
      inviteCode,
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function rotateInviteCode(req, res, next) {
  try {
    const { orgId } = req.params;

    const result = await partnerPortalService.rotateOrgInviteCode({
      partnerUid: req.partnerUser.uid,
      orgId,
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function listAvailableOrganizations(req, res, next) {
  try {
    const { search, limit } = req.query;

    const result = await partnerPortalService.listAvailableOrganizations({
      partnerUid: req.partnerUser.uid,
      searchQuery: search || '',
      limit: parseInt(limit) || 50,
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function requestOrgLink(req, res, next) {
  try {
    const { orgId, reason } = req.body || {};

    const result = await partnerPortalService.requestOrgLink({
      partnerUid: req.partnerUser.uid,
      orgId,
      reason,
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function getOrgLinkRequests(req, res, next) {
  try {
    const result = await partnerPortalService.getOrgLinkRequests({
      partnerUid: req.partnerUser.uid,
    });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function getPendingOrgLinkRequests(req, res, next) {
  try {
    const result = await partnerPortalService.getPendingOrgLinkRequests(req.partnerUser.uid);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function approveOrgLinkRequest(req, res, next) {
  try {
    const { partnerUid, requestId, role } = req.body;

    if (!partnerUid || !requestId || !role) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: 'partnerUid, requestId, and role are required',
      });
    }

    const result = await partnerPortalService.approveOrgLinkRequest(
      req.partnerUser.uid,
      partnerUid,
      requestId,
      role
    );

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function rejectOrgLinkRequest(req, res, next) {
  try {
    const { partnerUid, requestId, reason } = req.body;

    if (!partnerUid || !requestId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: 'partnerUid and requestId are required',
      });
    }

    const result = await partnerPortalService.rejectOrgLinkRequest(
      req.partnerUser.uid,
      partnerUid,
      requestId,
      reason
    );

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function getDashboardMetrics(req, res, next) {
  try {
    const result = await partnerPortalService.getDashboardMetrics(req.partnerUser.uid);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function getOrgUsers(req, res, next) {
  try {
    const { orgId } = req.params;
    const result = await partnerPortalService.getOrgUsers(req.partnerUser.uid, orgId);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getMe,
  createOrg,
  joinOrg,
  rotateInviteCode,
  listAvailableOrganizations,
  requestOrgLink,
  getOrgLinkRequests,
  getPendingOrgLinkRequests,
  approveOrgLinkRequest,
  rejectOrgLinkRequest,
  getDashboardMetrics,
  getOrgUsers,
  saveEventDraft,
  listEventDrafts,
  getEventDraft,
  publishEventDraft,
  listPartnerEvents,
};
