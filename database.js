(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./game_store.js'));
    else root.ClaborDatabase = factory(root.ClaborStore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
    'use strict';
    const keysToMigrate = ['currentGame', 'gameHistory', 'playerLibrary', 'claborBackupV1'];
    function storageError(error) {
        if (['QuotaExceededError','SecurityError','InvalidStateError','UnknownError','OpenFailedError'].includes(error.name)) {
            const message = new Error('Не удалось открыть или сохранить данные на устройстве. Проверьте свободное место и разрешение браузера на хранение данных. Не закрывайте страницу с несохранённым вводом.');
            message.cause = error; return message;
        }
        return error;
    }
    async function createDatabaseStore(DexieClass, name, legacyStorage, notify = () => {}) {
        const db = new DexieClass(name);
        db.version(1).stores({ kv: 'key' });
        await db.open();
        await db.transaction('rw', db.kv, async () => {
            if (await db.kv.get('__initialized')) return;
            const originals = {};
            for (const key of keysToMigrate) {
                const value = legacyStorage ? legacyStorage.getItem(key) : null;
                if (value !== null) { originals[key] = value; await db.kv.put({ key, value }); }
            }
            await db.kv.put({key:'__migrationBackup', value:JSON.stringify(originals)});
            await db.kv.put({key:'__initialized', value:'1'});
            // Keep the original localStorage untouched as a recovery copy. Never re-import it.
        });
        const api = {};
        const reads = ['readCurrent', 'readHistory', 'readLibrary'];
        const methods = [...reads, 'save', 'archive', 'archiveAndRematch', 'discard', 'deleteHistory', 'saveLibrary'];
        for (const method of methods) api[method] = async (...args) => {
            const changed = new Set();
            const result = await db.transaction(reads.includes(method) ? 'r' : 'rw', db.kv, async () => {
                const rows = await db.kv.toArray();
                const values = new Map(rows.map(row => [row.key, row.value]));
                const memory = {
                    getItem: key => values.has(key) ? values.get(key) : null,
                    setItem: (key, value) => { changed.add(key); values.set(key, value); },
                    removeItem: key => { changed.add(key); values.delete(key); }
                };
                const value = core.createStore(memory)[method](...args);
                for (const key of changed) {
                    if (values.has(key)) await db.kv.put({key, value:values.get(key)});
                    else await db.kv.delete(key);
                }
                return value;
            }).catch(error => { throw storageError(error); });
            changed.forEach(key => notify(key));
            return result;
        };
        api.close = () => db.close();
        return api;
    }
    let opening;
    function open() {
        if (!opening) {
            const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('clabor-data') : null;
            if (channel) channel.onmessage = event => window.dispatchEvent(new CustomEvent('clabor-storage', {detail:event.data}));
            opening = createDatabaseStore(Dexie, 'clabor', localStorage, key => channel?.postMessage({key})).catch(error => { throw storageError(error); });
        }
        return opening;
    }
    return { open, createDatabaseStore };
});
