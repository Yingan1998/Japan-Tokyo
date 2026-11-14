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
          const error = new Error(message || "Firebase ????\u66b9?\u5697\uf5fd?\u8763\u7b84??\uf55e?\u876c\u8130\u695d\u657a\uf5fe?\u95b0\u827e\u0080?);
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
        const error = new Error("Firebase SDK \u981b\uf423\uf16f?\u66b9?\u5697\uf5fd?\u8763\u7b84??\uf55e?\u876c\u8130\u695d?\ue880??\uf423\uf171\u6470\u5be5\ue98c?\uf55d\uea16\u657a\uf5fe?\u95b0\u827e\u0080?);
        error.code = "auth/network-request-failed";
        finish(error);
      }, 12000);
      if (existing) {
        if (window.firebase) return finish();
        existing.addEventListener("load", function () { finish(); }, { once: true });
        existing.addEventListener("error", function () { finish(new Error("Firebase SDK \u981b\uf423\uf16f\u61ad\u671b?\u5697\uf5fd??\uf698\ue847?\u6e21??\uef3f\uec84??)); }, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.firebaseSrc = src;
      script.onload = function () { finish(); };
      script.onerror = function () { finish(new Error("Firebase SDK \u981b\uf423\uf16f\u61ad\u671b?\u5697? + src)); };
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
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,96}$/.test(tripId)) throw new Error("?\uf1b2? ID ?\u6f86?\u929d\uf698\u8fe4\u8763\u7b9d\u0080?);
    return tripId;
  }

  function tripPath(tripId = activeTripId) {
    return "trips/" + normalizeTripId(tripId);
  }

  function memberRef(tripId, uid) {
    return firestore().doc(tripPath(tripId) + "/members/" + String(uid));
  }

  async function memberFor(user, tripId = activeTripId) {
    if (!user) throw new Error("\u96a2\uf55d??\u9903\uf16f??);
    const snapshot = await memberRef(tripId, user.uid).get({ source: "server" });
    if (!snapshot.exists) {
      const error = new Error("\u7507\u6587\u8463?\uee01??\u82b8??\u4eff\u0080\uea56??\uf1b2???);
      error.code = "TRIP_MEMBER_REQUIRED";
      throw error;
    }
    const member = snapshot.data() || {};
    if (member.status !== "active") {
      const error = new Error("\u7507\u6597?\u96a1\u6e38\u8463?\uee01\u6b47?\uec2c\ue705??);
      error.code = "ACCOUNT_DISABLED";
      throw error;
    }
    return member;
  }

  async function ensureInitialized() {
    if (!configured()) {
      const error = new Error("\u64a0\ueaf1\uebef\u619b\u6020\uf16f Firebase Web App config??);
      error.code = "FIREBASE_CONFIG_MISSING";
      throw error;
    }
    if (!initPromise) {
      initPromise = (async function () {
        await loadScript(CDN_BASE + "firebase-app-compat.js");
        await loadScript(CDN_BASE + "firebase-auth-compat.js");
        await loadScript(CDN_BASE + "firebase-firestore-compat.js");
        if (!window.firebase) throw new Error("Firebase SDK \u64a0\ueaf1\uebef?\u8210\ue705??);
        if (!window.firebase.apps.length) window.firebase.initializeApp(config);
        return { app: window.firebase.app(), auth: window.firebase.auth(), db: window.firebase.firestore() };
      }());
    }
    return initPromise;
  }

  function firestore() {
    if (!window.firebase || !window.firebase.firestore) throw new Error("Firestore \u64a0\ueaf1\uebef?\uecc7??\ue87a\u0080?);
    return window.firebase.firestore();
  }

  async function signIn(email, password, remember = true) {
    const sdk = await withTimeout(ensureInitialized(), 15000, "auth/network-request-failed", "Firebase SDK \u981b\uf423\uf16f?\u66b9?\u5697\uf5fd?\u8763\u7b84??\uf55e?\u876c\u8130\u695d\u657a\uf5fe?\u95b0\u827e\u0080?);
    const persistence = window.firebase.auth.Auth.Persistence;
    try {
      await withTimeout(sdk.auth.setPersistence(remember ? persistence.LOCAL : persistence.SESSION), 8000, "auth/unsupported-persistence-type", "?\uf55e??\u6025??\u22a5?\u977d\uecc7??\u9903\uf16f?\u0080?\uf55b\u0080?);
    } catch (persistenceError) {
      // ?\u5178? iOS \u8758\uef3b??\ue434\u6c57?\uef3b\uf171\u648b\uf5fc\u0080\ue434\u6c57?\u51bd? PWA \u6470\u5b75\uea16?\uf076?\u876f?IndexedDB??      // ?\uf699??\u5563\u6975\u96ff\uec2e?\u757e\u8404\uf0df\u646e\ue9c0?\u969e\uf697?\u95ae\u671b\uebf1\u7508\u2220\uea29?\u4e99??\ue4d8?\u929d\uf69b\ue98c?\uf55c\u8759?\u523b\u0080\uf1b3\u0080\u8123\uf16f App??      console.warn("Firebase persistence fallback", persistenceError);
      try {
        await withTimeout(sdk.auth.setPersistence(persistence.SESSION), 5000, "auth/unsupported-persistence-type", "?\uf55e??\u6025??\u22a5?\u977d\uecc7??\u9903\uf16f?\u0080?\uf55b\u0080?);
      } catch (sessionPersistenceError) {
        console.warn("Firebase session persistence unavailable", sessionPersistenceError);
      }
    }
    const credential = await withTimeout(
      sdk.auth.signInWithEmailAndPassword(String(email || "").trim(), String(password || "")),
      20000,
      "auth/network-request-failed",
      "?\u9903\uf16f????\u66b9?\u5697\uf5fd?\u8763\u7b84??\uf55e?\u876c\u8130\u695d\u657a\uf5fe?\u95b0\u827e\u0080?
    );
    try {
      return { user: userLabel(credential.user, null) };
    } catch (error) {
      await sdk.auth.signOut();
      throw error;
    }
  }

  async function currentSession() {
    const sdk = await withTimeout(ensureInitialized(), 15000, "auth/network-request-failed", "Firebase SDK \u981b\uf423\uf16f?\u66b9?\u5697\uf5fd?\u8763\u7b84??\uf55e?\u876c\u8130\u695d\u657a\uf5fe?\u95b0\u827e\u0080?);
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
        const error = new Error("Firebase ?\u9903\uf16f?\u0080?\uf55e\ueef8\u657a\u62da\u0080\u66b9?\u5697\uf5fd??\uf698\ue847?\u6e21?\u657a\uf5fa?\u95b0\u827e\u0080?);
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
    if (!user || !user.email) throw new Error("\u96a2\uf55d??\u9903\uf16f??);
    const credential = window.firebase.auth.EmailAuthProvider.credential(user.email, String(currentPassword || ""));
    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(String(newPassword || ""));
    return { token: await user.getIdToken(true), user: userLabel(user, await memberFor(user)) };
  }

  function datasetRef(dataset, tripId = activeTripId) {
    if (!DATASETS.includes(dataset)) throw new Error("\u929d\uf698\ue70c?\u6e21? Firestore \u9788\uf2ea??\uf256?" + dataset);
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
        throw new Error("?\u8129\u57a2\u9788\uf2ea??\u6f86???App \u929d\uf699\ueb60\u6470\u5c0d?" + dataset);
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
      const error = new Error("\u747c\uff3a??\uf1ae??\u8ced\u8028?\u5bde?\u8754\uf560??\uea51\u0080?);
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
        const error = new Error("Firestore \u9788\uf2ea??\uf24e??\u7948?\u8752\uef45?\u96a2\uf55d??\uf698\ue847\u981b\uf423\uf16f??);
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
          const error = new Error("Firestore ?\u6843?\u9788\uf2ea??\uf387\uebf1\u92b5\uecc9?\u5697\uf5fd??\uf38a??\u5557??\u4e53\u0080?);
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
      name: "Japan Tokyo\u569a\uec2b??\uea51??\uf55d\u8463",
      destination: "?\u66f9\u6f2a",
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
      console.warn("??Firestore \u95ac\ue431?\u64a0\ueaf1\uebef?\uf55e\ue71b?\uf1b2?\u95ae\u5256?\u9708\u0080?\ue886?\u96ff\u8f3b\ue705?\u66f9\u6f2a?\u8a68\u6346\u95ae\u5256?\u5697?, error);
    }
    if (snapshot && !snapshot.exists && selectedTripId !== DEFAULT_TRIP_ID) throw new Error("?\u66c6??\u5708\u0080\uea56??\uf1b2?\u95ae\u5256???);
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
      // ?\uf4c3??\uf2e9??\u82b7\uf038\u8775\u812b?\u5697\uf5fa?\u97cf\u5533\ue8d6?\uf424\uec93\u922d?members ?\uf2e8\u8fa3?\u8a68\u6346\u981d\u81ec???      console.warn("?\uf1b2?\u875d\uff37?\u64a0\ueaf1\uebef?\u822a?\u5697\uf5fb\ue716?\u51bd\ue8d6?\uf424??\u22a5?\u969e\u585a?", error);
    }
    const ids = new Set((refsSnapshot?.docs || []).map(doc => doc.id));
    // ?\uf4c1\uec93\u922d\u7946?\u8754\uf55e??\uf425\u63e3\u6498\ue7e0?\u5697\uf5f9??\ue435??\uff38? members ?\uf2e8\u8fa3?\u8a68\u6346\u9708\u0080?\ue87a\u0080?    if (!ids.has(DEFAULT_TRIP_ID)) {
      try { await memberFor(user, DEFAULT_TRIP_ID); ids.add(DEFAULT_TRIP_ID); } catch (error) { if (!['TRIP_MEMBER_REQUIRED', 'ACCOUNT_DISABLED'].includes(error.code)) throw error; }
    }
    const trips = [];
    for (const tripId of ids) {
      try { trips.push(await tripFor(tripId)); } catch (error) { console.warn("?\uf1b2??\ue91c\u201d?\u4eff??\u22a5?\u9708\u0080?\ue87e??\uf1b2?\u5697? + tripId, error); }
    }
    return trips;
  }

  async function createTrip(settings) {
    await ensureInitialized();
    const user = window.firebase.auth().currentUser;
    if (!user) throw new Error("\u96a2\uf55d??\u9903\uf16f??);
    const payload = settings || {};
    const tripId = normalizeTripId(payload.id || ("trip-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)));
    const trip = {
      id: tripId,
      name: String(payload.name || "?\u82b8\ue543?\uf698?\u92b5?).trim(),
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
      throw new Error("\u96a2\uf55d\u2035\u6496\u6025\u8fe4\u8763\u7b87??\uf1b2??\uf699\u8fc2?\uef3d\ueb56?\uf112\uebf5?\uf2ea\ue8d9?\uedff\u0080?);
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
    if (member.role !== "admin") { const error = new Error("?\u82a3??\uf1b2??\uef3c??\uf1b9?\u875e\u2220??\u222a\ue3fb\u969e\u4e69\u8028?\u5bde?\u92b5\uf5fd\u8eab\u6470\ueaee\u0080?); error.code = "FORBIDDEN"; throw error; }
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

