// Global variables to store API key, fetch interval, cached item types, and manual refresh flag
let apiKey = null;
let fetchInterval = null;
let itemTypeCache = {};
let manualRefreshMode = false;

// Opens (or creates) the IndexedDB database 'TornStockLogger' version 1
async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("TornStockLogger", 1);
    request.onerror = () => reject("Failed to open IndexedDB");
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("stock_history")) {
        const store = db.createObjectStore("stock_history", { autoIncrement: true });
        store.createIndex("by_item", ["country", "item_id"], { unique: false });
      }
    };
  });
}

// Saves a snapshot of stock data into the IndexedDB 'stock_history' store
async function saveStockSnapshot(db, country, item_id, quantity, timestamp) {
  const tx = db.transaction("stock_history", "readwrite");
  const store = tx.objectStore("stock_history");
  store.add({ country, item_id, quantity, timestamp });
  await tx.done;
}

// Calculates profit per minute given cost, market price, and flight time
function calculateProfitPerMinute(cost, market, flightTime) {
  const profit = market - cost;
  const totalFlightTime = flightTime * 2;
  return totalFlightTime > 0 ? profit / totalFlightTime : 0;
}

// Cache for static item metadata fetched once at initialization
let staticItemData = {};

// Loads static metadata (cost, flight time, name) for all items from the YATA API
async function loadStaticMetadata() {
  const response = await fetch("https://yata.yt/api/v1/travel/export/");
  const rawData = await response.json();
  const countries = rawData.stocks || {};

  for (const [country, data] of Object.entries(countries)) {
    const items = data.stocks || [];
    for (const item of items) {
      const key = `${country}_${item.id}`;
      staticItemData[key] = {
        country,
        id: item.id,
        name: item.name,
        cost: item.cost,
        flight_time: item.flight_time
      };
    }
  }
}

// Fetches the current market price for a given item ID, with caching and filtering
async function fetchMarketPriceForItem(itemId) {
  if (!apiKey) return { price: 0, type: null };
  if (itemTypeCache[itemId] && itemTypeCache[itemId] !== "Plushie" && itemTypeCache[itemId] !== "Flower") {
    return { price: 0, type: itemTypeCache[itemId] };
  }

  try {
    const res = await fetch(`https://api.torn.com/v2/market/${itemId}/itemmarket?offset=0&key=${apiKey}`);
    const data = await res.json();
    const type = data.itemmarket?.item?.type || null;
    itemTypeCache[itemId] = type;
    await browser.storage.local.set({ itemTypeCache });

    if (type !== "Plushie" && type !== "Flower") return { price: 0, type };

    const average_price = data.itemmarket?.item?.average_price || 0;
    const listings = data.itemmarket?.listings || [];
    const filtered = listings.filter(l => Math.abs(l.price - average_price) <= average_price * 0.1);
    const top5 = filtered.slice(0, 5);
    if (top5.length === 0) return { price: 0, type };

    const avg = top5.reduce((sum, l) => sum + l.price, 0) / top5.length;
    return { price: Math.round(avg), type };
  } catch (err) {
    console.warn("Error fetching market price for item", itemId, err);
  }

  return { price: 0, type: null };
}

// Fetches full data (quantity + optional prices), logs snapshots, and updates storage
async function fetchAndLogStock(requestedCountries = null) {
  const db = await openDatabase();
  let yataData = {};
  try {
    const yataRes = await fetch("https://yata.yt/api/v1/travel/export/");
    yataData = await yataRes.json();
  } catch (e) {
    console.warn("YATA fetch failed:", e);
    return;
  }
  const timestamp = yataData.timestamp || Math.floor(Date.now() / 1000);

  const dynamicData = {};
  const itemIdsToFetch = new Set();
  for (const [country, data] of Object.entries(yataData.stocks || {})) {
    if (requestedCountries && !requestedCountries.includes(country)) continue;
    for (const item of data.stocks || []) {
      const key = `${country}_${item.id}`;
      dynamicData[key] = { quantity: item.quantity };
      if (manualRefreshMode) itemIdsToFetch.add(item.id);
    }
  }

  const priceMap = {};
  if (manualRefreshMode) {
    const itemIds = Array.from(itemIdsToFetch);
    for (let i = 0; i < itemIds.length; i++) {
      priceMap[itemIds[i]] = await fetchMarketPriceForItem(itemIds[i]);
      await new Promise(r => setTimeout(r, 1100));
    }
  }

  const result = {};
  for (const [key, dyn] of Object.entries(dynamicData)) {
    const meta = staticItemData[key];
    if (!meta) continue;
    const info = manualRefreshMode ? priceMap[meta.id] || {} : {};
    const market_price = info.price ?? 0;
    const item_type = info.type ?? itemTypeCache[meta.id];
    if (item_type !== "Plushie" && item_type !== "Flower") continue;

    const ppm = calculateProfitPerMinute(meta.cost, market_price, meta.flight_time);
    await saveStockSnapshot(db, meta.country, meta.id, dyn.quantity, timestamp);

    if (!result[meta.country]) result[meta.country] = [];
    result[meta.country].push({
      ...meta,
      quantity: dyn.quantity,
      market_price,
      profit_per_minute: ppm,
      timestamp,
      type: item_type
    });
  }

  await browser.storage.local.set({ stockData: result });
  console.log("Stock data updated and saved.");
  manualRefreshMode = false;
}

// Initializes the extension: loads API key, metadata, and starts periodic quantity-only fetching
async function initialize() {
  const data = await browser.storage.local.get(["tornApiKey", "itemTypeCache"]);
  apiKey = data.tornApiKey || null;
  itemTypeCache = data.itemTypeCache || {};

  if (!apiKey) {
    console.warn("API key is missing.");
    return;
  }

  await loadStaticMetadata();
  await fetchAndLogStock();

  if (fetchInterval) clearInterval(fetchInterval);
  // Periodic fetch every 30s (only quantity; prices disabled)
  fetchInterval = setInterval(() => {
    manualRefreshMode = false;  // ensure no price fetch
    fetchAndLogStock();
  }, 30000);
}

// Message listener to handle manual refresh and restarts
browser.runtime.onMessage.addListener(msg => {
  if (msg.type === "restart-collector") {
    initialize();
  }
  if (msg.type === "manual-refresh") {
    manualRefreshMode = true;
    fetchAndLogStock(msg.countries);
  }
});

initialize();
