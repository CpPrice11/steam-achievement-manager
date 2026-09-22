function extractDlcAppIdsFromStoreHtml(html, baseAppId) {
  const ids = new Set();
  const source = String(html || '');
  const patterns = [
    /href="https?:\/\/store\.steampowered\.com\/app\/(\d+)\//gi,
    /data-ds-appid="(\d+)"/gi,
    /data-ds-itemkey="App_(\d+)"/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const appId = Number(match[1]);
      if (Number.isInteger(appId) && appId > 0 && appId !== baseAppId) ids.add(appId);
    }
  }

  return [...ids];
}

async function discoverDlcAppIds(appId, fetchJson, fetchText) {
  const ids = new Set();
  const warnings = [];
  const apiUrls = [
    `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=dlc,basic`,
    `https://store.steampowered.com/api/appdetails?appids=${appId}`,
  ];
  let apiAvailable = false;
  let apiError = '';
  for (const url of apiUrls) {
    try {
      const body = await fetchJson(url);
      if (!body?.[String(appId)]) throw new Error('Store API response has no AppID entry.');
      apiAvailable = true;
      const dlc = body?.[String(appId)]?.data?.dlc;
      if (Array.isArray(dlc) && dlc.length) {
        for (const value of dlc) {
          const id = Number(value);
          if (Number.isInteger(id) && id > 0) ids.add(id);
        }
        break;
      }
    } catch (error) {
      apiError = error?.message || String(error);
    }
  }
  if (!apiAvailable) warnings.push(`DLC Store API unavailable: ${apiError}`);

  const pages = [
    `https://store.steampowered.com/dlc/${appId}/?l=english`,
    `https://store.steampowered.com/app/${appId}/?l=english`,
  ];
  let pageAvailable = false;
  let pageError = '';
  for (const page of pages) {
    try {
      for (const id of extractDlcAppIdsFromStoreHtml(await fetchText(page), appId)) ids.add(id);
      pageAvailable = true;
    } catch (error) {
      pageError = error?.message || String(error);
    }
  }
  if (!pageAvailable) warnings.push(`DLC Store pages unavailable: ${pageError}`);

  return { ids: [...ids].slice(0, 250), warnings };
}

module.exports = { discoverDlcAppIds };
