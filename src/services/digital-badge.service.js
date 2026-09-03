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
  carbonKgFromDailyData,
  dateKey,
  isAchievedVisible,
  isSuccessfulStreakDay,
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
const BADGE_CALCULATION_VERSION = 2;

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

async function reconcileForUser(userId, timeZone, walkingDataFinalizedUntil) {
  const key = `${userId}:${timeZone}`;
  const existing = reconciliationInFlight.get(key);
  if (existing) {
    if (existing.walkingDataFinalizedUntil >= walkingDataFinalizedUntil) {
      return existing.promise;
    }
    try {
      await existing.promise;
    } catch (_) {
      // A newer finalized range must still be attempted after a failed run.
    }
    return reconcileForUser(userId, timeZone, walkingDataFinalizedUntil);
  }

  const entry = { walkingDataFinalizedUntil, promise: null };
  entry.promise = performReconciliation(userId, timeZone, walkingDataFinalizedUntil)
    .finally(() => {
      if (reconciliationInFlight.get(key) === entry) {
        reconciliationInFlight.delete(key);
      }
    });
  reconciliationInFlight.set(key, entry);
  return entry.promise;
}

async function readDigitalBadgeState(userId, timeZone) {
  const db = getFirestore();
  const now = new Date();
  const todayKey = dateKey(now, timeZone);
  const yesterdayKey = addDays(todayKey, -1);
  const [profileDoc, definitions, progressSnapshot, summaryDoc, todayWalkingDoc] = await Promise.all([
    db.collection('informations').doc(userId).get(),
    loadBadgeDefinitions(),
    db.collection('users').doc(userId).collection('badgeProgress').get(),
    db.collection('users').doc(userId).collection('badgeState').doc('summary').get(),
    db.collection('informations').doc(userId).collection('walking').doc(todayKey).get()
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
  const walkingDataFinalizedUntil = normalizeFinalizedUntil(
    summaryDoc.data()?.walkingDataFinalizedUntil,
    yesterdayKey
  ) || yesterdayKey;
  await applyTodayPreviews({
    db,
    userId,
    definitions: activeDefinitions,
    progressMap,
    accountStartKey,
    todayKey,
    timeZone,
    now,
    newlyAchievedRewardIds: [],
    rowsByDate: todayWalkingDoc.exists ? { [todayKey]: todayWalkingDoc.data() } : {},
    walkingDataFinalizedUntil
  }, { persistAchievements: false });
  return buildBadgeStateResponse({
    definitions: activeDefinitions,
    progressMap,
    accountStartKey,
    todayKey,
    timeZone,
    now,
    newlyAchievedRewardIds: [],
    walkingDataFinalizedUntil
  });
}

async function recalculateDigitalBadges({
  userId,
  timeZone,
  force = false,
  reason = 'app_launch',
  walkingDataFinalizedUntil = null
}) {
  const zone = normalizeTimeZone(timeZone);
  const todayKey = dateKey(new Date(), zone);
  const yesterdayKey = addDays(todayKey, -1);
  const summaryRef = getFirestore().collection('users').doc(userId)
    .collection('badgeState').doc('summary');
  const summaryDoc = await summaryRef.get();
  const summary = summaryDoc.data() || {};
  const lastRecalculatedAt = toDate(summary.lastRecalculatedAt);
  const requestedFinalizedUntil = normalizeFinalizedUntil(walkingDataFinalizedUntil, yesterdayKey);
  if (walkingDataFinalizedUntil !== null && requestedFinalizedUntil === null) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      'walkingDataFinalizedUntil must use YYYY-MM-DD format'
    );
  }
  const storedFinalizedUntil = normalizeFinalizedUntil(summary.walkingDataFinalizedUntil, yesterdayKey);
  const hasExplicitFinalizedUntil = requestedFinalizedUntil !== null;
  // Older app versions retain the previous yesterday-based behavior, but do not
  // persist an assumed sync watermark that could overtake a later verified one.
  const effectiveFinalizedUntil = hasExplicitFinalizedUntil
    ? maxDateKey(storedFinalizedUntil, requestedFinalizedUntil)
    : storedFinalizedUntil || yesterdayKey;
  const hasNewFinalizedData = Boolean(
    hasExplicitFinalizedUntil &&
    effectiveFinalizedUntil &&
    effectiveFinalizedUntil > (storedFinalizedUntil || '')
  );
  const isCoolingDown = !force && lastRecalculatedAt &&
    Date.now() - lastRecalculatedAt.getTime() < RECALCULATION_COOLDOWN_MS &&
    summary.timezone === zone &&
    summary.lastRecalculatedDate === todayKey &&
    summary.badgeCalculationVersion === BADGE_CALCULATION_VERSION &&
    !hasNewFinalizedData;

  if (isCoolingDown) {
    const result = await readDigitalBadgeState(userId, zone);
    return { ...result, recalculated: false, skippedReason: 'cooldown' };
  }

  const result = await reconcileForUser(userId, zone, effectiveFinalizedUntil);
  const summaryUpdate = {
    lastRecalculatedAt: new Date().toISOString(),
    lastRecalculatedDate: result.serverDate,
    badgeCalculationVersion: BADGE_CALCULATION_VERSION,
    timezone: zone,
    lastRecalculateReason: reason,
    lastUpdated: new Date().toISOString()
  };
  if (hasExplicitFinalizedUntil || storedFinalizedUntil) {
    summaryUpdate.walkingDataFinalizedUntil = maxDateKey(
      effectiveFinalizedUntil,
      result.walkingDataFinalizedUntil
    );
  }
  await summaryRef.set(summaryUpdate, { merge: true });
  return { ...result, recalculated: true };
}

function normalizeFinalizedUntil(value, latestAllowedKey) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return minDateKey(value, latestAllowedKey);
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

async function performReconciliation(userId, timeZone, walkingDataFinalizedUntil) {
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
  const walkingQueryStart = earliestRequiredWalkingDate({
    definitions: activeDefinitions,
    progressMap,
    accountStartKey,
    todayKey,
    timeZone
  });
  const yesterdayKey = addDays(todayKey, -1);
  const walkingQueryEnd = walkingDataFinalizedUntil === yesterdayKey
    ? todayKey
    : walkingDataFinalizedUntil;
  const rowsByDate = await loadWalkingRows(
    db,
    userId,
    walkingQueryStart,
    walkingQueryEnd
  );
  const reconciliationContext = {
    db,
    userId,
    definitions: activeDefinitions,
    progressMap,
    accountStartKey,
    todayKey,
    timeZone,
    now,
    newlyAchievedRewardIds,
    rowsByDate,
    walkingDataFinalizedUntil
  };

  await migrateLegacyProvisionalProgress(reconciliationContext);
  await reconcileStreakSeries(reconciliationContext);
  await reconcileRecordDaySeries(reconciliationContext);
  await reconcileMonthlyChampion(reconciliationContext);
  await applyTodayPreviews(reconciliationContext, { persistAchievements: true });

  return buildBadgeStateResponse({
    definitions: activeDefinitions,
    progressMap,
    accountStartKey,
    todayKey,
    timeZone,
    now,
    newlyAchievedRewardIds,
    walkingDataFinalizedUntil
  });
}

function buildBadgeStateResponse({
  definitions,
  progressMap,
  accountStartKey,
  todayKey,
  timeZone,
  now,
  newlyAchievedRewardIds,
  walkingDataFinalizedUntil = null
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
    walkingDataFinalizedUntil,
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
  const state = currentSeriesState(
    badges,
    context.progressMap,
    context.accountStartKey,
    context.timeZone
  );
  if (state.index >= badges.length || state.startDateKey > context.todayKey) return;

  let index = state.index;
  let startDateKey = state.startDateKey;
  while (index < badges.length && startDateKey <= context.walkingDataFinalizedUntil) {
    const badge = badges[index];
    const configuredStart = dateKey(badge.validFrom, context.timeZone);
    const configuredEnd = dateKey(badge.validTo, context.timeZone);
    const badgeStart = maxDateKey(startDateKey, configuredStart);
    const finalizedEnd = minDateKey(context.walkingDataFinalizedUntil, configuredEnd);
    if (!badgeStart || !finalizedEnd || badgeStart > finalizedEnd) break;

    const oldProgress = context.progressMap.get(badge.rewardId);
    const calculationStart = maxDateKey(
      badgeStart,
      oldProgress?.lastCalculatedUntil
        ? addDays(oldProgress.lastCalculatedUntil, 1)
        : badgeStart
    );
    if (calculationStart > finalizedEnd) break;

    const result = calculateStreak({
      rowsByDate: context.rowsByDate,
      startDateKey: calculationStart,
      endDateKey: finalizedEnd,
      requiredDays: Number(badge.conditions.requiredStreakDays),
      initialStreakDays: oldProgress?.lastCalculatedUntil
        ? Number(oldProgress.progress?.currentStreakDays || 0)
        : 0,
      preserveIncompleteEnd: false
    });
    const progress = buildProgress({
      reward: badge,
      oldProgress,
      progress: { currentStreakDays: result.currentStreakDays },
      completedOn: result.completedOn,
      progressStartDate: badgeStart,
      lastCalculatedUntil: result.completedOn || finalizedEnd,
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

  let index = state.index;
  let startDateKey = state.startDateKey;
  while (index < badges.length && startDateKey <= context.walkingDataFinalizedUntil) {
    const badge = badges[index];
    const configuredStart = dateKey(badge.validFrom, context.timeZone);
    const configuredEnd = dateKey(badge.validTo, context.timeZone);
    const badgeStart = maxDateKey(startDateKey, configuredStart);
    const finalizedEnd = minDateKey(context.walkingDataFinalizedUntil, configuredEnd);
    if (!badgeStart || !finalizedEnd || badgeStart > finalizedEnd) break;

    const oldProgress = context.progressMap.get(badge.rewardId);
    const calculationStart = maxDateKey(
      badgeStart,
      oldProgress?.lastCalculatedUntil
        ? addDays(oldProgress.lastCalculatedUntil, 1)
        : badgeStart
    );
    if (calculationStart > finalizedEnd) break;

    const result = calculateRecordDay({
      rowsByDate: context.rowsByDate,
      startDateKey: calculationStart,
      endDateKey: finalizedEnd,
      requiredCarbonKg: Number(badge.conditions.requiredRecordDayCarbonKg)
    });
    const progress = buildProgress({
      reward: badge,
      oldProgress,
      progress: {
        currentRecordDayCarbonKg: result.completedOn
          ? result.currentCarbonKg
          : 0
      },
      completedOn: result.completedOn,
      progressStartDate: badgeStart,
      lastCalculatedUntil: result.completedOn || finalizedEnd,
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
  const badges = orderBadges(context.definitions, BADGE_TYPES.MONTHLY_CHAMPION);
  for (const badge of badges) {
    const oldProgress = context.progressMap.get(badge.rewardId);
    if (oldProgress?.isAchieved) continue;

    const startDateKey = maxDateKey(
      dateKey(badge.validFrom, context.timeZone),
      context.accountStartKey
    );
    const endDateKey = minDateKey(
      context.walkingDataFinalizedUntil,
      dateKey(badge.validTo, context.timeZone)
    );
    const calculationStart = maxDateKey(
      startDateKey,
      oldProgress?.lastCalculatedUntil
        ? addDays(oldProgress.lastCalculatedUntil, 1)
        : startDateKey
    );
    if (!endDateKey || calculationStart > endDateKey) continue;

    const result = calculateMonthlyChampion({
      rowsByDate: context.rowsByDate,
      startDateKey: calculationStart,
      endDateKey,
      requiredCarbonKg: Number(badge.conditions.requiredChampionCarbonKg),
      initialCarbonKg: oldProgress?.lastCalculatedUntil
        ? Number(oldProgress.progress?.currentChampionCarbonKg || 0)
        : 0
    });
    const progress = buildProgress({
      reward: badge,
      oldProgress,
      progress: { currentChampionCarbonKg: result.carbonKg },
      completedOn: result.completedOn,
      progressStartDate: startDateKey,
      lastCalculatedUntil: result.completedOn || endDateKey,
      now: context.now
    });
    const newlyAchieved = !oldProgress?.isAchieved && progress.isAchieved;
    await persistProgress(context.db, context.userId, badge, oldProgress, progress);
    context.progressMap.set(badge.rewardId, progress);
    if (newlyAchieved) {
      context.newlyAchievedRewardIds.push(badge.rewardId);
    }
  }
}

async function migrateLegacyProvisionalProgress(context) {
  for (const reward of context.definitions) {
    const previous = context.progressMap.get(reward.rewardId);
    if (
      !previous ||
      previous.isAchieved ||
      previous.calculationVersion >= BADGE_CALCULATION_VERSION ||
      !previous.lastCalculatedUntil
    ) {
      continue;
    }

    const provisionalDate = addDays(previous.lastCalculatedUntil, 1);
    const provisionalRow = context.rowsByDate[provisionalDate];
    let progress;
    switch (badgeType(reward)) {
      case BADGE_TYPES.STREAK: {
        const current = Number(previous.progress?.currentStreakDays || 0);
        progress = {
          currentStreakDays: isSuccessfulStreakDay(provisionalRow)
            ? Math.max(0, current - 1)
            : current
        };
        break;
      }
      case BADGE_TYPES.RECORD_DAY:
        progress = { currentRecordDayCarbonKg: 0 };
        break;
      case BADGE_TYPES.MONTHLY_CHAMPION: {
        const current = Number(previous.progress?.currentChampionCarbonKg || 0);
        progress = {
          currentChampionCarbonKg: Math.max(
            0,
            current - carbonKgFromDailyData(provisionalRow)
          )
        };
        break;
      }
      default:
        continue;
    }

    const migrated = {
      ...previous,
      progress,
      calculationVersion: BADGE_CALCULATION_VERSION,
      lastUpdated: context.now.toISOString()
    };
    await persistProgress(context.db, context.userId, reward, previous, migrated);
    context.progressMap.set(reward.rewardId, migrated);
  }
}

function earliestRequiredWalkingDate({
  definitions,
  progressMap,
  accountStartKey,
  todayKey,
  timeZone
}) {
  const starts = [];
  for (const type of [BADGE_TYPES.STREAK, BADGE_TYPES.RECORD_DAY]) {
    const badges = orderBadges(definitions, type);
    const state = currentSeriesState(badges, progressMap, accountStartKey, timeZone);
    if (state.index >= badges.length) continue;
    const badge = badges[state.index];
    const progress = progressMap.get(badge.rewardId);
    const periodEnd = minDateKey(todayKey, dateKey(badge.validTo, timeZone));
    const start = maxDateKey(
      state.startDateKey,
      dateKey(badge.validFrom, timeZone),
      progress?.lastCalculatedUntil ? addDays(progress.lastCalculatedUntil, 1) : null
    );
    if (start && periodEnd && start <= periodEnd) starts.push(start);
  }

  for (const monthly of orderBadges(definitions, BADGE_TYPES.MONTHLY_CHAMPION)) {
    const progress = progressMap.get(monthly.rewardId);
    if (progress?.isAchieved) continue;
    const periodEnd = dateKey(monthly.validTo, timeZone);
    if (periodEnd < accountStartKey) continue;
    const start = maxDateKey(
      dateKey(monthly.validFrom, timeZone),
      accountStartKey,
      progress?.lastCalculatedUntil ? addDays(progress.lastCalculatedUntil, 1) : null
    );
    if (start && start <= minDateKey(todayKey, periodEnd)) starts.push(start);
  }

  return starts.length === 0 ? null : starts.sort()[0];
}

async function applyTodayPreviews(context, { persistAchievements }) {
  if (context.walkingDataFinalizedUntil !== addDays(context.todayKey, -1)) return;
  await applyTodayStreakPreview(context, persistAchievements);
  await applyTodayRecordDayPreview(context, persistAchievements);
  await applyTodayMonthlyPreview(context, persistAchievements);
}

async function applyTodayStreakPreview(context, persistAchievements) {
  const badges = orderBadges(context.definitions, BADGE_TYPES.STREAK);
  const state = currentSeriesState(
    badges,
    context.progressMap,
    context.accountStartKey,
    context.timeZone
  );
  if (state.index >= badges.length || state.startDateKey > context.todayKey) return;

  const badge = badges[state.index];
  if (!isValidOn(badge, context.todayKey, context.timeZone)) return;
  const oldProgress = context.progressMap.get(badge.rewardId);
  const current = Number(oldProgress?.progress?.currentStreakDays || 0);
  const successfulToday = Boolean(context.rowsByDate[context.todayKey]) &&
    calculateStreak({
      rowsByDate: context.rowsByDate,
      startDateKey: context.todayKey,
      endDateKey: context.todayKey,
      requiredDays: 1
    }).currentStreakDays === 1;
  const requiredDays = Number(badge.conditions.requiredStreakDays);
  const liveStreak = Math.min(requiredDays, current + (successfulToday ? 1 : 0));
  const completedOn = liveStreak >= requiredDays ? context.todayKey : null;
  const progress = buildProgress({
    reward: badge,
    oldProgress,
    progress: { currentStreakDays: liveStreak },
    completedOn: persistAchievements ? completedOn : null,
    progressStartDate: state.startDateKey,
    lastCalculatedUntil: oldProgress?.lastCalculatedUntil,
    now: context.now
  });
  await applyPreviewProgress(context, badge, oldProgress, progress, completedOn, persistAchievements);
}

async function applyTodayRecordDayPreview(context, persistAchievements) {
  const badges = orderBadges(context.definitions, BADGE_TYPES.RECORD_DAY);
  const state = currentSeriesState(
    badges,
    context.progressMap,
    context.accountStartKey,
    context.timeZone
  );
  if (state.index >= badges.length || state.startDateKey > context.todayKey) return;

  const badge = badges[state.index];
  if (!isValidOn(badge, context.todayKey, context.timeZone)) return;
  const oldProgress = context.progressMap.get(badge.rewardId);
  const result = calculateRecordDay({
    rowsByDate: context.rowsByDate,
    startDateKey: context.todayKey,
    endDateKey: context.todayKey,
    requiredCarbonKg: Number(badge.conditions.requiredRecordDayCarbonKg)
  });
  const progress = buildProgress({
    reward: badge,
    oldProgress,
    progress: { currentRecordDayCarbonKg: result.currentCarbonKg },
    completedOn: persistAchievements ? result.completedOn : null,
    progressStartDate: state.startDateKey,
    lastCalculatedUntil: oldProgress?.lastCalculatedUntil,
    now: context.now
  });
  await applyPreviewProgress(
    context,
    badge,
    oldProgress,
    progress,
    result.completedOn,
    persistAchievements
  );
}

async function applyTodayMonthlyPreview(context, persistAchievements) {
  const badge = selectCurrentMonthlyBadge(
    context.definitions,
    context.todayKey,
    context.timeZone
  );
  if (!badge) return;
  const oldProgress = context.progressMap.get(badge.rewardId);
  if (oldProgress?.isAchieved) return;

  const baseCarbonKg = Number(oldProgress?.progress?.currentChampionCarbonKg || 0);
  const result = calculateMonthlyChampion({
    rowsByDate: context.rowsByDate,
    startDateKey: context.todayKey,
    endDateKey: context.todayKey,
    requiredCarbonKg: Number(badge.conditions.requiredChampionCarbonKg),
    initialCarbonKg: baseCarbonKg
  });
  const progress = buildProgress({
    reward: badge,
    oldProgress,
    progress: { currentChampionCarbonKg: result.carbonKg },
    completedOn: persistAchievements ? result.completedOn : null,
    progressStartDate: dateKey(badge.validFrom, context.timeZone),
    lastCalculatedUntil: oldProgress?.lastCalculatedUntil,
    now: context.now
  });
  await applyPreviewProgress(
    context,
    badge,
    oldProgress,
    progress,
    result.completedOn,
    persistAchievements
  );
}

async function applyPreviewProgress(
  context,
  badge,
  oldProgress,
  progress,
  completedOn,
  persistAchievements
) {
  if (persistAchievements && completedOn) {
    await persistProgress(context.db, context.userId, badge, oldProgress, progress);
    context.newlyAchievedRewardIds.push(badge.rewardId);
  }
  context.progressMap.set(badge.rewardId, progress);
}

function currentSeriesState(badges, progressMap, accountStartKey, timeZone) {
  let index = 0;
  let startDateKey = accountStartKey;
  while (index < badges.length) {
    const badge = badges[index];
    const progress = progressMap.get(badge.rewardId);
    if (!progress?.isAchieved) break;
    const completedOn = completedDateKey(progress, badge, timeZone);
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

function completedDateKey(progress, badge, timeZone) {
  if (progress.completedOn) {
    if (typeof progress.completedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(progress.completedOn)) {
      return progress.completedOn;
    }
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VAL_INVALID_FORMAT,
      `Invalid badge progress completedOn date for reward ${badge.rewardId}. Expected YYYY-MM-DD.`
    );
  }

  if (!progress.detectedAt) return null;
  const detectedAt = toDate(progress.detectedAt);
  if (!detectedAt) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VAL_INVALID_FORMAT,
      `Invalid badge progress detectedAt date for reward ${badge.rewardId}. Expected a valid timestamp.`
    );
  }
  return dateKey(detectedAt, timeZone);
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
    calculationVersion: BADGE_CALCULATION_VERSION,
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
    calculationVersion: Number(data.calculationVersion || 1),
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
    'detectedAt', 'lastCalculatedUntil', 'calculationVersion'
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
