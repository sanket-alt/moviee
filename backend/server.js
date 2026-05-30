const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/api/extract', async (req, res) => {
    const { type, id, season, episode } = req.query;
    console.log(`\n[API REQUEST] Received extraction request for Type: ${type}, ID: ${id}`);

    if (!type || !id) {
        console.log(`[API ERROR] Missing critical parameters.`);
        return res.status(400).json({ error: 'Missing parameters.' });
    }

    let targetUrl = type === 'movie' 
        ? `https://www.vidking.net/embed/movie/${id}`
        : `https://www.vidking.net/embed/tv/${id}/${season}/${episode}`;

    console.log(`[EXTRACTOR] Target extraction URL constructed: ${targetUrl}`);
    let browser = null;

    try {
        console.log(`[PUPPETEER] Launching headless chromium instance...`);
        browser = await puppeteer.launch({
            headless: true, // Set to false locally if you want to watch the automated browser work!
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled' // Helps bypass basic anti-bot scripts
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        // Overwrite the webdriver property to mask automated execution
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        console.log(`[PUPPETEER] Intercepting network layers...`);
        await page.setRequestInterception(true);
        let streamUrl = null;

        page.on('request', (request) => {
            const url = request.url();
            
            // Log whenever a streaming file format flies past the network log
            if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('master')) {
                console.log(`[NETWORK MATCH] Potential stream source intercepted: ${url.substring(0, 60)}...`);
                streamUrl = url;
            }
            
            const resourceType = request.resourceType();
            if (['image', 'font', 'stylesheet'].includes(resourceType) && !url.includes('.m3u8')) {
                request.abort();
            } else {
                request.continue();
            }
        });

        console.log(`[PUPPETEER] Navigating to target site...`);
        // Use a 20-second timeout for navigation to prevent permanent hanging
        await page.goto(targetUrl, { Laurel: true, waitUntil: 'domcontentloaded', timeout: 20000 });
        console.log(`[PUPPETEER] DOM content loaded successfully.`);

        // Give the page script execution 3 seconds to auto-unpack sources naturally
        await new Promise(resolve => setTimeout(resolve, 3000));

        // If no stream URL was captured natively, look for video player components to force execution
        if (!streamUrl) {
            console.log(`[PUPPETEER] Stream not found naturally. Searching for play activation anchors...`);
            const playSelectors = ['#play', '.play-btn', '.vjs-big-play-button', 'video', 'canvas'];
            
            for (const selector of playSelectors) {
                try {
                    const el = await page.$(selector);
                    if (el !== null) {
                        console.log(`[PUPPETEER] Found actionable selector [${selector}]. Simulating click event...`);
                        await page.click(selector);
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for network to react
                    }
                } catch (e) {
                    // Fail silently to check next structural element selector
                }
                if (streamUrl) {
                    console.log(`[PUPPETEER] Success! Stream URL caught after click event.`);
                    break;
                }
            }
        }

        await browser.close();
        console.log(`[PUPPETEER] Browser instance closed safely.`);

        if (streamUrl) {
            console.log(`[API RESPONSE] Sending streaming link back to frontend.`);
            return res.json({ success: true, streamUrl: streamUrl });
        } else {
            console.log(`[API ERROR] Page loaded completely but no video resource was found.`);
            return res.status(404).json({ success: false, error: 'Source not found.' });
        }

    } catch (error) {
        console.log(`[CRITICAL EXCEPTION] Engine failure: ${error.message}`);
        if (browser) await browser.close();
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`  Extraction telemetry console active on Port ${PORT}`);
    console.log(`==================================================`);
});
