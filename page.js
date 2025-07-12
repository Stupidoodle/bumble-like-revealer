(function () {
    const emitEncounterResults = (results) => {
        console.log('[DEBUG] Dispatching encounter results to content script', results);
        window.dispatchEvent(new CustomEvent('bumble_encounter_data', {detail: results}));
    };

    // Patch fetch
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
        const res = await origFetch(...args);
        const url = args[0];

        if (typeof url === 'string' && url.includes('SERVER_GET_ENCOUNTERS')) {
            console.log('[DEBUG] Intercepted fetch SERVER_GET_ENCOUNTERS:', url);
            try {
                const clone = res.clone();
                const json = await clone.json();
                const results = json?.body?.[0]?.client_encounters?.results;
                if (Array.isArray(results)) {
                    emitEncounterResults(results);
                } else {
                    console.warn('[DEBUG] No valid encounter results in fetch response');
                }
            } catch (e) {
                console.error('[DEBUG] Failed to parse fetch response:', e);
            }
        }

        return res;
    };

    // Patch XMLHttpRequest
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._url = url;
        return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener('load', function () {
            const url = this._url;
            if (typeof url === 'string' && url.includes('SERVER_GET_ENCOUNTERS')) {
                console.log('[DEBUG] Intercepted XHR SERVER_GET_ENCOUNTERS:', url);
                try {
                    const json = JSON.parse(this.responseText);
                    const results = json?.body?.[0]?.client_encounters?.results;
                    if (Array.isArray(results)) {
                        emitEncounterResults(results);
                    } else {
                        console.warn('[DEBUG] No valid encounter results in XHR response');
                    }
                } catch (e) {
                    console.error('[DEBUG] Failed to parse XHR response:', e);
                }
            }
        });

        return origSend.apply(this, args);
    };

    console.log('[DEBUG] Bumble page-level script injected and monitoring');
})();
