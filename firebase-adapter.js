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
          const error = new Error(message || "Firebase \u9023\u7DDA\u903E\u6642\uFF0C\u8ACB\u78BA\u8A8D\u624B\u6A5F\u7DB2\u8DEF\u5F8C\u91CD\u8A66\u3002");
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
        const error = new Error("Firebase SDK \u8F09\u5165\u903E\u6642\uFF0C\u8ACB\u78BA\u8A8D\u624B\u6A5F\u7DB2\u8DEF\u6216\u95DC\u9589\u5167\u5BB9\u963B\u64CB\u5668\u5F8C\u91CD\u8A66\u3002");
        error.code = "auth/network-request-failed";
        finish(error);
      }, 12000);
      if (existing) {
        if (window.firebase) return finish();
        existing.addEventListener("load", function () { finish(); }, { once: true });
        existing.addEventListener("error", function () { finish(new Error("Firebase SDK \u8F09\u5165\u5931\u6557\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u9801\u9762\u3002")); }, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.firebaseSrc = src;
      script.onload = function () { finish(); };
      script.onerror = function () { finish(new Error("Firebase SDK \u8F09\u5165\u5931\u6557\uFF1A" + src)); };
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
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,96}$/.test(tripId)) throw new Error("\u65C5\u884C ID \u683C\u5F0F\u4E0D\u6B63\u78BA\u3002");
    return tripId;
  }

  function tripPath(tripId = activeTripId) {
    return "trips/" + normalizeTripId(tripId);
  }

  function memberRef(tripId, uid) {
    return firestore().doc(tripPath(tripId) + "/members/" + String(uid));
  }

  async function memberFor(user, tripId = activeTripId) {
    if (!user) throw new Error("\u8ACB\u5148\u767B\u5165\u3002");
    const snapshot = await memberRef(tripId, user.uid).get({ source: "server" });
    if (!snapshot.exists) {
      const error = new Error("\u6B64\u5E33\u865F\u5C1A\u672A\u52A0\u5165\u9019\u8D9F\u65C5\u884C\u3002");
      error.code = "TRIP_MEMBER_REQUIRED";
      throw error;
    }
    const member = snapshot.data() || {};
    if (member.status !== "active") {
      const error = new Error("\u6B64\u65C5\u4F34\u5E33\u865F\u5DF2\u505C\u7528\u3002");
      error.code = "ACCOUNT_DISABLED";
      throw error;
    }
    return member;
  }

  async function ensureInitialized() {
    if (!configured()) {
      const error = new Error("\u5C1A\u672A\u586B\u5165 Firebase Web App config\u3002");
      error.code = "FIREBASE_CONFIG_MISSING";
      throw error;
    }
    if (!initPromise) {
      initPromise = (async function () {
        await loadScript(CDN_BASE + "firebase-app-compat.js");
        await loadScript(CDN_BASE + "firebase-auth-compat.js");
        await loadScript(CDN_BASE + "firebase-firestore-compat.js");
        if (!window.firebase) throw new Error("Firebase SDK \u5C1A\u672A\u53EF\u7528\u3002");
        if (!window.firebase.apps.length) window.firebase.initializeApp(config);
        return { app: window.firebase.app(), auth: window.firebase.auth(), db: window.firebase.firestore() };
      }());
    }
    return initPromise;
  }

  function firestore() {
    if (!window.firebase || !window.firebase.firestore) throw new Error("Firestore \u5C1A\u672A\u521D\u59CB\u5316\u3002");
    return window.firebase.firestore();
  }

  async function signIn(email, password, remember = true) {
    const sdk = await withTimeout(ensureInitialized(), 15000, "auth/network-request-failed", "Firebase SDK \u8F09\u5165\u903E\u6642\uFF0C\u8ACB\u78BA\u8A8D\u624B\u6A5F\u7DB2\u8DEF\u5F8C\u91CD\u8A66\u3002");
    const persistence = window.firebase.auth.Auth.Persistence;
    try {
      await withTimeout(sdk.auth.setPersistence(remember ? persistence.LOCAL : persistence.SESSION), 8000, "auth/unsupported-persistence-type", "\u624B\u6A5F\u66AB\u6642\u7121\u6CD5\u4FDD\u5B58\u767B\u5165\u72C0\u614B\u3002");
    } catch (persistenceError) {
      // \u90E8\u5206 iOS \u79C1\u5BC6\u700F\u89BD\u3001\u5167\u5D4C\u700F\u89BD\u5668\u6216 PWA \u5BB9\u5668\u6703\u62D2\u7D55 IndexedDB\u3002
      // \u964D\u7D1A\u5230\u5DE5\u4F5C\u968E\u6BB5\u5132\u5B58\uFF0C\u4ECD\u5141\u8A31\u672C\u6B21\u767B\u5165\u5B8C\u6210\uFF0C\u4E0D\u963B\u64CB\u4F7F\u7528\u8005\u9032\u5165 App\u3002
      console.warn("Firebase persistence fallback", persistenceError);
      try {
        await withTimeout(sdk.auth.setPersistence(persistence.SESSION), 5000, "auth/unsupported-persistence-type", "\u624B\u6A5F\u66AB\u6642\u7121\u6CD5\u4FDD\u5B58\u767B\u5165\u72C0\u614B\u3002");
      } catch (sessionPersistenceError) {
        console.warn("Firebase session persistence unavailable", sessionPersistenceError);
      }
    }
    const credential = await withTimeout(
      sdk.auth.signInWithEmailAndPassword(String(email || "").trim(), String(password || "")),
      20000,
      "auth/network-request-failed",
      "\u767B\u5165\u9023\u7DDA\u903E\u6642\uFF0C\u8ACB\u78BA\u8A8D\u624B\u6A5F\u7DB2\u8DEF\u5F8C\u91CD\u8A66\u3002"
    );
    try {
      return { user: userLabel(credential.user, null) };
    } catch (error) {
      await sdk.auth.signOut();
      throw error;
    }
  }

  async function currentSession() {
    const sdk = await withTimeout(ensureInitialized(), 15000, "auth/network-request-failed", "Firebase SDK \u8F09\u5165\u903E\u6642\uFF0C\u8ACB\u78BA\u8A8D\u624B\u6A5F\u7DB2\u8DEF\u5F8C\u91CD\u8A66\u3002");
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
        const error = new Error("Firebase \u767B\u5165\u72C0\u614B\u6062\u5FA9\u903E\u6642\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u5F8C\u518D\u8A66\u3002");
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
    if (!user || !user.email) throw new Error("\u8ACB\u5148\u767B\u5165\u3002");
    const credential = window.firebase.auth.EmailAuthProvider.credential(user.email, String(currentPassword || ""));
    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(String(newPassword || ""));
    return { token: await user.getIdToken(true), user: userLabel(user, await memberFor(user)) };
  }

  function datasetRef(dataset, tripId = activeTripId) {
    if (!DATASETS.includes(dataset)) throw new Error("\u4E0D\u652F\u63F4\u7684 Firestore \u8CC7\u6599\u96C6\uFF1A" + dataset);
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
        throw new Error("\u96F2\u7AEF\u8CC7\u6599\u683C\u5F0F\u8207 App \u4E0D\u76F8\u5BB9\uFF1A" + dataset);
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
      const error = new Error("\u6AA2\u8996\u8005\u4E0D\u80FD\u4FEE\u6539\u65C5\u7A0B\u8CC7\u6599\u3002");
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
        const error = new Error("Firestore \u8CC7\u6599\u96C6\u7248\u672C\u885D\u7A81\uFF0C\u8ACB\u5148\u91CD\u65B0\u8F09\u5165\u3002");
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
          const error = new Error("Firestore \u55AE\u7B46\u8CC7\u6599\u7248\u672C\u885D\u7A81\uFF0C\u8ACB\u5148\u91CD\u65B0\u8F09\u5165\u3002");
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
      name: "Japan Tokyo\uFF5C\u65C5\u3059\u308B\u624B\u5E33",
      destination: "\u6771\u4EAC",
      startDate: "2026-11-28",
      endDate: "2026-12-06",
      timezone: "Asia/Tokyo",
      currency: "JPY",
      settlementCurrency: "TWD",
      theme: "postcard",
      backgroundTone: "mist",
      status: "active",
      ownerId: member.role === "admin" ? member.uid || user.uid : ""
    } : {};
    let snapshot = null;
    try {
      snapshot = await firestore().doc(tripPath(selectedTripId)).get({ source: "server" });
    } catch (error) {
      if (selectedTripId !== DEFAULT_TRIP_ID) throw error;
      console.warn("\u820A Firestore \u898F\u5247\u5C1A\u672A\u958B\u653E\u65C5\u884C\u8A2D\u5B9A\u8B80\u53D6\uFF0C\u4F7F\u7528\u6771\u4EAC\u76F8\u5BB9\u8A2D\u5B9A\uFF1A", error);
    }
    if (snapshot && !snapshot.exists && selectedTripId !== DEFAULT_TRIP_ID) throw new Error("\u627E\u4E0D\u5230\u9019\u8D9F\u65C5\u884C\u8A2D\u5B9A\u3002");
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
      // \u820A\u898F\u5247\u5C1A\u672A\u90E8\u7F72\u6642\uFF0C\u5148\u8D70\u65E2\u6709\u6771\u4EAC members \u6587\u4EF6\u76F8\u5BB9\u8DEF\u5F91\u3002
      console.warn("\u65C5\u884C\u7D22\u5F15\u5C1A\u672A\u53EF\u8B80\uFF0C\u6539\u7528\u65E2\u6709\u6210\u54E1\u6587\u4EF6\uFF1A", error);
    }
    const ids = new Set((refsSnapshot?.docs || []).map(doc => doc.id));
    // \u820A\u6771\u4EAC\u65C5\u7A0B\u6C92\u6709\u7D22\u5F15\u6642\uFF0C\u4ECD\u900F\u904E\u65E2\u6709 members \u6587\u4EF6\u76F8\u5BB9\u8B80\u53D6\u3002
    if (!ids.has(DEFAULT_TRIP_ID)) {
      try { await memberFor(user, DEFAULT_TRIP_ID); ids.add(DEFAULT_TRIP_ID); } catch (error) { if (!['TRIP_MEMBER_REQUIRED', 'ACCOUNT_DISABLED'].includes(error.code)) throw error; }
    }
    const trips = [];
    for (const tripId of ids) {
      try { trips.push(await tripFor(tripId)); } catch (error) { console.warn("\u65C5\u884C\u5217\u8868\u7565\u904E\u7121\u6CD5\u8B80\u53D6\u7684\u65C5\u884C\uFF1A" + tripId, error); }
    }
    return trips;
  }

  async function createTrip(settings) {
    await ensureInitialized();
    const user = window.firebase.auth().currentUser;
    if (!user) throw new Error("\u8ACB\u5148\u767B\u5165\u3002");
    const payload = settings || {};
    const tripId = normalizeTripId(payload.id || ("trip-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)));
    const trip = {
      id: tripId,
      name: String(payload.name || "\u672A\u547D\u540D\u65C5\u884C").trim(),
      destination: String(payload.destination || "").trim(),
      startDate: String(payload.startDate || ""),
      endDate: String(payload.endDate || ""),
      timezone: String(payload.timezone || "Asia/Tokyo"),
      currency: String(payload.currency || "JPY").toUpperCase(),
      settlementCurrency: String(payload.settlementCurrency || "TWD").toUpperCase(),
      cover: String(payload.cover || ""),
      theme: String(payload.theme || "journal"),
      backgroundTone: String(payload.backgroundTone || "cream"),
      status: "active",
      ownerId: user.uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!trip.name || !trip.destination || !/^\d{4}-\d{2}-\d{2}$/.test(trip.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(trip.endDate) || trip.endDate < trip.startDate) {
      throw new Error("\u8ACB\u586B\u5BEB\u6B63\u78BA\u7684\u65C5\u884C\u540D\u7A31\u3001\u76EE\u7684\u5730\u8207\u65E5\u671F\u3002");
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
    if (member.role !== "admin") { const error = new Error("\u53EA\u6709\u65C5\u884C\u64C1\u6709\u8005\uFF0F\u7BA1\u7406\u54E1\u53EF\u4EE5\u4FEE\u6539\u65C5\u884C\u8A2D\u5B9A\u3002"); error.code = "FORBIDDEN"; throw error; }
    const current = await tripFor(selectedTripId);
    const editableFields = ["name", "destination", "startDate", "endDate", "timezone", "currency", "settlementCurrency", "cover", "theme", "backgroundTone", "status"];
    const update = {};
    editableFields.forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(patch || {}, field)) update[field] = patch[field];
    });
    // \u4FDD\u7559\u820A\u6771\u4EAC\u6587\u4EF6\u7684 ownerId \u72C0\u614B\uFF1A\u66F4\u65B0\u6642\u4E0D\u4E3B\u52D5\u8986\u5BEB ownerId\uFF0C
    // \u8B93\u6C92\u6709 ownerId \u7684\u820A\u6587\u4EF6\u4E5F\u80FD\u5148\u4FDD\u5B58\u4E00\u822C\u8A2D\u5B9A\u3002
    update.updatedAt = new Date().toISOString();
    await firestore().doc(tripPath(selectedTripId)).set(update, { merge: true });
    const next = { ...current, ...update, id: selectedTripId, member };
    try {
      await firestore().doc("users/" + user.uid + "/tripRefs/" + selectedTripId).set({ tripId: selectedTripId, name: next.name, destination: next.destination, startDate: next.startDate, endDate: next.endDate, status: next.status || "active", updatedAt: next.updatedAt }, { merge: true });
    } catch (error) {
      // \u820A\u898F\u5247\u53EF\u80FD\u5C1A\u672A\u958B\u653E tripRefs\uFF1B\u4E3B\u65C5\u884C\u8A2D\u5B9A\u5DF2\u6210\u529F\u5C31\u4E0D\u963B\u65B7\u4F7F\u7528\u8005\u3002
      if (error?.code !== "permission-denied") throw error;
      console.warn("\u65C5\u884C\u8A2D\u5B9A\u5DF2\u66F4\u65B0\uFF0C\u4F46\u65C5\u7A0B\u7D22\u5F15\u5C1A\u672A\u540C\u6B65\uFF1B\u8ACB\u767C\u5E03\u6700\u65B0 firestore.rules\u3002", error);
    }
    return next;
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

