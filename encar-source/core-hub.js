// ==UserScript==
// @name         Encar Core Hub
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Центральное хранилище данных и событий
// @match        *://www.encar.com/cars/detail/*
// @match        *://fem.encar.com/cars/detail/*
// @grant        unsafeWindow
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    if (!unsafeWindow.EncarHub) {
        unsafeWindow.EncarHub = {
            _data: {},
            _listeners: {},
            _onceListeners: {},
            
            set: function(key, value, silent = false) {
                const oldValue = this._data[key];
                this._data[key] = value;
                if (!silent) {
                    this.emit(`${key}:changed`, { key, value, oldValue });
                    this.emit('any:changed', { key, value, oldValue });
                }
                console.log(`[Hub] ${key} =`, value);
                return value;
            },
            
            get: function(key) {
                return this._data[key];
            },
            
            getAll: function() {
                return { ...this._data };
            },
            
            on: function(event, callback) {
                if (!this._listeners[event]) this._listeners[event] = [];
                this._listeners[event].push(callback);
            },
            
            once: function(event, callback) {
                if (!this._onceListeners[event]) this._onceListeners[event] = [];
                this._onceListeners[event].push(callback);
            },
            
            off: function(event, callback) {
                if (this._listeners[event]) {
                    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
                }
                if (this._onceListeners[event]) {
                    this._onceListeners[event] = this._onceListeners[event].filter(cb => cb !== callback);
                }
            },
            
            emit: function(event, data) {
                if (this._listeners[event]) {
                    this._listeners[event].forEach(cb => {
                        try { cb(data); } catch(e) { console.error(`[Hub] Ошибка в ${event}:`, e); }
                    });
                }
                if (this._onceListeners && this._onceListeners[event]) {
                    const callbacks = [...this._onceListeners[event]];
                    delete this._onceListeners[event];
                    callbacks.forEach(cb => {
                        try { cb(data); } catch(e) { console.error(`[Hub] Ошибка в once ${event}:`, e); }
                    });
                }
            },
            
            waitFor: function(key, timeout = 10000) {
                return new Promise((resolve, reject) => {
                    const existing = this.get(key);
                    if (existing !== undefined && existing !== null) {
                        resolve(existing);
                        return;
                    }
                    const timeoutId = setTimeout(() => {
                        this.off(`${key}:changed`, handler);
                        reject(new Error(`Timeout waiting for ${key}`));
                    }, timeout);
                    const handler = (data) => {
                        clearTimeout(timeoutId);
                        this.off(`${key}:changed`, handler);
                        resolve(data.value);
                    };
                    this.on(`${key}:changed`, handler);
                });
            }
        };
    }
    
    GM_addStyle(`
        #encar-combined-panel,
        #encar-combined-panel * {
            translate: no !important;
            -webkit-translate: no !important;
        }
    `);
    
    document.documentElement.setAttribute('translate', 'no');
    document.body.setAttribute('translate', 'no');
    
    console.log('[CoreHub] Инициализирован v2.1');
})();
