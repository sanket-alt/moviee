// Configuration & State Engine
const TMDB_API_KEY = '1cf50e6248dc270629e802686245c2c8';
const IMG_BASE_URL = 'https://image.tmdb.org/t/p/w500';

let currentPage = 1;
let isFetching = false;
let currentMode = 'trending'; 
let mediaType = 'movie'; 
let currentSearchQuery = '';
let currentTvId = null;

// Core DOM Elements
const grid = document.getElementById('media-grid');
const loading = document.getElementById('loading');
const sectionTitle = document.querySelector('#section-title h2');

// Player DOM Elements
const modal = document.getElementById('player-modal');
const iframe = document.getElementById('vidking-iframe');
const closeBtn = document.getElementById('close-player');
const tvControls = document.getElementById('tv-controls');
const seasonSelect = document.getElementById('season-select');
const episodeSelect = document.getElementById('episode-select');

// Navigation DOM Elements
const btnTrending = document.getElementById('btn-trending');
const btnTop = document.getElementById('btn-top');
const searchBar = document.getElementById('search-bar');
const toggleMovie = document.getElementById('toggle-movie');
const toggleTv = document.getElementById('toggle-tv');

// 1. Primary Fetch Engine
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
        console.error("Database fetch failed:", error);
    } finally {
        isFetching = false;
        loading.style.display = 'none';
    }
}

// 2. Render Cards
function renderMedia(items) {
    items.forEach(item => {
        if (!item.poster_path) return; 

        // Safely extract the title string regardless of endpoint structure
        const displayTitle = item.title || item.name;

        const card = document.createElement('div');
        card.className = 'media-card';
        card.innerHTML = `
            <img src="${IMG_BASE_URL + item.poster_path}" alt="${displayTitle}" loading="lazy">
            <div class="info">
                <h3>${displayTitle}</h3>
                <div class="rating">User Rating: ${(item.vote_average * 10).toFixed(0)}%</div>
            </div>
        `;

        card.addEventListener('click', () => openPlayer(item.id));
        grid.appendChild(card);
    });
}

// 3. Grid Reset Logic
function resetGridAndFetch(newMode) {
    currentMode = newMode;
    currentPage = 1;
    grid.innerHTML = '';

    // Updates UI H2 Text Dynamically
    const typeText = mediaType === 'movie' ? 'Movies' : 'TV Shows';
    if (currentMode === 'trending') sectionTitle.innerText = `Trending ${typeText}`;
    if (currentMode === 'top_rated') sectionTitle.innerText = `Top Rated ${typeText}`;
    if (currentMode === 'search') sectionTitle.innerText = `Search Results: "${currentSearchQuery}"`;

    fetchMedia();
}

// 4. Navigation Event Handlers
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

// 5. Search Execution (Debounced)
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

// 6. Player Injection & Routing
async function openPlayer(tmdbId) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    if (mediaType === 'movie') {
        tvControls.style.display = 'none'; 
        iframe.src = `https://www.vidking.net/embed/movie/${tmdbId}?autoPlay=true`;
    } else {
        tvControls.style.display = 'flex'; 
        currentTvId = tmdbId; 
        iframe.src = ''; 
        await loadSeasons(tmdbId);
    }
}

// 7. TV Season & Episode API Pipeline
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
        console.error("Seasons load failed:", error);
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
            iframe.src = `https://www.vidking.net/embed/tv/${tmdbId}/${seasonNumber}/${episodeSelect.value}?autoPlay=true`;
        }
    } catch (error) {
        console.error("Episodes load failed:", error);
    }
}

seasonSelect.addEventListener('change', (e) => {
    loadEpisodes(currentTvId, e.target.value);
});

episodeSelect.addEventListener('change', (e) => {
    const selectedSeason = seasonSelect.value;
    iframe.src = `https://www.vidking.net/embed/tv/${currentTvId}/${selectedSeason}/${e.target.value}?autoPlay=true`;
});

// 8. Close Functions
closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
    iframe.src = ''; 
    document.body.style.overflow = 'auto';
});

// 9. Infinite Scroll Activation
window.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
    if (scrollTop + clientHeight >= scrollHeight - 150) {
        fetchMedia();
    }
});

// Execute framework entry point on load
resetGridAndFetch('trending');
