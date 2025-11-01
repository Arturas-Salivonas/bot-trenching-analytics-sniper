# eCobra Bot Helper

> **A powerful Chrome/Brave extension for enhanced Solana memecoin trading analytics and automation**

[![GitHub](https://img.shields.io/badge/GitHub-Source%20Code-blue?logo=github)](https://github.com/Arturas-Salivonas/bot-trenching-analytics-sniper)

eCobra Bot Helper is a comprehensive trading assistant that enhances your experience on Solana memecoin trading platforms with advanced analytics, filtering, and monitoring capabilities.

![alt text](https://github.com/Arturas-Salivonas/bot-trenching-analytics-sniper/blob/main/github-demo-images/1git.jpg "Admin name, followers on twittery, last coin 60 min ATH, Tag(group)")

![alt text](https://github.com/Arturas-Salivonas/bot-trenching-analytics-sniper/blob/main/github-demo-images/2git.jpg "Trenching settings #1")

![alt text](https://github.com/Arturas-Salivonas/bot-trenching-analytics-sniper/blob/main/github-demo-images/3git.jpg "Trenching settings #2")

![alt text](https://github.com/Arturas-Salivonas/bot-trenching-analytics-sniper/blob/main/github-demo-images/4git.jpg "Analytics settings")

![alt text](https://github.com/Arturas-Salivonas/bot-trenching-analytics-sniper/blob/main/github-demo-images/5git.jpg "ADMIN DATA")

![alt text](https://github.com/Arturas-Salivonas/bot-trenching-analytics-sniper/blob/main/github-demo-images/6git.jpg "Analytics - Admin tools")

![alt text](https://github.com/Arturas-Salivonas/bot-trenching-analytics-sniper/blob/main/github-demo-images/7git.jpg "Sniper settings")

![alt text](https://github.com/Arturas-Salivonas/bot-trenching-analytics-sniper/blob/main/github-demo-images/8git.jpg "Dex screener in the coin page shows status processing/approved/canceled + shows original or CTO + boost")

## 🌐 Supported Platforms

This extension works seamlessly on:
- **[padre.gg](https://trade.padre.gg)** - Full feature support
- **[axiom.trade](https://axiom.trade)** - Full feature support
- **[gmgn.ai](https://gmgn.ai)** - Full feature support

## ✨ Features

### 📊 Analytics Tab
Track and analyze all coins you've scanned with powerful filtering and sorting:
- **Comprehensive coin tracking** - Automatically scans and stores coin data from trading platforms
- **Admin/Developer insights** - View aggregated statistics by community admin/token creator
- **Advanced filtering**:
  - Search by coin name, symbol, or admin name
  - Filter by DEX approval status
  - Filter by minimum admin coin count
  - Filter by admin tags/categories
- **Multiple sorting options**:
  - Default (by discovery time)
  - By DEX approval speed
  - By highest ATH (All-Time High)
- **Admin tagging system** - Organize admins into custom categories:
  - Quick Migrate
  - Blacklist
  - Custom categories (create your own)
- **Export/Import functionality** - Backup and restore your entire database including settings
- **Performance optimized** - Virtual scrolling for large datasets (1000+ coins)

### 🎯 Trenching Tab
Enhance the trenching/trading interface with real-time information overlays:
- **Community link enhancements**:
  - Display admin names on community links
  - Show follower counts for communities
  - Display admin tags/categories with custom colors
  - Show admin's last 3 coins' average ATH with color coding
- **Admin history popup** - Quick view of admin's previous launches on individual coin pages
- **DEX status monitoring** - Real-time DEX approval status and boost monitoring
- **Customizable ATH color thresholds**:
  - Low threshold (default: <$40k) - Red
  - Mid threshold (default: <$60k) - Yellow
  - High (above mid threshold) - Green
- **Tag color customization** - Assign custom colors to each admin category for instant visual recognition

### 🎯 Sniper Tab
Automated filtering with browser notifications for new launches:
- **Multi-condition filtering** with OR/AND modes:
  - **Minimum followers** - Filter admins by follower count
  - **Average ATH** - Filter by admin's last 3 coins' average ATH
  - **Launch count range** - Target admins with specific experience levels
  - **Tag whitelist** - Only notify for specific admin categories
- **Real-time notifications** - Get instant browser alerts when coins match your criteria
- **Flexible logic** - Choose between OR mode (any condition) or AND mode (all conditions)
- **Tag-based filtering** - Allow only specific admin categories you trust

## 🚀 Installation

### Prerequisites
- Google Chrome or Brave browser
- Node.js 18+ and npm

### Build from Source

1. **Clone the repository**
   ```bash
   git clone https://github.com/Arturas-Salivonas/bot-trenching-analytics-sniper.git
   cd bot-trenching-analytics-sniper
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure RapidAPI (Required for Twitter community features)**

   See [SETUP.md](SETUP.md) for detailed instructions on obtaining your RapidAPI key.

   Then edit `src/lib/api/index.ts` and add your key:
   ```typescript
   'x-rapidapi-key': 'YOUR_API_KEY_HERE',
   ```

4. **Build the extension**
   ```bash
   npm run build
   ```

5. **Load in browser**
   - Open Chrome/Brave and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `dist` folder from the project directory

## 🔧 Configuration

### RapidAPI Setup
This extension requires a RapidAPI key for Twitter community data. See [SETUP.md](SETUP.md) for step-by-step instructions.

### First-Time Setup
1. Click the extension icon in your browser toolbar
2. Navigate to each tab to configure your preferences:
   - **Trenching**: Toggle features and customize colors
   - **Analytics**: Set up your filtering preferences
   - **Sniper**: Configure notification rules

### Data Storage
All data is stored locally in your browser using:
- **IndexedDB** - Coin records, admin data, and statistics
- **chrome.storage.sync** - Settings and preferences (synced across devices)

## 📖 Usage Guide

### Analytics Workflow
1. Visit any supported trading platform (padre.gg, axiom.trade, gmgn.ai)
2. Browse coins - they'll be automatically tracked
3. Open the extension and go to Analytics tab
4. Use filters and search to find interesting patterns
5. Tag admins into categories for future reference
6. Export your database periodically as backup

### Trenching Enhancements
1. Enable desired features in Trenching tab
2. Visit the trenching page on supported platforms
3. See enhanced information overlaid on community links:
   - Admin names and follower counts
   - Color-coded tags
   - Average ATH indicators
4. Click admin names for quick history popups

### Sniper Setup
1. Go to Sniper tab
2. Enable conditions you want to filter by
3. Set your thresholds (followers, ATH, launch count)
4. Choose OR mode (any condition) or AND mode (all conditions)
5. Grant notification permissions when prompted
6. Keep browser open to receive alerts for matching launches

## 🛠️ Development

### Development Mode
```bash
npm run dev
```
This starts the Vite dev server for rapid UI iteration. Rebuild for content script changes.

### Project Structure
```
├── src/
│   ├── background/     # Service worker for MV3
│   ├── content/        # Content scripts injected into pages
│   ├── popup/          # Extension popup UI (Svelte)
│   │   └── components/ # Tab components
│   ├── lib/            # Shared utilities
│   │   ├── db.ts       # IndexedDB (Dexie)
│   │   ├── storage.ts  # Chrome storage API
│   │   └── api/        # External API clients
│   └── overlay/        # Injected overlays
├── manifest.json       # Chrome extension manifest
└── vite.config.ts      # Build configuration
```

### Tech Stack
- **Framework**: Svelte + TypeScript
- **Build**: Vite
- **Storage**: Dexie (IndexedDB wrapper)
- **APIs**: Axios for HTTP requests
- **Charts**: Chart.js
- **Manifest**: Chrome Extension Manifest V3

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## 💝 Support the Developer

If you find this tool helpful, consider supporting the development:

**Solana Wallet**: `3ueu8X9QszUX1C4DZ4Z6u1eALLLk1EdzVMHPhbsA5pcw`

Every contribution helps maintain and improve this free tool. Thank you! 🙏

## 📜 License

This project is open source and available for personal and commercial use.

## 🔗 Links

- **Source Code**: [https://github.com/Arturas-Salivonas/bot-trenching-analytics-sniper](https://github.com/Arturas-Salivonas/bot-trenching-analytics-sniper)
- **Report Issues**: [GitHub Issues](https://github.com/Arturas-Salivonas/bot-trenching-analytics-sniper/issues)

## ⚠️ Disclaimer

This tool is for informational purposes only. Always do your own research (DYOR) before making any trading decisions. Cryptocurrency trading carries significant risk.

---

Built with ❤️ for the Solana memecoin community
