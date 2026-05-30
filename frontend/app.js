const TMDB_API_KEY = '1cf50e6248dc270629e802686245c2c8';
const IMG_BASE_URL = 'https://image.tmdb.org/t/p/w500';
// Point this to your active Node backend URL (local or cloud-hosted base)
const BACKEND_API_BASE = 'https://moviee-stbo.onrender.com';

let currentPage = 1;
let isFetching = false;
let currentMode = 'trending'; 
let mediaType = 'movie'; 
let currentSearchQuery = '';
let currentTvId = null;
let hlsInstance = null;

// DOM Layout Hooks
const grid = document.getElementById('media-grid');
const loading = document.getElementById('loading');
const sectionTitle = document.querySelector('#section-title h2');

// Player Structural Elements
const modal = document.getElementById('player-modal');
const videoPlayer = document.getElementById('native-player');
const playerLoader = document.getElementById('player-loader');
const closeBtn = document.getElementById('close-player');
const tvControls = document.getElementById('tv-controls');
const seasonSelect = document.getElementById('season-select');
const episodeSelect = document.getElementById('episode-select');

// Navigation Connectors
const btnTrending = document.getElementById('btn-trending');
const btnTop = document.getElementById('btn-top');
const searchBar = document.getElementById('search-bar');
const toggleMovie = document.getElementById('toggle-movie');
const toggleTv = document.getElementById('toggle-tv');

async function fetchMedia() {
    if (isFetching) return;
    isFetching = true;
    loading.style.display = 'flex';

    let url = '';
    switch (currentMode) {
        case 'trending':
            url = `https://api.themoviedb.org/3/trending/${mediaType}/week?api_key=${TMDB_API_KEY}&page=${currentPage}`;
            break;
        case 'top_rated':
            url = `https://api.themoviedb.org/3/${mediaType}/top_rated?api_key=${TMDB_API_KEY}&language=en-US&page=${currentPage}`;
            break;
        case 'search':
            url = `https://api.themoviedb.org/3/search/${mediaType}?api_key=${TMDB_API_KEY}&language=en-US&query=${encodeURIComponent(currentSearchQuery)}&page=${currentPage}`;
            break;
    }

    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.results.length === 0 && currentPage === 1) {
            grid.innerHTML = '<p style="color: #808080; grid-column: 1 / -1; text-align: center;">No results found.</p>';
        } else {
            renderMedia(data.results);
            currentPage++;
        }
    } catch (error) {
        console.error("Database connection failure:", error);
    } finally {
        isFetching = false;
        loading.style.display = 'none';
    }
}

function renderMedia(items) {
    items.forEach(item => {
        if (!item.poster_path) return; 
        const displayTitle = item.title || item.name;

        const card = document.createElement('div');
        card.className = 'media-card';
        card.innerHTML = `
            <img src="${IMG_BASE_URL + item.poster_path}" alt="${displayTitle}" loading="lazy">
            <div class="info">
                <h3>${displayTitle}</h3>
                <div class="rating">Match: ${(item.vote_average * 10).toFixed(0)}%</div>
            </div>
        `;
        card.addEventListener('click', () => openPlayer(item.id));
        grid.appendChild(card);
    });
}

function resetGridAndFetch(newMode) {
    currentMode = newMode;
    currentPage = 1;
    grid.innerHTML = '';
    const typeText = mediaType === 'movie' ? 'Movies' : 'TV Shows';
    if (currentMode === 'trending') sectionTitle.innerText = `Trending ${typeText}`;
    if (currentMode === 'top_rated') sectionTitle.innerText = `Top Rated ${typeText}`;
    if (currentMode === 'search') sectionTitle.innerText = `Search Results: "${currentSearchQuery}"`;
    fetchMedia();
}

toggleMovie.addEventListener('click', () => {
    if (mediaType === 'movie') return; 
    mediaType = 'movie';
    toggleMovie.classList.add('active');
    toggleTv.classList.remove('active');
    resetGridAndFetch(currentMode);
});

toggleTv.addEventListener('click', () => {
    if (mediaType === 'tv') return;
    mediaType = 'tv';
    toggleTv.classList.add('active');
    toggleMovie.classList.remove('active');
    resetGridAndFetch(currentMode);
});

btnTrending.addEventListener('click', () => {
    btnTrending.classList.add('active');
    btnTop.classList.remove('active');
    searchBar.value = '';
    resetGridAndFetch('trending');
});

btnTop.addEventListener('click', () => {
    btnTop.classList.add('active');
    btnTrending.classList.remove('active');
    searchBar.value = '';
    resetGridAndFetch('top_rated');
});

let searchTimeout;
searchBar.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    searchTimeout = setTimeout(() => {
        if (query.length > 0) {
            btnTrending.classList.remove('active');
            btnTop.classList.remove('active');
            currentSearchQuery = query;
            resetGridAndFetch('search');
        } else {
            btnTrending.classList.add('active');
            resetGridAndFetch('trending');
        }
    }, 500);
});

// 1. Stream Engine Initialization 
function initializeVideoSource(streamUrl) {
    // Clear old instances out of memory before executing new assignments
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    // Monitor engine startup performance to clean out visual placeholder frames
    videoPlayer.onplaying = () => {
        playerLoader.style.display = 'none';
    };

    // Scenario A: Browser handles HLS playlists natively (Apple Safari platforms)
    if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        videoPlayer.src = streamUrl;
    } 
    // Scenario B: Handle playback engine through HLS.js mapping (Chrome, Firefox, Edge)
    else if (Hls.isSupported()) {
        hlsInstance = new Hls({
            maxBufferLength: 30, // Max look-ahead buffering frame sizes
            maxMaxBufferLength: 600,
            enableWorker: true, // Use background web workers to keep UI fluid
            lowLatencyMode: true
        });
        hlsInstance.loadSource(streamUrl);
        hlsInstance.attachMedia(videoPlayer);
        
        hlsInstance.on(Hls.Events.ERROR, function (event, data) {
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.log('Network issues encountered. Attempting player recovery loops...');
                        hlsInstance.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.log('Media rendering fault. Forcing stream recovery target paths...');
                        hlsInstance.recoverMediaError();
                        break;
                    default:
                        destroyStreamSession();
                        break;
                }
            }
        });
    } else {
        alert("Your web platform environment lacks required streaming dependencies.");
    }
}

// 2. Extractor Callout Pipeline
async function loadVideoSource(type, id, season = '', episode = '') {
    playerLoader.style.display = 'flex';
    playerLoader.querySelector('p').innerText = "Securing Stream Connection...";
    
    let requestUrl = `${BACKEND_API_BASE}?type=${type}&id=${id}`;
    if (type === 'tv') {
        requestUrl += `&season=${season}&episode=${episode}`;
    }

    try {
        const response = await fetch(requestUrl);
        const data = await response.json();

        if (data.success && data.streamUrl) {
            initializeVideoSource(data.streamUrl);
        } else {
            playerLoader.querySelector('p').innerText = "Streaming Source Generation Failed. Switch Content.";
        }
    } catch (err) {
        console.error("Backend connection failure:", err);
        playerLoader.querySelector('p').innerText = "Backend extraction infrastructure offline.";
    }
}

async function openPlayer(tmdbId) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    if (mediaType === 'movie') {
        tvControls.style.display = 'none'; 
        await loadVideoSource('movie', tmdbId);
    } else {
        tvControls.style.display = 'flex'; 
        currentTvId = tmdbId; 
        await loadSeasons(tmdbId);
    }
}

async function loadSeasons(tmdbId) {
    try {
        const response = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`);
        const data = await response.json();
        seasonSelect.innerHTML = '';

        data.seasons.forEach(season => {
            if (season.season_number > 0) {
                const option = document.createElement('option');
                option.value = season.season_number;
                option.innerText = `Season ${season.season_number}`;
                seasonSelect.appendChild(option);
            }
        });

        if (seasonSelect.options.length > 0) {
            await loadEpisodes(tmdbId, seasonSelect.value);
        }
    } catch (error) {
        console.error("Seasons metadata acquisition failed:", error);
    }
}

async function loadEpisodes(tmdbId, seasonNumber) {
    try {
        const response = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}`);
        const data = await response.json();
        episodeSelect.innerHTML = '';

        data.episodes.forEach(episode => {
            const option = document.createElement('option');
            option.value = episode.episode_number;
            option.innerText = `Ep ${episode.episode_number}: ${episode.name}`;
            episodeSelect.appendChild(option);
        });

        if (episodeSelect.options.length > 0) {
            await loadVideoSource('tv', tmdbId, seasonNumber, episodeSelect.value);
        }
    } catch (error) {
        console.error("Episode metadata tracking failed:", error);
    }
}

seasonSelect.addEventListener('change', (e) => {
    loadEpisodes(currentTvId, e.target.value);
});

episodeSelect.addEventListener('change', (e) => {
    loadEpisodes(currentTvId, seasonSelect.value);
});

function destroyStreamSession() {
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
    videoPlayer.pause();
    videoPlayer.removeAttribute('src'); 
    videoPlayer.load();
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
}

closeBtn.addEventListener('click', destroyStreamSession);

window.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
    if (scrollTop + clientHeight >= scrollHeight - 150) {
        fetchMedia();
    }
});

resetGridAndFetch('trending');
