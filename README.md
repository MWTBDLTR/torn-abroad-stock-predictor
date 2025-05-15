# Torn Foreign Stock Predictor

A Firefox extension that helps predict foreign stock quantities in Torn City by analyzing historical data from the YATA API.

## Features

- Real-time stock quantity tracking
- Historical data analysis
- Market price monitoring
- Profit per minute calculations
- Country-based filtering
- Dark mode interface
- Responsive design

## Installation

1. Visit the [Firefox Add-ons page](https://addons.mozilla.org/firefox/addon/torn-foreign-stock-predictor/)
2. Click "Add to Firefox"
3. Follow the installation prompts

Or install manually:

1. Download the latest release
2. Go to `about:debugging` in Firefox
3. Click "This Firefox"
4. Click "Load Temporary Add-on"
5. Select any file in the extension directory

## Usage

1. Click the extension icon in your browser toolbar
2. Enter your Torn API key (required for market price data)
3. Select the countries you want to monitor
4. Click "Refresh Market Prices" to update data

The extension will automatically track stock quantities every 30 seconds and update the display.

## Development

### Prerequisites

- Firefox Browser
- Node.js (for development tools)
- Basic understanding of JavaScript and browser extensions

### Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/MWTBDLTR/torn-abroad-stock-predictor.git
   cd torn-abroad-stock-predictor
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Load the extension in Firefox:
   - Go to `about:debugging`
   - Click "This Firefox"
   - Click "Load Temporary Add-on"
   - Select `manifest.json` from your project directory

### Building

```bash
npm run build
```

## License

This project is licensed under the GNU General Public License v3.0 (GPL‑3.0).  
See [LICENSE](LICENSE) for full details.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

By submitting a pull request, you agree that:

- Your contributions are licensed under GPL v3
- All existing copyright headers remain intact
- You include your name/email in `NOTICE.md` for any significant addition

## Credits

- YATA API - For providing stock data
- Torn API - For market price information
- MrChurchh [3654415] - Initial development

## Support

For support, please:

1. Check the [Issues](https://github.com/MWTBDLTR/torn-abroad-stock-predictor/issues) page
2. Create a new issue if needed
3. Contact MrChurchh [3654415] in Torn

## Changelog

### v2.0

- Complete UI redesign
- Added market price tracking
- Improved data accuracy
- Better error handling
- Added country filters

### v1.0

- Initial release
- Basic stock tracking
- YATA API integration
