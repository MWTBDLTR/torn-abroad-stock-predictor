// Global variables to store API key, fetch interval, cached item types, and manual refresh flag
let apiKey = null;
let fetchInterval = null;
let itemTypeCache = {};
let manualRefreshMode = false;

// Opens (or creates) the IndexedDB database 'TornStockLogger'
async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("TornStockLogger", 1);
    // Handle database open errors
    request.onerror = () => reject("Failed to open IndexedDB");
    // Resolve with the database instance when opened successfully
    request.onsuccess = () => resolve(request.result);
    // Handle database version changes or initial creation
    request.onupgradeneeded = e => {
      const db = e.target.result;
      // If 'stock_history' store doesn't exist, create it
      if (!db.objectStoreNames.contains("stock_history")) {
        const store = db.createObjectStore("stock_history", { autoIncrement: true });
        // Create an index to query by country and item_id
        store.createIndex("by_item", ["country", "item_id"], { unique: false });
      }
    };
  });
}

// Saves a snapshot of stock data into the IndexedDB 'stock_history' store
async function saveStockSnapshot(db, country, item_id, quantity, timestamp) {
  // Start a readwrite transaction on 'stock_history'
  const tx = db.transaction("stock_history", "readwrite");
  const store = tx.objectStore("stock_history");
  // Add a new record with the provided details
  store.add({ country, item_id, quantity, timestamp });
  // Wait for the transaction to complete
  await tx.done;
}

// Calculates profit per minute given cost, market price, and flight time
function calculateProfitPerMinute(cost, market, flightTime) {
  const profit = market - cost;
  const totalFlightTime = flightTime * 2; // flightTime one-way, round-trip
  // Avoid division by zero; return 0 if no valid flight time
  return totalFlightTime > 0 ? profit / totalFlightTime : 0;
}

// Cache for static item metadata fetched once at initialization
let staticItemData = {};

// Loads static metadata (cost, flight time, name) for all items from the YATA API
async function loadStaticMetadata() {
  const response = await fetch("https://yata.yt/api/v1/travel/export/");
  const rawData = await response.json();
  const countries = rawData.stocks || {};

  // Flatten the nested structure into a lookup keyed by 'country_itemId'
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
  // If no API key is set, skip and return zeros
  if (!apiKey) return { price: 0, type: null };

  // Use cache for item type; only fetch for Plushie and Flower types
  if (itemTypeCache[itemId] && itemTypeCache[itemId] !== "Plushie" && itemTypeCache[itemId] !== "Flower") {
    return { price: 0, type: itemTypeCache[itemId] };
  }

  try {
    // Call Torn API for market data (filtered below)
    const res = await fetch(`https://api.torn.com/v2/market/${itemId}/itemmarket?offset=0&key=${apiKey}`);
    const data = await res.json();

    // Extract item type and cache it
    const type = data.itemmarket?.item?.type || null;
    itemTypeCache[itemId] = type;
    await browser.storage.local.set({ itemTypeCache });

    // Skip non-Plushie/Flower types
    if (type !== "Plushie" && type !== "Flower") return { price: 0, type };

    // Compute filtered average price: listings within ±10% of overall average (api does return average_market, I want to compute my own to compare)
    const average_price = data.itemmarket?.item?.average_price || 0;
    const listings = data.itemmarket?.listings || [];
    const filtered = listings.filter(l => Math.abs(l.price - average_price) <= average_price * 0.1);
    const top5 = filtered.slice(0, 5); // take up to 5 listings

    if (top5.length === 0) return { price: 0, type };

    // Compute average of top 5 listings
    const avg = top5.reduce((sum, l) => sum + l.price, 0) / top5.length;
    return { price: Math.round(avg), type };
  } catch (err) {
    console.warn("Error fetching market price for item", itemId, err);
  }

  // Fallback return on error
  return { price: 0, type: null };
}

// Fetches stock data from YATA, logs snapshots, and optionally fetches market prices
async function fetchAndLogStock(requestedCountries = null) {
  const db = await openDatabase();
  let yataData = {};
  try {
    const yataRes = await fetch("https://yata.yt/api/v1/travel/export/");
    yataData = await yataRes.json();
  } catch (e) {
    console.warn("YATA fetch failed:", e);
    return; // exit on fetch failure
  }
  // Use server timestamp or fallback to client timestamp
  const timestamp = yataData.timestamp || Math.floor(Date.now() / 1000);

  const dynamicData = {};
  const itemIdsToFetch = new Set();

  // Build dynamicData and determine which items need market price fetch
  for (const [country, data] of Object.entries(yataData.stocks || {})) {
    if (requestedCountries && !requestedCountries.includes(country)) continue; // respect filter
    for (const item of data.stocks || []) {
      const key = `${country}_${item.id}`;
      dynamicData[key] = { quantity: item.quantity };
      if (manualRefreshMode) {
        itemIdsToFetch.add(item.id);
      }
    }
  }

  const priceMap = {};
  if (manualRefreshMode) {
    // Fetch market price for each item, rate-limit to avoid throttling
    const itemIds = Array.from(itemIdsToFetch);
    for (let i = 0; i < itemIds.length; i++) {
      const id = itemIds[i];
      priceMap[id] = await fetchMarketPriceForItem(id);
      // Wait ~1.1 seconds between calls
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
  }

  const result = {};
  // Combine static and dynamic data, compute profit and store
  for (const [key, dyn] of Object.entries(dynamicData)) {
    const meta = staticItemData[key];
    if (!meta) continue; // skip unknown items

    const info = manualRefreshMode ? priceMap[meta.id] || {} : {};
    const market_price = info.price ?? 0;
    const item_type = info.type ?? itemTypeCache[meta.id];

    // Only process Plushie and Flower types
    if (item_type !== "Plushie" && item_type !== "Flower") continue;

    const ppm = calculateProfitPerMinute(meta.cost, market_price, meta.flight_time);

    // Save snapshot to IndexedDB
    await saveStockSnapshot(db, meta.country, meta.id, dyn.quantity, timestamp);

    // Build result object for storage and logging
    result[meta.country] = result[meta.country] || [];
    result[meta.country].push({
      ...meta,
      quantity: dyn.quantity,
      market_price,
      profit_per_minute: ppm,
      timestamp,
      type: item_type
    });
  }

  // Persist aggregated stock data to browser local storage
  await browser.storage.local.set({ stockData: result });
  console.log("Stock data updated and saved.");

  // Reset manual refresh flag after processing
  manualRefreshMode = false;
}

// Initializes the extension: loads API key, metadata, and starts periodic fetching from YATA
async function initialize() {
  const data = await browser.storage.local.get(["tornApiKey", "itemTypeCache"]);
  apiKey = data.tornApiKey || null;
  itemTypeCache = data.itemTypeCache || {};

  if (!apiKey) {
    console.warn("API key is missing.");
    return; // can't proceed without API key
  }

  await loadStaticMetadata();
  await fetchAndLogStock();

  // Clear previous interval if exists and set up a new fetch every 30 seconds
  if (fetchInterval) clearInterval(fetchInterval);
  fetchInterval = setInterval(() => fetchAndLogStock(), 30000);
}

// Listen for messages from popup or options page to control behavior
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "restart-collector") {
    console.log("Restarting data collector after key validation.");
    initialize();
  }
  if (msg.type === "manual-refresh") {
    console.log("Manual refresh requested for:", msg.countries);
    manualRefreshMode = true;
    fetchAndLogStock(msg.countries);
  }
});

// Init on extension load
initialize();
