// features/avatars.js
// Feature-layer pass-through for Matrix PROFILE avatars. Avatars are an
// account-level concern — a user's profile picture, the same in every room and
// client — NOT protocol/Spine data. They never touch the rotation, the event
// log, or any ddjp.* event (the deliberate account-level exception to "no media
// over Matrix" — see 06_fundamentals.md).
//
// Why this module exists: the UI needs avatars, but ui/ must never reach into
// transport directly (the layer boundary enforced by tests/check-boundaries.js).
// So the UI talks to Avatars, and Avatars talks to MatrixBridge. There is no
// logic or state here — every call forwards straight to the bridge. This keeps
// the boundary wall literally intact (ui → features → transport) without
// weakening the guard.
// Depends on: MatrixBridge

const Avatars = (() => {
  // Cached profile-avatar URL for a user (a blob: URL), or null until it loads.
  // Synchronous: returns whatever the bridge has cached and kicks off an async
  // fetch on a miss (the bridge fires onAvatarChange when it resolves).
  function getAvatarUrl(userId) {
    return MatrixBridge.getAvatarUrl ? MatrixBridge.getAvatarUrl(userId) : null;
  }

  // Subscribe / unsubscribe to "a user's avatar resolved or changed" so the UI
  // can swap the picture in live.
  function onAvatarChange(fn) {
    if (MatrixBridge.onAvatarChange) MatrixBridge.onAvatarChange(fn);
  }
  function offAvatarChange(fn) {
    if (MatrixBridge.offAvatarChange) MatrixBridge.offAvatarChange(fn);
  }

  // Upload a new profile picture for the current user. Validates + sets the
  // global Matrix avatar; resolves { ok: true } or { ok: false, reason } and
  // never throws, so the UI can show a clean message.
  function uploadAvatar(file) {
    if (!MatrixBridge.uploadAvatar) return Promise.resolve({ ok: false, reason: "avatars unavailable" });
    return MatrixBridge.uploadAvatar(file);
  }

  return { getAvatarUrl, onAvatarChange, offAvatarChange, uploadAvatar };
})();
