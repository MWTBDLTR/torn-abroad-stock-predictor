// Initialize browser event listeners
export function initializeBrowserListeners(initialize) {
  if (typeof browser !== 'undefined') {
    browser.runtime.onMessage.addListener(msg => {
      if (msg.type === "restart-collector") {
        initialize();
      }
      if (msg.type === "manual-refresh") {
        // Set manual refresh mode and trigger fetchAndLogStock
        import('./torn-stock-predictor.js').then(module => {
          module.setManualRefreshMode(true);
          module.fetchAndLogStock(msg.countries).catch(err => {
            // Optionally log error
            if (module.logger) module.logger.error("Manual refresh failed:", err);
          });
        });
      }
    });
  }
}

// Example usage in message handler
if (typeof browser !== 'undefined') {
  browser.runtime.onMessage.addListener(async (msg) => {
    if (msg.type === "get-historical-data") {
      // This will be handled by the main module
    }
  });
} 