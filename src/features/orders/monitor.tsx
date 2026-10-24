"use client";

/**
 * R0 app-wide order monitor (report 5, tiers 0+1): one signed-in polling
 * context mounted in HomeScreen, so staff on any tab hear about new orders.
 *
 * One poller per session: the board consumes this context instead of polling
 * itself, so the badge and the board share a cursor and can never disagree.
 * A new order (status `new`, created after the last seen moment) badges the
 * Orders tab, raises a toast, and — when the staffer opted in with a click —
 * chimes. Opening the Orders tab counts as seeing them: toasts clear and the
 * badge resets, and arrivals while the board is open stay silent.
 *
 * Chime needs a prior user gesture (autoplay policy), so sound defaults off
 * with an explicit toggle; system notifications additionally need a granted
 * Notification permission, asked only after the first real order arrives.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { fetchStaffOrders } from "./client";
import { detectNewOrders, mergeBoardOrders } from "./monitor-utils";
import { orderCode, type Order, type OrderStatus } from "./schema";
import { SyncError } from "@/features/menus/sync";
import { formatTableLabel } from "./table-links";

const POLL_MS = 5000;
const MAX_BACKOFF_MS = 40000;
const TOAST_MS = 8000;
const CHIME_STORAGE_KEY = "eateryo-order-chime";

export interface OrderToast {
  id: string;
  order: Order;
}

export type MonitorConnection = "idle" | "connecting" | "live" | "reconnecting";

interface MonitorValue {
  orders: Order[];
  phase: "loading" | "ready" | "error";
  connection: MonitorConnection;
  lastSyncedAt: string | null;
  /** Poll failure message for the board header; null when the poller is fine. */
  pollError: string | null;
  /** Unseen `new` orders — the tab badge count. */
  newCount: number;
  toasts: OrderToast[];
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** True once a real order has arrived: the moment to offer notifications. */
  hasArrived: boolean;
  notificationsAvailable: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  requestNotifications: () => Promise<void>;
  /** The board is open: arrivals stay silent and the unseen markers advance. */
  setViewingBoard: (viewing: boolean) => void;
  refresh: () => void;
  /** Board status writes: guard the id through the PATCH, then adopt/revert. */
  applyOptimistic: (orderId: string, status: OrderStatus) => void;
  resolveOptimistic: (updated: Order) => void;
  revertOptimistic: (rollback: Order) => void;
  dismissToast: (toastId: string) => void;
}

const MonitorContext = createContext<MonitorValue | null>(null);

export function useOrderMonitor(): MonitorValue {
  const value = useContext(MonitorContext);
  if (!value) throw new Error("useOrderMonitor must be used inside OrderMonitorProvider");
  return value;
}

function pollErrorMessage(error: unknown): string {
  if (error instanceof SyncError) {
    switch (error.code) {
      case "unauthorized":
        return "Your session expired — sign in again to keep order alerts live.";
      case "forbidden":
        return "You don't have access to this restaurant's orders.";
      case "rate_limited":
        return error.message;
      default:
        return error.message;
    }
  }
  return "Could not reach the server. Check your connection.";
}

/** Best-effort two-tone chime; silence on any failure (sound never breaks the board). */
function playChime() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const start = ctx.currentTime;
    [880, 1174.66].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const at = start + index * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.2);
    });
    void ctx.resume?.().catch(() => undefined);
    window.setTimeout(() => void ctx.close().catch(() => undefined), 900);
  } catch {
    // Sound is decoration; a blocked AudioContext stays silent.
  }
}

function notificationBody(order: Order): string {
  const lines = order.lines.slice(0, 3).map((line) => `${line.quantity}× ${line.name}`);
  const extra = order.lines.length > 3 ? ` +${order.lines.length - 3} more` : "";
  return `${formatTableLabel(order.tableLabel)} · ${lines.join(", ")}${extra}`;
}

export function OrderMonitorProvider({
  userId,
  children,
}: {
  userId: string | null;
  children: ReactNode;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [connection, setConnection] = useState<MonitorConnection>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [toasts, setToasts] = useState<OrderToast[]>([]);
  const [soundOn, setSoundOnState] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [hasArrived, setHasArrived] = useState(false);

  const sinceRef = useRef<string | null>(null);
  const seenAtRef = useRef<string | null>(null);
  const viewingRef = useRef(false);
  const guardedRef = useRef<Set<string>>(new Set());
  const soundOnRef = useRef(false);
  const permissionRef = useRef<NotificationPermission | "unsupported">("unsupported");
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const notificationsAvailable =
    typeof window !== "undefined" && "Notification" in window;

  // A new session (sign-out, or a different account) resets the monitor's
  // state synchronously during render — React's endorsed pattern for syncing
  // state to new props, with no effect round-trip and no stale flash. Refs
  // are reset in the polling effect below (refs must never be touched here).
  const [monitorUser, setMonitorUser] = useState(userId);
  if (monitorUser !== userId) {
    setMonitorUser(userId);
    setOrders([]);
    setPhase("loading");
    setConnection("idle");
    setLastSyncedAt(null);
    setPollError(null);
    setSeenAt(null);
    setToasts([]);
    setHasArrived(false);
  }

  // Persisted preferences restore once, off the effect body (a macrotask, so
  // the first paint still matches the server render exactly): sound defaults
  // off in private mode, and the Notification permission is read live.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (window.localStorage.getItem(CHIME_STORAGE_KEY) === "on") {
          soundOnRef.current = true;
          setSoundOnState(true);
        }
      } catch {
        // Private mode: sound simply defaults off.
      }
      if ("Notification" in window) {
        const current = window.Notification.permission;
        permissionRef.current = current;
        setNotificationPermission(current);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const dismissToast = useCallback((toastId: string) => {
    const timer = toastTimers.current.get(toastId);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(toastId);
    }
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  const pushToast = useCallback(
    (order: Order) => {
      const id = `${order.id}-${order.updatedAt}`;
      setToasts((current) => {
        if (current.some((toast) => toast.id === id)) return current;
        return [...current.slice(-2), { id, order }];
      });
      const timer = setTimeout(() => dismissToast(id), TOAST_MS);
      toastTimers.current.set(id, timer);
    },
    [dismissToast]
  );

  const poll = useCallback(
    async (initial: boolean) => {
      const result = await fetchStaffOrders({
        since: initial ? null : sinceRef.current,
        limit: 100,
      });
      sinceRef.current = result.serverTime;
      if (initial) {
        // The first load is context, not news: nothing badges or toasts.
        setOrders(result.orders);
        seenAtRef.current = result.serverTime;
        setSeenAt(result.serverTime);
      } else {
        const arrivals = detectNewOrders(result.orders, seenAtRef.current);
        setOrders((current) => mergeBoardOrders(current, result.orders, guardedRef.current));
        if (arrivals.length > 0) {
          setHasArrived(true);
          if (!viewingRef.current) {
            for (const order of arrivals) pushToast(order);
            if (soundOnRef.current) playChime();
            if (permissionRef.current === "granted") {
              try {
                for (const order of arrivals) {
                  new window.Notification(`New order · ${formatTableLabel(order.tableLabel)}`, {
                    body: notificationBody(order),
                    tag: order.id,
                  });
                }
              } catch {
                // A denied late-permission change stays silent.
              }
            }
          }
        }
        if (viewingRef.current) {
          // Watching the board is seeing: keep the badge cleared live.
          seenAtRef.current = result.serverTime;
          setSeenAt(result.serverTime);
        }
      }
      setLastSyncedAt(result.serverTime);
      setPhase("ready");
      setConnection("live");
      setPollError(null);
    },
    [pushToast]
  );

  useEffect(() => {
    if (!userId) {
      sinceRef.current = null;
      seenAtRef.current = null;
      guardedRef.current = new Set();
      for (const timer of toastTimers.current.values()) clearTimeout(timer);
      toastTimers.current.clear();
      return;
    }
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = setTimeout(() => void tick(), delay);
    };

    async function tick() {
      try {
        await poll(sinceRef.current === null);
        if (cancelled) return;
        failures = 0;
        schedule(POLL_MS);
      } catch (tickError) {
        if (cancelled) return;
        failures += 1;
        setPhase((current) => (current === "loading" ? "error" : current));
        setConnection("reconnecting");
        setPollError(pollErrorMessage(tickError));
        schedule(Math.min(POLL_MS * 2 ** Math.min(failures, 3), MAX_BACKOFF_MS));
      }
    }

    const initial = setTimeout(() => void tick(), 0);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll(false).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [userId, poll]);

  useEffect(
    () => () => {
      for (const timer of toastTimers.current.values()) clearTimeout(timer);
      toastTimers.current.clear();
    },
    []
  );

  const setSoundOn = useCallback((on: boolean) => {
    soundOnRef.current = on;
    setSoundOnState(on);
    try {
      window.localStorage.setItem(CHIME_STORAGE_KEY, on ? "on" : "off");
    } catch {
      // Preference stays in memory for the session.
    }
    if (on) playChime();
  }, []);

  const requestNotifications = useCallback(async () => {
    if (!("Notification" in window)) return;
    try {
      const result = await window.Notification.requestPermission();
      permissionRef.current = result;
      setNotificationPermission(result);
    } catch {
      // Dismissed prompt: the button can try again later.
    }
  }, []);

  const setViewingBoard = useCallback(
    (viewing: boolean) => {
      viewingRef.current = viewing;
      if (viewing && sinceRef.current) {
        seenAtRef.current = sinceRef.current;
        setSeenAt(sinceRef.current);
        setToasts([]);
      }
    },
    []
  );

  const refresh = useCallback(() => {
    void poll(false).catch(() => undefined);
  }, [poll]);

  const applyOptimistic = useCallback((orderId: string, status: OrderStatus) => {
    guardedRef.current.add(orderId);
    setOrders((current) =>
      current.map((entry) => (entry.id === orderId ? { ...entry, status } : entry))
    );
  }, []);

  const resolveOptimistic = useCallback((updated: Order) => {
    guardedRef.current.delete(updated.id);
    setOrders((current) => mergeBoardOrders(current, [updated], guardedRef.current));
  }, []);

  const revertOptimistic = useCallback((rollback: Order) => {
    guardedRef.current.delete(rollback.id);
    setOrders((current) => mergeBoardOrders(current, [rollback], guardedRef.current));
  }, []);

  const newCount = useMemo(
    () =>
      orders.filter(
        (order) => order.status === "new" && (seenAt === null || order.createdAt > seenAt)
      ).length,
    [orders, seenAt]
  );

  const value = useMemo<MonitorValue>(
    () => ({
      orders,
      phase,
      connection,
      lastSyncedAt,
      pollError,
      newCount,
      toasts,
      soundOn,
      setSoundOn,
      hasArrived,
      notificationsAvailable,
      notificationPermission,
      requestNotifications,
      setViewingBoard,
      refresh,
      applyOptimistic,
      resolveOptimistic,
      revertOptimistic,
      dismissToast,
    }),
    [
      orders,
      phase,
      connection,
      lastSyncedAt,
      pollError,
      newCount,
      toasts,
      soundOn,
      setSoundOn,
      hasArrived,
      notificationsAvailable,
      notificationPermission,
      requestNotifications,
      setViewingBoard,
      refresh,
      applyOptimistic,
      resolveOptimistic,
      revertOptimistic,
      dismissToast,
    ]
  );

  return <MonitorContext.Provider value={value}>{children}</MonitorContext.Provider>;
}

/** Short public id for toasts and badges (`#41F563`-style). */
export function monitorOrderCode(orderId: string): string {
  return orderCode(orderId);
}
