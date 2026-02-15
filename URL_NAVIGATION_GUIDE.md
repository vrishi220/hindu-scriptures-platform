# URL-Based Navigation for Scripture Browser

## Overview

The scripture browser now supports URL-based navigation, allowing you to share direct links to specific books and verses. This makes it easy to bookmark, share, and reference particular scriptures.

## URL Patterns

### Link to a specific book
```
/scriptures?book=1
```
Opens the scripture browser with Book #1 selected and its tree expanded.

### Link to a specific verse/node
```
/scriptures?book=1&node=42
```
Opens Book #1 and automatically expands the tree to show and select verse/node #42, displaying its full content.

## How to Use

### Sharing a Link

1. **Navigate to a verse**: Select any book and verse in the scripture browser
2. **Copy the link**: Click the **"🔗 Copy link"** button that appears in the breadcrumb area
3. **Share**: The entire URL (including book and node parameters) is copied to your clipboard
4. **Recipients**: Anyone with the link can directly access that specific verse

### Manual URL Entry

You can also manually construct URLs:

**Browser path**: `http://localhost:3000/scriptures`  
**With parameters**: `http://localhost:3000/scriptures?book=1&node=42`

Replace:
- `1` with your desired **book ID**
- `42` with your desired **node ID** (verse/chapter)

### URL Updates

The URL automatically updates as you navigate:
- Selecting a different book updates the URL to show `?book=X`
- Selecting a different verse adds `&node=Y` to the URL
- Clicking breadcrumb items updates the URL accordingly

## Features

✅ **Shareable Links**: Copy URL button for easy sharing  
✅ **Deep Linking**: Direct access to specific verses  
✅ **Bookmarkable**: Save your favorite verses  
✅ **Browser History**: Works with back/forward navigation  
✅ **URL Auto-Update**: URL changes reflect current selection  
✅ **Auto-Selection**: Page loads and auto-selects node from URL parameters  

## Examples

### Share a Bhagavad Gita verse
```
/scriptures?book=1&node=5
```
Opens Bhagavad Gita (Book #1) and shows verse node #5

### Share a Ramayana canto
```
/scriptures?book=2&node=3
```
Opens Ramayana (Book #2) with node #3 selected

### Share just the book
```
/scriptures?book=1
```
Opens Bhagavad Gita with the tree expanded but no specific verse selected

## Technical Implementation

The feature uses:
- **Next.js Router**: `useRouter()` for URL updates
- **Search Params**: `useSearchParams()` to read URL parameters
- **State Management**: Syncs URL parameters with component state
- **Browser Storage**: Uses URL as single source of truth for navigation

## Browser Support

✅ Works with all modern browsers:
- Chrome/Chromium
- Firefox
- Safari
- Edge

## URL Parameter Reference

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `book` | number | Book ID to display | `?book=1` |
| `node` | number | Node/Verse ID to select | `?node=42` |

Both parameters are optional:
- No parameters: Shows scripture selector, no book loaded
- Only `book`: Shows book with tree, no specific node selected
- Both: Shows book with specific node auto-selected

## Tips

💡 **Pro Tip 1**: Use the copy link button in the breadcrumb area for one-click sharing  
💡 **Pro Tip 2**: Bookmark URL with both book and node for quick access to favorite verses  
💡 **Pro Tip 3**: URL persists across page refreshes, so you can reload and stay in the same location  
💡 **Pro Tip 4**: Use query parameters in email signatures or documentation to reference specific verses  

## Troubleshooting

**Q: The URL shows parameters but the node doesn't load**  
A: Make sure the node ID exists in that book. Invalid node IDs are silently ignored.

**Q: Copy link button doesn't appear**  
A: The button only appears when a specific node is selected. Select a verse first.

**Q: URL parameters aren't changing when I navigate**  
A: Ensure JavaScript is enabled. The URL updates happen client-side via the Next.js router.

**Q: Old bookmarks with different book IDs don't work**  
A: Book IDs may change if the database is reset. You'll need to find the correct book ID in the selector.

## Accessibility

The URL navigation is fully accessible:
- Works with keyboard navigation
- Screen readers announce the copy link button
- URL changes are announced to assistive tech
- Breadcrumb navigation remains keyboard accessible

## Future Enhancements

Possible additions:
- Social share buttons (Twitter, Facebook, WhatsApp)
- QR codes for mobile sharing
- URL shortener integration
- Deep links in footnotes/cross-references
- Share via email with pre-formatted message
