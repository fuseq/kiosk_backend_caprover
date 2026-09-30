/** Bagimliligi olmayan minik yayin/abone otobusu. */

const listeners = new Map();

export const eventBus = {
    on(event, handler) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(handler);
        return () => this.off(event, handler);
    },

    off(event, handler) {
        listeners.get(event)?.delete(handler);
    },

    emit(event, payload) {
        const set = listeners.get(event);
        if (!set) return;
        for (const handler of [...set]) {
            try {
                handler(payload);
            } catch (err) {
                console.error(`[event-bus] "${event}" dinleyicisi hata verdi:`, err);
            }
        }
    },
};
