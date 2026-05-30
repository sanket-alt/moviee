const express = require('express');
const cors = require('cors');

// Import the Stealth framework
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/api/extract', async (req, res) => {
    const { type, id, season, episode } = req.query;
    console.log(`\n[API REQUEST] Extracting VidKing -> Type: ${type}, ID: ${id}`);

    if (!type || !id) return res.status(400).json({ error: 'Missing parameters.' });

    let targetUrl = type === 'movie' 
        ? `https://www.vidking.net/embed/movie/${id}`
        : `https://www.vidking.net/embed/tv/${id}/${season}/${episode}`;

    let browser = null;

    try {
        console.log(`[STEALTH] Launching masked chromium instance...`);
        browser = await puppeteer.launch({
            headless: true, // Change to false ONLY if running locally to debug visually
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security', // Bypasses CORS blocks inside the headless browser
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });

        const page = await browser.newPage();
        
        // Randomize viewport to avoid standard bot dimension fingerprinting
        await page.setViewport({ width: 1280 + Math.floor(Math.random() * 100), height: 720 });

        console.log(`[NETWORK] Setting up deep packet interception...`);
        let streamUrl = null;

        // Instead of just looking at the URL string, we listen to the actual response headers
        page.on('response', async (response) => {
            const url = response.url();
            const resourceType = response.request().resourceType();
            
            // Check if the response contains streaming media MIME types
            try {
                const headers = response.headers();
                const contentType = headers['content-type'] || '';
                
                if (url.includes('.m3u8') || contentType.includes('application/vnd.apple.mpegurl') || contentType.includes('video/mp4')) {
                    if (!url.includes('blank') && !url.includes('tracking')) {
                        console.log(`[SUCCESS] Stream payload identified!`);
                        streamUrl = url;
                    }
                }
            } catch (err) {
                // Ignore dropped connections
            }
        });

        console.log(`[NAVIGATION] Breaching VidKing perimeter...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Wait for potential Cloudflare turnstiles to clear automatically
        await new Promise(resolve => setTimeout(resolve, 4000));

        if (!streamUrl) {
            console.log(`[INTERACTION] Forcing player execution...`);
            
            // 1. Try known CSS selectors
            const playSelectors = ['.jw-icon-display', '.vjs-big-play-button', '#play', 'video'];
            for (const selector of playSelectors) {
                try {
                    if (await page.$(selector) !== null) {
                        await page.click(selector);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                } catch (e) {}
                if (streamUrl) break;
            }

            // 2. If selectors fail, click the exact dead center of the viewport (bypasses invisible ad overlays)
            if (!streamUrl) {
                console.log(`[INTERACTION] Executing center-screen brute force click...`);
                await page.mouse.click(640, 360);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        await browser.close();

        if (streamUrl) {
            return res.json({ success: true, streamUrl: streamUrl });
        } else {
            return res.status(404).json({ success: false, error: 'VidKing obfuscated the stream.' });
        }

    } catch (error) {
        console.log(`[CRITICAL] Extractor crashed: ${error.message}`);
        if (browser) await browser.close();
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Stealth Extractor Engine active on Port ${PORT}`);
});
