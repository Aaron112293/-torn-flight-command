// ==UserScript==
// @name         Torn Flight Command - Weav3r Price Test
// @namespace    torn.flight.command
// @version      0.1.2
// @description  Tests the public TornW3B marketplace response for Jaguar Plushie without an API key.
// @author       Aaron Mason
// @updateURL    https://raw.githubusercontent.com/Aaron112293/-torn-flight-command/main/Torn_Flight_Command_Weav3r_Test_v0.1.0.user.js
// @downloadURL  https://raw.githubusercontent.com/Aaron112293/-torn-flight-command/main/Torn_Flight_Command_Weav3r_Test_v0.1.0.user.js
// @match        https://www.torn.com/*
// @connect      weav3r.dev
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const ITEM_ID = 258;
    const ITEM_NAME = 'Jaguar Plushie';
    const ENDPOINT = `https://weav3r.dev/api/marketplace/${ITEM_ID}?limit=5`;
    const PANEL_ID = 'fc-weav3r-test-panel';

    function money(value) {
        const number = Number(value);
        return Number.isFinite(number) ? `$${Math.round(number).toLocaleString()}` : 'Unavailable';
    }

    function age(value) {
        const timestamp = Number(value);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Unknown';
        const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
        if (seconds < 60) return `${seconds}s ago`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        return `${Math.floor(seconds / 3600)}h ago`;
    }

    function getResponseText(response) {
        if (typeof response === 'string') return response;
        if (typeof response?.responseText === 'string') return response.responseText;
        if (typeof response?.response === 'string') return response.response;
        if (typeof response?.body === 'string') return response.body;
        if (response?.response && typeof response.response === 'object') {
            return JSON.stringify(response.response);
        }
        return '';
    }

    async function requestWithPda() {
        if (typeof window.PDA_httpGet !== 'function') {
            throw new Error('PDA_httpGet is unavailable');
        }
        return window.PDA_httpGet(ENDPOINT, {
            Accept: 'application/json'
        });
    }

    function requestWithGm() {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('GM_xmlhttpRequest is unavailable'));
                return;
            }
            GM_xmlhttpRequest({
                method: 'GET',
                url: ENDPOINT,
                timeout: 15000,
                headers: { Accept: 'application/json' },
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) resolve(response);
                    else reject(new Error(`HTTP ${response.status || 'unknown'}`));
                },
                onerror: () => reject(new Error('GM network request failed')),
                ontimeout: () => reject(new Error('GM request timed out after 15 seconds'))
            });
        });
    }

    async function requestPrice() {
        const errors = [];
        for (const attempt of [
            ['Torn PDA', requestWithPda],
            ['Userscript request', requestWithGm]
        ]) {
            try {
                return { source: attempt[0], response: await attempt[1]() };
            } catch (error) {
                errors.push(`${attempt[0]}: ${error.message}`);
            }
        }
        throw new Error(errors.join(' | '));
    }

    function createPanel() {
        document.getElementById(PANEL_ID)?.remove();
        const panel = document.createElement('section');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <div class="fcwt-head">
                <strong>Flight Command Price Test</strong>
                <button class="fcwt-close" type="button" aria-label="Close">×</button>
            </div>
            <div class="fcwt-body">
                <div><b>Item:</b> ${ITEM_NAME} (ID ${ITEM_ID})</div>
                <div class="fcwt-status">Ready to test Weav3r.</div>
                <div class="fcwt-results"></div>
                <button class="fcwt-test" type="button">TEST PRICE FEED</button>
                <button class="fcwt-copy" type="button" disabled>COPY REPORT</button>
            </div>`;

        const style = document.createElement('style');
        style.textContent = `
            #${PANEL_ID}{position:fixed;z-index:2147483647;left:12px;right:12px;top:90px;max-width:520px;margin:auto;background:#171717;color:#f4f4f4;border:2px solid #4b9cff;border-radius:12px;box-shadow:0 8px 30px #000a;font:14px/1.4 Arial,sans-serif}
            #${PANEL_ID} .fcwt-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:#232323;border-radius:10px 10px 0 0}
            #${PANEL_ID} .fcwt-head strong{font-size:16px}
            #${PANEL_ID} button{border:0;border-radius:8px;font-weight:700}
            #${PANEL_ID} .fcwt-close{background:transparent;color:#fff;font-size:28px;line-height:24px;padding:0 4px}
            #${PANEL_ID} .fcwt-body{padding:14px}
            #${PANEL_ID} .fcwt-status{margin:10px 0;padding:9px;background:#252525;border-radius:7px}
            #${PANEL_ID} .fcwt-results{white-space:pre-wrap;word-break:break-word;margin-bottom:10px;color:#d9eaff}
            #${PANEL_ID} .fcwt-test,#${PANEL_ID} .fcwt-copy{width:100%;padding:11px;margin-top:8px;background:#4b9cff;color:#071423}
            #${PANEL_ID} .fcwt-copy{background:#3a3a3a;color:#fff}
            #${PANEL_ID} button:disabled{opacity:.45}
        `;
        document.head.appendChild(style);
        document.body.appendChild(panel);
        return panel;
    }

    const panel = createPanel();
    const status = panel.querySelector('.fcwt-status');
    const results = panel.querySelector('.fcwt-results');
    const testButton = panel.querySelector('.fcwt-test');
    const copyButton = panel.querySelector('.fcwt-copy');
    let report = '';

    panel.querySelector('.fcwt-close').addEventListener('click', () => panel.remove());
    testButton.addEventListener('click', async () => {
        testButton.disabled = true;
        copyButton.disabled = true;
        status.textContent = 'Testing price feed…';
        results.textContent = '';
        try {
            const { source, response } = await requestPrice();
            const raw = getResponseText(response);
            if (!raw) throw new Error('The request succeeded but returned an empty response');
            const data = JSON.parse(raw);
            const listings = Array.isArray(data.listings)
                ? data.listings.filter((row) => Number.isFinite(Number(row?.price)))
                : [];
            const lowest = listings.slice().sort((a, b) => Number(a.price) - Number(b.price))[0] || null;
            const fields = [
                `Connection: SUCCESS (${source})`,
                `Returned item: ${data.item_name || 'Unknown'} (${data.item_id ?? 'unknown'})`,
                `Market price: ${money(data.market_price)}`,
                `Bazaar average: ${money(data.bazaar_average)}`,
                `Listings returned: ${listings.length}`,
                `Lowest listing: ${lowest ? money(lowest.price) : 'Unavailable'}`,
                `Lowest quantity: ${lowest?.quantity ?? 'Unavailable'}`,
                `Lowest updated: ${lowest ? age(lowest.last_checked ?? lowest.content_updated) : 'Unavailable'}`,
                `Generated: ${data.generated_at ? age(data.generated_at) : 'Unknown'}`
            ];
            report = JSON.stringify({
                test: 'Flight Command Weav3r Price Test v0.1.2',
                testedAt: new Date().toISOString(),
                endpoint: ENDPOINT,
                requestSource: source,
                response: data
            }, null, 2);
            status.textContent = 'SUCCESS — copy the report and send it to Codex.';
            results.textContent = fields.join('\n');
            copyButton.disabled = false;
        } catch (error) {
            report = JSON.stringify({
                test: 'Flight Command Weav3r Price Test v0.1.2',
                testedAt: new Date().toISOString(),
                endpoint: ENDPOINT,
                error: error.message
            }, null, 2);
            status.textContent = 'FAILED — copy the report and send it to Codex.';
            results.textContent = error.message;
            copyButton.disabled = false;
        } finally {
            testButton.disabled = false;
        }
    });

    copyButton.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(report);
            copyButton.textContent = 'REPORT COPIED';
        } catch (_) {
            window.prompt('Copy this report:', report);
        }
    });
})();
