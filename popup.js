// UI State Management
const UIState = {
    setLoading(isLoading) {
        document.body.classList.toggle('loading', isLoading);
        const loader = document.querySelector('.loader');
        if (isLoading && !loader) {
            const loaderEl = document.createElement('div');
            loaderEl.className = 'loader';
            loaderEl.innerHTML = 'Loading...';
            document.body.appendChild(loaderEl);
        } else if (!isLoading && loader) {
            loader.remove();
        }
    },
    
    showError(message) {
        const errorEl = document.createElement('div');
        errorEl.className = 'error-message';
        errorEl.textContent = message;
        document.body.appendChild(errorEl);
        setTimeout(() => errorEl.remove(), 5000); // Auto-dismiss after 5s
    }
};

// Utility functions for data formatting
const formatUtils = {
    formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    },
    
    formatTimeAgo(timestamp) {
        const now = Math.floor(Date.now() / 1000);
        const minutesAgo = Math.floor((now - timestamp) / 60);
        return `${minutesAgo} min${minutesAgo !== 1 ? 's' : ''} ago`;
    }
};

// Wait for the DOM to be fully loaded before running UI setup and logic
document.addEventListener("DOMContentLoaded", async () => {
    try {
        UIState.setLoading(true);
        
        // Cache references to key DOM elements
        const elements = {
            container: document.getElementById("content"),
            apiKeyInput: document.getElementById("apikey"),
            submitKey: document.getElementById("submit-key"),
            keyStatus: document.getElementById("key-status"),
            resetKey: document.getElementById("reset-key"),
            filterContainer: document.getElementById("filter"),
            configForm: document.querySelector(".config-form"),
            refreshButton: document.getElementById("refresh")
        };

        // Validate all required elements exist
        Object.entries(elements).forEach(([name, element]) => {
            if (!element) throw new Error(`Required element "${name}" not found`);
        });

        // Load saved data from browser local storage with timeout
        const storageData = await Promise.race([
            browser.storage.local.get(["stockData", "tornApiKey", "countryFilter"]),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Storage timeout")), 5000))
        ]);

        const { stockData, tornApiKey, countryFilter } = storageData;

        // If an API key was previously saved, populate
        if (tornApiKey) elements.apiKeyInput.value = tornApiKey;

        // Function to validate the Torn API key by querying the Torn user endpoint
        async function validateAndSaveKey() {
            try {
                UIState.setLoading(true);
                elements.keyStatus.textContent = "Validating API key...";
                
                const value = elements.apiKeyInput.value.trim();
                if (!value) {
                    UIState.showError("Please enter an API key");
                    return;
                }

                const res = await fetch(`https://api.torn.com/user/?selections=basic&key=${value}`);
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                
                const data = await res.json();
                if (data.error) throw new Error(data.error.error);

                if (data.player_id) {
                    await browser.storage.local.set({ tornApiKey: value });
                    elements.keyStatus.textContent = "API key is valid and saved locally.";
                    elements.configForm.style.display = "none";
                    console.log("API key validated and saved.");
                    browser.runtime.sendMessage({ type: "restart-collector" });
                } else {
                    throw new Error("Invalid API response format");
                }
            } catch (e) {
                UIState.showError(`Error: ${e.message}`);
                elements.keyStatus.textContent = "Error validating key.";
            } finally {
                UIState.setLoading(false);
            }
        }

        // Wire up event listeners with error handling
        elements.submitKey.addEventListener("click", validateAndSaveKey);
        elements.apiKeyInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") validateAndSaveKey();
        });

        elements.resetKey.addEventListener("click", async () => {
            try {
                UIState.setLoading(true);
                await browser.storage.local.remove("tornApiKey");
                elements.apiKeyInput.value = "";
                elements.configForm.style.display = "flex";
                elements.keyStatus.textContent = "API key removed.";
                console.log("API key reset.");
            } catch (e) {
                UIState.showError(`Error resetting key: ${e.message}`);
            } finally {
                UIState.setLoading(false);
            }
        });

        // If we already have a valid key, hide the API key form
        if (tornApiKey) {
            elements.configForm.style.display = "none";
            elements.keyStatus.textContent = "";
        }

        // If no stock data is available, show a placeholder message
        if (!stockData || Object.keys(stockData).length === 0) {
            elements.container.innerText = "No data available yet, please wait.";
            return;
        }

        // Build the list of all countries from the stockData keys
        const allCountries = Object.keys(stockData).sort();
        const selectedCountries = new Set(
            Array.isArray(countryFilter) ? countryFilter : allCountries
        );

        // Persist any changes to the country filter back to storage
        async function updateFilterStorage() {
            try {
                await browser.storage.local.set({
                    countryFilter: Array.from(selectedCountries)
                });
            } catch (e) {
                UIState.showError("Failed to save filter preferences");
            }
        }

        // Generate country filter checkboxes
        elements.filterContainer.innerHTML = "";
        allCountries.forEach(code => {
            const label = document.createElement("label");
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = selectedCountries.has(code);
            
            cb.addEventListener("change", () => {
                if (cb.checked) {
                    selectedCountries.add(code);
                } else {
                    selectedCountries.delete(code);
                }
                updateFilterStorage();
                render();
            });

            label.appendChild(cb);
            label.appendChild(document.createTextNode(" " + code.toUpperCase()));
            elements.filterContainer.appendChild(label);
        });

        // Handle manual refresh with loading state
        elements.refreshButton.addEventListener("click", async () => {
            try {
                UIState.setLoading(true);
                await browser.runtime.sendMessage({
                    type: "manual-refresh",
                    countries: Array.from(selectedCountries)
                });
                console.log("Manual refresh requested for countries:", Array.from(selectedCountries));
            } catch (e) {
                UIState.showError("Failed to trigger refresh");
            } finally {
                UIState.setLoading(false);
            }
        });

        // Enhanced render function with better formatting
        function render() {
            elements.container.innerHTML = "";
            const timestamps = [];

            Object.entries(stockData).forEach(([country, items]) => {
                if (!selectedCountries.has(country)) return;

                const section = document.createElement("div");
                section.className = "country-block";
                section.innerHTML = `<h4>${country.toUpperCase()}</h4>`;

                const topItem = items.reduce((prev, curr) => 
                    (curr.profit_per_minute > prev.profit_per_minute) ? curr : prev
                );

                items.forEach(item => {
                    if (item.timestamp) timestamps.push(item.timestamp);
                    
                    const row = document.createElement("div");
                    row.className = "item";
                    if (item === topItem) row.classList.add("top-item");
                    
                    row.innerHTML = `
                        <div><strong>${item.name}</strong></div>
                        <div>Qty: ${item.quantity.toLocaleString()}</div>
                        <div>Buy: ${formatUtils.formatCurrency(item.cost)}</div>
                        <div>Market: ${formatUtils.formatCurrency(item.market_price)}</div>
                        <div>Flight: ${item.flight_time} mins</div>
                        <div>Profit/Min: ${formatUtils.formatCurrency(item.profit_per_minute)}</div>
                    `;
                    section.appendChild(row);
                });

                elements.container.appendChild(section);
            });

            if (timestamps.length) {
                const latest = Math.max(...timestamps);
                const updated = document.createElement("div");
                updated.className = "last-updated";
                updated.innerText = `Last updated: ${formatUtils.formatTimeAgo(latest)}`;
                elements.container.appendChild(updated);
            }
        }

        // Initial render
        render();
        UIState.setLoading(false);
        
    } catch (e) {
        UIState.showError(`Initialization error: ${e.message}`);
        console.error("Popup initialization failed:", e);
    }
});
