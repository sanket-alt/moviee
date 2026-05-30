const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable Cross-Origin Resource Sharing so your frontend can call this backend
app.use(cors());
app.use(express.json());

app.get('/api/extract', async (req, res) => {
    const { type, id, season, episode } = req.query;

    if (!type || !id) {
        return res.status(400).json({ error: 'Missing parameters: type and id are required.' });
    }

    // Reconstruct the provider URL based on media type
    let targetUrl = '';
    if (type === 'movie') {
        targetUrl = `https://www.vidking.net/embed/movie/${id}`;
    } else if (type === 'tv') {
        if (!season || !episode) {
            return res.status(400).json({ error: 'TV shows require season and episode parameters.' });
        }
        targetUrl = `https://www.vidking.net/embed/tv/${id}/${season}/${episode}`;
    }

    let browser = null;

    try {
        // Essential performance flags for running Puppeteer inside hosting environments (Docker, Render, AWS)
        browser = await puppeteer.launch({
            headless: true,
            executablePath: '/usr/bin/google-chrome', // Specifically for Render
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        
        // Spoof user-agent so the provider doesn't treat the headless instance as an automated bot
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Enable request interception to catch the stream link
        await page.setRequestInterception(true);

        let streamUrl = null;

        page.on('request', (request) => {
            const url = request.url();
            
            // Look for HLS streaming files (.m3u8) or direct video formats (.mp4)
            if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('master.m3u8')) {
                // Ignore standard tracking/analytics files that might contain the extension string safely
                if (!url.includes('analytics') && !url.includes('telemetry')) {
                    streamUrl = url;
                }
            }
            
            // Block heavy graphical assets and third-party ad networks early to save bandwidth/speed
            const resourceType = request.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType) && !url.includes('.m3u8')) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // Navigate to the target page. 
        // networkidle2 means execution waits until there are no more than 2 active network connections left.
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // If the play action requires a simulated click to kick off the video execution scripts:
        const playButtonSelectors = ['#play', '.play-btn', '.vjs-big-play-button', 'video'];
        for (const selector of playButtonSelectors) {
            try {
                if (await page.$(selector) !== null) {
                    await page.click(selector);
                    // Short wait block to let network activities manifest post-click
                    await new Promise(resolve => setTimeout(resolve, 1500)); 
                }
            } catch (e) {
                // Fail silently and try the next selector point
            }
            if (streamUrl) break;
        }

        await browser.close();

        if (streamUrl) {
            return res.json({ success: true, streamUrl: streamUrl });
        } else {
            return res.status(404).json({ success: false, error: 'Streaming source URL could not be extracted.' });
        }

    } catch (error) {
        if (browser) await browser.close();
        console.error('Extraction Error:', error.message);
        return res.status(500).json({ success: false, error: 'Internal extraction timeout or execution crash.' });
    }
});

app.listen(PORT, () => {
    console.log(`Extraction engine active on port ${PORT}`);
});
