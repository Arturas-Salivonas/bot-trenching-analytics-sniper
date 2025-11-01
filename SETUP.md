# RapidAPI Setup Guide

This extension requires a RapidAPI key to fetch Twitter community information (admin names, follower counts, etc.). Follow this guide to get your free API key.

## Why is RapidAPI needed?

The extension uses the Twitter API through RapidAPI to:
- Display admin/creator names on community links
- Show follower counts for Twitter communities
- Enrich coin data with social metrics

## Step-by-Step Setup

### 1. Create a RapidAPI Account

1. Go to [https://rapidapi.com/](https://rapidapi.com/)
2. Click **"Sign Up"** in the top right corner
3. Sign up using:
   - Email and password, or
   - Google account, or
   - GitHub account

### 2. Subscribe to the Twitter API

1. Once logged in, go to the Twitter API page:
   - Visit: [https://rapidapi.com/huangsf01/api/twitter283](https://rapidapi.com/huangsf01/api/twitter283)
   - Or search for "twitter283" in the RapidAPI marketplace

2. Click the **"Subscribe to Test"** button

3. Choose the **FREE plan** (Basic):
   - 500 requests per month
   - No credit card required
   - Perfect for personal use

4. Click **"Subscribe"** to activate the free plan

### 3. Get Your API Key

1. After subscribing, you'll be on the API's main page
2. Look for the **"X-RapidAPI-Key"** in the code snippets section
3. Your API key will look something like:
   ```
   e76f83e0e4mshb27c10a4ef16362p13578bjsne66720c28b53
   ```
4. Copy this key to your clipboard

### 4. Add the API Key to the Extension

1. Open the project folder in your code editor
2. Navigate to: `src/lib/api/index.ts`
3. Find line 54 where it says:
   ```typescript
   'x-rapidapi-key': '', // Add your RapidAPI key here
   ```
4. Paste your API key between the quotes:
   ```typescript
   'x-rapidapi-key': 'YOUR_API_KEY_HERE',
   ```
5. Save the file

### 5. Rebuild the Extension

After adding your API key, rebuild the extension:

```bash
npm run build
```

Then reload the extension in your browser:
1. Go to `chrome://extensions/`
2. Find "eCobra Bot Helper"
3. Click the refresh icon 🔄

## Free Tier Limits

The free RapidAPI plan includes:
- **500 requests per month**
- **No credit card required**
- **Auto-renewal** (stays free)

### What counts as a request?
- Each time the extension fetches community info for a new admin
- Results are cached, so the same admin won't use multiple requests

### What if I hit the limit?
- The extension will continue to work
- Twitter community features (admin names, follower counts) will be unavailable until next month
- All other features (Analytics, Sniper, ATH tracking) continue to work normally

## Upgrading (Optional)

If you need more than 500 requests per month, RapidAPI offers paid plans:
- **Pro Plan**: 10,000 requests/month for ~$10
- **Ultra Plan**: 100,000 requests/month for ~$30

Most users will be fine with the free plan.

## Troubleshooting

### "Invalid API Key" Error
- Make sure you copied the entire key (no spaces before/after)
- Verify you're subscribed to the Twitter283 API on RapidAPI
- Try logging out and back into RapidAPI, then copy the key again

### "Rate Limited" Error
- You've used your 500 free requests for this month
- Wait until next month for the quota to reset
- Or upgrade to a paid plan if needed

### Features Not Working
- Make sure you rebuilt the extension after adding the key (`npm run build`)
- Reload the extension in Chrome
- Check the browser console (F12) for any error messages

## Security Note

⚠️ **Important**:
- Never commit your API key to a public repository
- The `.gitignore` file is configured to prevent this
- If you accidentally expose your key, regenerate it on RapidAPI

---

## Alternative: Running Without RapidAPI

If you prefer not to use RapidAPI, the extension will still work! The following features will be unavailable:
- Admin/creator names on community links
- Follower counts

These features will remain fully functional:
- Analytics tracking and filtering
- Sniper notifications
- ATH calculations and color coding
- Admin tagging system
- Export/Import functionality
- All other trenching enhancements

Simply leave the API key as an empty string `''` and build the extension.

---

Need help? [Open an issue on GitHub](https://github.com/Arturas-Salivonas/bot-trenching-analytics-sniper/issues)
