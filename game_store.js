(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./game_engine.js'));
    else root.ClaborStore = factory(root.Clabor);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine) {
    'use strict';
    function createStore(storage) {
        function read(key) {
            try { return storage.getItem(key); }
            catch (_) { throw new Error('Браузер не разрешает читать сохранения. Проверьте настройки хранения данных.'); }
        }
        function write(key, value) {
            try { storage.setItem(key, value); }
            catch (_) { throw new Error('Не удалось сохранить данные. Возможно, закончилось место в браузере. Не закрывайте страницу.'); }
        }
        function remove(key) {
            try { storage.removeItem(key); }
            catch (_) { throw new Error('Не удалось удалить сохранение. Попробуйте ещё раз.'); }
        }
        function parse(raw, label) {
            try { return JSON.parse(raw); }
            catch (_) { throw new Error(label + ': повреждены данные. Исходное сохранение не изменено.'); }
        }
        function assertToken(expected) {
            if (read('currentGame') !== expected) {
                const error = new Error('Игра изменена в другой вкладке. Обновите страницу, чтобы продолжить с актуальным счётом.');
                error.code = 'CONFLICT';
                throw error;
            }
        }
        function readCurrent() {
            const token = read('currentGame');
            return { token, game: token === null ? null : engine.normalizeGame(parse(token, 'Игра')) };
        }
        function backupLegacy(token) {
            if (token && parse(token, 'Игра').version !== 2 && read('claborBackupV1') === null) {
                write('claborBackupV1', token);
            }
        }
        function save(game, expected) {
            assertToken(expected);
            const next = engine.normalizeGame(game);
            backupLegacy(expected);
            next.revision++;
            const token = JSON.stringify(next);
            write('currentGame', token);
            return { game: next, token };
        }
        function readHistory() {
            const token = read('gameHistory');
            const entries = token === null ? [] : parse(token, 'История');
            if (!Array.isArray(entries)) throw new Error('История имеет неизвестный формат. Исходные данные не изменены.');
            return { entries, token };
        }
        function archive(game, expected, entry) {
            assertToken(expected);
            const history = readHistory();
            // Retrying after a failed removal must not create a duplicate history item.
            const entries = [entry, ...history.entries.filter(item => !item || item.id !== game.id)];
            write('gameHistory', JSON.stringify(entries));
            assertToken(expected);
            remove('currentGame');
        }
        function discard(expected) { assertToken(expected); remove('currentGame'); }
        function archiveAndRematch(game, expected, entry, nextGame) {
            engine.normalizeGame(nextGame);
            archive(game, expected, entry);
            return save(nextGame, null);
        }
        function deleteHistory(index, expected) {
            const history = readHistory();
            if (history.token !== expected) throw new Error('История изменилась в другой вкладке. Обновите страницу.');
            history.entries.splice(index, 1);
            write('gameHistory', JSON.stringify(history.entries));
        }
        function readLibrary() {
            const token = read('playerLibrary');
            return { library: token === null ? { version:1, profiles:[], lineups:[] } : parse(token, 'Профили'), token };
        }
        function saveLibrary(library, expected) {
            if (read('playerLibrary') !== expected) throw new Error('Профили изменены в другой вкладке. Обновите страницу.');
            const token = JSON.stringify(library);
            write('playerLibrary', token);
            return { library: engine.clone(library), token };
        }
        return { readCurrent, save, readHistory, archive, archiveAndRematch, discard, deleteHistory, readLibrary, saveLibrary };
    }
    return { createStore };
});
