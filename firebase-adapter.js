(function () {
  "use strict";

  const CDN_BASE = "https://www.gstatic.com/firebasejs/10.14.1/";
  const DATASETS = Array.isArray(window.__FIREBASE_DATASET_NAMES__)
    ? window.__FIREBASE_DATASET_NAMES__.slice()
    : ["itinerary", "tickets", "flights", "accommodations", "expenses", "reservedExpenses"];
  const DEFAULT_TRIP_ID = String(window.__FIREBASE_TRIP_ID__ || "japan-tokyo-2026");
  let activeTripId = String(window.__ACTIVE_TRIP_ID__ || DEFAULT_TRIP_ID);
  const config = window.__FIREBASE_CONFIG__ || {};
  let initPromise = null;

  function withTimeout(promise, milliseconds, code, message) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () {
          const error = new Error(message || "Firebase \u9023\u7dda\u903e\u6642\uff0c\u8acb\u78ba\u8a8d\u624b\u6a5f\u7db2\u8def\u5f8c\u91cd\u8a66\u3002");
          error.code = code || "auth/network-request-failed";
          reject(error);
        }, milliseconds);
      })
    ]);
  }

  function configured() {
    return Boolean(
      config.projectId &&
      config.apiKey &&
      config.appId &&
      config.messagingSenderId
    );
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const existing = document.querySelector('script[data-firebase-src="' + src + '"]');
      let settled = false;
      let timer = null;
      const finish = function (error) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      timer = setTimeout(function () {
        const error = new Error("Firebase SDK \u8f09\u5165\u903e\u6642\uff0c\u8acb\u78ba\u8a8d\u624b\u6a5f\u7db2\u8def\u6216\u95dc\u9589\u5167\u5bb9\u963b\u64cb\u5668\u5f8c\u91cd\u8a66\u3002");
        error.code = "auth/network-request-failed";
        finish(error);
      }, 12000);
      if (existing) {
        if (window.firebase) return finish();
        existing.addEventListener("load", function () { finish(); }, { once: true });
        existing.addEventListener("error", function () { finish(new Error("Firebase SDK \u8f09\u5165\u5931\u6557\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u9801\u9762\u3002")); }, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.firebaseSrc = src;
      script.onload = function () { finish(); };
      script.onerror = function () { finish(new Error("Firebase SDK \u8f09\u5165\u5931\u6557\uff1a" + src)); };
      document.head.appendChild(script);
    });
  }

  function userLabel(user, member) {
    return {
      id: user.uid,
      name: member?.name || user.displayName || user.email || user.uid,
      email: user.email || "",
      role: member?.role || "viewer",
      status: member?.status || "active",
      provider: "firebase"
    };
  }

  function normalizeTripId(value) {
    const tripId = String(value || "").trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,96}$/.test(tripId)) throw new Error("\u65c5\u884c ID \u683c\u5f0f\u4e0d\u6b63\u78ba\u3002");
    return tripId;
  }

  function tripPath(tripId = activeTripId) {
    return "trips/" + normalizeTripId(tripId);
  }

  function memberRef(tripId, uid) {
    return firestore().doc(tripPath(tripId) + "/members/" + String(uid));
  }

  async function memberFor(user, tripId = activeTripId) {
    if (!user) throw new Error("\u8acb\u5148\u767b\u5165\u3002");
    const snapshot = await memberRef(tripId, user.uid).get({ source: "server" });
    if (!snapshot.exists) {
      const error = new Error("\u6b64\u5e33\u865f\u5c1a\u672a\u52a0\u5165\u9019\u8d9f\u65c5\u884c\u3002");
      error.code = "TRIP_MEMBER_REQUIRED";
      throw error;
    }
    const member = snapshot.data() || {};
    if (member.status !== "active") {
      const error = new Error("\u6b64\u65c5\u4f34\u5e33\u865f\u5df2\u505c\u7528\u3002");
      error.code = "ACCOUNT_DISABLED";
      throw error;
    }
    return member;
  }

  async function ensureInitialized() {
    if (!configured()) {
      const error = new Error("\u5c1a\u672a\u586b\u5165 Firebase Web App config\u3002");
      error.code = "FIREBASE_CONFIG_MISSING";
      throw error;
    }
    if (!initPromise) {
      initPromise = (async function () {
        await loadScript(CDN_BASE + "firebase-app-compat.js");
        await loadScript(CDN_BASE + "firebase-auth-compat.js");
        await loadScript(CDN_BASE + "firebase-firestore-compat.js");
        if (!window.firebase) throw new Error("Firebase SDK \u5c1a\u672a\u53ef\u7528\u3002");
        if (!window.firebase.apps.length) window.firebase.initializeApp(config);
        return { app: window.firebase.app(), auth: window.firebase.auth(), db: window.firebase.firestore() };
      }());
    }
    return initPromise;
  }

  function firestore() {
    if (!window.firebase || !window.firebase.firestore) throw new Error("Firestore \u5c1a\u672a\u521d\u59cb\u5316\u3002");
    return window.firebase.firestore();
  }

  async function signIn(email, password, remember = true) {
    const sdk = await withTimeout(ensureInitialized(), 15000, "auth/network-request-failed", "Firebase SDK \u8f09\u5165\u903e\u6642\uff0c\u8acb\u78ba\u8a8d\u624b\u6a5f\u7db2\u8def\u5f8c\u91cd\u8a66\u3002");
    const persistence = window.firebase.auth.Auth.Persistence;
    try {
      await withTimeout(sdk.auth.setPersistence(remember ? persistence.LOCAL : persistence.SESSION), 8000, "auth/unsupported-persistence-type", "\u624b\u6a5f\u66ab\u6642\u7121\u6cd5\u4fdd\u5b58\u767b\u5165\u72c0\u614b\u3002");
    } catch (persistenceError) {
      // \u90e8\u5206 iOS \u79c1\u5bc6\u700f\u89bd\u3001\u5167\u5d4c\u700f\u89bd\u5668\u6216 PWA \u5bb9\u5668\u6703\u62d2\u7d55 IndexedDB\u3002
      // \u964d\u7d1a\u5230\u5de5\u4f5c\u968e\u6bb5\u5132\u5b58\uff0c\u4ecd\u5141\u8a31\u672c\u6b21\u767b\u5165\u5b8c\u6210\uff0c\u4e0d\u963b\u64cb\u4f7f\u7528\u8005\u9032\u5165 App\u3002
      console.warn("Firebase persistence fallback", persistenceError);
      try {
        await withTimeout(sdk.auth.setPersistence(persistence.SESSION), 5000, "auth/unsupported-persistence-type", "\u624b\u6a5f\u66ab\u6642\u7121\u6cd5\u4fdd\u5b58\u767b\u5165\u72c0\u614b\u3002");
      } catch (sessionPersistenceError) {
        console.warn("Firebase session persistence unavailable", sessionPersistenceError);
      }
    }
    const credential = await withTimeout(
      sdk.auth.signInWithEmailAndPassword(String(email || "").trim(), String(password || "")),
      20000,
      "auth/network-request-failed",
      "\u767b\u5165\u9023\u7dda\u903e\u6642\uff0c\u8acb\u78ba\u8a8d\u624b\u6a5f\u7db2\u8def\u5f8c\u91cd\u8a66\u3002"
    );
    try {
      return { user: userLabel(credential.user, null) };
    } catch (error) {
      await sdk.auth.signOut();
      throw error;
    }
  }

  async function currentSession() {
    const sdk = await withTimeout(ensureInitialized(), 15000, "auth/network-request-failed", "Firebase SDK \u8f09\u5165\u903e\u6642\uff0c\u8acb\u78ba\u8a8d\u624b\u6a5f\u7db2\u8def\u5f8c\u91cd\u8a66\u3002");
    const user = await new Promise((resolve, reject) => {
      let settled = false;
      let unsubscribe = () => {};
      let timer = null;
      const finish = function (error, current) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        unsubscribe();
        if (error) reject(error); else resolve(current);
      };
      timer = setTimeout(function () {
        const error = new Error("Firebase \u767b\u5165\u72c0\u614b\u6062\u5fa9\u903e\u6642\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u5f8c\u518d\u8a66\u3002");
        error.code = "auth/network-request-failed";
        finish(error);
      }, 12000);
      unsubscribe = sdk.auth.onAuthStateChanged(
        current => finish(null, current),
        error => finish(error)
      );
    });
    if (!user) return null;
    return { user: userLabel(user, null) };
  }

  async function sendPasswordReset(email) {
    const sdk = await ensureInitialized();
    try {
      await sdk.auth.sendPasswordResetEmail(String(email || "").trim());
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
  }

  async function signOut() {
    const sdk = await ensureInitialized();
    await sdk.auth.signOut();
  }

  async function changePassword(currentPassword, newPassword) {
    const sdk = await ensureInitialized();
    const user = sdk.auth.currentUser;
    if (!user || !user.email) throw new Error("\u8acb\u5148\u767b\u5165\u3002");
    const credential = window.firebase.auth.EmailAuthProvider.credential(user.email, String(currentPassword || ""));
    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(String(newPassword || ""));
    return { token: await user.getIdToken(true), user: userLabel(user, await memberFor(user)) };
  }

  function datasetRef(dataset, tripId = activeTripId) {
    if (!DATASETS.includes(dataset)) throw new Error("\u4e0d\u652f\u63f4\u7684 Firestore \u8cc7\u6599\u96c6\uff1a" + dataset);
    return firestore().doc(tripPath(tripId) + "/datasets/" + dataset);
  }

  function stripClientMeta(record) {
    const value = record && typeof record === "object" ? { ...record } : {};
    delete value._cloudVersion;
    delete value._cloudUpdatedAt;
    delete value._cloudUpdatedBy;
    delete value._deleted;
    return value;
  }

  function stableRecords(records) {
    return (Array.isArray(records) ? records : []).filter(item => item && String(item.id || "").trim()).map(item => ({
      ...item,
      id: String(item.id)
    }));
  }

  async function readSnapshot(tripId = activeTripId) {
    await ensureInitialized();
    const selectedTripId = normalizeTripId(tripId);
    await memberFor(window.firebase.auth().currentUser, selectedTripId);
    const revisions = {};
    const entries = await Promise.all(DATASETS.map(async dataset => {
      const snapshot = await datasetRef(dataset, selectedTripId).get({ source: "server" });
      const data = snapshot.exists ? snapshot.data() || {} : {};
      const records = Array.isArray(data.records) ? data.records.filter(item => !item._deleted) : [];
      if (snapshot.exists && !Array.isArray(data.records)) {
        throw new Error("\u96f2\u7aef\u8cc7\u6599\u683c\u5f0f\u8207 App \u4e0d\u76f8\u5bb9\uff1a" + dataset);
      }
      revisions[dataset] = { revision: Number(data.revision || 0), updatedAt: data.updatedAt || null };
      return [dataset, records.map(item => ({ ...item, _cloudVersion: Number(item._cloudVersion || 1), _cloudUpdatedAt: data.updatedAt || "", _cloudUpdatedBy: data.updatedBy || "" }))];
    }));
    return { trip: { id: selectedTripId }, datasets: Object.fromEntries(entries), revisions };
  }

  async function writeDataset(dataset, incomingRecords, expectedRevision, tripId = activeTripId) {
    await ensureInitialized();
    const user = window.firebase.auth().currentUser;
    const selectedTripId = normalizeTripId(tripId);
    const member = await memberFor(user, selectedTripId);
    if (!["admin", "editor"].includes(member.role)) {
      const error = new Error("\u6aa2\u8996\u8005\u4e0d\u80fd\u4fee\u6539\u65c5\u7a0b\u8cc7\u6599\u3002");
      error.code = "FORBIDDEN";
      throw error;
    }
    const incoming = stableRecords(incomingRecords);
    const ref = datasetRef(dataset, selectedTripId);
    const result = await firestore().runTransaction(async function (transaction) {
      const snapshot = await transaction.get(ref);
      const currentData = snapshot.exists ? snapshot.data() || {} : {};
      const revision = Number(currentData.revision || 0);
      if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== revision) {
        const error = new Error("Firestore \u8cc7\u6599\u96c6\u7248\u672c\u885d\u7a81\uff0c\u8acb\u5148\u91cd\u65b0\u8f09\u5165\u3002");
        error.code = "REVISION_CONFLICT";
        error.details = { dataset, expectedRevision: Number(expectedRevision), currentRevision: revision };
        throw error;
      }
      const current = Array.isArray(currentData.records) ? currentData.records : [];
      const currentById = new Map(current.map(item => [String(item.id), item]));
      const next = incoming.map(item => {
        const old = currentById.get(item.id);
        const expectedVersion = Number(item._cloudVersion || 0);
        if (old && expectedVersion !== Number(old._cloudVersion || 0)) {
          const error = new Error("Firestore \u55ae\u7b46\u8cc7\u6599\u7248\u672c\u885d\u7a81\uff0c\u8acb\u5148\u91cd\u65b0\u8f09\u5165\u3002");
          error.code = "RECORD_CONFLICT";
          error.details = { dataset, id: item.id, expectedVersion, currentVersion: Number(old._cloudVersion || 0) };
          throw error;
        }
        return { ...stripClientMeta(item), id: item.id, _cloudVersion: Number(old?._cloudVersion || 0) + 1, _deleted: false };
      });
      const incomingIds = new Set(incoming.map(item => item.id));
      current.forEach(item => {
        if (!incomingIds.has(String(item.id)) && !item._deleted) next.push({ ...item, _cloudVersion: Number(item._cloudVersion || 0) + 1, _deleted: true });
      });
      const nextRevision = revision + 1;
      transaction.set(ref, {
        tripId: selectedTripId,
        dataset,
        revision: nextRevision,
        updatedAt: new Date().toISOString(),
        updatedBy: user.uid,
        records: next
      });
      return { dataset, revision: nextRevision, records: next.filter(item => !item._deleted) };
    });
    return result;
  }

  async function previewImport(datasets, tripId = activeTripId) {
    const snapshot = await readSnapshot(tripId);
    const preview = {};
    DATASETS.forEach(dataset => {
      const current = snapshot.datasets?.[dataset] || [];
      const incoming = stableRecords(datasets?.[dataset] || []);
      const currentIds = new Set(current.map(item => String(item.id)));
      const incomingIds = new Set(incoming.map(item => String(item.id)));
      preview[dataset] = {
        current: current.length,
        incoming: incoming.length,
        added: [...incomingIds].filter(id => !currentIds.has(id)).length,
        updated: [...incomingIds].filter(id => currentIds.has(id)).length,
        removed: [...currentIds].filter(id => !incomingIds.has(id)).length
      };
    });
    return { tripId: normalizeTripId(tripId), preview, requiresConfirmation: true };
  }

  async function importDatasets(datasets, revisions, tripId = activeTripId) {
    const result = {};
    for (const dataset of DATASETS) {
      result[dataset] = await writeDataset(dataset, datasets?.[dataset] || [], revisions?.[dataset]?.revision, tripId);
    }
    return result;
  }

  async function tripFor(tripId = activeTripId) {
    await ensureInitialized();
    const selectedTripId = normalizeTripId(tripId);
    const user = window.firebase.auth().currentUser;
    const member = await memberFor(user, selectedTripId);
    const fallback = selectedTripId === DEFAULT_TRIP_ID ? {
      name: "Japan Tokyo\uff5c\u65c5\u3059\u308b\u624b\u5e33",
      destination: "\u6771\u4eac",
      startDate: "2026-11-28",
      endDate: "2026-12-06",
      timezone: "Asia/Tokyo",
      currency: "JPY",
      settlementCurrency: "TWD",
      theme: "postcard",
      status: "active",
      ownerId: member.role === "admin" ? member.uid || user.uid : ""
    } : {};
    let snapshot = null;
    try {
      snapshot = await firestore().doc(tripPath(selectedTripId)).get({ source: "server" });
    } catch (error) {
      if (selectedTripId !== DEFAULT_TRIP_ID) throw error;
      console.warn("\u820a Firestore \u898f\u5247\u5c1a\u672a\u958b\u653e\u65c5\u884c\u8a2d\u5b9a\u8b80\u53d6\uff0c\u4f7f\u7528\u6771\u4eac\u76f8\u5bb9\u8a2d\u5b9a\uff1a", error);
    }
    if (snapshot && !snapshot.exists && selectedTripId !== DEFAULT_TRIP_ID) throw new Error("\u627e\u4e0d\u5230\u9019\u8d9f\u65c5\u884c\u8a2d\u5b9a\u3002");
    const stored = snapshot?.data() || {};
    const hasTripSettings = Boolean(stored.startDate && stored.endDate && stored.destination);
    return { id: selectedTripId, ...fallback, ...(selectedTripId === DEFAULT_TRIP_ID && !hasTripSettings ? {} : stored), member };
  }

  async function listTrips() {
    await ensureInitialized();
    const user = window.firebase.auth().currentUser;
    if (!user) return [];
    let refsSnapshot = null;
    try {
      refsSnapshot = await firestore().collection("users").doc(user.uid).collection("tripRefs").get({ source: "server" });
    } catch (error) {
      // \u820a\u898f\u5247\u5c1a\u672a\u90e8\u7f72\u6642\uff0c\u5148\u8d70\u65e2\u6709\u6771\u4eac members \u6587\u4ef6\u76f8\u5bb9\u8def\u5f91\u3002
      console.warn("\u65c5\u884c\u7d22\u5f15\u5c1a\u672a\u53ef\u8b80\uff0c\u6539\u7528\u65e2\u6709\u6210\u54e1\u6587\u4ef6\uff1a", error);
    }
    const ids = new Set((refsSnapshot?.docs || []).map(doc => doc.id));
    // \u820a\u6771\u4eac\u65c5\u7a0b\u6c92\u6709\u7d22\u5f15\u6642\uff0c\u4ecd\u900f\u904e\u65e2\u6709 members \u6587\u4ef6\u76f8\u5bb9\u8b80\u53d6\u3002
    if (!ids.has(DEFAULT_TRIP_ID)) {
      try { await memberFor(user, DEFAULT_TRIP_ID); ids.add(DEFAULT_TRIP_ID); } catch (error) { if (!['TRIP_MEMBER_REQUIRED', 'ACCOUNT_DISABLED'].includes(error.code)) throw error; }
    }
    const trips = [];
    for (const tripId of ids) {
      try { trips.push(await tripFor(tripId)); } catch (error) { console.warn("\u65c5\u884c\u5217\u8868\u7565\u904e\u7121\u6cd5\u8b80\u53d6\u7684\u65c5\u884c\uff1a" + tripId, error); }
    }
    return trips;
  }

  async function createTrip(settings) {
    await ensureInitialized();
    const user = window.firebase.auth().currentUser;
    if (!user) throw new Error("\u8acb\u5148\u767b\u5165\u3002");
    const payload = settings || {};
    const tripId = normalizeTripId(payload.id || ("trip-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)));
    const trip = {
      id: tripId,
      name: String(payload.name || "\u672a\u547d\u540d\u65c5\u884c").trim(),
      destination: String(payload.destination || "").trim(),
      startDate: String(payload.startDate || ""),
      endDate: String(payload.endDate || ""),
      timezone: String(payload.timezone || "Asia/Tokyo"),
      currency: String(payload.currency || "JPY").toUpperCase(),
      settlementCurrency: String(payload.settlementCurrency || "TWD").toUpperCase(),
      cover: String(payload.cover || ""),
      theme: String(payload.theme || "journal"),
      status: "active",
      ownerId: user.uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!trip.name || !trip.destination || !/^\d{4}-\d{2}-\d{2}$/.test(trip.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(trip.endDate) || trip.endDate < trip.startDate) {
      throw new Error("\u8acb\u586b\u5beb\u6b63\u78ba\u7684\u65c5\u884c\u540d\u7a31\u3001\u76ee\u7684\u5730\u8207\u65e5\u671f\u3002");
    }
    const batch = firestore().batch();
    batch.set(firestore().doc(tripPath(tripId)), trip);
    batch.set(memberRef(tripId, user.uid), { name: user.displayName || user.email || user.uid, email: user.email || "", role: "admin", status: "active", owner: true, createdAt: trip.createdAt });
    batch.set(firestore().doc("users/" + user.uid + "/tripRefs/" + tripId), { tripId, name: trip.name, destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate, status: trip.status, updatedAt: trip.updatedAt });
    await batch.commit();
    return { ...trip, member: { role: "admin", status: "active", owner: true } };
  }

  async function updateTrip(tripId, patch) {
    await ensureInitialized();
    const selectedTripId = normalizeTripId(tripId);
    const user = window.firebase.auth().currentUser;
    const member = await memberFor(user, selectedTripId);
    if (member.role !== "admin") { const error = new Error("\u53ea\u6709\u65c5\u884c\u64c1\u6709\u8005\uff0f\u7ba1\u7406\u54e1\u53ef\u4ee5\u4fee\u6539\u65c5\u884c\u8a2d\u5b9a\u3002"); error.code = "FORBIDDEN"; throw error; }
    const current = await tripFor(selectedTripId);
    const next = { ...current, ...patch, id: selectedTripId, ownerId: current.ownerId || user.uid, updatedAt: new Date().toISOString() };
    delete next.member;
    await firestore().doc(tripPath(selectedTripId)).set(next, { merge: true });
    await firestore().doc("users/" + user.uid + "/tripRefs/" + selectedTripId).set({ tripId: selectedTripId, name: next.name, destination: next.destination, startDate: next.startDate, endDate: next.endDate, status: next.status || "active", updatedAt: next.updatedAt }, { merge: true });
    return { ...next, member };
  }

  function setTrip(tripId) {
    activeTripId = normalizeTripId(tripId || DEFAULT_TRIP_ID);
    window.__ACTIVE_TRIP_ID__ = activeTripId;
    return activeTripId;
  }

  window.travelFirebase = {
    configured,
    datasets: DATASETS,
    get tripId() { return activeTripId; },
    defaultTripId: DEFAULT_TRIP_ID,
    setTrip,
    ensureInitialized,
    signIn,
    currentSession,
    signOut,
    sendPasswordReset,
    changePassword,
    memberFor,
    tripFor,
    listTrips,
    createTrip,
    updateTrip,
    readSnapshot,
    writeDataset,
    previewImport,
    importDatasets
  };
}());

