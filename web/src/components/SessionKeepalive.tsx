"use client";
import { useEffect } from "react";

// Extend the Window interface to include our singleton property
declare global {
  interface Window {
    __sessionKeepaliveInitialized?: boolean;
  }
}

export default function SessionKeepalive() {
  useEffect(() => {
    // Singleton guard (window-scoped)
    if (typeof window === "undefined" || window.__sessionKeepaliveInitialized) return;
    console.log("Initializing session keepalive");
    window.__sessionKeepaliveInitialized = true;
    let lastActivity = Date.now();
    const idleTimeoutMs = 30 * 60 * 1000; // 30 min
    const keepaliveMs = 0.5 * 60 * 1000; // 0.5 min
    const activityEvents = ["mousemove", "keydown", "scroll", "click", "touchstart"];
    const onActivity = () => {
      lastActivity = Date.now();
    };
    activityEvents.forEach(evt => window.addEventListener(evt, onActivity));
    const keepalive = async () => {
      console.log("Sending keepalive ping");
      if (Date.now() - lastActivity < idleTimeoutMs) {
        fetch("/api/me", { credentials: "include" });
      }
    };
    const keepaliveInterval = window.setInterval(keepalive, keepaliveMs);
    return () => {
      activityEvents.forEach(evt => window.removeEventListener(evt, onActivity));
      window.clearInterval(keepaliveInterval);
      window.__sessionKeepaliveInitialized = false;
    };
  }, []);
  return null;
}
