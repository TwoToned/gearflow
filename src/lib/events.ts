import { EventEmitter } from "events";

export type RealtimeEventType =
  | "project:updated"
  | "project:created"
  | "project:deleted"
  | "line-item:changed"
  | "asset:updated"
  | "asset:created"
  | "warehouse:changed"
  | "kit:updated"
  | "kit:created"
  | "maintenance:changed"
  | "crew:changed"
  | "settings:changed";

export type RealtimeEventPayload = {
  orgId: string;
  actorId: string;
  projectId?: string;
  assetId?: string;
  kitId?: string;
  entityId?: string;
};

export type RealtimeEvent = {
  type: RealtimeEventType;
  payload: RealtimeEventPayload;
  timestamp: number;
};

const ALL_EVENT_TYPES: RealtimeEventType[] = [
  "project:updated",
  "project:created",
  "project:deleted",
  "line-item:changed",
  "asset:updated",
  "asset:created",
  "warehouse:changed",
  "kit:updated",
  "kit:created",
  "maintenance:changed",
  "crew:changed",
  "settings:changed",
];

class TypedEventEmitter {
  private emitter = new EventEmitter();

  emit(type: RealtimeEventType, payload: RealtimeEventPayload): void {
    const event: RealtimeEvent = { type, payload, timestamp: Date.now() };
    this.emitter.emit(type, event);
  }

  on(type: RealtimeEventType, handler: (event: RealtimeEvent) => void): () => void {
    this.emitter.on(type, handler);
    return () => {
      this.emitter.off(type, handler);
    };
  }

  onAny(handler: (event: RealtimeEvent) => void): () => void {
    const unsubs: (() => void)[] = [];
    for (const type of ALL_EVENT_TYPES) {
      this.emitter.on(type, handler);
      unsubs.push(() => this.emitter.off(type, handler));
    }
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }
}

export const events = new TypedEventEmitter();
