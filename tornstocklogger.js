// Global variables to store API key, fetch interval, cached item types, and manual refresh flag
let apiKey = null;
let fetchInterval = null;
let itemTypeCache = {};
let manualRefreshMode = false;

// Rate limiting configuration
const rateLimiter = {
    lastCall: 0,
    minDelay: 1100, // Minimum delay between API calls in ms
    async waitForNextCall() {
        const now = Date.now();
        const timeSinceLastCall = now - this.lastCall;
        if (timeSinceLastCall < this.minDelay) {
            await new Promise(resolve => setTimeout(resolve, this.minDelay - timeSinceLastCall));
        }
        this.lastCall = Date.now();
    }
};

// Logging utility for consistent error handling
const logger = {
    error: (message, ...args) => console.error(`[TornStockLogger Error] ${message}`, ...args),
    warn: (message, ...args) => console.warn(`[TornStockLogger Warning] ${message}`, ...args),
    info: (message, ...args) => console.log(`[TornStockLogger Info] ${message}`, ...args)
};

// Data validation utilities
const validator = {
    isValidStockData(data) {
        return data && typeof data === 'object' && 
               data.stocks && typeof data.stocks === 'object' &&
               data.timestamp && typeof data.timestamp === 'number';
    },
    
    isValidMarketData(data) {
        return data && typeof data === 'object' && 
               data.itemmarket && typeof data.itemmarket === 'object';
    },
    
    sanitizeNumber(value, defaultValue = 0) {
        const num = Number(value);
        return !isNaN(num) ? num : defaultValue;
    }
};

// Opens (or creates) the IndexedDB database 'TornStockLogger' version 1
async function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("TornStockLogger", 1);
        request.onerror = (event) => {
            logger.error("Database error:", event.target.error);
            reject("Failed to open IndexedDB");
        };
        request.onsuccess = () => {
            logger.info("Database opened successfully");
            resolve(request.result);
        };
        request.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("stock_history")) {
                const store = db.createObjectStore("stock_history", { autoIncrement: true });
                store.createIndex("by_item", ["country", "item_id"], { unique: false });
                logger.info("Database schema upgraded");
            }
        };
    });
}

// Saves a snapshot of stock data into the IndexedDB 'stock_history' store
async function saveStockSnapshot(db, country, item_id, quantity, timestamp, retryCount = 0) {
    const MAX_RETRIES = 3;
    try {
        if (!country || !item_id || typeof quantity === 'undefined' || !timestamp) {
            throw new Error("Invalid snapshot data");
        }
        
        const tx = db.transaction("stock_history", "readwrite");
        const store = tx.objectStore("stock_history");
        await store.add({
            country,
            item_id,
            quantity: validator.sanitizeNumber(quantity),
            timestamp: validator.sanitizeNumber(timestamp)
        });
        await tx.done;
    } catch (err) {
        if (retryCount < MAX_RETRIES) {
            logger.warn(`Retrying saveStockSnapshot (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
            return saveStockSnapshot(db, country, item_id, quantity, timestamp, retryCount + 1);
        }
        logger.error("Failed to save stock snapshot after retries:", err);
        throw err;
    }
}

// Calculates profit per minute given cost, market price, and flight time
function calculateProfitPerMinute(cost, market, flightTime) {
    cost = validator.sanitizeNumber(cost);
    market = validator.sanitizeNumber(market);
    flightTime = validator.sanitizeNumber(flightTime);
    
    const profit = market - cost;
    const totalFlightTime = flightTime * 2;
    return totalFlightTime > 0 ? profit / totalFlightTime : 0;
}

// Cache for static item metadata fetched once at initialization
let staticItemData = {};

// Loads static metadata (cost, flight time, name) for all items from the YATA API
async function loadStaticMetadata() {
    try {
        await rateLimiter.waitForNextCall();
        const response = await fetch("https://yata.yt/api/v1/travel/export/");
        const rawData = await response.json();
        
        if (!validator.isValidStockData(rawData)) {
            throw new Error("Invalid YATA API response format");
        }

        const countries = rawData.stocks || {};
        for (const [country, data] of Object.entries(countries)) {
            const items = data.stocks || [];
            for (const item of items) {
                if (!item.id || !item.name) continue;
                
                const key = `${country}_${item.id}`;
                staticItemData[key] = {
                    country,
                    id: item.id,
                    name: item.name,
                    cost: validator.sanitizeNumber(item.cost),
                    flight_time: validator.sanitizeNumber(item.flight_time)
                };
            }
        }
        logger.info("Static metadata loaded successfully");
    } catch (err) {
        logger.error("Failed to load static metadata:", err);
        throw err; // Propagate error as this is critical data
    }
}

// Enhanced fetchMarketPriceForItem with rate limiting
async function fetchMarketPriceForItem(itemId) {
    if (!apiKey) {
        logger.warn("No API key available");
        return { price: 0, type: null };
    }
    
    if (itemTypeCache[itemId] && itemTypeCache[itemId] !== "Plushie" && itemTypeCache[itemId] !== "Flower") {
        logger.info(`Skipping non-target item type: ${itemTypeCache[itemId]} for item ${itemId}`);
        return { price: 0, type: itemTypeCache[itemId] };
    }

    try {
        await rateLimiter.waitForNextCall();
        const res = await fetch(`https://api.torn.com/v2/market/${itemId}/itemmarket?offset=0&key=${apiKey}`);
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        const data = await res.json();
        
        if (data.error) {
            throw new Error(`API error: ${data.error.error}`);
        }

        const type = data.itemmarket?.item?.type || null;
        itemTypeCache[itemId] = type;
        await browser.storage.local.set({ itemTypeCache });

        if (type !== "Plushie" && type !== "Flower") {
            logger.info(`Skipping item ${itemId} of type ${type}`);
            return { price: 0, type };
        }

        const average_price = data.itemmarket?.item?.average_price || 0;
        const listings = data.itemmarket?.listings || [];
        const filtered = listings.filter(l => Math.abs(l.price - average_price) <= average_price * 0.1);
        const top5 = filtered.slice(0, 5);
        
        if (top5.length === 0) {
            logger.warn(`No valid listings found for item ${itemId}`);
            return { price: 0, type };
        }

        const avg = top5.reduce((sum, l) => sum + l.price, 0) / top5.length;
        return { price: Math.round(avg), type };
    } catch (err) {
        logger.error(`Error fetching market price for item ${itemId}:`, err);
        return { price: 0, type: null };
    }
}

// Enhanced fetchAndLogStock with rate limiting for YATA API
async function fetchAndLogStock(requestedCountries = null) {
    const db = await openDatabase();
    let yataData = {};
    try {
        await rateLimiter.waitForNextCall();
        const yataRes = await fetch("https://yata.yt/api/v1/travel/export/");
        yataData = await yataRes.json();
    } catch (e) {
        logger.error("YATA fetch failed:", e);
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
    try {
        const data = await browser.storage.local.get(["tornApiKey", "itemTypeCache"]);
        apiKey = data.tornApiKey || null;
        itemTypeCache = data.itemTypeCache || {};

        if (!apiKey) {
            throw new Error("API key is missing");
        }

        await loadStaticMetadata();
        await fetchAndLogStock();

        if (fetchInterval) {
            clearInterval(fetchInterval);
            logger.info("Cleared existing fetch interval");
        }

        // Periodic fetch every 30s (only quantity; prices disabled)
        fetchInterval = setInterval(() => {
            manualRefreshMode = false;  // ensure no price fetch
            fetchAndLogStock().catch(err => logger.error("Periodic fetch failed:", err));
        }, 30000);
        
        logger.info("Initialization completed successfully");
    } catch (err) {
        logger.error("Initialization failed:", err);
    }
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
