// Wait for the DOM to be fully loaded before running UI setup and logic
document.addEventListener("DOMContentLoaded", async () => {
  // Cache references to key DOM elements
  const container = document.getElementById("content");       // Main content area for stock display
  const apiKeyInput = document.getElementById("apikey");      // Input field for the Torn API key
  const submitKey = document.getElementById("submit-key");    // Button to submit/validate API key
  const keyStatus = document.getElementById("key-status");    // Element to show key validation status
  const resetKey = document.getElementById("reset-key");      // Button to reset/remove API key
  const filterContainer = document.getElementById("filter");  // Container to hold country filter checkboxes
  const configForm = document.querySelector(".config-form");  // Form wrapping the API key inputs

  // Load saved data from browser local storage: stock data, API key, and any country filters
  const { stockData, tornApiKey, countryFilter } = await browser.storage.local.get([
    "stockData",
    "tornApiKey",
    "countryFilter"
  ]);
  // If an API key was previously saved, populate
  if (tornApiKey) apiKeyInput.value = tornApiKey;

  // Function to validate the Torn API key by querying the Torn user endpoint
  async function validateAndSaveKey() {
    const value = apiKeyInput.value.trim();
    if (!value) return;  // Do nothing if input is empty

    // Build URL to check basic user data with the provided key
    const url = `https://api.torn.com/user/?selections=basic&key=${value}`;
    try {
      const res = await fetch(url);
      const data = await res.json();

      // If the response contains a player_id, the key is valid
      if (data.player_id) {
        // Persist the valid key
        await browser.storage.local.set({ tornApiKey: value });
        keyStatus.textContent = "API key is valid and saved locally.";
        configForm.style.display = "none";  // Hide the config form
        console.log("API key validated and saved.");
        // Notify background script to restart data collection with new key
        browser.runtime.sendMessage({ type: "restart-collector" });
      } else {
        // Show error if key does not return expected data
        keyStatus.textContent = "Invalid API key.";
      }
    } catch (e) {
      // Network or parsing error handling
      keyStatus.textContent = "Error validating key.";
    }
  }

  // Wire up the 'Submit Key' button to trigger validation
  submitKey.addEventListener("click", validateAndSaveKey);

  // Wire up the 'Reset Key' button to remove saved key and show config form
  resetKey.addEventListener("click", async () => {
    await browser.storage.local.remove("tornApiKey");  // Remove key from storage
    apiKeyInput.value = "";                          // Clear input field
    configForm.style.display = "flex";               // Reveal config form
    keyStatus.textContent = "API key removed.";
    console.log("API key reset.");
  });

  // If we already have a valid key, hide the API key form immediately
  if (tornApiKey) {
    configForm.style.display = "none";
    keyStatus.textContent = "";
  }

  // If no stock data is available, show a placeholder message and stop rendering
  if (!stockData || Object.keys(stockData).length === 0) {
    container.innerText = "No data available yet, please wait.";
    return;
  }

  // Build the list of all countries from the stockData keys, sorted alphabetically
  const allCountries = Object.keys(stockData).sort();
  // Determine which countries should be shown (either saved filter or all if none)
  const selectedCountries = new Set(
    Array.isArray(countryFilter) ? countryFilter : allCountries
  );

  // Persist any changes to the country filter back to storage
  async function updateFilterStorage() {
    await browser.storage.local.set({
      countryFilter: Array.from(selectedCountries)
    });
  }

  // Generate checkboxes for each country to allow filtering
  filterContainer.innerHTML = "";  // Clear existing filters
  allCountries.forEach(code => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selectedCountries.has(code);  // Pre-check based on saved filter

    // Update selectedCountries when the user toggles a checkbox
    cb.addEventListener("change", () => {
      if (cb.checked) {
        selectedCountries.add(code);
      } else {
        selectedCountries.delete(code);
      }
      updateFilterStorage();
      render();  // Re-render display after filter change
    });

    label.appendChild(cb);
    label.appendChild(document.createTextNode(" " + code.toUpperCase()));
    filterContainer.appendChild(label);
  });

  // 'Refresh' button triggers a manual fetch of stock data for selected countries
  document.getElementById("refresh").addEventListener("click", () => {
    browser.runtime.sendMessage({
      type: "manual-refresh",
      countries: Array.from(selectedCountries)
    });
    console.log("Manual refresh requested for countries:", Array.from(selectedCountries));
  });

  // Builds UI blocks for each selected country and its items
  function render() {
    container.innerHTML = "";  // Clear previous content
    const timestamps = [];

    // Iterate over each country and its item list
    Object.entries(stockData).forEach(([country, items]) => {
      if (!selectedCountries.has(country)) return;  // Skip filtered-out countries

      // Create a section for this country
      const section = document.createElement("div");
      section.className = "country-block";
      section.innerHTML = `<h4>${country.toUpperCase()}</h4>`;

      // Determine the item with highest profit_per_minute for highlighting
      let topItem = items[0];
      items.forEach(item => {
        if (item.profit_per_minute > topItem.profit_per_minute) topItem = item;
        if (item.timestamp) timestamps.push(item.timestamp);
      });

      // Create a row for each item with detailed stats
      items.forEach(item => {
        const row = document.createElement("div");
        row.className = "item";
        // Highlight the top item
        if (item === topItem) row.classList.add("top-item");
        row.innerHTML = `
          <div><strong>${item.name}</strong></div>
          <div>Qty: ${item.quantity}</div>
          <div>Buy Price: ${item.cost}</div>
          <div>Market Price: ${item.market_price}</div>
          <div>Flight Time: ${item.flight_time} mins</div>
          <div>Profit/Min: ${item.profit_per_minute.toFixed(2)}</div>
        `;
        section.appendChild(row);
      });

      container.appendChild(section);
    });

    // If we have any timestamps, display last updated timer
    if (timestamps.length) {
      const latest = Math.max(...timestamps);
      const now = Math.floor(Date.now() / 1000);
      const minutesAgo = Math.floor((now - latest) / 60);
      const updated = document.createElement("div");
      updated.style = "margin-top: 10px; font-size: 11px; color: #ccc;";
      updated.innerText = `Last updated: ${minutesAgo} min${minutesAgo !== 1 ? 's' : ''} ago`;
      container.appendChild(updated);
    }
  }

  // Render on page load
  render();
});
