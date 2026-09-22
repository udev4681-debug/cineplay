# 🎬 CinePlay — Movie & Game Matchmaker Portal

<p align="center">
  <img src="https://img.shields.io/badge/BCA%20Mini%20Project-Grade%20A%2B-e50914?style=for-the-badge&logo=codeforces&logoColor=white" alt="BCA Mini Project">
  <img src="https://img.shields.io/badge/Frontend-HTML5%20%7C%20CSS3%20%7C%20JS%20ES6%2B-ffd54f?style=for-the-badge&logo=javascript&logoColor=black" alt="Frontend Stack">
  <img src="https://img.shields.io/badge/Architecture-Decoupled%20MVC-00b0ff?style=for-the-badge&logo=dependabot&logoColor=white" alt="Architecture">
  <img src="https://img.shields.io/badge/Database-MySQL%20Ready-00758f?style=for-the-badge&logo=mysql&logoColor=white" alt="MySQL Ready">
  <img src="https://img.shields.io/badge/APIs-IMDb%20%7C%20TMDB%20%7C%20RAWG-ff6f00?style=for-the-badge&logo=themoviedatabase&logoColor=white" alt="APIs">
</p>

<p align="center">
  <b>A professional-grade entertainment discovery platform built with semantic HTML5, modular CSS3, and ES6+ JavaScript.</b><br>
  Inspired by Netflix · Steam · IMDb &nbsp;|&nbsp; Glassmorphic Dark UI · Interactive Mood Quiz · TMDB/RAWG API & MySQL Ready
</p>

---

## ✨ Project Overview

> **Stop Endless Scrolling on Streaming Platforms.** CinePlay uses an interactive mood/vibe recommendation engine to instantly match users with movies and games tailored to their exact mood, time of day, viewing partner, and available time.

Built as a **BCA (Bachelor of Computer Applications) Mini Project**, CinePlay demonstrates advanced frontend engineering practices including decoupled data-UI architecture, async API simulation, glassmorphism, responsive design, and local storage state hooks.

| Aspect | Details |
|---|---|
| **Project Type** | BCA Semester Mini Project |
| **Tech Approach** | Modular Vanilla JS, CSS3 Glassmorphism, Semantic HTML5 |
| **Design Theme** | Dark glassmorphism + Cinema Red (`#e50914`) & Amber (`#ffd54f`) accents |
| **Offline Support** | ✅ Fully functional locally with offline datasets |
| **API & DB Ready** | ✅ Blueprint ready for IMDb / TMDB / RAWG APIs & MySQL Database |
| **Responsive** | ✅ Widescreen (1440px+) $\rightarrow$ Desktop $\rightarrow$ Tablet $\rightarrow$ Mobile (375px) |
| **Pages** | 6 fully functional HTML pages |

---

## 🌟 Key Features

- 🍿 **Interactive Initial-Load Mood Quiz ("Anti-Scroll Popup")**: A 4-step wizard calculating custom recommendation match percentages (e.g., 99% match) with rationale badges (*"Perfect for Date Night Prime Time Binge"*).
- 🎬 **HD YouTube Trailer Player & Modal**: Integrated video player modal overlay with direct **Watch on YouTube ↗** links.
- 📺 **Streaming Availability Badges**: Real-time badges indicating where titles are streaming (Netflix, HBO Max, Prime Video, Apple TV+).
- ❤️ **Watchlist & Favorites System**: Synced with local storage & glassmorphic toast notifications.
- 🔍 **Live Search Auto-Suggestions**: Real-time dropdown search preview with movie thumbnails, star ratings, and genres.
- 🎨 **Modern Glassmorphic UI**: HSL color tokens, smooth CSS keyframes, card shimmer skeleton loaders, and responsive layouts.

---

## 🚀 Quick Start (Local Setup)

> **One command to launch the entire platform locally:**

```bash
# Step 1: Navigate to the project root directory
cd cineplay

# Step 2: Start the development server
python run_server.py

# Step 3: Open your browser automatically at:
# 👉 http://localhost:8000/
```

---

## 🚀 Phase 2 Technical Blueprint: API Sync, MySQL Database & Recommendation Engine

This blueprint documents how to expand CinePlay with live IMDb/Streaming APIs, a MySQL database backend, and enhanced AI recommendation accuracy.

---

### 1. 📡 IMDb & Streaming Data API Integration

To replace offline datasets with real-time data from IMDb, TMDB, RAWG, and streaming providers:

#### A. Recommended API Providers:
1. **TMDB API (The Movie Database)** (Movies/TV metadata, backdrops, YouTube trailers)
   - Docs: [https://developer.themoviedb.org](https://developer.themoviedb.org)
2. **OMDb / IMDb API** (IMDb ratings, Metascores, awards)
   - Docs: [http://www.omdbapi.com](http://www.omdbapi.com)
3. **RAWG Video Games API** (Game catalog, platforms, screenshots)
   - Docs: [https://rawg.io/apidocs](https://rawg.io/apidocs)
4. **WatchMode / JustWatch API** (Streaming platform availability: Netflix, Prime Video, Disney+, etc.)
   - Docs: [https://api.watchmode.com](https://api.watchmode.com)

#### B. API Fetch & Processing Example (Node.js / Express):

```javascript
// backend/services/tmdbService.js
const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE_URL = 'https://api.themoviedb.org/3';

async function fetchTrendingMovies() {
  try {
    const response = await axios.get(`${BASE_URL}/trending/movie/week`, {
      params: { api_key: TMDB_API_KEY }
    });
    
    // Fetch video trailer and streaming provider for each movie
    const enrichedMovies = await Promise.all(response.data.results.map(async (movie) => {
      const videos = await axios.get(`${BASE_URL}/movie/${movie.id}/videos`, { params: { api_key: TMDB_API_KEY } });
      const providers = await axios.get(`${BASE_URL}/movie/${movie.id}/watch/providers`, { params: { api_key: TMDB_API_KEY } });
      
      const trailer = videos.data.results.find(v => v.type === 'Trailer' && v.site === 'YouTube');
      
      return {
        imdb_id: movie.id,
        title: movie.title,
        poster: `https://image.tmdb.org/t/p/w500${movie.poster_path}`,
        backdrop: `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}`,
        rating: movie.vote_average,
        year: new Date(movie.release_date).getFullYear(),
        description: movie.overview,
        trailer_id: trailer ? trailer.key : null,
        streaming_providers: providers.data.results?.US?.flatrate?.map(p => p.provider_name) || []
      };
    }));
    
    return enrichedMovies;
  } catch (error) {
    console.error('TMDB Fetch Error:', error.message);
  }
}
```

---

### 2. 🗄️ MySQL Database Architecture & DDL Schema

To store user accounts, custom watchlists, ratings, and cached movie metadata:

#### A. Database Schema (`schema.sql`):

```sql
CREATE DATABASE IF NOT EXISTS cineplay_db;
USE cineplay_db;

-- 1. Users Table (Authentication & Accounts)
CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. User Preferences (For AI Recommendation Accuracy)
CREATE TABLE IF NOT EXISTS user_preferences (
    preference_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    favorite_genres JSON,
    preferred_mood VARCHAR(50) DEFAULT 'Action-packed',
    preferred_time_of_day VARCHAR(30) DEFAULT 'Night',
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 3. Movies Cache Table (Synced from IMDb / TMDB)
CREATE TABLE IF NOT EXISTS movies (
    movie_id VARCHAR(50) PRIMARY KEY, -- TMDB / IMDb ID
    title VARCHAR(255) NOT NULL,
    poster_url TEXT,
    backdrop_url TEXT,
    rating DECIMAL(3,1),
    release_year INT,
    runtime_minutes INT,
    description TEXT,
    trailer_youtube_id VARCHAR(50),
    genres JSON,
    mood_tags JSON,
    streaming_providers JSON,
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 4. User Watchlist / Favorites Table
CREATE TABLE IF NOT EXISTS watchlist (
    watchlist_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    media_id VARCHAR(50) NOT NULL,
    media_type ENUM('movie', 'game') NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_media (user_id, media_id, media_type)
);
```

#### B. Node.js MySQL Connection Pool Example (`db.js`):

```javascript
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'secret',
  database: process.env.DB_NAME || 'cineplay_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;
```

---

### 3. 🎯 Recommendation Engine & Scoring Algorithm

CinePlay calculates recommendations using a weighted multi-factor scoring formula:

$$\text{Score} = (W_{\text{mood}} \cdot S_{\text{mood}}) + (W_{\text{genre}} \cdot S_{\text{genre}}) + (W_{\text{era}} \cdot S_{\text{era}}) + (W_{\text{duration}} \cdot S_{\text{duration}})$$

#### Formula Weights:
- **Mood Compatibility ($W_{\text{mood}} = 40\%$)**: Matches mood tags (e.g. *Action-packed*, *Chill*, *Mind-Bending*).
- **Genre Alignment ($W_{\text{genre}} = 30\%$)**: User preferred genres.
- **Era Match ($W_{\text{era}} = 20\%$)**: Classic (<2010), Golden (2010-2019), Modern (2020+).
- **Duration / Time Slot ($W_{\text{duration}} = 10\%$)**: Adjusts according to user's time limit (<90m, 2h, 2.5h+).

---

## 🛠️ Project Structure

```
cineplay/
├── index.html              # Main Landing Page with Anti-Scroll Callout & Hero Slider
├── movies.html             # Movies Catalog & Filters
├── games.html              # Games Catalog & Filters
├── recommendations.html    # Standalone Recommendation Engine Page
├── favorites.html          # User Watchlist & Favorites Page
├── about.html              # Project Info & Tech Stack
├── css/
│   ├── style.css           # Core Design Tokens & Glassmorphism Rules
│   ├── animations.css      # Keyframes, Shimmer Skeletons, Glow Effects
│   └── responsive.css      # Mobile, Tablet & Widescreen Responsive Rules
├── js/
│   ├── data.js             # Enriched Local Datasets (IMDb, Trailers, Streaming)
│   ├── app.js              # Global Application & Modal Controllers
│   ├── recommendation.js   # Recommendation Algorithm Logic
│   └── favorites.js        # Watchlist State Hooks
├── run_server.py           # Python Local HTTP Server Launcher
└── README.md               # Complete Project Documentation & Blueprint
```

---

## 🌐 Production Deployment Guide (GitHub Pages & Vercel)

### Option 1: Automatic Deployment via Git Push (Recommended)
```bash
# 1. Stage all files
git add .

# 2. Commit changes
git commit -m "feat: UI overhaul, mood quiz modal, trailer fixes, and clean README"

# 3. Push to main branch
git push origin main
```
- **GitHub Pages**: Automatically builds and deploys to `https://<username>.github.io/cineplay/` within 1–2 minutes.
- **Vercel**: Instantly deploys a new production build to `https://cineplay.vercel.app`.

### Option 2: Forking & Sending a Pull Request (Collaborator Workflow)
If pushing to a repository you forked:
1. Set remote to your fork:
   ```bash
   git remote set-url origin https://github.com/Armancle/cineplay.git
   git push -u origin main
   ```
2. Open `https://github.com/Armancle/cineplay` in your browser.
3. Click **Contribute** $\rightarrow$ **Open Pull Request** to submit your updates to the main repository.

---

<p align="center">
  Made with ❤️ as a BCA Mini Project<br>
  Powered by <b>HTML5 · CSS3 · Vanilla ES6+ JavaScript</b><br>
  Inspired by Netflix · Steam · IMDb
</p>
