// Initialize browser event listeners
export function initializeBrowserListeners(initialize) {
  if (typeof browser !== 'undefined') {
    browser.runtime.onMessage.addListener(msg => {
      if (msg.type === "restart-collector") {
        initialize();
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