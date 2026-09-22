const appDetailsCache = new Map();

async function getAppDetails(appIds, fetchJson) {
  const details = new Map();
  const missing = [];
  const seen = new Set();
  for (const rawAppId of appIds) {
    const appId = Number(rawAppId);
    if (!Number.isInteger(appId) || appId <= 0 || seen.has(appId)) continue;
    seen.add(appId);
    if (appDetailsCache.has(appId)) {
      const cached = appDetailsCache.get(appId);
      if (cached) details.set(appId, cached);
    } else {
      missing.push(appId);
    }
  }

  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, missing.length) }, async () => {
    while (next < missing.length) {
      const appId = missing[next++];
      try {
        const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`;
        const body = await fetchJson(url);
        const data = body?.[String(appId)]?.data || null;
        appDetailsCache.set(appId, data);
        if (data) details.set(appId, data);
      } catch {
        // A failed request can be retried on the next refresh.
      }
    }
  }));

  return details;
}

module.exports = { getAppDetails };
