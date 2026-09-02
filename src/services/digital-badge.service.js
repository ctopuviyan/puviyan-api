const { admin, getAuth, getFirestore } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');
const {
  BADGE_TYPES,
  addDays,
  badgeType,
  calculateMonthlyChampion,
  calculateRecordDay,
  calculateStreak,
  dateKey,
  isAchievedVisible,
  isValidOn,
  maxDateKey,
  minDateKey,
  normalizeTimeZone,
  orderBadges,
  selectCurrentMonthlyBadge,
  thresholdFor,
  toDate,
  validateConditions
} = require('./digital-badge.rules');

const reconciliationInFlight = new Map();
const definitionsCache = { rewards: null, expiresAt: 0 };
const DEFINITION_CACHE_TTL_MS = 5 * 60 * 1000;
const RECALCULATION_COOLDOWN_MS = 15 * 60 * 1000;

function iso(value) {
  return toDate(value)?.toISOString() || null;
}

function serializeReward(reward) {
  const previewImage = reward.previewImage || reward.badgeImageUrl || '';
  const fullImage = reward.fullImage || reward.badgeImageUrl || '';
  return {
    rewardId: reward.rewardId,
    rewardTitle: reward.rewardTitle || '',
    rewardSubtitle: reward.rewardSubtitle || '',
    rewardType: reward.rewardType,
    rewardDetails: reward.rewardDetails || [],
    brandName: reward.brandName || null,
    deductPoints: Number(reward.deductPoints || 0),
    maxPerUser: Number(reward.maxPerUser || 1),
    validFrom: iso(reward.validFrom),
    validTo: iso(reward.validTo),
    previewImage,
    previewImageGreyed: reward.previewImageGreyed || '',
    fullImage,
    fullImageGreyed: reward.fullImageGreyed || '',
    badgeImageUrl: reward.badgeImageUrl || '',
    badgeName: reward.badgeName || null,
    badgeDescription: reward.badgeDescription || null,
    carbonContribution: Number(reward.carbonContribution || 0),
    howToClaim: reward.howToClaim || [],
    termsAndConditions: reward.termsAndConditions || '',
    likeCount: Number(reward.likeCount || 0),
    dislikeCount: Number(reward.dislikeCount || 0),
    usefulnessScore: Number(reward.usefulnessScore || 0),
    status: reward.status,
    orgId: reward.orgId || null,
    conditions: reward.conditions,
    createdAt: iso(reward.createdAt),
    updatedAt: iso(reward.updatedAt)
  };
}

async function getDigitalBadges({ userId, timeZone, rewardId = null }) {
  if (!userId) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN, 'Authentication is required');
  }

  const zone = normalizeTimeZone(timeZone);
  const result = await readDigitalBadgeState(userId, zone);
  if (!rewardId) return result;

  const reward = result.rewards.find((item) => item.rewardId === rewardId);
  if (!reward) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.RWD_NOT_FOUND, 'Digital badge reward not found');
  }
  return {
    serverDate: result.serverDate,
    refreshedAt: result.refreshedAt,
    timezone: result.timezone,
    reward
  };
}

/**
 * Returns permanent achieved-badge history for the authenticated profile.
 * This endpoint intentionally derives the user ID only from the verified
 * Firebase token; callers cannot read another user's progress by ID.
 */
async function getAchievedDigitalBadges({ userId, timeZone }) {
  if (!userId) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN, 'Authentication is required');
  }

  const zone = normalizeTimeZone(timeZone);
  const db = getFirestore();
  const [profileDoc, definitions, progressSnapshot] = await Promise.all([
    db.collection('informations').doc(userId).get(),
    loadBadgeDefinitions(),
    db.collection('users').doc(userId).collection('badgeProgress')
      .where('isAchieved', '==', true).get()
  ]);

  const profile = profileDoc.exists ? profileDoc.data() : {};
  const userOrgId = profile.orgMembership?.orgId || profile.orgId || null;
  const visibleDefinitions = definitions
    .filter((reward) => !reward.orgId || reward.orgId === userOrgId)
    .filter((reward) => validateConditions(reward.conditions));
  const definitionsById = new Map(
    visibleDefinitions.map((reward) => [reward.rewardId, reward])
  );

  const rewards = progressSnapshot.docs
    .map((doc) => {
      const progress = normalizeProgress(doc.id, doc.data());
      const definition = definitionsById.get(doc.id);
      const ordered = definition ? orderBadges(visibleDefinitions, badgeType(definition)) : [];
      const index = definition ? ordered.findIndex((item) => item.rewardId === definition.rewardId) : null;
      return {
        ...(definition ? serializeReward(definition) : serializeProgressSnapshot(progress)),
        badgeProgress: progress,
        listingState: {
          isVisible: true,
          status: 'achieved',
          reason: 'profile_achievement'
        },
        sequence: {
          family: definition ? badgeType(definition) : progress.badgeType,
          index,
          previousRewardId: index > 0 ? ordered[index - 1].rewardId : null,
          isCurrent: false,
          orderValue: definition ? thresholdFor(definition) : null
        }
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = toDate(a.badgeProgress.detectedAt)?.getTime() || 0;
      const bTime = toDate(b.badgeProgress.detectedAt)?.getTime() || 0;
      return bTime - aTime;
    });

  return {
    userId,
    refreshedAt: new Date().toISOString(),
    timezone: zone,
    rewards,
    total: rewards.length
  };
}

/**
 * Returns only the achievement display data intended for a public profile.
 * It deliberately excludes walking data, live progress, badge conditions,
 * organization membership, and any reward redemption information.
 */
async function getPublicAchievedDigitalBadges({ userId }) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_INVALID_VALUE, 'A profile user ID is required');
  }

  const progressSnapshot = await getFirestore().collection('users').doc(userId)
    .collection('badgeProgress').where('isAchieved', '==', true).get();
  const badges = progressSnapshot.docs
    .map((doc) => {
      const progress = normalizeProgress(doc.id, doc.data());
      const snapshot = progress.rewardSnapshot || {};
      return {
        rewardId: progress.rewardId,
        rewardTitle: snapshot.rewardTitle || snapshot.badgeName || 'Badge',
        rewardSubtitle: snapshot.rewardSubtitle || '',
        badgeName: snapshot.badgeName || '',
        badgeDescription: snapshot.badgeDescription || null,
        badgeImageUrl: snapshot.badgeImageUrl || '',
        achievedAt: progress.detectedAt
      };
    })
    .sort((a, b) => {
      const aTime = toDate(a.achievedAt)?.getTime() || 0;
      const bTime = toDate(b.achievedAt)?.getTime() || 0;
      return bTime - aTime;
    });

  return {
    userId,
    refreshedAt: new Date().toISOString(),
    badges,
    total: badges.length
  };
}

async function reconcileForUser(userId, timeZone) {
  const key = `${userId}:${timeZone}`;
  const existing = reconciliationInFlight.get(key);
  if (existing) return existing;

  const reconciliation = performReconciliation(userId, timeZone)
    .finally(() => reconciliationInFlight.delete(key));
  reconciliationInFlight.set(key, reconciliation);
  return reconciliation;
}

async function readDigitalBadgeState(userId, timeZone) {
  const db = getFirestore();
  const now = new Date();
  const todayKey = dateKey(now, timeZone);
  const [profileDoc, definitions, progressSnapshot] = await Promise.all([
    db.collection('informations').doc(userId).get(),
    loadBadgeDefinitions(),
    db.collection('users').doc(userId).collection('badgeProgress').get()
  ]);
  const profile = profileDoc.exists ? profileDoc.data() : {};
  const userOrgId = profile.orgMembership?.orgId || profile.orgId || null;
  const activeDefinitions = definitions
    .filter((reward) => reward.status === 'active')
    .filter((reward) => !reward.orgId || reward.orgId === userOrgId)
    .filter((reward) => validateConditions(reward.conditions));
  const progressMap = new Map(
    progressSnapshot.docs.map((doc) => [doc.id, normalizeProgress(doc.id, doc.data())])
  );
  const accountStartKey = await resolveAccountStartKey(userId, profile, timeZone, todayKey);
  return buildBadgeStateResponse({
    definitions: activeDefinitions,
    progressMap,
    accountStartKey,
    todayKey,
    timeZone,
    now,
    newlyAchievedRewardIds: []
  });
}

async function recalculateDigitalBadges({ userId, timeZone, force = false, reason = 'app_launch' }) {
  const zone = normalizeTimeZone(timeZone);
  const summaryRef = getFirestore().collection('users').doc(userId)
    .collection('badgeState').doc('summary');
  const summaryDoc = await summaryRef.get();
  const lastRecalculatedAt = toDate(summaryDoc.data()?.lastRecalculatedAt);
  const isCoolingDown = !force && lastRecalculatedAt &&
    Date.now() - lastRecalculatedAt.getTime() < RECALCULATION_COOLDOWN_MS &&
    summaryDoc.data()?.timezone === zone;

  if (isCoolingDown) {
    const result = await readDigitalBadgeState(userId, zone);
    return { ...result, recalculated: false, skippedReason: 'cooldown' };
  }

  const result = await reconcileForUser(userId, zone);
  await summaryRef.set({
    lastRecalculatedAt: new Date().toISOString(),
    lastRecalculatedDate: result.serverDate,
    timezone: zone,
    lastRecalculateReason: reason,
    lastUpdated: new Date().toISOString()
  }, { merge: true });
  return { ...result, recalculated: true };
}

async function loadBadgeDefinitions() {
  const now = Date.now();
  if (definitionsCache.rewards && definitionsCache.expiresAt > now) {
    return definitionsCache.rewards;
  }
  const snapshot = await getFirestore().collection('rewards')
    .where('rewardType', '==', 'digital_badge').get();
  definitionsCache.rewards = snapshot.docs.map((doc) => ({ rewardId: doc.id, ...doc.data() }));
  definitionsCache.expiresAt = now + DEFINITION_CACHE_TTL_MS;
  return definitionsCache.rewards;
}

async function performReconciliation(userId, timeZone) {
  const db = getFirestore();
  const now = new Date();
  const todayKey = dateKey(now, timeZone);
  const [profileDoc, definitions, progressSnapshot] = await Promise.all([
    db.collection('informations').doc(userId).get(),
    loadBadgeDefinitions(),
    db.collection('users').doc(userId).collection('badgeProgress').get()
  ]);

  const profile = profileDoc.exists ? profileDoc.data() : {};
  const userOrgId = profile.orgMembership?.orgId || profile.orgId || null;
  const activeDefinitions = definitions
    .filter((reward) => reward.status === 'active')
    .filter((reward) => !reward.orgId || reward.orgId === userOrgId)
    .filter((reward) => validateConditions(reward.conditions));

  const progressMap = new Map(
    progressSnapshot.docs.map((doc) => [doc.id, normalizeProgress(doc.id, doc.data())])
  );
  const accountStartKey = await resolveAccountStartKey(userId, profile, timeZone, todayKey);
  const newlyAchievedRewardIds = [];

  await reconcileStreakSeries({
    db,
    userId,
    definitions: activeDefinitions,
    progressMap,
    accountStartKey,
    todayKey,
    timeZone,
    now,
    newlyAchievedRewardIds
  });
  await reconcileRecordDaySeries({
    db,
    userId,
    definitions: activeDefinitions,
    progressMap,
    accountStartKey,
    todayKey,
    timeZone,
    now,
    newlyAchievedRewardIds
  });
  await reconcileMonthlyChampion({
    db,
    userId,
    definitions: activeDefinitions,
    progressMap,
    todayKey,
    timeZone,
    now,
    newlyAchievedRewardIds
  });

  return buildBadgeStateResponse({
    definitions: activeDefinitions,
    progressMap,
    accountStartKey,
    todayKey,
    timeZone,
    now,
    newlyAchievedRewardIds
  });
}

function buildBadgeStateResponse({
  definitions,
  progressMap,
  accountStartKey,
  todayKey,
  timeZone,
  now,
  newlyAchievedRewardIds
}) {
  const selection = selectCurrentBadges({
    definitions,
    progressMap,
    accountStartKey,
    todayKey,
    timeZone
  });
  const rewards = definitions.map((reward) => {
    const progress = progressMap.get(reward.rewardId) || null;
    const sequence = sequenceFor(reward, definitions, selection);
    const listingState = listingStateFor({ reward, progress, selection, now, todayKey, timeZone });
    return { ...serializeReward(reward), badgeProgress: progress, listingState, sequence };
  });

  rewards.sort((a, b) => {
    if (a.listingState.isVisible !== b.listingState.isVisible) {
      return a.listingState.isVisible ? -1 : 1;
    }
    return `${a.conditions.badgeType}:${a.sequence.index}`
      .localeCompare(`${b.conditions.badgeType}:${b.sequence.index}`);
  });

  const activeBadgesByType = {};
  for (const [type, selectedRewardId] of selection.entries()) {
    if (!selectedRewardId) continue;
    const reward = rewards.find((item) => item.rewardId === selectedRewardId);
    if (reward) activeBadgesByType[type] = reward;
  }
  return {
    serverDate: todayKey,
    refreshedAt: now.toISOString(),
    timezone: timeZone,
    activeBadgesByType,
    newlyAchievedRewardIds,
    rewards,
    total: rewards.length
  };
}

async function resolveAccountStartKey(userId, profile, timeZone, fallback) {
  const profileCreatedAt = toDate(profile.createdAt);
  if (profileCreatedAt) return dateKey(profileCreatedAt, timeZone);
  try {
    const user = await getAuth().getUser(userId);
    const createdAt = toDate(user.metadata?.creationTime);
    return createdAt ? dateKey(createdAt, timeZone) : fallback;
  } catch (_) {
    return fallback;
  }
}

async function reconcileStreakSeries(context) {
  const badges = orderBadges(context.definitions, BADGE_TYPES.STREAK);
  if (badges.length === 0) return;
  const state = currentSeriesState(badges, context.progressMap, context.accountStartKey, context.timeZone);
  if (state.index >= badges.length || state.startDateKey > context.todayKey) return;

  const activeBadge = badges[state.index];
  const activeProgress = context.progressMap.get(activeBadge.rewardId);
  const lookback = Math.max(0, Number(activeBadge.conditions.requiredStreakDays || 0) - 1);
  const cursorStart = activeProgress?.lastCalculatedUntil
    ? addDays(activeProgress.lastCalculatedUntil, -lookback)
    : state.startDateKey;
  const queryStart = maxDateKey(state.startDateKey, cursorStart);
  const rowsByDate = await loadWalkingRows(context.db, context.userId, queryStart, context.todayKey);

  let index = state.index;
  let startDateKey = state.startDateKey;
  while (index < badges.length && startDateKey <= context.todayKey) {
    const badge = badges[index];
    const configuredStart = dateKey(badge.validFrom, context.timeZone);
    const configuredEnd = dateKey(badge.validTo, context.timeZone);
    const badgeStart = maxDateKey(startDateKey, configuredStart);
    if (!badgeStart || badgeStart > context.todayKey || badgeStart > configuredEnd) break;

    const calculationStart = index === state.index ? maxDateKey(badgeStart, queryStart) : badgeStart;
    const result = calculateStreak({
      rowsByDate,
      startDateKey: calculationStart,
      endDateKey: minDateKey(context.todayKey, configuredEnd),
      requiredDays: Number(badge.conditions.requiredStreakDays)
    });
    const oldProgress = context.progressMap.get(badge.rewardId);
    const progress = buildProgress({
      reward: badge,
      oldProgress,
      progress: { currentStreakDays: result.currentStreakDays },
      completedOn: result.completedOn,
      progressStartDate: badgeStart,
      lastCalculatedUntil: addDays(context.todayKey, -1),
      now: context.now
    });
    const newlyAchieved = !oldProgress?.isAchieved && progress.isAchieved;
    await persistProgress(context.db, context.userId, badge, oldProgress, progress);
    context.progressMap.set(badge.rewardId, progress);
    if (!result.completedOn) break;

    if (newlyAchieved) {
      context.newlyAchievedRewardIds.push(badge.rewardId);
    }
    if (result.completedOn === context.todayKey) break;
    startDateKey = addDays(result.completedOn, 1);
    index += 1;
  }
}

async function reconcileRecordDaySeries(context) {
  const badges = orderBadges(context.definitions, BADGE_TYPES.RECORD_DAY);
  if (badges.length === 0) return;
  const state = currentSeriesState(badges, context.progressMap, context.accountStartKey, context.timeZone);
  if (state.index >= badges.length || state.startDateKey > context.todayKey) return;

  const activeProgress = context.progressMap.get(badges[state.index].rewardId);
  const cursorStart = activeProgress?.lastCalculatedUntil
    ? addDays(activeProgress.lastCalculatedUntil, 1)
    : state.startDateKey;
  const queryStart = maxDateKey(state.startDateKey, cursorStart);
  const rowsByDate = await loadWalkingRows(context.db, context.userId, queryStart, context.todayKey);

  let index = state.index;
  let startDateKey = state.startDateKey;
  while (index < badges.length && startDateKey <= context.todayKey) {
    const badge = badges[index];
    const configuredStart = dateKey(badge.validFrom, context.timeZone);
    const configuredEnd = dateKey(badge.validTo, context.timeZone);
    const badgeStart = maxDateKey(startDateKey, configuredStart);
    if (!badgeStart || badgeStart > context.todayKey || badgeStart > configuredEnd) break;

    const calculationStart = index === state.index ? maxDateKey(badgeStart, queryStart) : badgeStart;
    const result = calculateRecordDay({
      rowsByDate,
      startDateKey: calculationStart,
      endDateKey: minDateKey(context.todayKey, configuredEnd),
      requiredCarbonKg: Number(badge.conditions.requiredRecordDayCarbonKg)
    });
    const oldProgress = context.progressMap.get(badge.rewardId);
    const progress = buildProgress({
      reward: badge,
      oldProgress,
      progress: { currentRecordDayCarbonKg: result.currentCarbonKg },
      completedOn: result.completedOn,
      progressStartDate: badgeStart,
      lastCalculatedUntil: addDays(context.todayKey, -1),
      now: context.now
    });
    const newlyAchieved = !oldProgress?.isAchieved && progress.isAchieved;
    await persistProgress(context.db, context.userId, badge, oldProgress, progress);
    context.progressMap.set(badge.rewardId, progress);
    if (!result.completedOn) break;

    if (newlyAchieved) {
      context.newlyAchievedRewardIds.push(badge.rewardId);
    }
    if (result.completedOn === context.todayKey) break;
    startDateKey = addDays(result.completedOn, 1);
    index += 1;
  }
}

async function reconcileMonthlyChampion(context) {
  const badge = selectCurrentMonthlyBadge(context.definitions, context.todayKey, context.timeZone);
  if (!badge) return;
  const oldProgress = context.progressMap.get(badge.rewardId);
  if (oldProgress?.isAchieved) return;

  const startDateKey = dateKey(badge.validFrom, context.timeZone);
  const endDateKey = minDateKey(context.todayKey, dateKey(badge.validTo, context.timeZone));
  const rowsByDate = await loadWalkingRows(context.db, context.userId, startDateKey, endDateKey);
  const result = calculateMonthlyChampion({
    rowsByDate,
    startDateKey,
    endDateKey,
    requiredCarbonKg: Number(badge.conditions.requiredChampionCarbonKg)
  });
  const progress = buildProgress({
    reward: badge,
    oldProgress,
    progress: { currentChampionCarbonKg: result.carbonKg },
    completedOn: result.completedOn,
    now: context.now
  });
  const newlyAchieved = !oldProgress?.isAchieved && progress.isAchieved;
  await persistProgress(context.db, context.userId, badge, oldProgress, progress);
  context.progressMap.set(badge.rewardId, progress);
  if (newlyAchieved) {
    context.newlyAchievedRewardIds.push(badge.rewardId);
  }
}

function currentSeriesState(badges, progressMap, accountStartKey, timeZone) {
  let index = 0;
  let startDateKey = accountStartKey;
  while (index < badges.length) {
    const badge = badges[index];
    const progress = progressMap.get(badge.rewardId);
    if (!progress?.isAchieved) break;
    const completedOn = progress.completedOn ||
      (progress.detectedAt ? dateKey(progress.detectedAt, timeZone) : null);
    if (completedOn) startDateKey = addDays(completedOn, 1);
    index += 1;
  }
  if (index < badges.length) {
    const existingStart = progressMap.get(badges[index].rewardId)?.progressStartDate;
    const configuredStart = dateKey(badges[index].validFrom, timeZone);
    startDateKey = maxDateKey(startDateKey, existingStart, configuredStart);
  }
  return { index, startDateKey };
}

function buildProgress({
  reward,
  oldProgress,
  progress,
  completedOn,
  progressStartDate,
  lastCalculatedUntil,
  now
}) {
  if (oldProgress?.isAchieved) return oldProgress;
  const achieved = Boolean(completedOn);
  const detectionTime = achieved ? now.toISOString() : null;
  const result = {
    rewardId: reward.rewardId,
    badgeType: badgeType(reward),
    progress,
    isAchieved: achieved,
    completedOn: completedOn || null,
    detectedAt: achieved ? detectionTime : null,
    lastUpdated: now.toISOString()
  };
  if (progressStartDate) result.progressStartDate = progressStartDate;
  if (lastCalculatedUntil) result.lastCalculatedUntil = lastCalculatedUntil;
  return result;
}

function normalizeProgress(rewardId, data) {
  const type = data.badgeType || null;
  const legacyProgress = type === BADGE_TYPES.STREAK
    ? { currentStreakDays: Number(data.currentStreakDays || 0) }
    : type === BADGE_TYPES.RECORD_DAY
      ? { currentRecordDayCarbonKg: Number(data.currentRecordDayCarbonKg || 0) }
      : { currentChampionCarbonKg: Number(data.currentChampionCarbonKg || 0) };
  return {
    rewardId,
    badgeType: type,
    progress: data.progress || legacyProgress,
    isAchieved: data.isAchieved === true,
    progressStartDate: data.progressStartDate || null,
    completedOn: data.completedOn || null,
    detectedAt: iso(data.detectedAt || data.achievedAt),
    lastCalculatedUntil: data.lastCalculatedUntil || null,
    lastUpdated: iso(data.lastUpdated) || new Date(0).toISOString(),
    rewardSnapshot: data.rewardSnapshot || {
      rewardTitle: data.rewardTitle || '',
      rewardSubtitle: data.rewardSubtitle || '',
      badgeName: data.badgeName || '',
      badgeDescription: data.badgeDescription || null,
      badgeImageUrl: data.badgeImageUrl || ''
    }
  };
}

async function persistProgress(db, userId, reward, previous, progress) {
  if (previous && samePersistedProgress(previous, progress)) return false;
  const data = {
    ...progress,
    rewardSnapshot: {
      rewardTitle: reward.rewardTitle || '',
      rewardSubtitle: reward.rewardSubtitle || '',
      badgeName: reward.badgeName || '',
      badgeDescription: reward.badgeDescription || null,
      badgeImageUrl: reward.badgeImageUrl || ''
    }
  };
  await db.collection('users').doc(userId).collection('badgeProgress')
    .doc(reward.rewardId).set(data, { merge: true });
  return true;
}

function samePersistedProgress(a, b) {
  const keys = [
    'rewardId', 'badgeType', 'isAchieved', 'progressStartDate', 'completedOn',
    'detectedAt', 'lastCalculatedUntil'
  ];
  return keys.every((key) => (a[key] ?? null) === (b[key] ?? null)) &&
    JSON.stringify(a.progress || {}) === JSON.stringify(b.progress || {});
}

function serializeProgressSnapshot(progress) {
  const snapshot = progress.rewardSnapshot || {};
  return {
    rewardId: progress.rewardId,
    rewardTitle: snapshot.rewardTitle || '',
    rewardSubtitle: snapshot.rewardSubtitle || '',
    rewardType: 'digital_badge',
    badgeName: snapshot.badgeName || null,
    badgeDescription: snapshot.badgeDescription || null,
    badgeImageUrl: snapshot.badgeImageUrl || '',
    previewImage: snapshot.badgeImageUrl || '',
    fullImage: snapshot.badgeImageUrl || '',
    conditions: { badgeType: progress.badgeType },
    status: 'inactive'
  };
}

async function loadWalkingRows(db, userId, startDateKey, endDateKey) {
  if (!startDateKey || !endDateKey || startDateKey > endDateKey) return {};
  const snapshot = await db.collection('informations').doc(userId).collection('walking')
    .where(admin.firestore.FieldPath.documentId(), '>=', startDateKey)
    .where(admin.firestore.FieldPath.documentId(), '<=', endDateKey)
    .get();
  return Object.fromEntries(snapshot.docs.map((doc) => [doc.id, doc.data()]));
}

function selectCurrentBadges({ definitions, progressMap, accountStartKey, todayKey, timeZone }) {
  const result = new Map();
  for (const type of [BADGE_TYPES.STREAK, BADGE_TYPES.RECORD_DAY]) {
    const badges = orderBadges(definitions, type);
    const state = currentSeriesState(badges, progressMap, accountStartKey, timeZone);
    const badge = state.index < badges.length && state.startDateKey <= todayKey
      ? badges[state.index]
      : null;
    result.set(type, badge && isValidOn(badge, todayKey, timeZone) ? badge.rewardId : null);
  }
  result.set(
    BADGE_TYPES.MONTHLY_CHAMPION,
    selectCurrentMonthlyBadge(definitions, todayKey, timeZone)?.rewardId || null
  );
  return result;
}

function sequenceFor(reward, definitions, selection) {
  const type = badgeType(reward);
  const ordered = orderBadges(definitions, type);
  const index = ordered.findIndex((item) => item.rewardId === reward.rewardId);
  return {
    family: type,
    index,
    previousRewardId: index > 0 ? ordered[index - 1].rewardId : null,
    isCurrent: selection.get(type) === reward.rewardId,
    orderValue: thresholdFor(reward)
  };
}

function listingStateFor({ reward, progress, selection, now, todayKey, timeZone }) {
  if (progress?.isAchieved) {
    const visible = isAchievedVisible(progress, now);
    return {
      isVisible: visible,
      status: visible ? 'achieved' : 'hidden',
      reason: visible ? 'achieved_visibility_window' : 'achieved_visibility_expired'
    };
  }
  if (selection.get(badgeType(reward)) === reward.rewardId) {
    return { isVisible: true, status: 'active', reason: 'current_badge_for_family' };
  }
  if (badgeType(reward) === BADGE_TYPES.MONTHLY_CHAMPION && !isValidOn(reward, todayKey, timeZone)) {
    return { isVisible: false, status: 'upcoming', reason: 'outside_reward_period' };
  }
  return { isVisible: false, status: 'locked', reason: 'another_badge_is_active' };
}

module.exports = {
  getDigitalBadges,
  getAchievedDigitalBadges,
  getPublicAchievedDigitalBadges,
  recalculateDigitalBadges,
  reconcileForUser,
  serializeReward,
  samePersistedProgress
};
