// RoomSync local-only persistence. No Firebase calls or cloud synchronization.
// One versioned JSON document makes related writes atomic within localStorage.
// Web Locks serialize writes across same-origin tabs when supported. This is
// convenience-only account isolation, NOT a trusted security boundary.
export const DATABASE_KEY = 'roomsync.local.database.v1';
export const SESSION_KEY = 'roomsync.local.session.v1';
const listeners = new Set();

export function readDatabase() {
  const raw = localStorage.getItem(DATABASE_KEY);
  if (!raw) return { version: 1, users: {}, households: {}, invites: {} };
  let data;
  try { data = JSON.parse(raw); } catch {
    throw new Error('RoomSync local data is unreadable. Back up browser storage before resetting it.');
  }
  if (data.version !== 1 || !data.users || !data.households || !data.invites) {
    throw new Error('Unsupported RoomSync local database. Existing data has not been changed.');
  }
  return data;
}

function emit() {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === DATABASE_KEY || event.key === SESSION_KEY || event.key === null) emit();
  });
}

export function subscribeLocal(callback, onError = () => {}) {
  let active = true;
  const run = () => queueMicrotask(() => {
    if (!active) return;
    try { callback(); } catch (error) { onError(error); }
  });
  listeners.add(run);
  run();
  return () => { active = false; listeners.delete(run); };
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch {
    throw new Error('Browser storage is full or disabled. Remove large images or back up data and free space, then retry. No database changes were saved.');
  }
}

export async function mutateDatabase(update) {
  const commit = () => {
    const data = readDatabase();
    const result = update(data);
    // Update functions must be synchronous; hash passwords/read files before
    // opening a mutation, keeping the read-modify-write operation indivisible.
    if (result instanceof Promise) throw new Error('Local transaction must be synchronous');
    writeStorage(DATABASE_KEY, JSON.stringify(data));
    emit();
    return result;
  };
  if (globalThis.navigator?.locks?.request) {
    return navigator.locks.request('roomsync-local-database', commit);
  }
  return commit();
}

export function sessionUid() {
  return localStorage.getItem(SESSION_KEY);
}

export function saveSession(uid) {
  if (uid) writeStorage(SESSION_KEY, uid);
  else localStorage.removeItem(SESSION_KEY);
  emit();
}

// The UI consumes timestamps via .seconds / .toDate(). Store plain milliseconds
// and hydrate only public read snapshots, not the persisted JSON document.
const timestampFields = new Set(['createdAt', 'updatedAt', 'joinedAt', 'paidAt', 'completedAt', 'purchasedAt']);
export function publicRecord(value, field = '') {
  if (typeof value === 'number' && timestampFields.has(field)) {
    return { seconds: Math.floor(value / 1000), toDate: () => new Date(value) };
  }
  if (Array.isArray(value)) return value.map((item) => publicRecord(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, publicRecord(item, key)]));
  }
  return value;
}

export function requireUser(data) {
  const user = data.users[sessionUid()];
  if (!user) throw new Error('Please sign in to your local account.');
  return user;
}

export function requireHousehold(data, hid, roles) {
  const user = requireUser(data);
  const household = data.households[hid];
  const member = household?.members[user.uid];
  if (!household || !member) throw new Error('You are not a member of this local household.');
  if (roles && !roles.includes(member.role)) throw new Error('Your role does not permit this action.');
  return { user, household, member };
}

export function listHouseholdRecords(hid, collection, callback, onError, sort) {
  return subscribeLocal(() => {
    const { household } = requireHousehold(readDatabase(), hid);
    let records = Object.values(household[collection] || {});
    if (sort) records = records.sort(sort);
    callback(records.map((record) => publicRecord(record)));
  }, onError);
}

export async function imageDataUrl(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, WebP or GIF image.');
  }
  // localStorage is commonly limited to a few MB; cap each embedded image.
  if (file.size > 512 * 1024) throw new Error('Local images must be at most 512 KB. Resize the image before uploading.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read this image.'));
    reader.readAsDataURL(file);
  });
}
