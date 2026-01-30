require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function printPortfolio() {
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

    // Load cookies from cookie.json
    console.log('Loading cookies...');
    const cookiesPath = path.join(__dirname, '..', 'cookie.json');
    const cookiesString = fs.readFileSync(cookiesPath, 'utf8');
    const cookies = JSON.parse(cookiesString);

    // Convert cookies to Puppeteer format and set them
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

    // Navigate to Yahoo Finance portfolios
    console.log('Navigating to Yahoo Finance portfolios...');
    await page.goto('https://finance.yahoo.com/portfolios/', {
      waitUntil: 'domcontentloaded',
      timeout: parseInt(process.env.PUPPETEER_TIMEOUT || '60000')
    });

    // Wait for the page to render
    console.log('Waiting for page to render...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Find and click on the account
    const accountId = process.env.ACCOUNT_IDENTIFIER;
    const accountName = process.env.ACCOUNT_NAME;
    console.log(`Looking for account: ${accountId || accountName}...`);

    // First, let's take a screenshot to see the current state
    await page.screenshot({ path: path.join(__dirname, '..', 'debug_before_click.png'), fullPage: true });
    console.log('Saved debug screenshot: debug_before_click.png');

    // Get page content to debug
    const pageContent = await page.content();
    const hasAccount = (accountId && pageContent.includes(accountId)) || (accountName && pageContent.includes(accountName));
    console.log(`Page contains account identifier: ${hasAccount}`);

    const clicked = await page.evaluate((identifier, name) => {
      // Look specifically for clickable link/button with account name
      const links = Array.from(document.querySelectorAll('a, button, [role="button"]'));

      for (const link of links) {
        const text = link.textContent || '';
        if ((identifier && text.includes(identifier)) || (name && text.includes(name))) {
          link.click();
          return { success: true, tag: link.tagName, href: link.href || 'no-href' };
        }
      }

      // Fallback: search for any element with account identifier
      const allElements = Array.from(document.querySelectorAll('*'));
      for (const el of allElements) {
        const text = el.textContent || '';
        if ((identifier && text.includes(identifier)) || (name && text.includes(name))) {
          el.click();
          return { success: true, tag: el.tagName, text: text.substring(0, 50) };
        }
      }

      return { success: false };
    }, accountId, accountName);

    console.log('Click result:', JSON.stringify(clicked));

    if (!clicked || !clicked.success) {
      console.log('Could not find account to click. Check ACCOUNT_IDENTIFIER and ACCOUNT_NAME in .env');
    } else {
      console.log('Clicked on account, waiting for navigation...');

      // If we clicked a link, wait for navigation
      if (clicked.href && clicked.href !== 'no-href') {
        try {
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
          console.log('Navigation completed');
        } catch (e) {
          console.log('Navigation wait timed out, continuing...');
        }
      }

      // Wait for page to render
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Take another screenshot after clicking
      try {
        await page.screenshot({ path: path.join(__dirname, '..', 'debug_after_click.png'), fullPage: true });
        console.log('Saved debug screenshot: debug_after_click.png');
      } catch (e) {
        console.log('Could not take screenshot:', e.message);
      }
    }

    // Create portfolio directory if it doesn't exist
    const portfolioDir = path.join(__dirname, '..', 'portfolio');
    if (!fs.existsSync(portfolioDir)) {
      fs.mkdirSync(portfolioDir, { recursive: true });
      console.log('Created portfolio directory');
    }

    // Generate filename with date and time
    const now = new Date();
    const filename = `portfolio_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.pdf`;
    const filepath = path.join(portfolioDir, filename);

    // Try to find and click the Print button
    console.log('Looking for Print button...');
    const printResult = await page.evaluate(() => {
      // Try multiple selectors for Print button
      const selectors = [
        'button:contains("Print")',
        '[aria-label*="Print"]',
        '[title*="Print"]',
        'button[class*="print"]',
        'a[class*="print"]'
      ];

      // Search all buttons and links for "Print"
      const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim();
        const ariaLabel = btn.getAttribute('aria-label') || '';
        const title = btn.getAttribute('title') || '';

        if (text === 'Print' || text.includes('Print') ||
            ariaLabel.includes('Print') || ariaLabel.includes('print') ||
            title.includes('Print') || title.includes('print')) {
          btn.click();
          return { found: true, text, tag: btn.tagName };
        }
      }

      return { found: false };
    });

    console.log('Print button search result:', JSON.stringify(printResult));

    if (printResult.found) {
      console.log('Found and clicked Print button');
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log('Warning: Could not find Print button, will generate PDF anyway');
    }

    // Generate and save PDF
    console.log(`Saving PDF to ${filepath}...`);
    await page.pdf({
      path: filepath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px'
      }
    });

    console.log(`Successfully saved portfolio to: ${filename}`);

  } catch (error) {
    console.error('Error during automation:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the script
printPortfolio()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
