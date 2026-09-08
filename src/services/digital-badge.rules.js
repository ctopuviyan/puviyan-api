// Flutter supplies the user's current IANA timezone. UTC is used only when an
// older or unsupported client cannot provide one.
const DEFAULT_TIME_ZONE = 'UTC';
const ACHIEVED_VISIBILITY_DAYS = 7;
const MIN_DAILY_DISTANCE_KM = 3;
const MIN_DAILY_FLOORS = 5;

const BADGE_TYPES = Object.freeze({
  STREAK: 'puviStreaker',
  RECORD_DAY: 'recordDay',
  MONTHLY_CHAMPION: 'carbonImpactChampion'
});

function normalizeTimeZone(value) {
  if (!value) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch (_) {
    return DEFAULT_TIME_ZONE;
  }
}

function dateKey(value = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const date = toDate(value) || new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(key, days) {
  const [year, month, day] = String(key).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function maxDateKey(...values) {
  const keys = values.filter(Boolean);
  return keys.length === 0 ? null : keys.sort().at(-1);
}

function minDateKey(...values) {
  const keys = values.filter(Boolean);
  return keys.length === 0 ? null : keys.sort().at(0);
}

function dateRange(startKey, endKey) {
  if (!startKey || !endKey || startKey > endKey) return [];
  const result = [];
  for (let key = startKey; key <= endKey; key = addDays(key, 1)) {
    result.push(key);
  }
  return result;
}

function badgeType(reward) {
  return reward?.conditions?.badgeType || null;
}

function thresholdFor(reward) {
  switch (badgeType(reward)) {
    case BADGE_TYPES.STREAK:
      return Number(reward.conditions.requiredStreakDays || 0);
    case BADGE_TYPES.RECORD_DAY:
      return Number(reward.conditions.requiredRecordDayCarbonKg || 0);
    case BADGE_TYPES.MONTHLY_CHAMPION:
      return toDate(reward.validFrom)?.getTime() || 0;
    default:
      return Number.POSITIVE_INFINITY;
  }
}

function orderBadges(rewards, type) {
  return rewards
    .filter((reward) => badgeType(reward) === type)
    .slice()
    .sort((a, b) => {
      const threshold = thresholdFor(a) - thresholdFor(b);
      if (threshold !== 0) return threshold;
      const validFrom = (toDate(a.validFrom)?.getTime() || 0) -
        (toDate(b.validFrom)?.getTime() || 0);
      if (validFrom !== 0) return validFrom;
      return String(a.rewardId).localeCompare(String(b.rewardId));
    });
}

function isValidOn(reward, dayKey, timeZone = DEFAULT_TIME_ZONE) {
  const from = toDate(reward.validFrom);
  const to = toDate(reward.validTo);
  if (!from || !to) return false;
  return dayKey >= dateKey(from, timeZone) && dayKey <= dateKey(to, timeZone);
}

function selectCurrentMonthlyBadge(rewards, dayKey, timeZone = DEFAULT_TIME_ZONE) {
  return orderBadges(rewards, BADGE_TYPES.MONTHLY_CHAMPION)
    .find((reward) => isValidOn(reward, dayKey, timeZone)) || null;
}

function isSuccessfulStreakDay(row) {
  if (!row) return false;
  const distance = Number(row.distance ?? row.distanceKm ?? row.activeMobilityKm ?? 0);
  const floors = Number(row.flightsClimbed ?? row.floorsClimbed ?? 0);
  return distance >= MIN_DAILY_DISTANCE_KM || floors >= MIN_DAILY_FLOORS;
}

function carbonKgFromDailyData(row) {
  if (!row) return 0;
  if (Number.isFinite(Number(row.co2))) return Number(row.co2);
  if (Number.isFinite(Number(row.co2SavedKg))) return Number(row.co2SavedKg);
  const active = Number(row.activeCo2 || 0);
  const climbing = Number(row.climbingCo2 || 0);
  if (active > 0 || climbing > 0) return active + climbing;
  const grams = Number(row.co2SavedGrams || 0);
  return grams > 0 ? grams / 1000 : 0;
}

function calculateStreak({
  rowsByDate,
  startDateKey,
  endDateKey,
  requiredDays,
  initialStreakDays = 0,
  preserveIncompleteEnd = true
}) {
  let currentStreakDays = initialStreakDays;

  for (const key of dateRange(startDateKey, endDateKey)) {
    if (isSuccessfulStreakDay(rowsByDate[key])) {
      currentStreakDays += 1;
      if (currentStreakDays >= requiredDays) {
        return { currentStreakDays: requiredDays, completedOn: key };
      }
    } else if (!preserveIncompleteEnd || key !== endDateKey) {
      currentStreakDays = 0;
    }
  }

  return { currentStreakDays, completedOn: null };
}

function calculateRecordDay({ rowsByDate, startDateKey, endDateKey, requiredCarbonKg }) {
  for (const key of dateRange(startDateKey, endDateKey)) {
    const carbonKg = carbonKgFromDailyData(rowsByDate[key]);
    if (carbonKg >= requiredCarbonKg) {
      return { completedOn: key, currentCarbonKg: requiredCarbonKg };
    }
  }
  return {
    completedOn: null,
    currentCarbonKg: carbonKgFromDailyData(rowsByDate[endDateKey])
  };
}

function calculateMonthlyChampion({
  rowsByDate,
  startDateKey,
  endDateKey,
  requiredCarbonKg,
  initialCarbonKg = 0
}) {
  let carbonKg = initialCarbonKg;
  let completedOn = null;

  for (const key of dateRange(startDateKey, endDateKey)) {
    const dailyCarbon = carbonKgFromDailyData(rowsByDate[key]);
    if (dailyCarbon > 0) {
      carbonKg += dailyCarbon;
      if (!completedOn && carbonKg >= requiredCarbonKg) completedOn = key;
    }
  }

  return { carbonKg, completedOn };
}

function isAchievedVisible(progress, now = new Date()) {
  if (!progress?.isAchieved) return false;
  const achievedAt = toDate(progress.achievedAt);
  if (!achievedAt) return false;
  return now.getTime() < achievedAt.getTime() + ACHIEVED_VISIBILITY_DAYS * 86400000;
}

function validateConditions(conditions) {
  if (!conditions || conditions.isEnabled === false) return false;
  switch (conditions.badgeType) {
    case BADGE_TYPES.STREAK:
      return Number(conditions.requiredStreakDays) > 0;
    case BADGE_TYPES.RECORD_DAY:
      return Number(conditions.requiredRecordDayCarbonKg) > 0;
    case BADGE_TYPES.MONTHLY_CHAMPION:
      return Number(conditions.requiredChampionCarbonKg) > 0;
    default:
      return false;
  }
}

module.exports = {
  ACHIEVED_VISIBILITY_DAYS,
  BADGE_TYPES,
  DEFAULT_TIME_ZONE,
  MIN_DAILY_DISTANCE_KM,
  MIN_DAILY_FLOORS,
  addDays,
  badgeType,
  calculateMonthlyChampion,
  calculateRecordDay,
  calculateStreak,
  carbonKgFromDailyData,
  dateKey,
  dateRange,
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
};
