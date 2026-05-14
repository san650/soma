const indexOfId = (arr, id) => arr.findIndex((x) => x.id === id);

const upsertIn = (arr, item) => {
  const i = indexOfId(arr, item.id);
  if (i === -1) return [...arr, item];
  return [...arr.slice(0, i), item, ...arr.slice(i + 1)];
};

const removeFrom = (arr, id) => arr.filter((x) => x.id !== id);

export const COMMANDS = {
  ADD_MEDICATION: {
    apply: (s, p) => { s.medications = upsertIn(s.medications, p.to); },
    revert: (s, p) => { s.medications = removeFrom(s.medications, p.to.id); },
    coalesceKey: (p) => p.to.id,
  },
  UPDATE_MEDICATION: {
    apply: (s, p) => { s.medications = upsertIn(s.medications, p.to); },
    revert: (s, p) => { s.medications = upsertIn(s.medications, p.from); },
    coalesceKey: (p) => p.to.id,
  },
  REMOVE_MEDICATION: {
    apply: (s, p) => { s.medications = removeFrom(s.medications, p.from.id); },
    revert: (s, p) => { s.medications = upsertIn(s.medications, p.from); },
    coalesceKey: (p) => p.from.id,
  },
  LOG_DOSE: {
    apply: (s, p) => { s.doseLogs = upsertIn(s.doseLogs, p.to); },
    revert: (s, p) => { s.doseLogs = removeFrom(s.doseLogs, p.to.id); },
    coalesceKey: (p) => p.to.id,
  },
  UNLOG_DOSE: {
    apply: (s, p) => { s.doseLogs = removeFrom(s.doseLogs, p.from.id); },
    revert: (s, p) => { s.doseLogs = upsertIn(s.doseLogs, p.from); },
    coalesceKey: (p) => p.from.id,
  },
};

export const makeCommand = (type, payload) => ({ type, payload });

export const coalesceKeyOf = (cmd) =>
  `${cmd.type}:${COMMANDS[cmd.type].coalesceKey(cmd.payload)}`;

export const isNoOp = (cmd) => cmd.payload.from === cmd.payload.to;
