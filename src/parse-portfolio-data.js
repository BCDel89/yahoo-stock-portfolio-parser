require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

async function parsePortfolioData() {
	const datePrefix = new Date().toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/(\d+)\/(\d+)\/(\d+),\s(\d+):(\d+)/, '$1$2$3_$4$5');
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

    // Scroll to top to see the tabs
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Take a screenshot to see the current page
    await page.screenshot({ path: path.join(__dirname, '../data/output', datePrefix + '_print.png'), fullPage: false });
    console.log('Saved screenshot: portfolio_page.png');

    // Look for tab container and list all clickable elements near "Holdings Summary"
    const tabsInfo = await page.evaluate(() => {
      // Find all elements that might be tabs
      const allElements = Array.from(document.querySelectorAll('*'));
      const tabs = [];

      for (const el of allElements) {
        const text = el.textContent;
        // Look for elements that contain exactly one of our target tab names
        if ((text === 'Summary' || text === 'Holdings' || text === 'Fundamentals' ||
             text === 'Performance') && el.textContent.trim().length < 20) {
          tabs.push({
            tag: el.tagName,
            text: el.textContent.trim(),
            className: el.className,
            role: el.getAttribute('role'),
            type: el.getAttribute('type')
          });
        }
      }

      return tabs;
    });

    console.log('Found potential tabs:', JSON.stringify(tabsInfo, null, 2));

    // Object to store all parsed data
    const portfolioData = {};

    // Define the tabs to parse
    const tabs = ['Summary', 'Holdings', 'Fundamentals'];

    for (const tabName of tabs) {
      console.log(`\nProcessing ${tabName} tab...`);

      // Click the tab
      const tabClicked = await page.evaluate((name) => {
        // Look for any clickable element with the tab name
        const allElements = Array.from(document.querySelectorAll('*'));

        for (const el of allElements) {
          const text = el.textContent.trim();
          // Check if this element's text matches exactly
          if (text === name) {
            // Check if it's clickable or has clickable parent
            let clickable = el;
            for (let i = 0; i < 3; i++) {  // Check up to 3 parents
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
            // If no clickable parent, try clicking the element itself
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

      // Parse the table data
      const tabData = await page.evaluate((tabName) => {
        const results = [];

        // Find all tables on the page
        const tables = Array.from(document.querySelectorAll('table, [role="table"]'));

        for (const table of tables) {
          // Get headers
          const headers = [];
          const headerCells = table.querySelectorAll('th, [role="columnheader"]');
          headerCells.forEach(cell => {
            headers.push(cell.textContent.trim());
          });

          // Get rows
          const rows = table.querySelectorAll('tr, [role="row"]');
          rows.forEach(row => {
            const cells = row.querySelectorAll('td, [role="cell"]');
            if (cells.length === 0) return;

            const rowData = {};
            cells.forEach((cell, index) => {
              const header = headers[index] || `column_${index}`;
              rowData[header] = cell.textContent.trim();
            });

            // Only add if it has data
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

          // Add all fields from this row to the symbol's data
          Object.keys(row).forEach(key => {
            if (key !== 'Symbol') {
              // Prefix with tab name to avoid conflicts
              const fieldName = `${tabName.toLowerCase()}_${key}`;
              portfolioData[symbol][fieldName] = row[key];
            }
          });
        }
      });
    }

    // Fetch Yahoo Finance data for each symbol
    console.log('\n=== Fetching Yahoo Finance API data ===');
    const symbols = Object.keys(portfolioData);

    for (const symbol of symbols) {
      try {
        console.log(`Fetching data for ${symbol}...`);
        const quote = await yahooFinance.quote(symbol);

        // Add Yahoo Finance data to the symbol's data
        portfolioData[symbol].yahooFinanceData = quote;
        console.log(`  ✓ Successfully fetched data for ${symbol}`);
      } catch (error) {
        console.error(`  ✗ Error fetching data for ${symbol}:`, error.message);
        portfolioData[symbol].yahooFinanceData = { error: error.message };
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Scrape news articles for each symbol
    console.log('\n=== Scraping news articles ===');
    for (const symbol of symbols) {
      try {
        console.log(`Scraping news for ${symbol}...`);
        // Go directly to the news page for this stock
        const newsUrl = `https://finance.yahoo.com/quote/${symbol}/news/`;

        await page.goto(newsUrl, {
          waitUntil: 'domcontentloaded',
          timeout: parseInt(process.env.PUPPETEER_TIMEOUT || '60000')
        });

        // Wait for content to load
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Scroll down to ensure news section loads
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight / 3);
        });
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get article links
        const articleLinks = await page.evaluate(() => {
          const articles = [];
          const seen = new Set();

          // Get ALL links with /news/ in href
          const allNewsLinks = Array.from(document.querySelectorAll('a[href*="/news/"]'));

          allNewsLinks.forEach(link => {
            const href = link.href;

            // Skip if we've seen this link, or if it's a navigation link
            if (seen.has(href)) return;
            if (!href.includes('finance.yahoo.com/news/')) return;
            if (href.includes('/news/us/') || href.includes('/news/politics/')) return; // Skip category pages

            // Try to find a title - check for h3 in or near the link
            let title = '';

            // Method 1: h3 inside the link
            const h3Inside = link.querySelector('h3');
            if (h3Inside) {
              title = h3Inside.textContent.trim();
            }

            // Method 2: h3 in parent container
            if (!title) {
              const parent = link.closest('li, div, article');
              if (parent) {
                const h3Parent = parent.querySelector('h3');
                if (h3Parent) {
                  title = h3Parent.textContent.trim();
                }
              }
            }

            // Method 3: Use link text as fallback
            if (!title) {
              const linkText = link.textContent.trim();
              if (linkText.length > 20 && linkText.length < 200) {
                title = linkText;
              }
            }

            // Only add if we have a reasonable title
            if (title && title.length > 15 && title.length < 300) {
              articles.push({
                title: title,
                link: href
              });
              seen.add(href);
            }
          });

          return articles.slice(0, 5); // Limit to 5 articles
        });

        console.log(`  Found ${articleLinks.length} article links for ${symbol}`);

        // Now fetch full content for each article
        const newsArticles = [];
        for (let i = 0; i < articleLinks.length; i++) {
          const article = articleLinks[i];
          try {
            console.log(`    Fetching article ${i + 1}/${articleLinks.length}...`);

            await page.goto(article.link, {
              waitUntil: 'domcontentloaded',
              timeout: parseInt(process.env.PUPPETEER_TIMEOUT || '60000')
            });

            await new Promise(resolve => setTimeout(resolve, 2000));

            // Extract full article content
            const fullArticle = await page.evaluate(() => {
              // Try different selectors for article content
              const contentSelectors = [
                '.body .caas-body',
                'article .caas-body',
                '.article-body',
                '[data-test-locator="article-canvas"]',
                '.canvas-body',
                'article'
              ];

              let content = '';
              for (const selector of contentSelectors) {
                const contentEl = document.querySelector(selector);
                if (contentEl) {
                  // Get all paragraph text
                  const paragraphs = contentEl.querySelectorAll('p');
                  content = Array.from(paragraphs)
                    .map(p => p.textContent.trim())
                    .filter(text => text.length > 0)
                    .join('\n\n');

                  if (content) break;
                }
              }

              // Fallback: get all paragraphs if no content found
              if (!content) {
                const allParagraphs = document.querySelectorAll('article p, .article p, main p');
                content = Array.from(allParagraphs)
                  .map(p => p.textContent.trim())
                  .filter(text => text.length > 50) // Filter out short/navigation text
                  .slice(0, 20) // Limit paragraphs
                  .join('\n\n');
              }

              return content;
            });

            newsArticles.push({
              title: article.title,
              link: article.link,
              content: fullArticle
            });

            console.log(`    ✓ Article ${i + 1} content extracted (${fullArticle.length} chars)`);

          } catch (articleError) {
            console.error(`    ✗ Error fetching article: ${articleError.message}`);
            newsArticles.push({
              title: article.title,
              link: article.link,
              content: '',
              error: articleError.message
            });
          }

          // Delay between articles
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        portfolioData[symbol].news = newsArticles;
        console.log(`  ✓ Scraped ${newsArticles.length} full articles for ${symbol}`);

      } catch (error) {
        console.error(`  ✗ Error scraping news for ${symbol}:`, error.message);
        portfolioData[symbol].news = { error: error.message };
      }

      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Save the parsed data
    const outputPath = path.join(__dirname, '../data/output', datePrefix + '_data.json');
    fs.writeFileSync(outputPath, JSON.stringify(portfolioData, null, 2));
    console.log(`\nSaved portfolio data to: ${outputPath}`);
    console.log(`\nParsed ${Object.keys(portfolioData).length} symbols`);

    // Print summary
    console.log('\nSymbols found:');
    Object.keys(portfolioData).forEach(symbol => {
      const fieldCount = Object.keys(portfolioData[symbol]).length - 1;
      console.log(`  ${symbol}: ${fieldCount} fields`);
    });

  } catch (error) {
    console.error('Error during automation:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the script
parsePortfolioData()
  .then(() => {
    console.log('\nScript completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
