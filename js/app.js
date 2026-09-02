/* CinePlay - Global Application Script */

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initNavbar();
  initBackToTop();
  initMobileMenu();
  initLazyLoading();
  initIntersectionObserver();
  initNewsletter();

  // Modern UI Components
  initMoodQuizModal();
  initVideoTrailerModal();
  initLiveSearchAutoSuggestions();

  // Auto-init Home Page features if elements are present
  if (document.getElementById("hero-slider")) {
    initHomePage();
  }
});

/* ==========================================================================
   1. Simulated API Client (Decoupled Data Layer)
   ========================================================================== */
/* Item registry: stores full item object keyed by item.id for reliable detail lookups */
window._cineItemRegistry = {};

const CinePlayAPI = {
  // Fetches movies via CinePlayDataManager (TMDB -> Firestore -> Local Fallback)
  async fetchMovies(params = {}) {
    // Remove the rate limiting delay - it's causing timeouts
    // await new Promise(resolve => setTimeout(resolve, 200));

    if (window.CinePlayDataManager) {
      try {
        const result = await window.CinePlayDataManager.fetchMovies(params);
        console.log("fetchMovies result:", result?.results?.length || 0, "movies");
        if (result && result.results && result.results.length > 0) {
          return result;
        }
        if (window.moviesData && window.moviesData.length > 0) {
          console.warn("[CinePlayAPI] DataManager returned empty, using local fallback");
          let movies = [...window.moviesData];
          if (params.query) movies = CinePlay.searchItems(movies, params.query);
          if (params.genre && params.genre !== "All") movies = CinePlay.filterByGenre(movies, params.genre);
          CinePlay.sortItems(movies, params.sortBy || "rating-desc");
          const limit = params.limit || 20;
          const page = params.page || 1;
          const start = (page - 1) * limit;
          const end = start + limit;
          const paginated = movies.slice(start, end);
          return { results: paginated, total: movies.length, hasMore: end < movies.length };
        }
        return result || { results: [], total: 0, hasMore: false };
      } catch (error) {
        console.warn("[CinePlayAPI] DataManager fetch failed:", error);
        return this._fallbackToLocalMovies(params);
      }
    }
    return this._fallbackToLocalMovies(params);
  },

  // Helper method for local fallback
  _fallbackToLocalMovies(params = {}) {
    let movies = window.moviesData ? [...window.moviesData] : [];
    if (params.query) movies = CinePlay.searchItems(movies, params.query);
    if (params.genre && params.genre !== "All") movies = CinePlay.filterByGenre(movies, params.genre);
    CinePlay.sortItems(movies, params.sortBy || "rating-desc");
    const limit = params.limit || 20;
    const page = params.page || 1;
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginated = movies.slice(start, end);
    return { results: paginated, total: movies.length, hasMore: end < movies.length };
  },

  // Recommendations calculation engine
  async fetchRecommendations(criteria) {
    if (window.CinePlayDataManager && window.CinePlayDataManager.fetchRecommendations) {
      try {
        const results = await window.CinePlayDataManager.fetchRecommendations(criteria);
        if (results && results.length > 0) return results;
      } catch (err) {
        console.warn("[CinePlayAPI] fetchRecommendations error:", err);
      }
    }

    return CinePlay.getRecommendations(criteria, { movies: window.moviesData, games: window.gamesData });
  }
};

function simulateNetworkDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ==========================================================================
   2. Decoupled Core Logic Functions (Reusable Utility Layers)
   ========================================================================== */

// Searches items (movies or games) by title or genres
function searchItems(items, query) {
  const q = query.toLowerCase().trim();
  return items.filter(item =>
    item.title.toLowerCase().includes(q) ||
    (item.genre && item.genre.some(g => g.toLowerCase().includes(q))) ||
    (item.mood && item.mood.some(m => m.toLowerCase().includes(q)))
  );
}

// Filters items by genre name
function filterByGenre(items, genre) {
  if (genre === "All") return items;
  return items.filter(item => item.genre && item.genre.includes(genre));
}

// Sorts items in place based on selected sorting metric
function sortItems(items, sortBy) {
  items.sort((a, b) => {
    if (sortBy === "rating-desc") return b.rating - a.rating;
    if (sortBy === "rating-asc") return a.rating - b.rating;
    if (sortBy === "year-desc") return b.year - a.year;
    if (sortBy === "year-asc") return a.year - b.year;
    return 0;
  });
  return items;
}

// Maps the quiz's user-facing mood labels to the internal mood tags
// used in data.js / the live API's mood field. Update the KEYS on the
// left if your quiz card data-value attributes differ from these.
const MOOD_QUIZ_TO_TAGS = {
  "Thrilled & Hyped": ["Action-packed", "Suspenseful"],
  "Chill & Cozy": ["Relaxing", "Emotional"],
  "Mind-Bending": ["Thought-provoking", "Suspenseful"],
  "Deep & Emotional": ["Emotional", "Thought-provoking"],
  "Spooky Thrill": ["Scary", "Suspenseful"],
  "Fun & Lighthearted": ["Relaxing", "Emotional"]
};

// Recommendations scoring algorithm
function getRecommendations({ contentType = "movie", mood = "Action-packed", genre = "All", era = "any", platform = "any", runtimeMax = 999 }, overrideData = {}) {
  const dataset = contentType === "movie"
    ? (overrideData.movies || window.moviesData)
    : (overrideData.games || window.gamesData);

  if (!dataset || dataset.length === 0) return [];

  // Filter out disliked items
  const dislikedIds = new Set(
    typeof getDislikedIds === "function"
      ? getDislikedIds()
      : (window.CinePlay && window.CinePlay.getDislikedIds ? window.CinePlay.getDislikedIds() : [])
  );

  const filteredDataset = dataset.filter(item => !dislikedIds.has(String(item.id)));
  if (filteredDataset.length === 0) return [];

  const moodTags = MOOD_QUIZ_TO_TAGS[mood] || [mood];

  const matchedList = filteredDataset.map(item => {
    let score = 0;

    // 1. Mood match (Weight: 40 points)
    if (item.mood && item.mood.some(m => moodTags.includes(m))) {
      score += 40;
    } else if (item.mood && item.mood.some(m => moodTags.some(t => m.toLowerCase().includes(t.toLowerCase())))) {
      score += 25;
    } else if (!item.mood || item.mood.length === 0) {
      // TMDB movies have no mood field — give them a partial score so they're not excluded
      score += 20;
    }

    // 2. Genre match (Weight: 30 points)
    const itemGenres = item.genre || item.genres || [];
    if (genre === "All" || itemGenres.includes(genre)) {
      score += 30;
    } else if (genre !== "All" && itemGenres.some(g => g.toLowerCase().includes(genre.toLowerCase()))) {
      score += 15; // partial genre match
    }

    // 3. Era match (Weight: 20 points)
    let yearMatch = false;
    const itemYear = parseInt(item.year) || 0;
    if (era === "classic" && itemYear < 2010) yearMatch = true;
    else if (era === "golden" && itemYear >= 2010 && itemYear <= 2019) yearMatch = true;
    else if (era === "modern" && itemYear >= 2020) yearMatch = true;
    else if (era === "any") yearMatch = true;

    if (yearMatch) {
      score += 20;
    }

    // 4. Runtime / Platform Match (Weight: 10 points)
    if (contentType === "game") {
      let platformMatch = false;
      if (platform === "any" || (item.platform && item.platform.includes(platform))) {
        platformMatch = true;
      }
      if (platformMatch) score += 10;
    } else {
      if (!item.runtime || item.runtime <= runtimeMax) {
        score += 10;
      } else {
        score += 5;
      }
    }

    return {
      item,
      score: Math.min(score, 99)
    };
  });

  // Sort and filter results — lowered threshold from 40 to 30 to include TMDB movies without mood tags
  return matchedList
    .filter(match => match.score >= 30)
    .sort((a, b) => b.score - a.score || (b.item.rating || 0) - (a.item.rating || 0));
}

/* ==========================================================================
   3. UI Rendering Engine (Decoupled Card & List Renderers)
   ========================================================================== */

// Renders list of movie cards into specified container
// Renders list of movie cards into specified container
function renderMovies(movies, containerElement, append = false) {
  if (!containerElement) {
    console.error("renderMovies: containerElement is null");
    return;
  }

  if (!movies || movies.length === 0) {
    if (!append) {
      containerElement.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">No movies found matching your criteria.</div>`;
    }
    return;
  }

  console.log(`✅ renderMovies: Rendering ${movies.length} movies`);

  const cardsHtml = movies.map(movie => createMovieCardHTML(movie)).join("");

  if (append) {
    containerElement.insertAdjacentHTML("beforeend", cardsHtml);
  } else {
    containerElement.innerHTML = cardsHtml;
  }

  bindCardClickEvents(containerElement, "movie");
}

// Renders list of game cards into specified container
function renderGames(games, containerElement, append = false) {
  if (!containerElement) return;
  if (games.length === 0) {
    if (!append) containerElement.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">No games found matching your criteria.</div>`;
    return;
  }
  const cardsHtml = games.map(game => createGameCardHTML(game)).join("");
  if (append) {
    containerElement.insertAdjacentHTML("beforeend", cardsHtml);
  } else {
    containerElement.innerHTML = cardsHtml;
  }
  bindCardClickEvents(containerElement, "game");
}

/// Dynamic templates
function createMovieCardHTML(movie) {
  if (!movie || !movie.id) {
    console.warn("createMovieCardHTML: Invalid movie object", movie);
    return "";
  }

  window._cineItemRegistry[movie.id] = movie;

  const isFav = isFavorite(movie.id);

  // Handle both API and local data formats
  const posterUrl = movie.poster || movie.poster_path || '';
  const title = movie.title || movie.name || 'Untitled';
  const cleanTitle = title.replace(/"/g, '&quot;');
  const rating = movie.rating || movie.vote_average || 0;
  const year = movie.year || (movie.release_date ? new Date(movie.release_date).getFullYear() : '—');
  const runtime = movie.runtime ? (typeof movie.runtime === 'number' ? `${movie.runtime}m` : movie.runtime) : (movie.duration || '—');
  const genres = movie.genres || movie.genre || [];
  const overview = movie.overview || movie.description || 'No overview available.';
  const cleanOverview = overview.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let streamingBadges = "";
  if (movie.providers && movie.providers.IN && movie.providers.IN.flatrate) {
    streamingBadges = movie.providers.IN.flatrate.slice(0, 2).map(s => `<span class="streaming-badge">${s.name}</span>`).join("");
  } else if (movie.streaming && Array.isArray(movie.streaming)) {
    streamingBadges = movie.streaming.slice(0, 2).map(s => `<span class="streaming-badge">${s}</span>`).join("");
  }

  return `
    <article class="media-card" data-id="${movie.id}" data-type="movie">
      <div class="card-img-wrapper shimmer-wrapper">
        <img src="${posterUrl || 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 300 450\' fill=\'%2314141d\'%3E%3C/svg%3E'}" alt="${cleanTitle}" data-title="${cleanTitle}" class="card-img" loading="lazy" onerror="CinePlay.movieImgFallback(this, this.dataset.title || 'Movie')"> 
        <div class="card-rating-badge"><i class="fa-solid fa-star"></i> ${typeof rating === 'number' ? rating.toFixed(1) : rating}</div>
        <button class="card-favorite-btn ${isFav ? 'active' : ''}" aria-label="Favorite button" onclick="event.stopPropagation(); CinePlay.handleFavoriteAction(this, '${movie.id}', 'movie')">
          <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
        </button>
        <span class="card-type-tag">Movie</span>
      </div>
      <div class="card-content">
        <div class="card-meta">
          <span>${year}</span>
          <span>${runtime}</span>
        </div>
        <h3 class="card-title">${title}</h3>
        <div class="card-genres">
          ${genres.slice(0, 3).map(g => `<span class="card-genre-tag">${g}</span>`).join("")}
        </div>
        <p class="card-desc">${cleanOverview}</p>
        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button class="card-btn" style="flex: 1;">Details</button>
          <button class="card-btn btn-outline" style="padding: 0 12px; border-radius: 8px;" title="Watch Trailer" onclick="event.stopPropagation(); CinePlay.openMovieTrailer('${movie.id}')"><i class="fa-solid fa-play"></i></button>
        </div>
        ${streamingBadges ? `<div class="streaming-list">${streamingBadges}</div>` : ''}
      </div>
    </article>
  `;
}

function createGameCardHTML(game) {
  // Store in registry for reliable detail modal lookup
  window._cineItemRegistry[game.id] = game;

  const isFav = isFavorite(game.id);
  const platforms = game.platform || [];
  return `
    <article class="media-card" data-id="${game.id}" data-type="game">
      <div class="card-img-wrapper shimmer-wrapper">
        <img src="${game.cover || game.poster || 'images/posters/g1.jpg'}" alt="${game.title}" class="card-img" loading="lazy" onerror="CinePlay.gameImgFallback(this, '${game.title}')">
        <div class="card-rating-badge"><i class="fa-solid fa-star"></i> ${game.rating}</div>
        <button class="card-favorite-btn ${isFav ? 'active' : ''}" aria-label="Favorite button" onclick="event.stopPropagation(); CinePlay.handleFavoriteAction(this, '${game.id}', 'game')">
          <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
        </button>
        <span class="card-type-tag">Game</span>
      </div>
      <div class="card-content">
        <div class="card-meta">
          <span>${game.year}</span>
          <span style="max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${platforms.slice(0, 2).join(", ")}${platforms.length > 2 ? '...' : ''}
          </span>
        </div>
        <h3 class="card-title">${game.title}</h3>
        <div class="card-genres">
          ${(game.genres || game.genre || []).slice(0, 3).map(g => `<span class="card-genre-tag">${g}</span>`).join("")}
        </div>
        <p class="card-desc">${game.description || game.overview || ''}</p>
        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button class="card-btn" style="flex: 1;">Details</button>
          ${game.trailer ? `<button class="card-btn btn-outline" style="padding: 0 12px; border-radius: 8px;" title="Watch Trailer" onclick="event.stopPropagation(); CinePlay.openTrailerModal('${game.trailer}', '${game.title.replace(/'/g, "\\'")}')"><i class="fa-solid fa-play"></i></button>` : ''}
        </div>
      </div>
    </article>
  `;
}

function bindCardClickEvents(container, type) {
  const cards = container.querySelectorAll(".media-card");
  cards.forEach(card => {
    card.addEventListener("click", (e) => {
      // Don't trigger on favorite/trailer button clicks
      if (e.target.closest(".card-favorite-btn") || e.target.closest(".card-btn.btn-outline")) return;

      const id = card.dataset.id;

      // 1. Check registry first (works for TMDB-sourced items too)
      let item = window._cineItemRegistry[id];

      // 2. Fall back to local datasets
      if (!item) {
        const dataSet = type === "movie" ? window.moviesData : window.gamesData;
        item = dataSet ? dataSet.find(i => i.id === id) : null;
      }

      if (item) {
        openDetailsModal(item, type);
      } else {
        // 3. Last resort: fetch from TMDB if it's a tmdb_ id
        if (id && id.startsWith("tmdb_") && window.CinePlayAPIService) {
          const tmdbId = id.replace("tmdb_", "");
          showToast("Loading details…", "fa-spinner");
          CinePlayAPIService.getTMDBMovieDetails(tmdbId).then(data => {
            if (data) {
              const normalized = CinePlayAPIService.normalizeMovie(data);
              window._cineItemRegistry[id] = normalized;
              openDetailsModal(normalized, "movie");
            }
          });
        }
      }
    });
  });
}

function movieImgFallback(img, title) {
  const parent = img.parentElement;
  if (!parent) return;
  const score = img.nextElementSibling ? img.nextElementSibling.textContent.trim() : "8.0";
  parent.innerHTML = `
    <div class="fallback-poster">
      <i class="fa-solid fa-film"></i>
      <div class="fallback-title">${title}</div>
    </div>
    <div class="card-rating-badge"><i class="fa-solid fa-star"></i> ${score}</div>
    <span class="card-type-tag">Movie</span>
  `;
}

function gameImgFallback(img, title) {
  const parent = img.parentElement;
  if (!parent) return;
  const score = img.nextElementSibling ? img.nextElementSibling.textContent.trim() : "9.0";
  parent.innerHTML = `
    <div class="fallback-poster">
      <i class="fa-solid fa-gamepad"></i>
      <div class="fallback-title">${title}</div>
    </div>
    <div class="card-rating-badge"><i class="fa-solid fa-star"></i> ${score}</div>
    <span class="card-type-tag">Game</span>
  `;
}

function handleFavoriteAction(btn, id, type) {
  const isFavNow = toggleFavorite(id, type);
  const icon = btn.querySelector("i");
  if (isFavNow) {
    btn.classList.add("active");
    icon.className = "fa-solid fa-heart";
  } else {
    btn.classList.remove("active");
    icon.className = "fa-regular fa-heart";
  }
}

/* ==========================================================================
   4. LocalStorage Favorites Hooks
   ========================================================================== */
const FAVORITES_KEY = "cineplay_favorites";

function getFavorites() {
  return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
}

function saveFavorites(favorites) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  window.dispatchEvent(new Event("favoritesChanged"));
  if (window.CinePlayAuth && window.CinePlayAuth.isLoggedIn()) {
    window.CinePlayAuth.syncFavoritesToCloud(favorites);
  }
}

function toggleFavorite(itemId, itemType, itemData = null) {
  let favorites = getFavorites();
  const idStr = String(itemId);
  const index = favorites.findIndex(item => {
    const favId = typeof item === "object" ? String(item.id || item.tmdbId || item.steamAppId || "") : String(item);
    return favId === idStr || `tmdb_${favId}` === idStr || `steam_${favId}` === idStr || favId === idStr.replace(/^tmdb_|^steam_/, "");
  });

  if (index !== -1) {
    favorites.splice(index, 1);
    saveFavorites(favorites);
    showToast("Removed from Watchlist", "fa-regular fa-heart");
    return false;
  } else {
    let item = itemData || (window._cineItemRegistry ? window._cineItemRegistry[idStr] : null);
    if (!item && window._cineItemRegistry) {
      const cleanId = idStr.replace(/^tmdb_|^steam_/, "");
      item = window._cineItemRegistry[cleanId] || window._cineItemRegistry[`tmdb_${cleanId}`] || window._cineItemRegistry[`steam_${cleanId}`];
    }
    if (!item) {
      const dataSet = itemType === "movie" ? window.moviesData : window.gamesData;
      item = dataSet ? dataSet.find(i => String(i.id) === idStr) : null;
    }

    const type = itemType || (item && (item.type || (item.platform ? "game" : "movie"))) || (idStr.startsWith("steam_") ? "game" : "movie");
    const favEntry = {
      ...(item || {}),
      id: idStr,
      type: type,
      title: (item && (item.title || item.name)) || "Untitled",
      name: (item && (item.name || item.title)) || "Untitled",
      poster: (item && (item.poster || item.cover || item.headerImage || item.poster_path)) || "",
      cover: (item && (item.cover || item.poster || item.headerImage)) || "",
      headerImage: (item && (item.headerImage || item.poster || item.cover)) || "",
      backdrop: (item && item.backdrop) || "",
      rating: (item && (item.rating || item.tmdbRating || item.vote_average)) || 0,
      tmdbRating: (item && (item.tmdbRating || item.rating || item.vote_average)) || 0,
      year: (item && (item.year || (item.release_date ? new Date(item.release_date).getFullYear() : ""))) || "",
      genres: (item && (item.genres || item.genre)) || [],
      genre: (item && (item.genre || item.genres)) || [],
      overview: (item && (item.overview || item.description)) || "",
      description: (item && (item.description || item.overview)) || "",
      runtime: (item && (item.runtime || item.duration)) || "",
      duration: (item && (item.duration || item.runtime)) || "",
      trailer: (item && (item.trailer || item.trailerKey)) || null,
      trailerKey: (item && (item.trailerKey || item.trailer)) || null,
      providers: (item && item.providers) || {},
      platform: (item && (item.platform || item.platforms)) || [],
      platforms: (item && (item.platforms || item.platform)) || [],
      tmdbId: (item && item.tmdbId) || (idStr.startsWith("tmdb_") ? idStr.replace("tmdb_", "") : null),
      steamAppId: (item && item.steamAppId) || (idStr.startsWith("steam_") ? idStr.replace("steam_", "") : null),
      savedAt: new Date().toISOString()
    };

    favorites.push(favEntry);
    saveFavorites(favorites);

    // If item was previously disliked, remove it from disliked list
    if (getDislikedIds().includes(idStr)) {
      removeDisliked(idStr);
    }

    showToast("Saved to your Watchlist! ❤️", "fa-solid fa-heart");
    return true;
  }
}

function isFavorite(itemId) {
  const favorites = getFavorites();
  const idStr = String(itemId);
  return favorites.some(item => {
    const favId = typeof item === "object" ? String(item.id || item.tmdbId || item.steamAppId || "") : String(item);
    return favId === idStr || `tmdb_${favId}` === idStr || `steam_${favId}` === idStr || favId === idStr.replace(/^tmdb_|^steam_/, "");
  });
}

/* ==========================================================================
   5. Dynamic Details Modal Overlay
   ========================================================================== */
let globalModal = null;

function initModalElement() {
  if (globalModal) return;

  globalModal = document.createElement("div");
  globalModal.id = "details-modal";
  globalModal.className = "modal";
  globalModal.innerHTML = `
    <div class="modal-content glass-panel">
      <button class="modal-close" id="modal-close-btn"><i class="fa-solid fa-xmark"></i></button>
      <div class="modal-poster" id="modal-poster-container"></div>
      <div class="modal-body">
        <h2 class="modal-title" id="modal-title-text"></h2>
        <div class="modal-badges" id="modal-badges-container"></div>
        <p class="modal-desc" id="modal-desc-text"></p>
        <ul class="modal-info-list" id="modal-info-details"></ul>
        <div class="modal-actions" id="modal-actions-container"></div>
      </div>
    </div>
  `;

  document.body.appendChild(globalModal);

  // Close bindings
  const closeBtn = globalModal.querySelector("#modal-close-btn");
  closeBtn.addEventListener("click", closeModal);
  globalModal.addEventListener("click", (e) => {
    if (e.target === globalModal) closeModal();
  });
}

function openDetailsModal(itemOrId, type = "movie") {
  initModalElement();

  let item = typeof itemOrId === "object" ? itemOrId : null;
  if (!item && typeof itemOrId === "string") {
    item = window._cineItemRegistry ? window._cineItemRegistry[itemOrId] : null;
    if (!item) {
      const dataSet = type === "movie" ? window.moviesData : window.gamesData;
      item = dataSet ? dataSet.find(i => String(i.id) === String(itemOrId)) : null;
    }
  }

  if (!item) {
    if (typeof itemOrId === "string" && itemOrId.startsWith("tmdb_") && window.CinePlayAPIService) {
      const tmdbId = itemOrId.replace("tmdb_", "");
      showToast("Loading details…", "fa-spinner");
      CinePlayAPIService.getTMDBMovieDetails(tmdbId).then(data => {
        if (data) {
          const normalized = CinePlayAPIService.normalizeMovie(data);
          if (window._cineItemRegistry) window._cineItemRegistry[itemOrId] = normalized;
          openDetailsModal(normalized, "movie");
        }
      });
    }
    return;
  }

  trackRecentlyViewed(item.id, type);

  if (item.id && window._cineItemRegistry) window._cineItemRegistry[item.id] = item;

  // Reset scroll positions
  const modalContent = document.querySelector('.modal-content');
  if (modalContent) modalContent.scrollTop = 0;
  const modalBody = document.querySelector('.modal-body');
  if (modalBody) modalBody.scrollTop = 0;

  const posterContainer = document.getElementById("modal-poster-container");
  const titleText = document.getElementById("modal-title-text");
  const badgesContainer = document.getElementById("modal-badges-container");
  const descText = document.getElementById("modal-desc-text");
  const infoDetails = document.getElementById("modal-info-details");
  const actionsContainer = document.getElementById("modal-actions-container");

  // Poster
  posterContainer.innerHTML = "";
  const img = document.createElement("img");
  img.src = item.poster || item.cover || "images/posters/m1.jpg";
  img.alt = item.title;
  img.onerror = () => {
    posterContainer.innerHTML = `
      <div class="fallback-poster" style="height: 100%;">
        <i class="fa-solid ${type === 'movie' ? 'fa-film' : 'fa-gamepad'}"></i>
        <div class="fallback-title">${item.title}</div>
      </div>
    `;
  };
  posterContainer.appendChild(img);

  titleText.textContent = item.title;

  const runtimeDisplay = item.runtime
    ? (typeof item.runtime === 'number' ? `${item.runtime}m` : item.runtime)
    : (item.duration || '—');

  badgesContainer.innerHTML = `
    <div class="modal-badge rating"><i class="fa-solid fa-star"></i> ${item.rating || item.tmdbRating || '—'}</div>
    <div class="modal-badge">${item.year || '—'}</div>
    ${type === "movie" ? `<div class="modal-badge"><i class="fa-regular fa-clock"></i> ${runtimeDisplay}</div>` : ""}
    <div class="modal-badge" style="text-transform: uppercase; background: rgba(229, 9, 20, 0.2); color: #fff;">${type}</div>
  `;

  descText.textContent = item.description || item.overview || 'No description available.';

  const genres = item.genres || item.genre || [];
  const platforms = item.platform || item.platforms || [];
  const moods = (Array.isArray(item.mood) && item.mood.length > 0)
    ? item.mood
    : (window.CinePlayAPIService && window.CinePlayAPIService.determineMoodTags 
        ? window.CinePlayAPIService.determineMoodTags(genres, item.description || item.overview, item.title)
        : ["Thought-provoking", "Action-packed"]);
  const moodDisplay = Array.isArray(moods) ? moods.join(" • ") : String(moods);

  let metaHtml = `
    <li><strong>Genres:</strong> ${genres.length ? genres.join(", ") : '—'}</li>
    <li><strong>Mood Vibe:</strong> <span style="color: var(--accent-red); font-weight: 600;"><i class="fa-solid fa-sparkles"></i> ${moodDisplay}</span></li>
  `;

  if (type === "movie") {
    const directorStr = Array.isArray(item.directors)
      ? item.directors.join(", ")
      : (item.director || null);
    if (directorStr) {
      metaHtml += `<li><strong>Director:</strong> <a href="movies.html?director=${encodeURIComponent(directorStr)}" style="color: var(--accent-red); text-decoration: underline;">${directorStr}</a></li>`;
    }
    const castStr = Array.isArray(item.cast) ? item.cast.join(", ") : item.cast;
    if (castStr) metaHtml += `<li id="modal-cast-row"><strong>Cast:</strong> ${castStr}</li>`;
    else metaHtml += `<li id="modal-cast-row"><strong>Cast:</strong> <span class="modal-loading-text"><i class="fa-solid fa-spinner fa-spin" style="font-size:11px;"></i> Loading…</span></li>`;

    if (item.language) metaHtml += `<li><strong>Language:</strong> ${item.language}</li>`;
    if (item.country) metaHtml += `<li><strong>Country:</strong> ${item.country}</li>`;
    if (item.voteCount) metaHtml += `<li><strong>Votes:</strong> ${Number(item.voteCount).toLocaleString()}</li>`;

    metaHtml += `
      <div class="provider-section" id="modal-providers-section">
        <div class="provider-header">
          <span class="provider-title"><i class="fa-solid fa-tv" style="color: var(--accent-red); margin-right: 6px;"></i> Where to Watch</span>
          <span style="font-size: 11px; color: var(--text-muted);">Region: <strong>🌐 India</strong></span>
        </div>
        <div class="provider-grid" id="modal-provider-grid">
          ${_buildProviderGrid(item)}
        </div>
        <p style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">Availability may vary by region.</p>
      </div>
    `;

  } else if (type === "game") {
    if (platforms.length) metaHtml += `<li><strong>Platforms:</strong> ${platforms.join(", ")}</li>`;
    const dev = Array.isArray(item.developers) ? item.developers.join(", ") : item.developer;
    const pub = Array.isArray(item.publishers) ? item.publishers.join(", ") : item.publisher;
    if (dev) metaHtml += `<li><strong>Developer:</strong> ${dev}</li>`;
    if (pub) metaHtml += `<li><strong>Publisher:</strong> ${pub}</li>`;
    if (item.price) metaHtml += `<li><strong>Price:</strong> <span style="color: #4ade80; font-weight: 700;">${item.price}</span></li>`;
    if (item.tags && item.tags.length) metaHtml += `<li><strong>Tags:</strong> ${item.tags.slice(0, 6).join(" • ")}</li>`;
    if (item.sysReq) {
      const sysMin = typeof item.sysReq === 'string' ? item.sysReq : (item.sysReq.minimum || '');
      const sysRec = typeof item.sysReq === 'string' ? '' : (item.sysReq.recommended || '');
      metaHtml += `
        <li style="margin-top: 10px; border-top: 1px solid var(--border-color); padding-top: 8px;">
          <strong>System Requirements:</strong>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px;">
            <div><strong>Min:</strong> ${sysMin}</div>
            ${sysRec ? `<div style="margin-top: 4px;"><strong>Rec:</strong> ${sysRec}</div>` : ''}
          </div>
        </li>
      `;
    }
  }

  infoDetails.innerHTML = metaHtml;

  const trailerKey = item.trailerKey || item.trailer || "";
  const isFav = isFavorite(item.id);
  const isDisliked = getDislikedIds().includes(String(item.id));

  actionsContainer.innerHTML = `
    <button class="btn btn-primary" id="modal-play-btn">
      <i class="fa-solid fa-play"></i> Watch Trailer
    </button>
    <button class="btn btn-outline" id="modal-fav-btn">
      <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
      ${isFav ? 'Favorited' : 'Add to Watchlist'}
    </button>
    <button class="btn btn-outline ${isDisliked ? 'active' : ''}" id="modal-dislike-btn" title="${isDisliked ? 'Remove from Disliked' : 'Show fewer recommendations like this'}" style="${isDisliked ? 'border-color: var(--accent-red); color: var(--accent-red);' : ''}">
      <i class="fa-solid fa-thumbs-down"></i> ${isDisliked ? 'Disliked (Undo)' : 'Not for me'}
    </button>
  `;

  const playBtn = document.getElementById("modal-play-btn");
  if (playBtn) {
    if (trailerKey) {
      playBtn.addEventListener("click", () => openTrailerModal(trailerKey, item.title));
    } else {
      playBtn.addEventListener("click", () => openMovieTrailer(item.id, item.title));
    }
  }

  const favBtn = document.getElementById("modal-fav-btn");
  if (favBtn) {
    favBtn.addEventListener("click", () => {
      const isNowFav = toggleFavorite(item.id, type, item);
      favBtn.innerHTML = isNowFav
        ? '<i class="fa-solid fa-heart"></i> Favorited'
        : '<i class="fa-regular fa-heart"></i> Add to Watchlist';
    });
  }

  const dislikeBtn = document.getElementById("modal-dislike-btn");
  if (dislikeBtn) {
    dislikeBtn.addEventListener("click", () => {
      const currentlyDisliked = getDislikedIds().includes(String(item.id));
      if (currentlyDisliked) {
        removeDisliked(item.id);
        dislikeBtn.classList.remove("active");
        dislikeBtn.style.borderColor = "";
        dislikeBtn.style.color = "";
        dislikeBtn.innerHTML = '<i class="fa-solid fa-thumbs-down"></i> Not for me';
        showToast(`Removed "${item.title}" from disliked list`, "fa-rotate-left");
      } else {
        markAsDisliked(item.id, item.title, item);
        dislikeBtn.classList.add("active");
        dislikeBtn.style.borderColor = "var(--accent-red)";
        dislikeBtn.style.color = "var(--accent-red)";
        dislikeBtn.innerHTML = '<i class="fa-solid fa-thumbs-down"></i> Disliked (Undo)';
        // If it was favorited, also remove from favorites
        if (isFavorite(item.id)) {
          toggleFavorite(item.id, type, item);
          if (favBtn) favBtn.innerHTML = '<i class="fa-regular fa-heart"></i> Add to Watchlist';
        }
      }
    });
  }

  globalModal.classList.add("active");
  document.body.style.overflow = "hidden";

  if (type === "movie" && item.tmdbId && window.CinePlayAPIService) {
    _enrichModalWithTMDB(item);
  }
}

async function _enrichModalWithTMDB(item) {
  try {
    const tmdbId = item.tmdbId;
    const [credits, videos, providers] = await Promise.all([
      CinePlayAPIService.getTMDBMovieCredits(tmdbId),
      CinePlayAPIService.getTMDBMovieVideos(tmdbId),
      CinePlayAPIService.getTMDBWatchProviders(tmdbId)
    ]);

    const castRow = document.getElementById("modal-cast-row");
    if (castRow && credits && credits.cast && credits.cast.length) {
      const castNames = credits.cast.slice(0, 6).map(c => c.name).join(", ");
      castRow.innerHTML = `<strong>Cast:</strong> ${castNames}`;
    }

    if (videos && videos.results && videos.results.length) {
      const trailer = videos.results.find(v => v.site === "YouTube" && v.type === "Trailer")
        || videos.results.find(v => v.site === "YouTube" && v.type === "Teaser");
      if (trailer && trailer.key) {
        item.trailerKey = trailer.key;
        item.trailer = trailer.key;
        window._cineItemRegistry[item.id] = item;
        const playBtn = document.getElementById("modal-play-btn");
        if (playBtn) {
          playBtn.style.display = "inline-flex";
          playBtn.onclick = () => openTrailerModal(trailer.key, item.title);
        }
      }
    }

    const providerGrid = document.getElementById("modal-provider-grid");
    if (providerGrid && providers && providers.results) {
      const config = window.CINEPLAY_CONFIG ? window.CINEPLAY_CONFIG.TMDB : { IMAGE_BASE: "https://image.tmdb.org/t/p", DEFAULT_REGION: "IN" };
      const regionData = providers.results[config.DEFAULT_REGION] || providers.results["US"] || {};
      const allP = [
        ...(regionData.flatrate || []).map(p => ({ ...p, type: "STREAM" })),
        ...(regionData.rent || []).map(p => ({ ...p, type: "RENT" })),
        ...(regionData.buy || []).map(p => ({ ...p, type: "BUY" }))
      ];
      if (allP.length > 0) {
        providerGrid.innerHTML = allP.slice(0, 6).map(p => `
          <div class="provider-card" title="${p.provider_name} (${p.type})">
            ${p.logo_path ? `<img src="${config.IMAGE_BASE}/w92${p.logo_path}" alt="${p.provider_name}" class="provider-logo" onerror="this.style.display='none'">` : `<i class="fa-solid fa-tv" style="color:var(--accent-red);"></i>`}
            <span class="provider-name">${p.provider_name}</span>
            <span class="provider-type-badge ${p.type.toLowerCase()}">${p.type}</span>
          </div>
        `).join("");
      }
    }
  } catch (e) {
    console.warn("[CinePlay] TMDB enrichment failed:", e);
  }
}

// Build streaming provider grid from item data or honest empty state
// Build streaming provider grid from item data or honest empty state
function _buildProviderGrid(item) {
  const config = window.CINEPLAY_CONFIG ? window.CINEPLAY_CONFIG.TMDB : { DEFAULT_REGION: "IN" };
  const regionKey = config.DEFAULT_REGION || "IN";

  // ✅ Check multiple possible locations for provider data
  let providersList = [];

  // 1. Check item.providers (TMDB normalized format)
  if (item.providers && typeof item.providers === "object") {
    const region = item.providers[regionKey] || item.providers["US"] || {};
    providersList = [
      ...(region.flatrate || []).map(p => ({ ...p, type: "STREAM" })),
      ...(region.rent || []).map(p => ({ ...p, type: "RENT" })),
      ...(region.buy || []).map(p => ({ ...p, type: "BUY" }))
    ];
  }

  // 2. Check item.streaming (legacy format from data.js)
  if (providersList.length === 0 && item.streaming && Array.isArray(item.streaming)) {
    providersList = item.streaming.map(name => ({
      name: name,
      type: "STREAM",
      logo: null
    }));
  }

  // 3. Check if there's raw provider data in the item
  if (providersList.length === 0 && item.provider_data) {
    const region = item.provider_data[regionKey] || item.provider_data["US"] || {};
    providersList = [
      ...(region.flatrate || []).map(p => ({ ...p, type: "STREAM" })),
      ...(region.rent || []).map(p => ({ ...p, type: "RENT" })),
      ...(region.buy || []).map(p => ({ ...p, type: "BUY" }))
    ];
  }

  // 4. Check if the item has direct provider names
  if (providersList.length === 0 && item.provider_names && Array.isArray(item.provider_names)) {
    providersList = item.provider_names.map(name => ({
      name: name,
      type: "STREAM",
      logo: null
    }));
  }

  // If we have providers, render them
  if (providersList.length > 0) {
    // Remove duplicates by name
    const uniqueProviders = [];
    const seenNames = new Set();
    providersList.forEach(p => {
      if (!seenNames.has(p.name)) {
        seenNames.add(p.name);
        uniqueProviders.push(p);
      }
    });

    return uniqueProviders.slice(0, 6).map(p => `
      <div class="provider-card" title="${p.name} (${p.type})">
        ${p.logo ? `<img src="${p.logo}" alt="${p.name}" class="provider-logo" onerror="this.style.display='none'">` : `<i class="fa-solid fa-tv" style="color:var(--accent-red);"></i>`}
        <span class="provider-name">${p.name}</span>
        <span class="provider-type-badge ${p.type.toLowerCase()}">${p.type}</span>
      </div>
    `).join("");
  }

  // Honest unavailable state when no provider data exists
  return `<div class="provider-unavailable"><i class="fa-solid fa-circle-info"></i> Streaming availability currently unavailable for this region.</div>`;
}
// Universal trailer opener - fetches trailer if not available locally
async function openMovieTrailer(itemId, title) {
  // 1. Check if we have the item in registry with trailer
  let item = window._cineItemRegistry[itemId];
  const movieTitle = title || (item ? item.title : "Trailer");

  // 2. Check if trailer exists
  if (item && (item.trailerKey || item.trailer)) {
    openTrailerModal(item.trailerKey || item.trailer, movieTitle);
    return;
  }

  // 3. If no trailer found, show loading toast
  showToast("Loading trailer...", "fa-spinner fa-spin");

  // 4. Try to fetch from TMDB if it's a TMDB movie
  if (item && item.tmdbId && window.CinePlayAPIService) {
    try {
      const videosData = await window.CinePlayAPIService.getTMDBMovieVideos(item.tmdbId);
      if (videosData && videosData.results && videosData.results.length > 0) {
        const trailer = videosData.results.find(v => v.site === "YouTube" && v.type === "Trailer") ||
          videosData.results.find(v => v.site === "YouTube" && v.type === "Teaser");

        if (trailer && trailer.key) {
          // Save trailer to item
          item.trailerKey = trailer.key;
          item.trailer = trailer.key;
          window._cineItemRegistry[itemId] = item;

          // Open trailer
          openTrailerModal(trailer.key, movieTitle);
          return;
        }
      }
    } catch (e) {
      console.warn("Trailer fetch error:", e);
    }
  }

  // 5. Fallback: try searching TMDB for the movie to get ID
  if (window.CinePlayAPIService) {
    try {
      const searchRes = await window.CinePlayAPIService.searchTMDBMovies(title);
      if (searchRes && searchRes.results && searchRes.results.length > 0) {
        const tmdbId = String(searchRes.results[0].id);
        const videosData = await window.CinePlayAPIService.getTMDBMovieVideos(tmdbId);
        if (videosData && videosData.results && videosData.results.length > 0) {
          const trailer = videosData.results.find(v => v.site === "YouTube" && v.type === "Trailer") ||
            videosData.results.find(v => v.site === "YouTube" && v.type === "Teaser");

          if (trailer && trailer.key) {
            openTrailerModal(trailer.key, title);
            return;
          }
        }
      }
    } catch (e) {
      console.warn("Trailer search error:", e);
    }
  }

  // 6. If all fails, show message
  showToast("Trailer not available for this title", "fa-circle-info");
}

// Async enrich open modal with live TMDB data (cast, trailer, providers)
async function _enrichModalWithTMDB(item) {
  try {
    const tmdbId = item.tmdbId;
    const [credits, videos, providers] = await Promise.all([
      CinePlayAPIService.getTMDBMovieCredits(tmdbId),
      CinePlayAPIService.getTMDBMovieVideos(tmdbId),
      CinePlayAPIService.getTMDBWatchProviders(tmdbId)
    ]);

    // Update cast row
    const castRow = document.getElementById("modal-cast-row");
    if (castRow && credits && credits.cast && credits.cast.length) {
      const castNames = credits.cast.slice(0, 6).map(c => c.name).join(", ");
      castRow.innerHTML = `<strong>Cast:</strong> ${castNames}`;
    }

    // Update trailer button if we found a valid YouTube trailer/teaser
    if (videos && videos.results && videos.results.length) {
      const trailer = videos.results.find(v => v.site === "YouTube" && v.type === "Trailer")
        || videos.results.find(v => v.site === "YouTube" && v.type === "Teaser");
      if (trailer && trailer.key) {
        item.trailerKey = trailer.key;
        item.trailer = trailer.key;
        window._cineItemRegistry[item.id] = item;
        // Update play button if modal still open
        const playBtn = document.getElementById("modal-play-btn");
        if (playBtn) {
          playBtn.style.display = "inline-flex";
          playBtn.onclick = () => openTrailerModal(trailer.key, item.title);
        } else {
          // Add trailer button if it wasn't there before
          const actionsContainer = document.getElementById("modal-actions-container");
          if (actionsContainer && !actionsContainer.querySelector("#modal-play-btn")) {
            const btn = document.createElement("button");
            btn.id = "modal-play-btn";
            btn.className = "btn btn-primary";
            btn.innerHTML = `<i class="fa-solid fa-play"></i> Watch Trailer`;
            btn.addEventListener("click", () => openTrailerModal(trailer.key, item.title));
            actionsContainer.prepend(btn);
          }
        }
      }
    }

    // Update providers section from live TMDB data
    const providerGrid = document.getElementById("modal-provider-grid");
    if (providerGrid && providers && providers.results) {
      const config = window.CINEPLAY_CONFIG ? window.CINEPLAY_CONFIG.TMDB : { IMAGE_BASE: "https://image.tmdb.org/t/p", DEFAULT_REGION: "IN" };
      const regionData = providers.results[config.DEFAULT_REGION] || providers.results["US"] || {};
      const allP = [
        ...(regionData.flatrate || []).map(p => ({ ...p, type: "STREAM" })),
        ...(regionData.rent || []).map(p => ({ ...p, type: "RENT" })),
        ...(regionData.buy || []).map(p => ({ ...p, type: "BUY" }))
      ];
      if (allP.length > 0) {
        providerGrid.innerHTML = allP.slice(0, 6).map(p => `
          <div class="provider-card" title="${p.provider_name} (${p.type})">
            ${p.logo_path ? `<img src="${config.IMAGE_BASE}/w92${p.logo_path}" alt="${p.provider_name}" class="provider-logo" onerror="this.style.display='none'">` : `<i class="fa-solid fa-tv" style="color:var(--accent-red);"></i>`}
            <span class="provider-name">${p.provider_name}</span>
            <span class="provider-type-badge ${p.type.toLowerCase()}">${p.type}</span>
          </div>
        `).join("");
      } else {
        providerGrid.innerHTML = `<div class="provider-unavailable"><i class="fa-solid fa-circle-info"></i> Streaming availability currently unavailable for this region.</div>`;
      }
    }
  } catch (e) {
    console.warn("[CinePlay] TMDB enrichment failed:", e);
  }
}

function closeModal() {
  if (!globalModal) return;
  globalModal.classList.remove("active");
  document.body.style.overflow = "";
}

/* ==========================================================================
   6. Video Trailer Player Modal Engine
   ========================================================================== */
let trailerModal = null;

function initVideoTrailerModal() {
  if (trailerModal) return;

  trailerModal = document.createElement("div");
  trailerModal.id = "video-trailer-modal";
  trailerModal.className = "video-modal-overlay";
  trailerModal.innerHTML = `
    <div class="video-modal-box">
      <div class="video-modal-header">
        <span class="video-modal-title" id="trailer-title">Trailer Preview</span>
        <div style="display: flex; align-items: center; gap: 12px;">
          <a id="yt-direct-btn" href="#" target="_blank" class="btn btn-outline" style="padding: 6px 14px; font-size: 13px; border-radius: 20px; text-decoration: none;">
            <i class="fa-brands fa-youtube" style="color: #ff0000; margin-right: 4px;"></i> Open on YouTube ↗
          </a>
          <button class="quiz-close-btn" id="close-trailer-btn"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
      <div class="video-wrapper">
        <iframe id="trailer-iframe" src="" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
      </div>
    </div>
  `;
  document.body.appendChild(trailerModal);

  const closeBtn = trailerModal.querySelector("#close-trailer-btn");
  closeBtn.addEventListener("click", closeTrailerModal);
  trailerModal.addEventListener("click", (e) => {
    if (e.target === trailerModal) closeTrailerModal();
  });
}

function openTrailerModal(trailerId, title) {
  initVideoTrailerModal();
  const iframe = document.getElementById("trailer-iframe");
  const titleEl = document.getElementById("trailer-title");
  const ytBtn = document.getElementById("yt-direct-btn");

  if (trailerId) {
    if (iframe) iframe.src = `https://www.youtube.com/embed/${trailerId}?autoplay=1&rel=0`;
    if (titleEl) titleEl.textContent = `${title} — Official Trailer`;
    if (ytBtn) ytBtn.href = `https://www.youtube.com/watch?v=${trailerId}`;
    trailerModal.classList.add("active");
    document.body.style.overflow = "hidden";
  } else {
    showToast("Trailer preview coming soon!", "fa-solid fa-circle-info");
  }
}

function closeTrailerModal() {
  if (!trailerModal) return;
  const iframe = document.getElementById("trailer-iframe");
  if (iframe) iframe.src = "";
  trailerModal.classList.remove("active");
  document.body.style.overflow = "";
}

/* ==========================================================================
   7. Interactive Initial Load Mood Quiz Popup Wizard ("The Anti-Scroll Popup")
   ========================================================================== */
let moodQuizModal = null;
let currentQuizStep = 1;
const quizSelections = {
  mood: "Action-packed",
  timeOfDay: "Night",
  company: "Solo",
  duration: 130
};

function initMoodQuizModal() {
  if (moodQuizModal) return;

  moodQuizModal = document.createElement("div");
  moodQuizModal.id = "mood-quiz-modal";
  moodQuizModal.className = "mood-modal-overlay";
  moodQuizModal.innerHTML = `
    <div class="quiz-modal-box">
      <div class="quiz-modal-header">
        <div class="quiz-step-indicator">
          <span class="quiz-step-tag" id="quiz-step-tag">Step 1 of 4 • Mood</span>
          <button class="quiz-close-btn" id="close-quiz-btn"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <h2 class="quiz-title" id="quiz-question-title">How are you feeling right now?</h2>
        <p class="quiz-subtitle" id="quiz-question-subtitle">Select your vibe and let CinePlay recommend the perfect movie.</p>
        <div class="quiz-progress-track">
          <div class="quiz-progress-bar" id="quiz-progress-bar" style="width: 25%;"></div>
        </div>
      </div>

      <div class="quiz-body">
        <!-- Step 1: Mood -->
        <div class="quiz-step-pane active" data-step="1">
          <div class="quiz-options-grid">
            <div class="quiz-option-card selected" data-value="Action-packed" onclick="selectQuizOption(this, 'mood', 'Action-packed')">
              <span class="quiz-option-icon">🍿</span>
              <div class="quiz-option-title">Thrilled & Hyped</div>
              <div class="quiz-option-desc">High energy action & thrills</div>
            </div>
            <div class="quiz-option-card" data-value="Relaxing" onclick="selectQuizOption(this, 'mood', 'Relaxing')">
              <span class="quiz-option-icon">🛋️</span>
              <div class="quiz-option-title">Chill & Cozy</div>
              <div class="quiz-option-desc">Relaxing stories to unwind</div>
            </div>
            <div class="quiz-option-card" data-value="Thought-provoking" onclick="selectQuizOption(this, 'mood', 'Thought-provoking')">
              <span class="quiz-option-icon">🧠</span>
              <div class="quiz-option-title">Mind-Bending</div>
              <div class="quiz-option-desc">Plot twists & deep themes</div>
            </div>
            <div class="quiz-option-card" data-value="Emotional" onclick="selectQuizOption(this, 'mood', 'Emotional')">
              <span class="quiz-option-icon">😭</span>
              <div class="quiz-option-title">Deep & Emotional</div>
              <div class="quiz-option-desc">Heartfelt dramas & stories</div>
            </div>
            <div class="quiz-option-card" data-value="Scary" onclick="selectQuizOption(this, 'mood', 'Scary')">
              <span class="quiz-option-icon">👻</span>
              <div class="quiz-option-title">Spooky Thrill</div>
              <div class="quiz-option-desc">Horror & edge-of-seat tension</div>
            </div>
            <div class="quiz-option-card" data-value="Suspenseful" onclick="selectQuizOption(this, 'mood', 'Suspenseful')">
              <span class="quiz-option-icon">😂</span>
              <div class="quiz-option-title">Fun & Lighthearted</div>
              <div class="quiz-option-desc">Laughter, music & joy</div>
            </div>
          </div>
        </div>

        <!-- Step 2: Time of Day -->
        <div class="quiz-step-pane" data-step="2">
          <div class="quiz-options-grid">
            <div class="quiz-option-card selected" data-value="Morning" onclick="selectQuizOption(this, 'timeOfDay', 'Morning')">
              <span class="quiz-option-icon">☀️</span>
              <div class="quiz-option-title">Morning Bright</div>
              <div class="quiz-option-desc">Uplifting start to the day</div>
            </div>
            <div class="quiz-option-card" data-value="Evening" onclick="selectQuizOption(this, 'timeOfDay', 'Evening')">
              <span class="quiz-option-icon">🌇</span>
              <div class="quiz-option-title">Sunset Chill</div>
              <div class="quiz-option-desc">Evening wind-down time</div>
            </div>
            <div class="quiz-option-card" data-value="Night" onclick="selectQuizOption(this, 'timeOfDay', 'Night')">
              <span class="quiz-option-icon">🌙</span>
              <div class="quiz-option-title">Prime Time Binge</div>
              <div class="quiz-option-desc">Peak night viewing</div>
            </div>
            <div class="quiz-option-card" data-value="Midnight" onclick="selectQuizOption(this, 'timeOfDay', 'Midnight')">
              <span class="quiz-option-icon">🌌</span>
              <div class="quiz-option-title">Midnight Mystery</div>
              <div class="quiz-option-desc">Late night dark atmosphere</div>
            </div>
          </div>
        </div>

        <!-- Step 3: Company -->
        <div class="quiz-step-pane" data-step="3">
          <div class="quiz-options-grid">
            <div class="quiz-option-card selected" data-value="Solo" onclick="selectQuizOption(this, 'company', 'Solo')">
              <span class="quiz-option-icon">👤</span>
              <div class="quiz-option-title">Solo Viewing</div>
              <div class="quiz-option-desc">Just me, my snacks & cinema</div>
            </div>
            <div class="quiz-option-card" data-value="Date" onclick="selectQuizOption(this, 'company', 'Date')">
              <span class="quiz-option-icon">👫</span>
              <div class="quiz-option-title">Date Night</div>
              <div class="quiz-option-desc">Romantic or engaging pick</div>
            </div>
            <div class="quiz-option-card" data-value="Family" onclick="selectQuizOption(this, 'company', 'Family')">
              <span class="quiz-option-icon">👨‍👩‍👧</span>
              <div class="quiz-option-title">Family Night</div>
              <div class="quiz-option-desc">Crowd pleaser for everyone</div>
            </div>
            <div class="quiz-option-card" data-value="Friends" onclick="selectQuizOption(this, 'company', 'Friends')">
              <span class="quiz-option-icon">🍻</span>
              <div class="quiz-option-title">Squad / Friends</div>
              <div class="quiz-option-desc">Fun & high energy vibes</div>
            </div>
          </div>
        </div>

        <!-- Step 4: Duration -->
        <div class="quiz-step-pane" data-step="4">
          <div class="quiz-options-grid">
            <div class="quiz-option-card" data-value="90" onclick="selectQuizOption(this, 'duration', 90)">
              <span class="quiz-option-icon">⚡</span>
              <div class="quiz-option-title">Quick Watch (&lt; 90 min)</div>
              <div class="quiz-option-desc">Snappy story, no fluff</div>
            </div>
            <div class="quiz-option-card selected" data-value="130" onclick="selectQuizOption(this, 'duration', 130)">
              <span class="quiz-option-icon">🎬</span>
              <div class="quiz-option-title">Standard Feature (~ 2 hours)</div>
              <div class="quiz-option-desc">Classic movie duration</div>
            </div>
            <div class="quiz-option-card" data-value="999" onclick="selectQuizOption(this, 'duration', 999)">
              <span class="quiz-option-icon">🍿</span>
              <div class="quiz-option-title">Cinematic Epic (2.5h+)</div>
              <div class="quiz-option-desc">Deep immersion experience</div>
            </div>
          </div>
        </div>

        <!-- Step 5: Result Pane -->
        <div class="quiz-step-pane" data-step="5" id="quiz-result-pane">
          <!-- Populated dynamically -->
        </div>
      </div>

      <div class="quiz-modal-footer">
        <button class="btn btn-outline quiz-nav-btn" id="quiz-prev-btn" style="visibility: hidden;" onclick="navigateQuizStep(-1)">
          <i class="fa-solid fa-arrow-left"></i> Back
        </button>
        <div style="display: flex; gap: 10px; align-items: center;">
          <button class="btn btn-outline quiz-nav-btn" id="quiz-skip-btn" onclick="closeMoodQuizModal()">Skip</button>
          <button class="btn btn-primary quiz-nav-btn" id="quiz-next-btn" onclick="navigateQuizStep(1)">
            Next <i class="fa-solid fa-arrow-right"></i>
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(moodQuizModal);

  const closeBtn = moodQuizModal.querySelector("#close-quiz-btn");
  closeBtn.addEventListener("click", closeMoodQuizModal);
  moodQuizModal.addEventListener("click", (e) => {
    if (e.target === moodQuizModal) closeMoodQuizModal();
  });

  // Auto show on every visit / refresh on index.html (landing page)
  const isHomePage =
    window.location.pathname.endsWith("index.html") ||
    window.location.pathname === "/" ||
    window.location.pathname === "" ||
    window.location.pathname.endsWith("/cineplay/") ||
    window.location.pathname.endsWith("/cineplay/index.html");

  if (isHomePage) {
    setTimeout(() => {
      openMoodQuizModal();
    }, 600);
  }
}

function openMoodQuizModal() {
  initMoodQuizModal();
  currentQuizStep = 1;
  updateQuizUI();
  moodQuizModal.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeMoodQuizModal() {
  if (!moodQuizModal) return;
  moodQuizModal.classList.remove("active");
  document.body.style.overflow = "";
}

window.selectQuizOption = function (card, key, val) {
  const parentPane = card.closest(".quiz-step-pane");
  parentPane.querySelectorAll(".quiz-option-card").forEach(c => c.classList.remove("selected"));
  card.classList.add("selected");
  quizSelections[key] = val;
};

window.navigateQuizStep = function (direction) {
  currentQuizStep += direction;
  if (currentQuizStep > 4 && direction > 0) {
    calculateQuizResults();
  } else if (currentQuizStep < 1) {
    currentQuizStep = 1;
    updateQuizUI();
  } else {
    updateQuizUI();
  }
};

function updateQuizUI() {
  const tag = document.getElementById("quiz-step-tag");
  const title = document.getElementById("quiz-question-title");
  const subtitle = document.getElementById("quiz-question-subtitle");
  const progressBar = document.getElementById("quiz-progress-bar");
  const prevBtn = document.getElementById("quiz-prev-btn");
  const nextBtn = document.getElementById("quiz-next-btn");
  const skipBtn = document.getElementById("quiz-skip-btn");

  if (!tag || !title) return;

  const stepPanes = moodQuizModal.querySelectorAll(".quiz-step-pane");
  stepPanes.forEach(pane => {
    pane.classList.toggle("active", parseInt(pane.dataset.step, 10) === currentQuizStep);
  });

  if (currentQuizStep === 5) {
    prevBtn.style.visibility = "visible";
    prevBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Retake';
    prevBtn.onclick = () => { currentQuizStep = 1; updateQuizUI(); };
    skipBtn.style.display = "none";
    nextBtn.style.display = "inline-flex";
    nextBtn.innerHTML = '<i class="fa-solid fa-check"></i> Done';
    nextBtn.onclick = closeMoodQuizModal;
    return;
  }

  // Restore regular onclick for steps 1-4
  prevBtn.onclick = () => navigateQuizStep(-1);
  nextBtn.onclick = () => navigateQuizStep(1);
  nextBtn.style.display = "inline-flex";
  prevBtn.style.visibility = currentQuizStep > 1 ? "visible" : "hidden";
  skipBtn.style.display = "inline-block";

  if (currentQuizStep === 1) {
    tag.textContent = "Step 1 of 4 • Mood";
    title.textContent = "How are you feeling right now?";
    subtitle.textContent = "Select your vibe and let CinePlay recommend the perfect movie.";
    progressBar.style.width = "25%";
    nextBtn.innerHTML = 'Next <i class="fa-solid fa-arrow-right"></i>';
    prevBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Back';
  } else if (currentQuizStep === 2) {
    tag.textContent = "Step 2 of 4 • Time of Day";
    title.textContent = "What is the time of day?";
    subtitle.textContent = "We adjust recommendations based on your viewing environment.";
    progressBar.style.width = "50%";
    nextBtn.innerHTML = 'Next <i class="fa-solid fa-arrow-right"></i>';
    prevBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Back';
  } else if (currentQuizStep === 3) {
    tag.textContent = "Step 3 of 4 • Watch Partner";
    title.textContent = "Who are you watching with?";
    subtitle.textContent = "Solo relaxation, date night, or family movie session?";
    progressBar.style.width = "75%";
    nextBtn.innerHTML = 'Next <i class="fa-solid fa-arrow-right"></i>';
    prevBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Back';
  } else if (currentQuizStep === 4) {
    tag.textContent = "Step 4 of 4 • Time Limit";
    title.textContent = "How much time do you have?";
    subtitle.textContent = "Pick your ideal duration to prevent late night fatigue.";
    progressBar.style.width = "100%";
    nextBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Get My Match';
    prevBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Back';
  }
}

async function calculateQuizResults() {
  const resultPane = document.getElementById("quiz-result-pane");
  const tag = document.getElementById("quiz-step-tag");
  const title = document.getElementById("quiz-question-title");
  const subtitle = document.getElementById("quiz-question-subtitle");

  currentQuizStep = 5;
  tag.textContent = "Your Perfect Cinema Match";
  title.textContent = "Finding Your Match...";
  subtitle.textContent = `Analyzing ${quizSelections.mood} vibe for ${quizSelections.company.toLowerCase()} • ${quizSelections.timeOfDay.toLowerCase()}...`;

  resultPane.innerHTML = `
    <div style="text-align: center; padding: 45px 20px;">
      <i class="fa-solid fa-wand-magic-sparkles fa-spin" style="font-size: 38px; color: var(--accent-red); margin-bottom: 16px;"></i>
      <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 8px;">Curating Live TMDB Matches...</h3>
      <p style="color: var(--text-muted); font-size: 13px;">Handpicking fresh titles tailored to your exact mood.</p>
    </div>
  `;

  updateQuizUI();

  try {
    const matches = await CinePlayAPI.fetchRecommendations({
      contentType: "movie",
      mood: quizSelections.mood,
      timeOfDay: quizSelections.timeOfDay,
      company: quizSelections.company,
      runtimeMax: quizSelections.duration
    });

    let topMatch = null;
    let score = 96;

    if (matches && matches.length > 0) {
      // Pick randomly among top matches for high diversity on every quiz run
      const topPool = matches.slice(0, Math.min(4, matches.length));
      const chosen = topPool[Math.floor(Math.random() * topPool.length)];
      topMatch = chosen.item;
      score = chosen.score;
    } else if (window.moviesData && window.moviesData.length > 0) {
      topMatch = window.moviesData[Math.floor(Math.random() * window.moviesData.length)];
    }

    if (!topMatch) {
      resultPane.innerHTML = `<div style="text-align:center; padding:30px;"><p>No matches found. Please try different options.</p></div>`;
      return;
    }

    if (window._cineItemRegistry) {
      window._cineItemRegistry[topMatch.id] = topMatch;
    }

    title.textContent = "No More Scrolling!";
    subtitle.textContent = `Based on your ${quizSelections.mood} vibe, ${quizSelections.timeOfDay.toLowerCase()} timing, and ${quizSelections.company.toLowerCase()} plan:`;

    const moodsStr = Array.isArray(topMatch.mood) && topMatch.mood.length > 0
      ? topMatch.mood.join(" • ")
      : (window.CinePlayAPIService && window.CinePlayAPIService.determineMoodTags 
          ? window.CinePlayAPIService.determineMoodTags(topMatch.genres || topMatch.genre, topMatch.overview || topMatch.description, topMatch.title).join(" • ") 
          : quizSelections.mood);

    const posterUrl = topMatch.poster || topMatch.backdrop || "images/posters/m1.jpg";
    const desc = topMatch.overview || topMatch.description || "No overview available.";
    const safeTitle = (topMatch.title || "Movie").replace(/'/g, "\\'");

    resultPane.innerHTML = `
      <div class="quiz-result-hero">
        <img src="${posterUrl}" alt="${safeTitle}" class="quiz-result-poster" onerror="CinePlay.movieImgFallback(this, '${safeTitle}')">
        <div class="quiz-result-info">
          <span class="match-score-chip"><i class="fa-solid fa-bolt"></i> ${score}% Match</span>
          <span class="match-rationale-tag"><i class="fa-solid fa-sparkles"></i> ${moodsStr}</span>
          <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 6px; color: var(--text-primary);">${topMatch.title}</h3>
          <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${desc}</p>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            ${topMatch.trailer ? `<button class="btn btn-primary" style="padding: 8px 16px; font-size: 12px;" onclick="CinePlay.openTrailerModal('${topMatch.trailer}', '${safeTitle}')"><i class="fa-solid fa-play"></i> Watch Trailer</button>` : ''}
            <button class="btn btn-outline" style="padding: 8px 16px; font-size: 12px;" onclick="CinePlay.openDetailsModal(window._cineItemRegistry['${topMatch.id}'] || '${topMatch.id}', 'movie')"><i class="fa-solid fa-circle-info"></i> Full Details</button>
            <button class="btn btn-outline" style="padding: 8px 14px; font-size: 12px; border-color: var(--accent-red); color: var(--accent-red);" title="Get another match with same settings" onclick="calculateQuizResults()"><i class="fa-solid fa-rotate"></i> Roll Another</button>
          </div>
        </div>
      </div>
      <div style="text-align: center; margin-top: 15px;">
        <a href="recommendations.html" class="btn btn-primary btn-large" style="width: 100%; border-radius: 30px; padding: 12px 20px; font-size: 14px;" onclick="closeMoodQuizModal()">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Explore All Matches on Recommendation Engine
        </a>
      </div>
    `;
  } catch (err) {
    console.error("[Quiz] Error calculating live results:", err);
    resultPane.innerHTML = `<div style="text-align:center; padding:30px;"><p>Failed to generate recommendations. Please try again.</p><button class="btn btn-primary" onclick="calculateQuizResults()">Retry</button></div>`;
  }
}

/* ==========================================================================
   8. Floating Quick Match Button Trigger
   ========================================================================== */
function initFloatingMatchBtn() {
  if (document.getElementById("floating-match-btn")) return;
  const btn = document.createElement("button");
  btn.id = "floating-match-btn";
  btn.className = "floating-match-btn";
  btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> <span>Quick Mood Match</span>`;
  btn.addEventListener("click", () => {
    openMoodQuizModal();
  });
  document.body.appendChild(btn);
}

/* ==========================================================================
   9. Live Search Auto-Suggestions Dropdown
   ========================================================================== */
function initLiveSearchAutoSuggestions() {
  const searchInputs = document.querySelectorAll(".search-input");

  searchInputs.forEach(input => {
    const wrapper = input.closest(".search-input-wrapper");
    if (!wrapper) return;

    let dropdown = wrapper.querySelector(".search-suggestions-dropdown");
    if (!dropdown) {
      dropdown = document.createElement("div");
      dropdown.className = "search-suggestions-dropdown";
      wrapper.appendChild(dropdown);
    }

    let searchTimer = null;

    input.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) {
        dropdown.classList.remove("active");
        return;
      }

      searchTimer = setTimeout(async () => {
        let matches = [];
        const seenIds = new Set();

        // 1. Check local dataset first
        const localMovies = (window.moviesData || []).filter(m => m.title.toLowerCase().includes(q)).map(m => ({ ...m, type: "movie" }));
        const localGames = (window.gamesData || []).filter(g => g.title.toLowerCase().includes(q)).map(g => ({ ...g, type: "game" }));
        [...localMovies, ...localGames].forEach(item => {
          if (item.id && !seenIds.has(String(item.id))) {
            seenIds.add(String(item.id));
            matches.push(item);
          }
        });

        // 2. Fetch live TMDB results — dedupe by id to avoid showing the same movie twice
        if (window.CinePlayAPIService) {
          try {
            const tmdbRes = await window.CinePlayAPIService.searchTMDBMovies(q);
            if (tmdbRes && tmdbRes.results && tmdbRes.results.length > 0) {
              const tmdbMatches = tmdbRes.results.slice(0, 6).map(m => window.CinePlayAPIService.normalizeMovie(m)).filter(Boolean);
              tmdbMatches.forEach(tm => {
                if (tm && tm.id && !seenIds.has(String(tm.id))) {
                  seenIds.add(String(tm.id));
                  matches.push({ ...tm, type: "movie" });
                }
              });
            }
          } catch (e) {
            console.warn("Live search TMDB fetch error:", e);
          }
        }

        if (matches.length === 0) {
          dropdown.classList.remove("active");
          return;
        }

        dropdown.innerHTML = matches.slice(0, 6).map(item => {
          const safeTitle = (item.title || item.name || "Untitled").replace(/'/g, "\\'");
          const thumb = item.poster || item.cover || "images/posters/m1.jpg";
          const rating = item.rating || item.tmdbRating || 8.0;
          const year = item.year || 2024;
          const type = item.type || "movie";
          const itemId = String(item.id);

          // Register in registry so openFeaturedItem can find it
          window._cineItemRegistry[itemId] = item;

          return `
            <div class="suggestion-item" onclick="CinePlay.openFeaturedItem('${itemId}', '${type}'); this.closest('.search-suggestions-dropdown').classList.remove('active'); document.querySelectorAll('.search-input').forEach(i => i.blur());">
              <img src="${thumb}" alt="${safeTitle}" class="suggestion-thumb" onerror="this.src='images/posters/m1.jpg'">
              <div>
                <div class="suggestion-title">${item.title || item.name}</div>
                <div class="suggestion-meta"><i class="fa-solid fa-star" style="color: var(--rating-yellow);"></i> ${rating} • ${year} • <span style="text-transform: uppercase; font-size: 10px; font-weight: 700; color: var(--accent-red);">${type}</span></div>
              </div>
            </div>
          `;
        }).join("");

        dropdown.classList.add("active");
      }, 250);
    });

    document.addEventListener("click", (e) => {
      if (!wrapper.contains(e.target)) {
        dropdown.classList.remove("active");
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        dropdown.classList.remove("active");
        input.blur();
        return;
      }

      if (e.key === "Enter") {
        if (dropdown.classList.contains("active")) {
          const firstSuggestion = dropdown.querySelector(".suggestion-item");
          if (firstSuggestion) {
            e.preventDefault();
            e.stopPropagation();
            dropdown.classList.remove("active");
            input.blur();
            firstSuggestion.click();
          }
        }
      }
    });
  });
}

/* ==========================================================================
   10. Recently Viewed Tracking
   ========================================================================== */
const RECENTLY_VIEWED_KEY = "cineplay_recently_viewed";

function getRecentlyViewed() {
  return JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY)) || [];
}

function trackRecentlyViewed(id, type) {
  let list = getRecentlyViewed();
  list = list.filter(item => item.id !== id);
  list.unshift({ id, type });
  if (list.length > 6) {
    list.pop();
  }
  localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("recentlyViewedChanged"));
}

/* ==========================================================================
   11. Theme / Sticky Header / Mobile Menu UI
   ========================================================================== */
function initTheme() {
  const themeToggleBtn = document.getElementById("theme-toggle");
  if (!themeToggleBtn) return;

  const currentTheme = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", currentTheme);
  updateThemeIcon(currentTheme);

  themeToggleBtn.addEventListener("click", () => {
    const theme = document.documentElement.getAttribute("data-theme");
    const newTheme = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
    updateThemeIcon(newTheme);
    showToast(`Switched to ${newTheme === "light" ? "Light" : "Dark"} Mode`, "fa-circle-half-stroke");
  });
}

function updateThemeIcon(theme) {
  const icon = document.querySelector("#theme-toggle i");
  if (!icon) return;
  icon.className = theme === "light" ? "fa-solid fa-moon" : "fa-solid fa-sun";
}

function initNavbar() {
  const header = document.querySelector("header");
  if (!header) return;
  window.addEventListener("scroll", () => {
    header.classList.toggle("sticky", window.scrollY > 50);
  });
}

function initMobileMenu() {
  const menuBtn = document.getElementById("mobile-menu-btn");
  const navMenu = document.getElementById("nav-menu");
  if (!menuBtn || !navMenu) return;

  let overlay = document.querySelector(".mobile-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "mobile-overlay";
    document.body.appendChild(overlay);
  }

  function toggleMenu() {
    navMenu.classList.toggle("active");
    overlay.classList.toggle("active");
    document.body.classList.toggle("menu-open"); // Add this line
    const icon = menuBtn.querySelector("i");
    icon.className = navMenu.classList.contains("active") ? "fa-solid fa-xmark" : "fa-solid fa-bars";
  }

  menuBtn.addEventListener("click", toggleMenu);
  overlay.addEventListener("click", toggleMenu);

  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", () => {
      if (navMenu.classList.contains("active")) toggleMenu();
    });
  });
}

function initBackToTop() {
  let backBtn = document.getElementById("back-to-top");
  if (!backBtn) {
    backBtn = document.createElement("button");
    backBtn.id = "back-to-top";
    backBtn.className = "back-to-top";
    backBtn.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
    document.body.appendChild(backBtn);
  }

  window.addEventListener("scroll", () => {
    backBtn.classList.toggle("show", window.scrollY > 400);
  });

  backBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

/* ==========================================================================
   12. Stats & Skeletons Observer helpers
   ========================================================================== */
function initLazyLoading() {
  const images = document.querySelectorAll("img[loading='lazy']");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) img.src = img.dataset.src;
          observer.unobserve(img);
        }
      });
    });
    images.forEach(img => observer.observe(img));
  } else {
    images.forEach(img => { if (img.dataset.src) img.src = img.dataset.src; });
  }
}

function initIntersectionObserver() {
  const revealElements = document.querySelectorAll(".scroll-reveal");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add("active");
      });
    }, { threshold: 0.1 });
    revealElements.forEach(el => observer.observe(el));
  } else {
    revealElements.forEach(el => el.classList.add("active"));
  }

  const counters = document.querySelectorAll(".stat-number");
  if (counters.length > 0 && "IntersectionObserver" in window) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounters(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(c => obs.observe(c));
  } else {
    counters.forEach(c => {
      c.textContent = parseInt(c.dataset.target, 10).toLocaleString() + (c.dataset.suffix || "");
    });
  }
}

function animateCounters(el) {
  const target = parseInt(el.dataset.target, 10);
  const suffix = el.dataset.suffix || "";
  const duration = 2000;
  const stepTime = Math.max(Math.floor(duration / target), 15);
  let current = 0;
  const increment = Math.ceil(target / (duration / stepTime));

  const timer = setInterval(() => {
    current += increment;
    if (current >= target) {
      el.textContent = target.toLocaleString() + suffix;
      clearInterval(timer);
    } else {
      el.textContent = current.toLocaleString() + suffix;
    }
  }, stepTime);
}

function showToast(message, iconClass = "fa-info-circle") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<i class="fa-solid ${iconClass}"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("removing");
    toast.addEventListener("animationend", () => {
      toast.remove();
      if (container.children.length === 0) container.remove();
    });
  }, 3000);
}

function initNewsletter() {
  const form = document.getElementById("newsletter-form");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = form.querySelector(".newsletter-input");
    if (input && input.value.trim()) {
      showToast("Subscription successful! Welcome aboard.", "fa-paper-plane");
      input.value = "";
    }
  });
}

/* ==========================================================================
   13. Decoupled Home Page Feature Initializer
   ========================================================================== */
function initHomePage() {
  initHeroSlider();
  initHomeSearch();
  renderFeaturedLists();
}

function initHeroSlider() {
  const slides = document.querySelectorAll(".slide");
  const prevBtn = document.getElementById("carousel-prev");
  const nextBtn = document.getElementById("carousel-next");
  const dotsContainer = document.getElementById("carousel-dots");
  if (!slides.length || !prevBtn || !nextBtn || !dotsContainer) return;

  let currentSlide = 0;
  let slideInterval;

  slides.forEach((_, idx) => {
    const dot = document.createElement("button");
    dot.className = `dot ${idx === 0 ? 'active' : ''}`;
    dot.setAttribute("aria-label", `Go to slide ${idx + 1}`);
    dot.addEventListener("click", () => goToSlide(idx));
    dotsContainer.appendChild(dot);
  });

  const dots = dotsContainer.querySelectorAll(".dot");

  function updateSlides() {
    slides.forEach((slide, idx) => {
      slide.classList.toggle("active", idx === currentSlide);
      if (dots[idx]) dots[idx].classList.toggle("active", idx === currentSlide);
    });
  }

  function nextSlide() {
    currentSlide = (currentSlide + 1) % slides.length;
    updateSlides();
  }

  function prevSlide() {
    currentSlide = (currentSlide - 1 + slides.length) % slides.length;
    updateSlides();
  }

  function goToSlide(idx) {
    currentSlide = idx;
    updateSlides();
    resetTimer();
  }

  function startTimer() {
    clearInterval(slideInterval);
    slideInterval = setInterval(nextSlide, 6000);
  }

  function resetTimer() {
    clearInterval(slideInterval);
    startTimer();
  }

  prevBtn.addEventListener("click", () => { prevSlide(); resetTimer(); });
  nextBtn.addEventListener("click", () => { nextSlide(); resetTimer(); });
  startTimer();
}

function initHomeSearch() {
  const form = document.getElementById("home-search-form");
  const input = document.getElementById("home-search-input");
  const typeSelect = document.getElementById("search-type");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = encodeURIComponent(input.value.trim());
    const type = typeSelect.value;
    if (value) {
      window.location.href = `${type}.html?search=${value}`;
    }
  });
}

async function renderFeaturedLists() {
  const moviesSlider = document.getElementById("featured-movies-slider");
  const gamesSlider = document.getElementById("featured-games-slider");
  if (!moviesSlider || !gamesSlider) return;

  try {
    // ✅ Fetch movies with better error handling
    let movieRes = null;
    try {
      movieRes = await CinePlayAPI.fetchMovies({ sortBy: "rating-desc", limit: 6 });
      console.log("🎬 Featured Movies:", movieRes?.results?.length || 0);
    } catch (e) {
      console.warn("Movies fetch failed:", e);
    }

    // ✅ Fetch games with better error handling
    let gameRes = null;
    try {
      gameRes = await CinePlayAPI.fetchGames({ sortBy: "rating-desc", limit: 6 });
      console.log("🎮 Featured Games:", gameRes?.results?.length || 0);
    } catch (e) {
      console.warn("Games fetch failed:", e);
    }

    // ✅ If API fails, use local data as fallback
    if (!movieRes || !movieRes.results || movieRes.results.length === 0) {
      console.warn("Using local movies for featured section");
      let localMovies = [...(window.moviesData || [])];
      localMovies.sort((a, b) => b.rating - a.rating);
      movieRes = { results: localMovies.slice(0, 6), total: localMovies.length, hasMore: false };
    }

    if (!gameRes || !gameRes.results || gameRes.results.length === 0) {
      console.warn("Using local games for featured section");
      let localGames = [...(window.gamesData || [])];
      localGames.sort((a, b) => b.rating - a.rating);
      gameRes = { results: localGames.slice(0, 6), total: localGames.length, hasMore: false };
    }

    // ✅ Render movies
    if (movieRes && movieRes.results && movieRes.results.length > 0) {
      window.CinePlay.renderMovies(movieRes.results, moviesSlider);
      console.log("✅ Featured movies rendered:", movieRes.results.length);
    } else {
      console.warn("No movies to render");
      moviesSlider.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">No movies available</div>`;
    }

    // ✅ Render games
    if (gameRes && gameRes.results && gameRes.results.length > 0) {
      window.CinePlay.renderGames(gameRes.results, gamesSlider);
      console.log("✅ Featured games rendered:", gameRes.results.length);
    } else {
      console.warn("No games to render");
      gamesSlider.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">No games available</div>`;
    }

    // Sync favorites indicators on cards
    window.addEventListener("favoritesChanged", () => {
      syncFavoritesIcons(moviesSlider);
      syncFavoritesIcons(gamesSlider);
    });

  } catch (error) {
    console.error("Error rendering featured lists:", error);
    // Fallback: try to render from local data
    try {
      if (window.moviesData && window.moviesData.length > 0) {
        const sorted = [...window.moviesData].sort((a, b) => b.rating - a.rating);
        window.CinePlay.renderMovies(sorted.slice(0, 6), moviesSlider);
      }
      if (window.gamesData && window.gamesData.length > 0) {
        const sorted = [...window.gamesData].sort((a, b) => b.rating - a.rating);
        window.CinePlay.renderGames(sorted.slice(0, 6), gamesSlider);
      }
    } catch (fallbackError) {
      console.error("Fallback also failed:", fallbackError);
    }
  }
}

function syncFavoritesIcons(container) {
  if (!container) return;
  const cards = container.querySelectorAll(".media-card");
  cards.forEach(card => {
    const id = card.dataset.id;
    const btn = card.querySelector(".card-favorite-btn");
    if (!btn) return;
    const isFav = isFavorite(id);
    btn.classList.toggle("active", isFav);
    const icon = btn.querySelector("i");
    if (icon) icon.className = isFav ? "fa-solid fa-heart" : "fa-regular fa-heart";
  });
}

/* ==========================================================================
   Universal Search Overlay Engine
   ========================================================================== */
function closeUniversalSearch() {
  const searchOverlay = document.getElementById("universal-search-overlay");
  if (searchOverlay) {
    searchOverlay.classList.remove("active");
    document.body.style.overflow = "";
  }
}

function initUniversalSearch() {
  let searchOverlay = document.getElementById("universal-search-overlay");
  if (!searchOverlay) {
    searchOverlay = document.createElement("div");
    searchOverlay.id = "universal-search-overlay";
    searchOverlay.className = "search-overlay";
    searchOverlay.innerHTML = `
      <div class="search-overlay-header">
        <i class="fa-solid fa-magnifying-glass" style="font-size: 24px; color: var(--accent-red);"></i>
        <input type="text" id="universal-search-input" class="search-overlay-input" placeholder="Search CinePlay movies, games, actors, directors..." autocomplete="off">
        <button class="search-overlay-close" id="universal-search-close" aria-label="Close Search"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="search-overlay-results" id="universal-search-results">
        <div style="text-align: center; color: var(--text-muted); margin-top: 40px;">
          <i class="fa-solid fa-clapperboard" style="font-size: 40px; margin-bottom: 10px; color: var(--accent-red);"></i>
          <p>Type to search across movies, games, actors, and directors...</p>
        </div>
      </div>
    `;
    document.body.appendChild(searchOverlay);

    // Close on clicking backdrop outside container
    searchOverlay.addEventListener("click", (e) => {
      if (e.target === searchOverlay) {
        closeUniversalSearch();
      }
    });
  }

  const closeBtn = document.getElementById("universal-search-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeUniversalSearch);
  }

  // Keyboard shortcut Ctrl+K or / to open
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const searchOverlay = document.getElementById("universal-search-overlay");
      if (searchOverlay && searchOverlay.classList.contains("active")) {
        closeUniversalSearch();
      } else {
        openUniversalSearch();
      }
    } else if (e.key === "Escape") {
      const searchOverlay = document.getElementById("universal-search-overlay");
      if (searchOverlay && searchOverlay.classList.contains("active")) {
        closeUniversalSearch();
      }
    }
  });

  const input = document.getElementById("universal-search-input");
  if (input) {
    input.addEventListener("input", (e) => handleUniversalSearch(e.target.value));
  }
}

function openUniversalSearch(initialQuery = "") {
  initUniversalSearch();
  const searchOverlay = document.getElementById("universal-search-overlay");
  const input = document.getElementById("universal-search-input");
  if (searchOverlay && input) {
    searchOverlay.classList.add("active");
    document.body.style.overflow = "hidden";
    input.value = initialQuery;
    setTimeout(() => input.focus(), 50);
    if (initialQuery) handleUniversalSearch(initialQuery);
  }
}

function handleUniversalSearch(query) {
  const container = document.getElementById("universal-search-results");
  if (!container) return;
  const q = query.toLowerCase().trim();

  if (!q) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); margin-top: 40px;">
        <i class="fa-solid fa-clapperboard" style="font-size: 40px; margin-bottom: 10px; color: var(--accent-red);"></i>
        <p>Type to search across movies, games, actors, and directors...</p>
      </div>
    `;
    return;
  }

  const movies = (window.moviesData || []).filter(m => m.title.toLowerCase().includes(q) || (m.genre && m.genre.some(g => g.toLowerCase().includes(g))));
  const games = (window.gamesData || []).filter(g => g.title.toLowerCase().includes(q) || (g.genre && g.genre.some(gen => gen.toLowerCase().includes(q))));
  const actors = (window.actorsData || []).filter(a => a.name.toLowerCase().includes(q) || (a.knownFor && a.knownFor.toLowerCase().includes(q)));
  const directors = (window.directorsData || []).filter(d => d.name.toLowerCase().includes(q) || (d.knownFor && d.knownFor.toLowerCase().includes(q)));

  if (movies.length === 0 && games.length === 0 && actors.length === 0 && directors.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); margin-top: 40px;">
        <i class="fa-solid fa-ghost" style="font-size: 40px; margin-bottom: 10px; color: var(--accent-red);"></i>
        <h3>No matching results found</h3>
        <p style="font-size: 13px;">Try searching for a different keyword, title, actor, or genre.</p>
      </div>
    `;
    return;
  }

  let html = "";

  if (movies.length > 0) {
    html += `
      <div class="search-category-group">
        <h4><i class="fa-solid fa-film"></i> Movies (${movies.length})</h4>
        <div class="search-results-grid">
          ${movies.slice(0, 6).map(m => {
            const safeTitle = (m.title || "Untitled").replace(/'/g, "\\'");
            return `
            <div class="search-result-card" onclick="CinePlay.openFeaturedItem('${m.id}', 'movie'); document.getElementById('universal-search-overlay').classList.remove('active');">
              <img src="${m.poster || 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 300 450\' fill=\'%2314141d\'%3E%3C/svg%3E'}" alt="${safeTitle}" onerror="CinePlay.movieImgFallback(this, '${safeTitle}')">
              <div class="search-result-info">
                <div class="search-result-title">${m.title}</div>
                <div class="search-result-sub">⭐ ${m.rating} • ${m.year} • ${m.genre ? m.genre[0] : ''}</div>
              </div>
            </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  if (games.length > 0) {
    html += `
      <div class="search-category-group">
        <h4><i class="fa-solid fa-gamepad"></i> Games (${games.length})</h4>
        <div class="search-results-grid">
          ${games.slice(0, 6).map(g => {
            const safeTitle = (g.title || "Untitled").replace(/'/g, "\\'");
            return `
            <div class="search-result-card" onclick="CinePlay.openFeaturedItem('${g.id}', 'game'); document.getElementById('universal-search-overlay').classList.remove('active');">
              <img src="${g.cover || g.poster || 'images/posters/g1.jpg'}" alt="${safeTitle}" onerror="CinePlay.gameImgFallback(this, '${safeTitle}')">
              <div class="search-result-info">
                <div class="search-result-title">${g.title}</div>
                <div class="search-result-sub">⭐ ${g.rating} • ${g.year} • ${g.price || 'Free'}</div>
              </div>
            </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  if (actors.length > 0) {
    html += `
      <div class="search-category-group">
        <h4><i class="fa-solid fa-user-astronaut"></i> People / Cast (${actors.length})</h4>
        <div class="search-results-grid">
          ${actors.map(a => `
            <div class="search-result-card" onclick="window.location.href='movies.html?actor=' + encodeURIComponent('${a.name}')">
              <img src="${a.image}" alt="${a.name}" style="border-radius: 50%;">
              <div class="search-result-info">
                <div class="search-result-title">${a.name}</div>
                <div class="search-result-sub">${a.role} • ${a.knownFor}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  if (directors.length > 0) {
    html += `
      <div class="search-category-group">
        <h4><i class="fa-solid fa-video"></i> Directors (${directors.length})</h4>
        <div class="search-results-grid">
          ${directors.map(d => `
            <div class="search-result-card" onclick="window.location.href='movies.html?director=' + encodeURIComponent('${d.name}')">
              <img src="${d.image}" alt="${d.name}" style="border-radius: 50%;">
              <div class="search-result-info">
                <div class="search-result-title">${d.name}</div>
                <div class="search-result-sub">Director • ${d.knownFor}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

/* ==========================================================================
   Surprise Me Event Feature
   ========================================================================== */
let _lastSurprisePickId = null;

async function triggerSurpriseMe(filterType = "all") {
  // 1. Close ALL UI overlays and dropdowns
  document.querySelectorAll(".search-suggestions-dropdown.active").forEach(d => d.classList.remove("active"));
  const universalOverlay = document.getElementById("universal-search-overlay");
  if (universalOverlay) universalOverlay.classList.remove("active");
  const filterDrawer = document.getElementById("advanced-filter-drawer");
  if (filterDrawer) filterDrawer.style.display = "none";
  const gameDrawer = document.getElementById("advanced-game-filter-drawer");
  if (gameDrawer) gameDrawer.style.display = "none";
  const moodQuiz = document.getElementById("mood-quiz-modal");
  if (moodQuiz) moodQuiz.classList.remove("active");
  if (document.activeElement && typeof document.activeElement.blur === "function") {
    document.activeElement.blur();
  }

  // 2. Get disliked IDs so we can exclude them
  const dislikedIds = new Set(getDislikedIds());

  // 3. Build pool — try TMDB first for movies, fall back to local
  let pool = [];

  if (filterType === "movie" || filterType === "all") {
    // Try to get a fresh random page from TMDB discover
    let tmdbMovies = [];
    if (window.CinePlayAPIService) {
      try {
        const randomPage = Math.floor(Math.random() * 10) + 1;
        const res = await window.CinePlayAPIService.discoverTMDBMovies({
          sort_by: "popularity.desc",
          page: randomPage,
          "vote_count.gte": 200
        });
        if (res && res.results && res.results.length > 0) {
          tmdbMovies = res.results
            .map(m => window.CinePlayAPIService.normalizeMovie(m))
            .filter(Boolean)
            .filter(m => !dislikedIds.has(String(m.id)));
        }
      } catch (e) {
        console.warn("[SurpriseMe] TMDB discover failed, using local:", e);
      }
    }
    const moviesPool = tmdbMovies.length > 0 ? tmdbMovies : (window.moviesData || []).filter(m => !dislikedIds.has(String(m.id)));
    if (filterType === "movie") {
      pool = moviesPool;
    } else {
      pool.push(...moviesPool);
    }
  }

  if (filterType === "game" || filterType === "all") {
    const gamesPool = (window.gamesData || []).filter(g => !dislikedIds.has(String(g.id)));
    pool.push(...gamesPool);
  }

  if (pool.length === 0) {
    showToast("Finding something amazing for you...", "fa-dice");
    return;
  }

  // 4. Guarantee different pick each click
  let candidates = pool;
  if (pool.length > 1 && _lastSurprisePickId) {
    const filtered = pool.filter(item => String(item.id) !== String(_lastSurprisePickId));
    if (filtered.length > 0) candidates = filtered;
  }

  const randomPick = candidates[Math.floor(Math.random() * candidates.length)];
  _lastSurprisePickId = randomPick.id;

  const targetType = filterType === "movie" ? "movie" : (filterType === "game" ? "game" : (!randomPick.platform ? "movie" : "game"));

  showToast(`🎲 Tonight's Pick: ${randomPick.title}!`, "fa-dice-d20");

  setTimeout(() => {
    openDetailsModal(randomPick, targetType);
  }, 200);
}

/* ==========================================================================
   Dislike Learner System
   ========================================================================== */
const DISLIKES_KEY = "cineplay_dislikes";

/** Returns array of disliked item IDs (strings) */
function getDislikedIds() {
  const raw = JSON.parse(localStorage.getItem(DISLIKES_KEY) || "[]");
  return raw.map(entry => (typeof entry === "object" ? String(entry.id) : String(entry)));
}

/** Returns full disliked item objects for rendering cards */
function getDislikedItems() {
  const raw = JSON.parse(localStorage.getItem(DISLIKES_KEY) || "[]");
  return raw.filter(entry => typeof entry === "object" && entry.id);
}

/** Removes a specific item from the disliked list */
function removeDisliked(itemId) {
  const idStr = String(itemId);
  let raw = JSON.parse(localStorage.getItem(DISLIKES_KEY) || "[]");
  raw = raw.filter(entry => {
    const id = typeof entry === "object" ? String(entry.id) : String(entry);
    return id !== idStr;
  });
  localStorage.setItem(DISLIKES_KEY, JSON.stringify(raw));
  window.dispatchEvent(new Event("dislikesChanged"));
  if (window.CinePlayAuth && window.CinePlayAuth.isLoggedIn()) {
    window.CinePlayAuth.syncDislikesToCloud(raw);
  }
}

/** Adds item to disliked list — stores full mini object for the disliked tab */
function markAsDisliked(itemId, title, itemData = null) {
  const idStr = String(itemId);
  let raw = JSON.parse(localStorage.getItem(DISLIKES_KEY) || "[]");
  const exists = raw.some(entry => {
    const id = typeof entry === "object" ? String(entry.id) : String(entry);
    return id === idStr;
  });
  if (!exists) {
    let item = itemData || (window._cineItemRegistry ? window._cineItemRegistry[idStr] : null);
    if (!item) {
      const dataSet = window.moviesData || [];
      item = dataSet.find(i => String(i.id) === idStr);
    }
    const entry = {
      id: idStr,
      title: title || (item && item.title) || "Unknown",
      poster: (item && (item.poster || item.cover)) || "",
      rating: (item && (item.rating || item.tmdbRating)) || 0,
      year: (item && item.year) || "",
      type: (item && item.type) || (item && item.platform ? "game" : "movie"),
      genre: (item && (item.genre || item.genres)) || []
    };
    raw.push(entry);
    localStorage.setItem(DISLIKES_KEY, JSON.stringify(raw));
    window.dispatchEvent(new Event("dislikesChanged"));
    if (window.CinePlayAuth && window.CinePlayAuth.isLoggedIn()) {
      window.CinePlayAuth.syncDislikesToCloud(raw);
    }
  }
  showToast(`Got it. We'll show you fewer recommendations like "${title}".`, "fa-thumbs-down");
}

function renderSkeletonCardsHTML(count = 4) {
  return Array(count).fill(0).map(() => `
    <div class="skeleton-card">
      <div class="skeleton-box" style="height: 240px;"></div>
      <div class="skeleton-box" style="height: 20px; width: 80%;"></div>
      <div class="skeleton-box" style="height: 14px; width: 60%;"></div>
    </div>
  `).join("");
}

// Global exposes for detail modals in slides or cards
window.openFeaturedItem = function (id, explicitType = null) {
  const idStr = String(id);
  let item = window._cineItemRegistry ? window._cineItemRegistry[idStr] : null;
  const type = explicitType || (idStr.startsWith("g") ? "game" : "movie");
  if (!item) {
    const dataSet = type === "movie" ? window.moviesData : window.gamesData;
    item = dataSet ? dataSet.find(i => String(i.id) === idStr) : null;
  }
  if (item) {
    openDetailsModal(item, type);
  } else if (idStr.startsWith("tmdb_") && window.CinePlayAPIService) {
    const tmdbId = idStr.replace("tmdb_", "");
    showToast("Loading details…", "fa-spinner");
    CinePlayAPIService.getTMDBMovieDetails(tmdbId).then(data => {
      if (data) {
        const normalized = CinePlayAPIService.normalizeMovie(data);
        if (window._cineItemRegistry) window._cineItemRegistry[idStr] = normalized;
        openDetailsModal(normalized, "movie");
      }
    });
  }
};
// Unified namespace exports
window.CinePlay = {
  // UI Renderers
  renderMovies,
  renderGames,

  // Data Processors
  searchItems,
  filterByGenre,
  sortItems,
  getRecommendations,

  // Favorites State Hooks
  getFavorites,
  toggleFavorite,
  isFavorite,

  // Modal / Notifications / Trailers
  openDetailsModal,
  openFeaturedItem: window.openFeaturedItem,
  closeModal,
  openTrailerModal,
  openMovieTrailer,
  closeTrailerModal,
  openMoodQuizModal,
  closeMoodQuizModal,
  showToast,
  openUniversalSearch,
  closeUniversalSearch,
  triggerSurpriseMe,
  markAsDisliked,
  getDislikedIds,
  getDislikedItems,
  removeDisliked,
  renderSkeletonCardsHTML,

  // Fallbacks
  movieImgFallback,
  gameImgFallback,
  handleFavoriteAction,

  // Template HTML Generators
  createMovieCardHTML,
  createGameCardHTML,

  // History Tracker
  getRecentlyViewed,
  trackRecentlyViewed
};

// Expose API Client globally
window.CinePlayAPI = CinePlayAPI;

