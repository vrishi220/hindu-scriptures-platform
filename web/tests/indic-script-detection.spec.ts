import { test, expect } from "@playwright/test";
import { hasDevanagariLetters } from "../src/lib/indicScript";

test("does not classify IAST with danda punctuation as Devanagari", () => {
  expect(hasDevanagariLetters("sañjaya uvāca ।")).toBe(false);
  expect(hasDevanagariLetters("ācāryamupasaṅgamya rājā vacanamabravīt ।। 2।।")).toBe(false);
});

test("classifies Devanagari letters as Devanagari", () => {
  expect(hasDevanagariLetters("सञ्जय उवाच ।")).toBe(true);
  expect(hasDevanagariLetters("धर्मक्षेत्रे कुरुक्षेत्रे")).toBe(true);
});

test("danda-only content is not treated as Devanagari text", () => {
  expect(hasDevanagariLetters("।")).toBe(false);
  expect(hasDevanagariLetters("॥")).toBe(false);
});
