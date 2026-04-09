import { renderHook, act, waitFor } from '@testing-library/react';
import { useScripturesBrowse } from '../useScripturesBrowse';

describe('useScripturesBrowse', () => {
  beforeEach(() => {
    // Mock fetch for testing
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initial state', () => {
    it('should initialize with correct default state', () => {
      const { result } = renderHook(() => useScripturesBrowse());

      expect(result.current.books).toEqual([]);
      expect(result.current.bookQuery).toBe('');
      expect(result.current.bookHasMore).toBe(true);
      expect(result.current.bookLoadingMore).toBe(false);
      expect(result.current.bookId).toBeNull();
      expect(result.current.currentBook).toBeNull();
      expect(result.current.treeData).toEqual([]);
      expect(result.current.treeLoading).toBe(false);
      expect(result.current.treeError).toBeNull();
      expect(result.current.expandedIds).toEqual(new Set());
      expect(result.current.selectedId).toBeNull();
      expect(result.current.privateBookGate).toBe(false);
      expect(result.current.urlInitialized).toBe(false);
      expect(result.current.breadcrumb).toEqual([]);
    });

    it('should accept custom config', () => {
      const mockRef = { current: null };
      const { result } = renderHook(() =>
        useScripturesBrowse({
          bookBrowserDensity: 3,
          authEmail: 'test@example.com',
          booksScrollContainerRef: mockRef,
        })
      );

      // State should still be initialized correctly
      expect(result.current.books).toEqual([]);
    });
  });

  describe('Book loading', () => {
    it('should load books successfully', async () => {
      const mockBooks = [
        { id: 1, title: 'Book 1', slug: 'book-1', visibility: 'public' as const },
        { id: 2, title: 'Book 2', slug: 'book-2', visibility: 'private' as const },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockBooks,
      });

      const { result } = renderHook(() => useScripturesBrowse());

      await act(async () => {
        await result.current.loadBooksPage({ reset: true });
      });

      expect(result.current.books).toEqual(mockBooks);
      expect(result.current.bookHasMore).toBe(false);
    });

    it('should handle book search query', async () => {
      const mockBooks = [{ id: 1, title: 'Gita', slug: 'gita', visibility: 'public' as const }];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockBooks,
      });

      const { result } = renderHook(() => useScripturesBrowse());

      act(() => {
        result.current.setBookQuery('Gita');
      });

      await act(async () => {
        await result.current.loadBooks();
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('q=Gita'),
        expect.any(Object)
      );
    });

    it('should handle loading errors gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useScripturesBrowse());

      await act(async () => {
        await result.current.loadBooksPage({ reset: true });
      });

      expect(result.current.books).toEqual([]);
      expect(result.current.bookHasMore).toBe(false);
    });

    it('should support pagination with loadBooksPage', async () => {
      const page1 = [
        { id: 1, title: 'Book 1', slug: 'book-1', visibility: 'public' as const },
      ];
      const page2 = [
        { id: 2, title: 'Book 2', slug: 'book-2', visibility: 'public' as const },
      ];

      // First page
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => page1,
      });

      const { result } = renderHook(() => useScripturesBrowse());

      await act(async () => {
        await result.current.loadBooksPage({ reset: true });
      });

      expect(result.current.books).toEqual(page1);
      expect(result.current.bookHasMore).toBe(false); // page1 has 1 item, default page size is 20

      // Second page
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => page2,
      });

      await act(async () => {
        await result.current.loadBooksPage();
      });

      expect(result.current.books).toEqual([...page1, ...page2]);
    });
  });

  describe('Tree navigation', () => {
    it('should load tree for selected book', async () => {
      const mockTreeData = [
        { id: 1, text: 'Chapter 1', children: [] },
        { id: 2, text: 'Chapter 2', children: [] },
      ];

      const mockBookDetails = {
        id: 1,
        title: 'Book 1',
        slug: 'book-1',
        visibility: 'public' as const,
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockBookDetails,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTreeData,
        });

      const { result } = renderHook(() => useScripturesBrowse());

      await act(async () => {
        await result.current.loadTree('1');
      });

      expect(result.current.treeData).toEqual(mockTreeData);
      expect(result.current.currentBook).toEqual(mockBookDetails);
      expect(result.current.selectedId).toBe(1);
    });

    it('should gate private books for anonymous users', async () => {
      const mockBooks = [
        { id: 1, title: 'Private Book', slug: 'private', visibility: 'private' as const },
      ];

      const { result } = renderHook(() =>
        useScripturesBrowse({ authEmail: null })
      );

      // Set up books first
      act(() => {
        result.current.setBooks(mockBooks);
      });

      await act(async () => {
        await result.current.loadTree('1');
      });

      expect(result.current.privateBookGate).toBe(true);
      expect(result.current.treeData).toEqual([]);
    });

    it('should allow authenticated users to load private books', async () => {
      const mockTreeData = [{ id: 1, text: 'Content', children: [] }];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => mockTreeData });

      const { result } = renderHook(() =>
        useScripturesBrowse({ authEmail: 'user@example.com' })
      );

      await act(async () => {
        await result.current.loadTree('1');
      });

      expect(result.current.privateBookGate).toBe(false);
    });

    it('should handle tree loading errors', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ detail: 'Server error' }),
        });

      const { result } = renderHook(() => useScripturesBrowse());

      await act(async () => {
        await result.current.loadTree('1');
      });

      expect(result.current.treeError).toBe('Server error');
    });
  });

  describe('Node expansion', () => {
    it('should toggle node expansion', () => {
      const { result } = renderHook(() => useScripturesBrowse());

      act(() => {
        result.current.toggleNode(1);
      });

      expect(result.current.expandedIds.has(1)).toBe(true);

      act(() => {
        result.current.toggleNode(1);
      });

      expect(result.current.expandedIds.has(1)).toBe(false);
    });

    it('should support multiple expanded nodes', () => {
      const { result } = renderHook(() => useScripturesBrowse());

      act(() => {
        result.current.toggleNode(1);
        result.current.toggleNode(2);
        result.current.toggleNode(3);
      });

      expect(result.current.expandedIds.has(1)).toBe(true);
      expect(result.current.expandedIds.has(2)).toBe(true);
      expect(result.current.expandedIds.has(3)).toBe(true);
    });
  });

  describe('Book refresh', () => {
    it('should reset pagination on refresh', async () => {
      const mockBooks = [
        { id: 1, title: 'Book 1', slug: 'book-1', visibility: 'public' as const },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockBooks,
      });

      const { result } = renderHook(() => useScripturesBrowse());

      // Load initial books
      await act(async () => {
        await result.current.loadBooksPage({ reset: true });
      });

      // Refresh should call with reset: true
      await act(async () => {
        await result.current.loadBooksRefresh();
      });

      expect(result.current.books).toEqual(mockBooks);
    });
  });

  describe('Cleanup', () => {
    it('should abort pending requests on unmount', () => {
      (global.fetch as jest.Mock).mockImplementationOnce(
        () => new Promise(() => {}) // Never resolves
      );

      const abortSpy = jest.spyOn(AbortController.prototype, 'abort');
      const { unmount } = renderHook(() => useScripturesBrowse());

      unmount();

      expect(abortSpy).toHaveBeenCalled();
      abortSpy.mockRestore();
    });
  });
});
