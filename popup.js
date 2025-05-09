document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("content");
  const apiKeyInput = document.getElementById("apikey");
  const submitKey = document.getElementById("submit-key");
  const keyStatus = document.getElementById("key-status");
  const resetKey = document.getElementById("reset-key");
  const filterContainer = document.getElementById("filter");
  const configForm = document.querySelector(".config-form");

  const { stockData, tornApiKey, countryFilter } = await browser.storage.local.get([
    "stockData",
    "tornApiKey",
    "countryFilter"
  ]);
  if (tornApiKey) apiKeyInput.value = tornApiKey;

  async function validateAndSaveKey() {
    const value = apiKeyInput.value.trim();
    if (!value) return;
    const url = `https://api.torn.com/user/?selections=basic&key=${value}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.player_id) {
        await browser.storage.local.set({ tornApiKey: value });
        keyStatus.textContent = "API key is valid and saved.";
        configForm.style.display = "none";
        console.log("API key validated and saved.");
        browser.runtime.sendMessage({ type: "restart-collector" });
      } else {
        keyStatus.textContent = "Invalid API key.";
      }
    } catch (e) {
      keyStatus.textContent = "Error validating key.";
    }
  }

  submitKey.addEventListener("click", validateAndSaveKey);

  resetKey.addEventListener("click", async () => {
    await browser.storage.local.remove("tornApiKey");
    apiKeyInput.value = "";
    configForm.style.display = "flex";
    keyStatus.textContent = "API key removed.";
    console.log("API key reset.");
  });

  if (tornApiKey) {
    configForm.style.display = "none";
    keyStatus.textContent = "";
  }

  if (!stockData || Object.keys(stockData).length === 0) {
    container.innerText = "No data available.";
    return;
  }

  const allCountries = Object.keys(stockData).sort();
  const selectedCountries = new Set(
    Array.isArray(countryFilter) ? countryFilter : allCountries
  );

  async function updateFilterStorage() {
    await browser.storage.local.set({
      countryFilter: Array.from(selectedCountries)
    });
  }

  filterContainer.innerHTML = "";
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
    filterContainer.appendChild(label);
  });

  document.getElementById("refresh").addEventListener("click", () => {
    browser.runtime.sendMessage({
      type: "manual-refresh",
      countries: Array.from(selectedCountries)
    });
    console.log("Manual refresh requested for countries:", Array.from(selectedCountries));
  });

  function render() {
    container.innerHTML = "";
    const timestamps = [];

    Object.entries(stockData).forEach(([country, items]) => {
      if (!selectedCountries.has(country)) return;

      const section = document.createElement("div");
      section.className = "country-block";
      section.innerHTML = `<h4>${country.toUpperCase()}</h4>`;

      let topItem = items[0];
      items.forEach(item => {
        if (item.profit_per_minute > topItem.profit_per_minute) topItem = item;
        if (item.timestamp) timestamps.push(item.timestamp);
      });

      items.forEach(item => {
        const row = document.createElement("div");
        row.className = "item";
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

  render();
});