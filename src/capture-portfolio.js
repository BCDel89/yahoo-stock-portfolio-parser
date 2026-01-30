require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

function getTimestamp() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${month}${day}${year}_${hours}${minutes}`;
}

async function capturePortfolio() {
  const browser = await puppeteer.launch({
    headless: process.env.PUPPETEER_HEADLESS === 'true',
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ],
    timeout: parseInt(process.env.PUPPETEER_TIMEOUT || '60000')
  });

  try {
    const page = await browser.newPage();

    // Load cookies
    console.log('Loading cookies...');
    const cookiesPath = path.join(__dirname, '..', 'cookie.json');
    const cookiesString = fs.readFileSync(cookiesPath, 'utf8');
    const cookies = JSON.parse(cookiesString);

    const puppeteerCookies = cookies.map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expirationDate || -1,
      httpOnly: cookie.httpOnly || false,
      secure: cookie.secure || false,
      sameSite: cookie.sameSite === 'no_restriction' ? 'None' :
                cookie.sameSite === 'lax' ? 'Lax' :
                cookie.sameSite === 'strict' ? 'Strict' : 'None'
    }));

    await page.setCookie(...puppeteerCookies);
    console.log(`Loaded ${puppeteerCookies.length} cookies`);

    // Navigate to portfolios page
    console.log('Navigating to Yahoo Finance portfolios...');
    await page.goto('https://finance.yahoo.com/portfolios/', {
      waitUntil: 'domcontentloaded',
      timeout: parseInt(process.env.PUPPETEER_TIMEOUT || '60000')
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Find and click the account
    const accountId = process.env.ACCOUNT_IDENTIFIER;
    const accountName = process.env.ACCOUNT_NAME;
    console.log(`Looking for account: ${accountId || accountName}...`);
    const clicked = await page.evaluate((identifier, name) => {
      const links = Array.from(document.querySelectorAll('a, button, [role="button"]'));
      for (const link of links) {
        const text = link.textContent || '';
        if ((identifier && text.includes(identifier)) || (name && text.includes(name))) {
          link.click();
          return { success: true, href: link.href || 'no-href' };
        }
      }
      return { success: false };
    }, accountId, accountName);

    if (!clicked.success) {
      throw new Error('Could not find account. Check ACCOUNT_IDENTIFIER and ACCOUNT_NAME in .env');
    }

    console.log('Clicked on account, waiting for navigation...');

    if (clicked.href && clicked.href !== 'no-href') {
      try {
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
      } catch (e) {
        console.log('Navigation wait timed out, continuing...');
      }
    }

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Scroll to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create portfolio directory if it doesn't exist
    const portfolioDir = path.join(__dirname, '..', 'portfolio');
    if (!fs.existsSync(portfolioDir)) {
      fs.mkdirSync(portfolioDir, { recursive: true });
      console.log('Created portfolio directory');
    }

    // Generate timestamp for filenames
    const timestamp = getTimestamp();
    console.log(`Using timestamp: ${timestamp}`);

    // Take screenshot before parsing
    const screenshotBeforePath = path.join(portfolioDir, `screenshot_before_${timestamp}.png`);
    await page.screenshot({ path: screenshotBeforePath, fullPage: false });
    console.log(`Saved screenshot: screenshot_before_${timestamp}.png`);

    // Object to store all parsed data
    const portfolioData = {};

    // Define the tabs to parse
    const tabs = ['Summary', 'Holdings', 'Fundamentals'];

    for (const tabName of tabs) {
      console.log(`\nProcessing ${tabName} tab...`);

      // Click the tab
      const tabClicked = await page.evaluate((name) => {
        const allElements = Array.from(document.querySelectorAll('*'));

        for (const el of allElements) {
          const text = el.textContent.trim();
          if (text === name) {
            let clickable = el;
            for (let i = 0; i < 3; i++) {
              if (!clickable) break;
              if (clickable.tagName === 'BUTTON' ||
                  clickable.tagName === 'A' ||
                  clickable.getAttribute('role') === 'tab' ||
                  clickable.getAttribute('role') === 'button' ||
                  clickable.onclick ||
                  window.getComputedStyle(clickable).cursor === 'pointer') {
                clickable.click();
                return true;
              }
              clickable = clickable.parentElement;
            }
            el.click();
            return true;
          }
        }
        return false;
      }, tabName);

      if (!tabClicked) {
        console.log(`Could not find ${tabName} tab, skipping...`);
        continue;
      }

      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Take screenshot of this tab
      const tabScreenshotPath = path.join(portfolioDir, `screenshot_${tabName.toLowerCase()}_${timestamp}.png`);
      await page.screenshot({ path: tabScreenshotPath, fullPage: false });
      console.log(`Saved ${tabName} tab screenshot`);

      // Parse the table data
      const tabData = await page.evaluate((tabName) => {
        const results = [];
        const tables = Array.from(document.querySelectorAll('table, [role="table"]'));

        for (const table of tables) {
          const headers = [];
          const headerCells = table.querySelectorAll('th, [role="columnheader"]');
          headerCells.forEach(cell => {
            headers.push(cell.textContent.trim());
          });

          const rows = table.querySelectorAll('tr, [role="row"]');
          rows.forEach(row => {
            const cells = row.querySelectorAll('td, [role="cell"]');
            if (cells.length === 0) return;

            const rowData = {};
            cells.forEach((cell, index) => {
              const header = headers[index] || `column_${index}`;
              rowData[header] = cell.textContent.trim();
            });

            if (Object.keys(rowData).length > 0) {
              results.push(rowData);
            }
          });
        }

        return { tab: tabName, data: results };
      }, tabName);

      console.log(`Found ${tabData.data.length} rows in ${tabName} tab`);

      // Merge data into portfolioData by symbol
      tabData.data.forEach(row => {
        if (row.Symbol) {
          const symbol = row.Symbol;
          if (!portfolioData[symbol]) {
            portfolioData[symbol] = { symbol };
          }

          Object.keys(row).forEach(key => {
            if (key !== 'Symbol') {
              const fieldName = `${tabName.toLowerCase()}_${key}`;
              portfolioData[symbol][fieldName] = row[key];
            }
          });
        }
      });
    }

    // Save the parsed data to JSON
    const jsonPath = path.join(portfolioDir, `json_${timestamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(portfolioData, null, 2));
    console.log(`\nSaved JSON data: json_${timestamp}.json`);
    console.log(`Parsed ${Object.keys(portfolioData).length} symbols`);

    // Print summary
    console.log('\nSymbols found:');
    Object.keys(portfolioData).forEach(symbol => {
      const fieldCount = Object.keys(portfolioData[symbol]).length - 1;
      console.log(`  ${symbol}: ${fieldCount} fields`);
    });

    // Go back to Summary tab for PDF
    console.log('\nPreparing to generate PDF...');
    try {
      await page.evaluate(() => {
        const allElements = Array.from(document.querySelectorAll('*'));
        for (const el of allElements) {
          const text = el.textContent.trim();
          if (text === 'Summary') {
            let clickable = el;
            for (let i = 0; i < 3; i++) {
              if (!clickable) break;
              if (clickable.tagName === 'BUTTON' ||
                  clickable.tagName === 'A' ||
                  clickable.getAttribute('role') === 'tab' ||
                  clickable.getAttribute('role') === 'button' ||
                  clickable.onclick ||
                  window.getComputedStyle(clickable).cursor === 'pointer') {
                clickable.click();
                return true;
              }
              clickable = clickable.parentElement;
            }
            el.click();
            return true;
          }
        }
        return false;
      });

      await new Promise(resolve => setTimeout(resolve, 3000));

      // Scroll to top for better PDF
      await page.evaluate(() => window.scrollTo(0, 0));
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Generate PDF
      const pdfPath = path.join(portfolioDir, `print_${timestamp}.pdf`);
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20px',
          right: '20px',
          bottom: '20px',
          left: '20px'
        }
      });

      console.log(`\nSaved PDF: print_${timestamp}.pdf`);
    } catch (pdfError) {
      console.log(`Warning: Could not generate PDF - ${pdfError.message}`);
      console.log('Continuing with other outputs...');
    }
    console.log('\n=== Capture Complete ===');
    console.log(`All files saved to: ${portfolioDir}/`);
    console.log(`  - print_${timestamp}.pdf`);
    console.log(`  - json_${timestamp}.json`);
    console.log(`  - screenshot_before_${timestamp}.png`);
    console.log(`  - screenshot_summary_${timestamp}.png`);
    console.log(`  - screenshot_holdings_${timestamp}.png`);
    console.log(`  - screenshot_fundamentals_${timestamp}.png`);

  } catch (error) {
    console.error('Error during automation:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the script
capturePortfolio()
  .then(() => {
    console.log('\nScript completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
