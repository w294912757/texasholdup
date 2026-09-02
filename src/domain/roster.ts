import { createRandom } from "./cards";
import {
  difficultyBandForTier,
  matchReplacementAiProfile,
  type DifficultyBand,
} from "./matching";
import type {
  AiRotationDetails,
  AiTableState,
  GameSession,
  SeatProfile,
} from "./types";

const RECENT_HAND_WINDOW = 5;
const NEW_PLAYER_PROTECTION_HANDS = 3;
const MAX_VOLUNTARY_DEPARTURES = 2;

export interface AiRosterChange {
  type: "left" | "joined";
  playerId: string;
  name: string;
  details: AiRotationDetails;
}

export interface AiRosterRotation {
  roster: SeatProfile[];
  stacks: Record<string, number>;
  aiStates: Record<string, AiTableState>;
  changes: AiRosterChange[];
}

interface DepartureCandidate {
  profile: SeatProfile;
  state: AiTableState;
  details: AiRotationDetails;
  forced: boolean;
}

function streakLength(results: number[], direction: "win" | "loss"): number {
  let streak = 0;
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index] ?? 0;
    if (direction === "win" ? result <= 0 : result >= 0) break;
    streak += 1;
  }
  return streak;
}

export function aiDepartureProbability(
  state: AiTableState,
  remainingStack: number,
): number {
  if (remainingStack <= 0) return 1;
  if (state.handsPlayed < NEW_PLAYER_PROTECTION_HANDS) return 0;

  const stackRatio = remainingStack / Math.max(1, state.entryStack);
  const recentNet = state.recentNetResults.reduce(
    (sum, result) => sum + result,
    0,
  );
  const recentRatio = recentNet / Math.max(1, state.entryStack);
  let probability = 0.04;

  if (stackRatio < 0.25) probability += 0.5;
  else if (stackRatio < 0.5) probability += 0.25;
  else if (stackRatio < 0.75) probability += 0.1;

  if (recentRatio <= -0.5) probability += 0.2;
  else if (recentRatio <= -0.25) probability += 0.1;
  else if (recentRatio >= 0.5) probability += 0.08;
  else if (recentRatio >= 0.25) probability += 0.04;

  if (streakLength(state.recentNetResults, "loss") >= 3) probability += 0.12;
  if (streakLength(state.recentNetResults, "win") >= 3) probability += 0.06;
  if (state.handsPlayed >= 12) probability += 0.08;
  else if (state.handsPlayed >= 8) probability += 0.04;

  return Math.min(0.9, probability);
}

function updatedState(
  session: GameSession,
  profile: SeatProfile,
  remainingStack: number,
): AiTableState {
  const existing = session.aiStates?.[profile.id];
  if (!existing) {
    return {
      playerId: profile.id,
      joinedHand: 1,
      handsPlayed: session.completedHands,
      entryStack: session.config.buyIn,
      lastStack: remainingStack,
      recentNetResults: [],
    };
  }

  const netResult = remainingStack - existing.lastStack;
  return {
    ...existing,
    handsPlayed: existing.handsPlayed + 1,
    lastStack: remainingStack,
    recentNetResults: [...existing.recentNetResults, netResult].slice(
      -RECENT_HAND_WINDOW,
    ),
  };
}

function profileBand(
  profile: SeatProfile,
  playerLevel: number,
): DifficultyBand {
  return (
    profile.aiBand ??
    difficultyBandForTier(playerLevel, profile.aiTier ?? playerLevel)
  );
}

export function rotateAiRoster(
  session: GameSession,
  playerLevel: number,
): AiRosterRotation {
  const random = createRandom(
    `${session.seed}:rotation:${session.completedHands}`,
  );
  const aiProfiles = session.roster
    .filter((profile) => !profile.isHuman)
    .sort((left, right) => left.seat - right.seat);
  const states: Record<string, AiTableState> = {};
  const candidates = aiProfiles.map((profile): DepartureCandidate => {
    const remainingStack = session.stacks[profile.id] ?? 0;
    const state = updatedState(session, profile, remainingStack);
    states[profile.id] = state;
    const probability = aiDepartureProbability(state, remainingStack);
    const roll = random();
    return {
      profile,
      state,
      forced: remainingStack <= 0,
      details: {
        seat: profile.seat,
        reason: remainingStack <= 0 ? "busted" : "voluntary",
        remainingStack,
        handsPlayed: state.handsPlayed,
        recentNet: state.recentNetResults.reduce(
          (sum, result) => sum + result,
          0,
        ),
        probability,
        roll,
        aiTier: profile.aiTier,
        aiBand: profileBand(profile, playerLevel),
      },
    };
  });
  const forced = candidates.filter((candidate) => candidate.forced);
  const voluntary = candidates
    .filter(
      (candidate) =>
        !candidate.forced &&
        (candidate.details.roll ?? 1) < (candidate.details.probability ?? 0),
    )
    .sort(
      (left, right) =>
        (left.details.roll ?? 1) / (left.details.probability ?? 1) -
        (right.details.roll ?? 1) / (right.details.probability ?? 1),
    )
    .slice(0, MAX_VOLUNTARY_DEPARTURES);
  const departing = [...forced, ...voluntary].sort(
    (left, right) => left.profile.seat - right.profile.seat,
  );
  const departingIds = new Set(
    departing.map((candidate) => candidate.profile.id),
  );
  const roster = session.roster.filter(
    (profile) => !departingIds.has(profile.id),
  );
  const stacks = { ...session.stacks };
  const changes: AiRosterChange[] = [];
  const excludedNames = new Set(
    session.roster
      .filter((profile) => !profile.isHuman)
      .map((profile) => profile.name),
  );
  const joinedProfiles: SeatProfile[] = [];

  for (const candidate of departing) {
    delete stacks[candidate.profile.id];
    delete states[candidate.profile.id];
    changes.push({
      type: "left",
      playerId: candidate.profile.id,
      name: candidate.profile.name,
      details: candidate.details,
    });

    const id = `ai-${candidate.profile.seat}-h${session.completedHands + 1}`;
    const replacement = matchReplacementAiProfile(
      playerLevel,
      `${session.seed}:replacement:${session.completedHands}:${candidate.profile.seat}`,
      id,
      excludedNames,
    );
    excludedNames.add(replacement.name);
    const joined: SeatProfile = {
      id: replacement.id,
      name: replacement.name,
      seat: candidate.profile.seat,
      isHuman: false,
      avatarKey: replacement.avatarKey,
      aiTier: replacement.tier,
      aiBand: replacement.band,
    };
    roster.push(joined);
    joinedProfiles.push(joined);
    stacks[joined.id] = session.config.buyIn;
    states[joined.id] = {
      playerId: joined.id,
      joinedHand: session.completedHands + 1,
      handsPlayed: 0,
      entryStack: session.config.buyIn,
      lastStack: session.config.buyIn,
      recentNetResults: [],
    };
    changes.push({
      type: "joined",
      playerId: joined.id,
      name: joined.name,
      details: {
        seat: joined.seat,
        reason: "replacement",
        remainingStack: session.config.buyIn,
        handsPlayed: 0,
        recentNet: 0,
        aiTier: joined.aiTier,
        aiBand: joined.aiBand,
      },
    });
  }

  const finalAiProfiles = roster.filter((profile) => !profile.isHuman);
  const finalBands = new Set(
    finalAiProfiles.map((profile) => profileBand(profile, playerLevel)),
  );
  if (finalAiProfiles.length > 1 && finalBands.size === 1) {
    const lastJoined = joinedProfiles.at(-1);
    if (lastJoined) {
      const currentBand = profileBand(lastJoined, playerLevel);
      const replacement = matchReplacementAiProfile(
        playerLevel,
        `${session.seed}:replacement:${session.completedHands}:${lastJoined.seat}:diverse`,
        lastJoined.id,
        new Set(
          roster
            .filter((profile) => profile.id !== lastJoined.id)
            .map((profile) => profile.name),
        ),
        currentBand,
      );
      lastJoined.name = replacement.name;
      lastJoined.avatarKey = replacement.avatarKey;
      lastJoined.aiTier = replacement.tier;
      lastJoined.aiBand = replacement.band;
      const joinedChange = changes.find(
        (change) =>
          change.type === "joined" && change.playerId === lastJoined.id,
      );
      if (joinedChange) {
        joinedChange.name = replacement.name;
        joinedChange.details.aiTier = replacement.tier;
        joinedChange.details.aiBand = replacement.band;
      }
    }
  }

  return {
    roster: roster.sort((left, right) => left.seat - right.seat),
    stacks,
    aiStates: states,
    changes,
  };
}
