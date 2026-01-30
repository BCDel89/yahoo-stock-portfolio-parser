# Stock Portfolio Parser

Automated tool for extracting portfolio data from Yahoo Finance using Puppeteer. This tool captures portfolio screenshots, generates PDFs, and exports structured JSON data from Yahoo Finance portfolio pages.

## Features

- 🔐 **Cookie-based authentication** - Uses exported browser cookies for seamless login
- 📊 **Multi-tab data extraction** - Captures data from Summary, Holdings, and Fundamentals tabs
- 📸 **Screenshot capture** - Takes timestamped screenshots of each portfolio view
- 📄 **PDF generation** - Creates printable PDF reports of your portfolio
- 📋 **JSON export** - Exports structured portfolio data for further analysis
- ⚙️ **Configurable** - Environment-based configuration for flexibility

## Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- A Yahoo Finance account with an existing portfolio

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd stock-portfolio-parser
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your account details
```

4. Export your Yahoo Finance cookies:
   - Install a browser extension like "Cookie Editor" or "EditThisCookie"
   - Log in to Yahoo Finance
   - Export cookies as JSON
   - Save to `cookie.json` in the project root

## Configuration

Edit the `.env` file with your settings:

```env
# Account identifier to search for (e.g., account number or name)
ACCOUNT_IDENTIFIER=your-account-id
ACCOUNT_NAME=INDIVIDUAL

# Optional: Puppeteer configuration
PUPPETEER_HEADLESS=false
PUPPETEER_TIMEOUT=60000
```

## Usage

### Capture Portfolio (Recommended)
Captures screenshots, generates PDF, and exports JSON data:
```bash
npm run capture
```

### Parse Portfolio Data
Extracts and parses portfolio data to JSON only:
```bash
npm run parse
```

### Print Portfolio
Generates a PDF report of your portfolio:
```bash
npm run print
```

## Output

All generated files are saved to the `portfolio/` directory with timestamps:

- `screenshot_before_MMDDYY_HHMM.png` - Initial page screenshot
- `screenshot_summary_MMDDYY_HHMM.png` - Summary tab screenshot
- `screenshot_holdings_MMDDYY_HHMM.png` - Holdings tab screenshot
- `screenshot_fundamentals_MMDDYY_HHMM.png` - Fundamentals tab screenshot
- `json_MMDDYY_HHMM.json` - Structured portfolio data
- `print_MMDDYY_HHMM.pdf` - PDF report

## Project Structure

```
stock-portfolio-parser/
├── src/                        # Source code
│   ├── capture-portfolio.js    # Main capture script
│   ├── parse-portfolio-data.js # Data parsing script
│   └── print-portfolio.js      # PDF generation script
├── data/                       # Data directory
│   └── output/                 # Output files location
├── portfolio/                  # Generated portfolio files (ignored by git)
├── assets/                     # Static assets
├── cookie.json                 # Auth cookies (ignored by git)
├── .env                        # Environment config (ignored by git)
├── .env.example               # Example environment config
├── .gitignore                 # Git ignore rules
├── package.json               # Project dependencies
└── README.md                  # This file
```

## Security Notes

⚠️ **IMPORTANT**: This repository is configured to exclude sensitive files:

- `cookie.json` - Contains authentication cookies
- `.env` - Contains your account configuration
- `portfolio/` - May contain personal financial data
- All generated screenshots and PDFs

**Never commit these files to version control!**

## Troubleshooting

### "Could not find Robinhood Individual account"
- Verify your `ACCOUNT_IDENTIFIER` and `ACCOUNT_NAME` in `.env`
- Check that your cookies are still valid (they may expire)
- Try re-exporting fresh cookies from your browser

### "Navigation timeout"
- Increase `PUPPETEER_TIMEOUT` in `.env`
- Check your internet connection
- Verify Yahoo Finance is accessible

### Puppeteer browser doesn't launch
- Install Chromium: `npx puppeteer browsers install chrome`
- Check system requirements for Puppeteer

## Development

To modify the scripts for your specific needs:

1. The main data extraction logic is in `src/capture-portfolio.js`
2. Update the `tabs` array to add/remove tabs to capture
3. Modify the table parsing logic in the `page.evaluate()` sections
4. Adjust timeouts if pages load slowly

## License

ISC

## Disclaimer

This tool is for personal use only. Ensure you comply with Yahoo Finance's Terms of Service when using automated tools. Be respectful of rate limits and don't abuse the service.
