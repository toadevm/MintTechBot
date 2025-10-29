# Custom Emoji Guide (Telegram Premium Emojis)

This bot supports Telegram's custom emojis (premium animated emojis) for blockchain chains and other UI elements.

## How Custom Emojis Work

- **Premium users**: See animated custom emoji
- **Regular users**: See fallback emoji (standard Unicode emoji)
- **Format**: `<tg-emoji id="EMOJI_ID">fallback</tg-emoji>`

## Finding Custom Emoji IDs

### Method 1: Telegram Desktop/Web
1. Open Telegram Desktop or Web
2. Find a message with the custom emoji you want
3. Right-click the emoji → "Copy Emoji"
4. Paste - you'll get the ID

### Method 2: Bots
Use these Telegram bots to find emoji IDs:
- @CustomEmojiFinderBot
- @GetEmojiIDBot
- @CustomStickerBot

### Method 3: Sticker Pack Browser
1. Browse Telegram sticker packs with custom emojis
2. Use bot to extract emoji ID from pack

## Known Blockchain Emoji IDs

```javascript
// Ethereum
customEmojiId: '5368324170671202286'

// Bitcoin
customEmojiId: '5377323528904394915'

// Solana (varies by pack)
customEmojiId: '5431456798765432123' // Example

// Add more as you find them
```

## Adding Custom Emojis to Your Bot

### Step 1: Add to Chain Config

Edit `src/services/chainManager.js`:

```javascript
{
  name: 'ethereum',
  chainId: 1,
  displayName: 'Ethereum',
  currencySymbol: 'ETH',
  emoji: '🔷',
  customEmojiId: '5368324170671202286', // Add this line
  // ... rest of config
}
```

### Step 2: Use in Messages

The bot automatically uses custom emojis via `getChainEmoji()`:

```javascript
// This automatically uses custom emoji if available
const chainEmoji = this.chainManager.getChainEmoji('ethereum');
const message = `${chainEmoji} <b>Ethereum Network</b>`;

await ctx.replyWithHTML(message);
```

### Step 3: Manual Usage (if needed)

For custom emojis outside of chain configs:

```javascript
const customEmoji = '<tg-emoji id="5368324170671202286">🔷</tg-emoji>';
const message = `${customEmoji} <b>Special Message</b>`;

await ctx.replyWithHTML(message);
```

## Testing Custom Emojis

1. **Test with premium account**: You should see animated emoji
2. **Test with regular account**: You should see fallback emoji (🔷)
3. **Test in groups**: Custom emojis work in groups too

## Current Implementation

Currently implemented for:
- ✅ Ethereum (ID: 5368324170671202286)
- ✅ All chain displays in `/my_tokens`
- ✅ All chain displays throughout the bot

To add more chains:
1. Find the emoji ID using methods above
2. Add `customEmojiId` field to chain config in `chainManager.js`
3. No code changes needed - `getChainEmoji()` handles it automatically

## Resources

- [Telegram Bot API - Custom Emoji](https://core.telegram.org/bots/api#customemoji)
- [Telegram Stickers](https://t.me/addstickers/)
- Custom Emoji Finder Bot: @CustomEmojiFinderBot

## Notes

- Custom emoji IDs can change if the sticker pack is updated
- Always include a fallback emoji for non-premium users
- HTML parse mode is required: `parse_mode: 'HTML'`
- Works in messages, but NOT in button text (buttons don't support HTML)
