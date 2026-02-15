# URL Navigation Examples

## Quick Examples

### Example 1: Share a Bhagavad Gita Verse
**User Action**: Select Bhagavad Gita, then select "Verse 1" from Chapter 1  
**URL Generated**: `http://localhost:3000/scriptures?book=1&node=5`  
**What Happens When Shared**:
1. Recipient opens the link
2. Bhagavad Gita (Book #1) automatically loads
3. Tree expands to show Chapter 1
4. Verse 1 is selected and highlighted
5. Full verse content displays on the right

### Example 2: Share a Ramayana Canto
**User Action**: Select Ramayana, navigate to Canto 2  
**URL Generated**: `http://localhost:3000/scriptures?book=2&node=15`  
**What Happens**: 
1. Recipient sees Ramayana Kanda selected
2. Canto 2 is auto-expanded
3. All verses in that canto visible in tree
4. Node #15 is highlighted

### Example 3: Email a Reference
**Scenario**: You want to email a colleague about a specific verse

**Before (Without URL Navigation)**:
> "Check out the Bhagavad Gita, Chapter 2. You need to manually find it."

**After (With URL Navigation)**:
> "Here's the exact verse I was referring to: http://localhost:3000/scriptures?book=1&node=42"
> 
> Recipient clicks link → exact verse loads → perfect reference

---

## Use Cases

### Academic Referencing
```markdown
As mentioned in the Bhagavad Gita:
http://localhost:3000/scriptures?book=1&node=42

Students can click the link and see the exact verse in context.
```

### Social Media Sharing
```
📚 Just found this beautiful verse from the Ramayana:
http://localhost:3000/scriptures?book=2&node=28

Share with friends and they'll see the same verse you're looking at!
```

### Documentation
```html
<p>See reference in the <a href="/scriptures?book=1&node=5">Bhagavad Gita, Chapter 1, Verse 1</a></p>
```

### Chat/Messaging
```
Friend 1: What's that verse about duty?
Friend 2: This one: /scriptures?book=1&node=42
Friend 1: *clicks link* Oh yes, that's perfect!
```

### Personal Collection
```
My favorite verses:
- Gita on Courage: /scriptures?book=1&node=42
- Ramayana on Dharma: /scriptures?book=2&node=15
- Upanishad on Knowledge: /scriptures?book=3&node=8
```

---

## URL Construction Guide

### Build a URL Manually
1. Find your book ID in the dropdown
2. Select the verse, note its ID
3. Construct: `/scriptures?book=[BOOK_ID]&node=[NODE_ID]`

### Quick Reference
```
Bhagavad Gita
  Chapter 1, Verse 1    → /scriptures?book=1&node=5
  Chapter 2, Verse 47   → /scriptures?book=1&node=42
  Chapter 3, Verse 2    → /scriptures?book=1&node=65

Ramayana Kanda 1
  Canto 1, Verse 3      → /scriptures?book=2&node=8
  Canto 2, Verse 1      → /scriptures?book=2&node=12
  Canto 3, Verse 2      → /scriptures?book=2&node=20
```

---

## Sharing Methods

### Method 1: Copy Button (Easiest)
1. Select a verse in the scripture browser
2. Click the blue **"🔗 Copy link"** button in the breadcrumb
3. Paste anywhere (email, chat, social media)
4. ✅ Done! Full URL copied

### Method 2: Manual Copy
1. Select a verse
2. Look at the browser address bar
3. Copy the URL: `http://localhost:3000/scriptures?book=1&node=42`
4. Share it

### Method 3: Generate Link
```javascript
// In your JavaScript code
const url = `/scriptures?book=${bookId}&node=${nodeId}`;
window.open(url, '_blank');
```

---

## What Gets Shared?

### Shareable URL Example
```
/scriptures?book=1&node=42
```

### Breaks Down To:
- **Book**: #1 (Bhagavad Gita)
- **Node**: #42 (Specific verse)
- **Path**: /scriptures (Scripture browser page)

### Full URL
```
http://localhost:3000/scriptures?book=1&node=42
                     ↑            ↑    ↑   ↑  ↑
                    Domain       Path  Params
```

---

## Real-World Scenario

### Scenario: Classroom Teaching

**Teacher's Experience**:
1. Prepares lesson on "Duty and Dharma"
2. Finds relevant Bhagavad Gita verses
3. For each verse:
   - Selects it in the scripture browser
   - Clicks "🔗 Copy link"
   - Pastes into lesson plan document

**Result**: Lesson plan with live links to all verses

**Student's Experience**:
1. Receives lesson plan with links
2. Clicks on verse link
3. Exact verse loads in scripture browser
4. Can read in context with full tree visible
5. Can explore related verses in same book

---

## URL Patterns Reference

| Pattern | Example | Result |
|---------|---------|--------|
| No params | `/scriptures` | Book selector, empty |
| Book only | `/scriptures?book=1` | Book 1 loaded, tree expanded |
| Book + Node | `/scriptures?book=1&node=42` | Book 1, Node 42 selected & auto-loaded |
| Invalid node | `/scriptures?book=1&node=999` | Book 1 loads, node ignored (doesn't exist) |

---

## Tips for Power Users

💡 **Tip 1**: Create a bookmark folder with your favorite verses
```
Bookmarks
├── Duty (Gita 2.47): /scriptures?book=1&node=42
├── Compassion (Rama 1.3): /scriptures?book=2&node=8
└── Truth (Upanishad 2.5): /scriptures?book=3&node=15
```

💡 **Tip 2**: Use in your email signature
```
Best regards,
John Doe
"The mind is like water" - Bhagavad Gita /scriptures?book=1&node=42
```

💡 **Tip 3**: Create a collection in a document
```markdown
# Important Verses on Truth

1. Bhagavad Gita on Satya: /scriptures?book=1&node=42
2. Ramayana on Honesty: /scriptures?book=2&node=15
3. Upanishad on Reality: /scriptures?book=3&node=8
```

💡 **Tip 4**: Use in footnotes
```html
<p>As stated in the ancient texts<sup><a href="/scriptures?book=1&node=42">1</a></sup></p>
```

---

## Demo URLs

Ready to try? Use these demo URLs:

```
Single book view:
http://localhost:3000/scriptures?book=1

Book with verse selected:
http://localhost:3000/scriptures?book=1&node=5

Different book:
http://localhost:3000/scriptures?book=2

Try sharing these links in your browser!
```

---

## Frequently Asked Questions

**Q: Can I create a shortened URL?**  
A: Not built-in, but you can use URL shorteners (bit.ly, tinyurl) with the full URL

**Q: Will the link work for others?**  
A: Yes! As long as they have access to that book and node

**Q: Can I modify the parameters?**  
A: Yes! Edit book= or node= numbers in the URL directly

**Q: What if the node doesn't exist?**  
A: The book loads but the invalid node is silently ignored (graceful fallback)

---

**Ready to share? Try it now! 🔗**
