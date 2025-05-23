// Global variables to store API key, fetch interval, cached item types, and manual refresh flag
import { initializeBrowserListeners } from './browser-init.js';

let apiKey = null;
let fetchInterval = null;
let itemTypeCache = {};
let manualRefreshMode = false;

// Rate limiting configuration
const rateLimiter = {
    lastCall: 0,
    minDelay: 1100, // Minimum delay between API calls in ms
    yataLastCall: 0,
    yataMinDelay: 30000, // YATA API has a 30s cache
    async waitForNextCall(isYata = false) {
        const now = Date.now();
        if (isYata) {
            const timeSinceLastYata = now - this.yataLastCall;
            if (timeSinceLastYata < this.yataMinDelay) {
                await new Promise(resolve => setTimeout(resolve, this.yataMinDelay - timeSinceLastYata));
            }
            this.yataLastCall = Date.now();
        } else {
            const timeSinceLastCall = now - this.lastCall;
            if (timeSinceLastCall < this.minDelay) {
                await new Promise(resolve => setTimeout(resolve, this.minDelay - timeSinceLastCall));
            }
            this.lastCall = Date.now();
        }
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

// Enhanced API response validation
const apiValidator = {
    validateYataResponse(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid YATA API response format');
        }
        
        if (!data.stocks || typeof data.stocks !== 'object') {
            throw new Error('Missing or invalid stocks data in YATA response');
        }
        
        if (!data.timestamp || typeof data.timestamp !== 'number') {
            throw new Error('Missing or invalid timestamp in YATA response');
        }
        
        // Validate each country's data
        Object.entries(data.stocks).forEach(([country, countryData]) => {
            if (!COUNTRY_CODES[country]) {
                logger.warn(`Unknown country code: ${country}`);
            }
            
            if (!countryData.update || typeof countryData.update !== 'number') {
                throw new Error(`Missing or invalid update timestamp for country: ${country}`);
            }
            
            if (!countryData.stocks || !Array.isArray(countryData.stocks)) {
                throw new Error(`Invalid stock data format for country: ${country}`);
            }
            
            countryData.stocks.forEach(item => {
                if (!item.id || !item.name || typeof item.quantity === 'undefined' || typeof item.cost === 'undefined') {
                    throw new Error(`Invalid item data in country ${country}: ${JSON.stringify(item)}`);
                }
            });
        });
        
        return true;
    },

    validateTornMarketResponse(data, itemId) {
        if (!data || typeof data !== 'object') {
            throw new Error(`Invalid Torn API response for item ${itemId}`);
        }

        if (data.error) {
            throw new Error(`Torn API error: ${data.error.error}`);
        }

        if (!data.itemmarket || typeof data.itemmarket !== 'object') {
            throw new Error(`Missing or invalid itemmarket data for item ${itemId}`);
        }

        const { item, listings } = data.itemmarket;
        
        if (!item || !item.type || !Array.isArray(listings)) {
            throw new Error(`Invalid market data structure for item ${itemId}`);
        }

        return true;
    }
};

// Country code mapping for consistency
const COUNTRY_CODES = {
    mex: "Mexico",
    cay: "Cayman Islands",
    can: "Canada",
    haw: "Hawaii",
    uni: "United Kingdom",
    arg: "Argentina",
    swi: "Switzerland",
    jap: "Japan",
    chi: "China",
    uae: "UAE",
    sou: "South Africa"
};

// Hardcoded flight times in minutes for each country
const FLIGHT_TIMES = {
    mex: 36,
    cay: 50,
    can: 58,
    haw: 188,
    uni: 222,
    arg: 234,
    swi: 246,
    jap: 316,
    chi: 338,
    uae: 380,
    sou: 416
};

// Enhanced stock analysis utilities
const stockAnalyzer = {
    calculateTrend(historicalData, timeframeHours = 24) {
        if (!historicalData || historicalData.length < 2) return 0;
        
        const cutoff = Date.now() - (timeframeHours * 60 * 60 * 1000);
        const relevantData = historicalData.filter(d => d.timestamp * 1000 >= cutoff);
        
        if (relevantData.length < 2) return 0;
        
        const changes = [];
        for (let i = 1; i < relevantData.length; i++) {
            const pctChange = ((relevantData[i].quantity - relevantData[i-1].quantity) / relevantData[i-1].quantity) * 100;
            changes.push(pctChange);
        }
        
        return changes.reduce((a, b) => a + b, 0) / changes.length;
    },
    
    predictRestock(historicalData) {
        if (!historicalData || historicalData.length < 2) return null;
        
        const sorted = [...historicalData].sort((a, b) => a.quantity - b.quantity);
        const minQuantity = sorted[0].quantity;
        const maxQuantity = sorted[sorted.length - 1].quantity;
        
        // If current quantity is near minimum, might indicate upcoming restock
        const latestQuantity = historicalData[historicalData.length - 1].quantity;
        const nearMin = (latestQuantity - minQuantity) / (maxQuantity - minQuantity) < 0.2;
        
        return {
            minQuantity,
            maxQuantity,
            nearMin,
            avgQuantity: sorted.reduce((a, b) => a + b.quantity, 0) / sorted.length
        };
    }
};

// Opens (or creates) the IndexedDB database 'TornStockLogger' version 2
async function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("TornStockLogger", 2); // Increment version for schema update
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
            // Only create or upgrade the object store if it does not exist
            // or if a breaking schema change is required in the future
            // For v2, only create if missing (do not delete existing data)
            if (!db.objectStoreNames.contains("stock_history")) {
                const store = db.createObjectStore("stock_history", { 
                    keyPath: ["timestamp", "country", "item_id"]
                });
                // Add indices for common queries
                store.createIndex("by_item", ["country", "item_id"], { unique: false });
                store.createIndex("by_timestamp", "timestamp", { unique: false });
                store.createIndex("by_country", "country", { unique: false });
                logger.info("Database schema created (v2)");
            } else {
                // For future migrations, add migration logic here
                logger.info("Database schema upgrade: no destructive changes (v2)");
            }
        };
    });
}

// Saves a snapshot of stock data into the IndexedDB 'stock_history' store
async function saveStockSnapshot(db, country, item_id, quantity, timestamp, retryCount = 0) {
    const MAX_RETRIES = 3;
    try {
        // Validate input
        if (!country || !item_id || typeof quantity === 'undefined' || !timestamp) {
            throw new Error("Invalid snapshot data");
        }
        
        // Sanitize data
        const data = {
            country,
            item_id,
            quantity: validator.sanitizeNumber(quantity),
            timestamp: validator.sanitizeNumber(timestamp),
            created_at: Date.now()
        };
        
        const tx = db.transaction("stock_history", "readwrite");
        const store = tx.objectStore("stock_history");
        
        // Check for duplicate entry
        const existingKey = [data.timestamp, data.country, data.item_id];
        const existing = await store.get(existingKey);
        
        if (existing) {
            logger.info(`Updating existing snapshot for ${country}:${item_id} at ${timestamp}`);
            await store.put(data);
        } else {
            await store.add(data);
        }
        
        await tx.done;
        logger.info(`Successfully saved snapshot for ${country}:${item_id}`);
        
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
    return flightTime > 0 ? profit / flightTime : 0;
}

// Cache for static item metadata fetched once at initialization
let staticItemData = {};

// YATA API error codes
const YATA_ERROR_CODES = {
    SERVER_ERROR: 1,
    USER_ERROR: 2,
    RATE_LIMIT: 3,
    TORN_API_ERROR: 4
};

// Enhanced error handling for YATA API
class YataApiError extends Error {
    constructor(error, status) {
        super(error.error);
        this.name = 'YataApiError';
        this.code = error.code;
        this.status = status;
    }
}

// Enhanced loadStaticMetadata with YATA error handling
async function loadStaticMetadata() {
    try {
        await rateLimiter.waitForNextCall(true);
        const response = await fetch("https://yata.yt/api/v1/travel/export/");
        
        if (!response.ok) {
            const errorData = await response.json();
            if (errorData.error) {
                switch (errorData.error.code) {
                    case YATA_ERROR_CODES.RATE_LIMIT:
                        logger.warn("YATA API rate limit reached, waiting before retry");
                        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30s
                        return loadStaticMetadata(); // Retry
                    case YATA_ERROR_CODES.TORN_API_ERROR:
                        logger.error("YATA received error from Torn API:", errorData.error.error);
                        break;
                    case YATA_ERROR_CODES.SERVER_ERROR:
                        logger.error("YATA server error:", errorData.error.error);
                        break;
                    case YATA_ERROR_CODES.USER_ERROR:
                        logger.error("YATA user error:", errorData.error.error);
                        break;
                }
                throw new YataApiError(errorData.error, response.status);
            }
            throw new Error(`YATA API HTTP error! status: ${response.status}`);
        }

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
                const flight_time = FLIGHT_TIMES[country] || 0;
                if (!flight_time) {
                    logger.warn(`Missing or invalid flight time for country ${country}`);
                }
                
                staticItemData[key] = {
                    country,
                    id: item.id,
                    name: item.name,
                    cost: validator.sanitizeNumber(item.cost),
                    flight_time: flight_time
                };
            }
        }
        logger.info("Static metadata loaded successfully");
        return true;
    } catch (err) {
        if (err instanceof YataApiError) {
            // Handle specific YATA API errors
            switch (err.code) {
                case YATA_ERROR_CODES.RATE_LIMIT:
                    logger.warn("Rate limit reached, retrying in 30s");
                    await new Promise(resolve => setTimeout(resolve, 30000));
                    return loadStaticMetadata();
                default:
                    logger.error(`YATA API Error (${err.code}):`, err.message);
            }
        } else {
            logger.error("Failed to load static metadata:", err);
        }
        throw err;
    }
}

// Cache for market prices
let marketPriceCache = {};
const MARKET_PRICE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Enhanced fetchMarketPriceForItem with caching
async function fetchMarketPriceForItem(itemId) {
    if (!apiKey) {
        logger.warn("No API key available");
        return { price: 0, type: null };
    }
    
    // Check cache first
    const cached = marketPriceCache[itemId];
    if (cached && Date.now() - cached.timestamp < MARKET_PRICE_CACHE_DURATION) {
        return cached;
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
        
        apiValidator.validateTornMarketResponse(data, itemId);

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
        const result = { price: Math.round(avg), type, timestamp: Date.now() };
        
        // Cache the result
        marketPriceCache[itemId] = result;
        return result;
    } catch (err) {
        logger.error(`Error fetching market price for item ${itemId}:`, err);
        return { price: 0, type: null };
    }
}

// Fetch all item types from Torn API in one call
async function fetchAllItemTypes() {
    if (!apiKey) {
        logger.warn("No API key available for fetching all item types");
        return {};
    }
    try {
        await rateLimiter.waitForNextCall();
        const res = await fetch(`https://api.torn.com/torn/?selections=items&key=${apiKey}`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error.error);

        const typeCache = {};
        for (const [id, item] of Object.entries(data.items || {})) {
            typeCache[id] = item.type;
        }
        logger.info("Fetched all item types from Torn API");
        return typeCache;
    } catch (err) {
        logger.error("Failed to fetch all item types:", err);
        return {};
    }
}

// Fetch and cache all market prices for relevant items (Plushie/Flower)
async function fetchAndCacheAllMarketPrices() {
    if (!apiKey) {
        logger.warn("No API key available for fetching market prices");
        return;
    }
    const itemIds = Object.keys(itemTypeCache).filter(
        id => itemTypeCache[id] === 'Plushie' || itemTypeCache[id] === 'Flower'
    );
    for (const itemId of itemIds) {
        await fetchMarketPriceForItem(itemId);
    }
    logger.info('Initial market prices fetched and cached.');
}

// Update fetchAndLogStock with YATA error handling
async function fetchAndLogStock(requestedCountries = null) {
    const db = await openDatabase();
    let yataData = {};
    try {
        await rateLimiter.waitForNextCall(true);
        const yataRes = await fetch("https://yata.yt/api/v1/travel/export/");

        if (!yataRes.ok) {
            const errorData = await yataRes.json();
            if (errorData.error) {
                throw new YataApiError(errorData.error, yataRes.status);
            }
            throw new Error(`YATA API HTTP error! status: ${yataRes.status}`);
        }

        yataData = await yataRes.json();
        apiValidator.validateYataResponse(yataData);

        // Define timestamp as soon as yataData is available
        const timestamp = yataData.timestamp || Math.floor(Date.now() / 1000);

        for (const [country, data] of Object.entries(yataData.stocks || {})) {
            if (requestedCountries && !requestedCountries.includes(country)) continue;
            for (const item of data.stocks || []) {
                const historicalData = await getHistoricalData(db, country, item.id, timestamp - (24 * 60 * 60), timestamp);
                const trend = stockAnalyzer.calculateTrend(historicalData);
                const restock = stockAnalyzer.predictRestock(historicalData);
                await saveStockSnapshot(db, country, item.id, item.quantity, timestamp, {
                    trend,
                    restock,
                    countryName: COUNTRY_CODES[country] || country
                });
            }
        }

        const dynamicData = {};
        const itemIdsToFetch = new Set();
        for (const [country, data] of Object.entries(yataData.stocks || {})) {
            if (requestedCountries && !requestedCountries.includes(country)) continue;
            for (const item of data.stocks || []) {
                const key = `${country}_${item.id}`;
                dynamicData[key] = { quantity: item.quantity };
                // Only fetch price if manual refresh
                if (manualRefreshMode) itemIdsToFetch.add(item.id);
            }
        }

        const priceMap = {};
        const itemIds = Array.from(itemIdsToFetch);
        for (let i = 0; i < itemIds.length; i++) {
            priceMap[itemIds[i]] = await fetchMarketPriceForItem(itemIds[i]);
        }

        const result = {};
        for (const [key, dyn] of Object.entries(dynamicData)) {
            const meta = staticItemData[key];
            if (!meta) {
                logger.warn('No meta for key', key);
                continue;
            }
            let market_price = 0;
            if (manualRefreshMode) {
                const info = priceMap[meta.id] || {};
                market_price = info.price ?? 0;
                // Save to IndexedDB for persistence
                try {
                    const tx = db.transaction("stock_history", "readwrite");
                    const store = tx.objectStore("stock_history");
                    // Use a special country code for market price snapshots
                    const priceKey = [timestamp, 'MARKET', meta.id];
                    await store.put({
                        country: 'MARKET',
                        item_id: meta.id,
                        quantity: market_price, // Store price in quantity field for simplicity
                        timestamp,
                        created_at: Date.now(),
                        type: 'market_price'
                    });
                    await tx.done;
                } catch (err) {
                    logger.warn('Failed to save market price to DB:', err);
                }
            } else {
                // Try to get the latest market price from IndexedDB
                try {
                    const latestPrice = await getLatestSnapshot(db, 'MARKET', meta.id);
                    if (latestPrice && typeof latestPrice.quantity === 'number') {
                        market_price = latestPrice.quantity;
                    } else if (marketPriceCache[meta.id]) {
                        market_price = marketPriceCache[meta.id].price ?? 0;
                    }
                } catch (err) {
                    logger.warn('Failed to load market price from DB:', err);
                    if (marketPriceCache[meta.id]) {
                        market_price = marketPriceCache[meta.id].price ?? 0;
                    }
                }
            }
            const item_type = itemTypeCache[meta.id];
            if (typeof item_type === "undefined") {
                logger.info(`Item ${meta.id} (${meta.name}) type: UNKNOWN`);
                logger.info(`Skipping item ${meta.id} (${meta.name}) because type is unknown`);
                continue;
            }
            if (item_type !== "Plushie" && item_type !== "Flower") {
                continue;
            }
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

        await browser.storage.local.set({ stockData: result, stockDataVersion: Date.now() });
        console.log("Stock data updated and saved.");
        manualRefreshMode = false;
    } catch (e) {
        logger.error("YATA fetch/validation failed:", e);
        throw e; // Propagate error for better handling
    }
}

// Initializes the extension: loads API key, metadata, and starts periodic quantity-only fetching
async function initialize() {
    try {
        const data = await browser.storage.local.get(["tornApiKey", "itemTypeCache"]);
        apiKey = data.tornApiKey || null;
        itemTypeCache = data.itemTypeCache || {};

        if (!apiKey) {
            logger.warn("API key is missing. Extension is idle until a key is provided.");
            return; // Do not proceed further
        }

        // Fetch all item types if cache is empty
        if (!itemTypeCache || Object.keys(itemTypeCache).length === 0) {
            itemTypeCache = await fetchAllItemTypes();
            await browser.storage.local.set({ itemTypeCache });
        }

        await loadStaticMetadata();
        // Fetch and cache all market prices for relevant items (Plushie/Flower) once at startup
        await fetchAndCacheAllMarketPrices();
        await fetchAndLogStock();

        // Remove setInterval/clearInterval logic
        // Set up periodic alarm (every 30s)
        const alarms = (typeof browser !== 'undefined' && browser.alarms) ? browser.alarms : (typeof chrome !== 'undefined' ? chrome.alarms : null);
        if (alarms) {
            alarms.clear("periodicFetch", () => {
                alarms.create("periodicFetch", { periodInMinutes: 0.5 }); // 30 seconds
            });
        }

        logger.info("Initialization completed successfully");
    } catch (err) {
        logger.error("Initialization failed:", err);
    }
}

// Query methods for historical data
async function getHistoricalData(db, country, item_id, startTime, endTime) {
  try {
    const tx = db.transaction("stock_history", "readonly");
    const store = tx.objectStore("stock_history");
    const index = store.index("by_item");
    
    const range = IDBKeyRange.bound(
      [country, item_id, startTime], 
      [country, item_id, endTime]
    );
    
    const results = await index.getAll(range) || [];
    return Array.isArray(results) ? results.sort((a, b) => a.timestamp - b.timestamp) : [];
  } catch (err) {
    logger.error("Failed to fetch historical data:", err);
    throw err;
  }
}

async function getLatestSnapshot(db, country, item_id) {
  try {
    const tx = db.transaction("stock_history", "readonly");
    const store = tx.objectStore("stock_history");
    const index = store.index("by_item");
    
    const range = IDBKeyRange.bound(
      [country, item_id, 0],
      [country, item_id, Date.now()]
    );
    
    const cursor = await index.openCursor(range, 'prev');
    return cursor ? cursor.value : null;
  } catch (err) {
    logger.error("Failed to fetch latest snapshot:", err);
    throw err;
  }
}

// Export functions for testing
export {
    calculateProfitPerMinute,
    fetchAndLogStock,
    fetchMarketPriceForItem,
    saveStockSnapshot,
    // Export other utilities that might be needed for testing
    validator,
    apiValidator,
    stockAnalyzer,
    rateLimiter,
    openDatabase,
    getHistoricalData,
    getLatestSnapshot,
    initialize,
    // Export for manual refresh
    logger,
    manualRefreshMode,
    // Add this function to allow setting manualRefreshMode
    setManualRefreshMode
};

// Add the function definition before the export block
function setManualRefreshMode(value) {
    manualRefreshMode = value;
}

// Listen for alarms to trigger periodic fetch
if ((typeof browser !== 'undefined' && browser.alarms) || (typeof chrome !== 'undefined' && chrome.alarms)) {
    const alarms = (typeof browser !== 'undefined' && browser.alarms) ? browser.alarms : chrome.alarms;
    alarms.onAlarm.addListener(alarm => {
        if (alarm.name === "periodicFetch") {
            if (!apiKey) {
                logger.warn("Periodic fetch skipped: API key is missing.");
                return;
            }
            manualRefreshMode = false; // ensure no price fetch
            fetchAndLogStock().catch(err => logger.error("Periodic fetch failed:", err));
        }
    });
}

// Only initialize if we're in a browser environment
if (typeof browser !== 'undefined') {
  (async () => {
    await initialize();
    initializeBrowserListeners(initialize);
  })().catch(err => {
    console.error('Failed to initialize:', err);
  });
}
