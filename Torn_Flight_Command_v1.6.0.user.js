// ==UserScript==
// @name         Torn Flight Command
// @namespace    torn.flight.command
// @version      1.6.0
// @description  Flight Command Mexico cards with profit sorting, safer foreign-stock feed, and direct-shop bridge
// @match        https://www.torn.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = 'v1.6.0';
    const FLIGHT_STATE_KEY = 'fc-last-confirmed-flight';
    const FEED_URL = 'https://torn-intel.com/api/v1/foreign-stock/travel-table';
    const FEED_CACHE_KEY = 'fc-mexico-foreign-stock-cache-v1';
    const LIVE_BRIDGE_KEY = 'flightCommandLiveShopBridgeV1';
    const FEED_REFRESH_MS = 30000;

    const itemCardState = new Map();
    let mexicoRenderSignature = '';
    let highlightingEnabled = localStorage.getItem('fc-highlighting') !== 'off';
    let profitMode = localStorage.getItem('fc-profit-mode') === 'npc' ? 'npc' : 'market';
    const savedSortMode = localStorage.getItem('fc-sort-mode');
    let sortMode = ['price-high', 'price-low', 'profit-high', 'profit-low', 'quantity-high', 'quantity-low'].includes(savedSortMode)
        ? savedSortMode
        : 'profit-high';
    let hideSoldOut = localStorage.getItem('fc-hide-sold-out') === 'true';
    let mexicoFeed = loadCachedMexicoFeed();
    let feedLoading = false;
    let feedError = '';
    let lastFeedRequest = 0;

    const CITY_TO_COUNTRY = {
        'ciudad juarez': 'Mexico',
        'george town': 'Cayman Islands',
        'toronto': 'Canada',
        'honolulu': 'Hawaii',
        'london': 'United Kingdom',
        'buenos aires': 'Argentina',
        'zurich': 'Switzerland',
        'tokyo': 'Japan',
        'beijing': 'China',
        'dubai': 'United Arab Emirates',
        'south africa': 'South Africa',
        'johannesburg': 'South Africa'
    };

    // Complete Ciudad Juarez catalog. Prices are the normal abroad buy prices;
    // live page values override these whenever Torn exposes a current listing.
    const MEXICO_ITEMS = [
        { name: 'Bolt Cutters', shop: 'General Store', cost: 25, market: 436 },
        { name: 'Bottle of Tequila', shop: 'General Store', cost: 85, market: 701 },
        { name: 'Card Skimmer', shop: 'General Store', cost: 175, market: 1603 },
        { name: 'Crazy Straw', shop: 'General Store', cost: 25, market: 755 },
        { name: 'Dahlia', shop: 'General Store', cost: 300, market: 1736 },
        { name: 'Jaguar Plushie', shop: 'General Store', cost: 10000, market: 15389 },
        { name: 'Mayan Statue', shop: 'General Store', cost: 500, market: 1902 },
        { name: 'Trench Coat', shop: 'General Store', cost: 500000, market: 336832 },
        { name: 'Yucca Plant', shop: 'General Store', cost: 20000, market: 7071 },
        { name: 'Zip Ties', shop: 'General Store', cost: 25, market: 2215 },
        { name: '9mm Uzi', shop: 'Arms Dealer', cost: 1100000, market: 599534 },
        { name: 'AK-47', shop: 'Arms Dealer', cost: 15000, market: 9542 },
        { name: 'ArmaLite M-15A4', shop: 'Arms Dealer', cost: 20000000, market: 20470686 },
        { name: 'Axe', shop: 'Arms Dealer', cost: 4200, market: 2353 },
        { name: 'Claymore Mine', shop: 'Arms Dealer', cost: 15000, market: 15368 },
        { name: 'Cobra Derringer', shop: 'Arms Dealer', cost: 70000, market: 54486 },
        { name: 'Desert Eagle', shop: 'Arms Dealer', cost: 45000, market: 35472 },
        { name: 'Flak Jacket', shop: 'Arms Dealer', cost: 7500, market: 4024 },
        { name: 'Flare Gun', shop: 'Arms Dealer', cost: 300, market: 174 },
        { name: 'Heckler & Koch SL8', shop: 'Arms Dealer', cost: 45000, market: 34708 },
        { name: 'Kevlar Gloves', shop: 'Arms Dealer', cost: 400000, market: 329992 },
        { name: 'Leather Bullwhip', shop: 'Arms Dealer', cost: 1500, market: 611 },
        { name: 'M249 SAW', shop: 'Arms Dealer', cost: 950000, market: 670103 },
        { name: 'Minigun', shop: 'Arms Dealer', cost: 3000000, market: 1422286 },
        { name: 'Ninja Claws', shop: 'Arms Dealer', cost: 8000, market: 4612 },
        { name: 'Outer Tactical Vest', shop: 'Arms Dealer', cost: 1000000, market: 746545 },
        { name: 'Samurai Sword', shop: 'Arms Dealer', cost: 75000, market: 52519 },
        { name: 'Springfield 1911', shop: 'Arms Dealer', cost: 430, market: 991 },
        { name: 'Taser', shop: 'Arms Dealer', cost: 5500, market: 3253 },
        { name: 'Obsidian Point', shop: 'Black Market', minCost: 108363, maxCost: 152939, market: 144689 }
    ];

    function loadCachedMexicoFeed() {
        try {
            const cached = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || 'null');
            return Array.isArray(cached?.stocks) ? cached : null;
        } catch (error) {
            return null;
        }
    }

    function saveMexicoFeed(feed) {
        try {
            localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(feed));
        } catch (error) {
            // The current in-memory feed remains usable if storage is unavailable.
        }
    }

    function feedItemByName(name) {
        return mexicoFeed?.stocks?.find(item => item.name === name) || null;
    }

    async function requestFeedJson() {
        if (typeof PDA_httpGet === 'function') {
            const response = await PDA_httpGet(FEED_URL, {
                Accept: 'application/json'
            });

            const responseText = typeof response === 'string'
                ? response
                : [response?.responseText, response?.response, response?.body]
                    .find(value => typeof value === 'string');

            if (!responseText) {
                throw new Error('The stock feed returned no response text.');
            }

            return JSON.parse(responseText);
        }

        const response = await fetch(FEED_URL, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            credentials: 'omit'
        });

        if (!response.ok) {
            throw new Error(`Stock feed request failed (${response.status}).`);
        }

        return response.json();
    }

    async function refreshMexicoFeed(force = false) {
        if (feedLoading) return;
        if (!force && Date.now() - lastFeedRequest < FEED_REFRESH_MS) return;

        feedLoading = true;
        feedError = '';
        lastFeedRequest = Date.now();
        mexicoRenderSignature = '';
        renderMexicoItems(true);

        try {
            const data = await requestFeedJson();
            const mexico = data?.stocks?.mex;

            if (!mexico || !Array.isArray(mexico.stocks)) {
                throw new Error('Mexico stock data was missing from the feed.');
            }

            mexicoFeed = {
                update: Number(mexico.update) || null,
                receivedAt: Date.now(),
                stocks: mexico.stocks.map(item => ({
                    id: Number(item.id),
                    name: String(item.name || ''),
                    cost: Number(item.cost),
                    quantity: Number(item.quantity)
                }))
            };

            saveMexicoFeed(mexicoFeed);
            mexicoRenderSignature = '';
            renderMexicoItems(true);
        } catch (error) {
            feedError = error?.message || String(error);
            mexicoRenderSignature = '';
            renderMexicoItems(true);
        } finally {
            feedLoading = false;
        }
    }

    let panelOpen = false;
    let mexicoOpen = false;
    let lastFlightInfo = null;
    let lastFlightSeen = 0;

    function saveFlightInfo(info) {
        try {
            localStorage.setItem(FLIGHT_STATE_KEY, JSON.stringify({
                ...info,
                savedAt: Date.now()
            }));
        } catch (error) {
            // Flight detection still works for the current page if storage is unavailable.
        }
    }

    function loadSavedFlightInfo() {
        try {
            const saved = JSON.parse(localStorage.getItem(FLIGHT_STATE_KEY) || 'null');
            if (!saved?.country || !saved?.direction || !saved?.route) return null;
            return saved;
        } catch (error) {
            return null;
        }
    }

    function clearSavedFlightInfo() {
        try {
            localStorage.removeItem(FLIGHT_STATE_KEY);
        } catch (error) {
            // Nothing else is required if storage is unavailable.
        }
    }

    function globalTravelIndicatorIsVisible(text) {
        if (/(^|\n)\s*TRAVELING\s*(\n|$)/i.test(text)) return true;

        return Boolean(document.querySelector(
            '[aria-label*="traveling" i], [title*="traveling" i]'
        ));
    }

    function getFlightInfo() {
        const text = document.body?.innerText || '';
        const travelingVisible = globalTravelIndicatorIsVisible(text);
        let routeMatch = null;

        for (const city of Object.keys(CITY_TO_COUNTRY)) {
            const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const outbound = new RegExp(`Torn\\s+to\\s+${escaped}`, 'i');
            const returning = new RegExp(`${escaped}\\s+to\\s+Torn`, 'i');

            if (outbound.test(text)) {
                routeMatch = {
                    country: CITY_TO_COUNTRY[city],
                    city,
                    direction: 'OUTBOUND',
                    route: `Torn -> ${CITY_TO_COUNTRY[city]}`
                };
                break;
            }

            if (returning.test(text)) {
                routeMatch = {
                    country: CITY_TO_COUNTRY[city],
                    city,
                    direction: 'RETURNING',
                    route: `${CITY_TO_COUNTRY[city]} -> Torn`
                };
                break;
            }
        }

        if (routeMatch) {
            lastFlightInfo = { ...routeMatch };
            lastFlightSeen = Date.now();
            saveFlightInfo(lastFlightInfo);
            return lastFlightInfo;
        }

        if (lastFlightInfo && Date.now() - lastFlightSeen < 10000) {
            return lastFlightInfo;
        }

        if (travelingVisible) {
            const savedFlight = loadSavedFlightInfo();

            if (savedFlight) {
                lastFlightInfo = {
                    country: savedFlight.country,
                    city: savedFlight.city,
                    direction: savedFlight.direction,
                    route: savedFlight.route
                };
                lastFlightSeen = Date.now();
                return lastFlightInfo;
            }
        }

        if (!travelingVisible && document.readyState === 'complete' && text.length > 100) {
            clearSavedFlightInfo();
        }

        return null;
    }

    function installStyles() {
        if (document.getElementById('fc-style')) return;

        const style = document.createElement('style');
        style.id = 'fc-style';

        style.textContent = `
            #fc-panel {
                position: fixed;
                left: 22px;
                right: 22px;
                top: 50%;
                transform: translateY(-50%);
                z-index: 2147483646;
                background: linear-gradient(180deg, rgba(49,49,52,.98), rgba(17,17,19,.98));
                border: 1px solid rgba(255,255,255,.13);
                border-radius: 18px;
                overflow: hidden;
                box-shadow: 0 16px 50px rgba(0,0,0,.65);
                color: #eee;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
                max-height: calc(100vh - 28px);
            }

            #fc-header {
                height: 66px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 20px;
                border-bottom: 1px solid rgba(255,255,255,.08);
            }

            #fc-title {
                font-size: 21px;
                font-weight: 800;
                letter-spacing: .4px;
            }

            #fc-minimize {
                width: 48px;
                height: 42px;
                border: 0;
                border-radius: 12px;
                background: #354f73;
                color: #dceaff;
                font-size: 27px;
                font-weight: 800;
            }

            #fc-content {
                padding: 26px 20px 24px;
                text-align: center;
            }

            #fc-country {
                font-size: 32px;
                font-weight: 900;
                line-height: 1.1;
                margin-bottom: 7px;
            }

            #fc-route {
                color: #aeb6c1;
                font-size: 17px;
                margin-bottom: 18px;
            }

            #fc-mode {
                display: inline-block;
                padding: 7px 14px;
                border-radius: 9px;
                font-size: 14px;
                font-weight: 900;
                letter-spacing: .8px;
            }

            #fc-mode.outbound {
                background: rgba(42,118,180,.30);
                border: 1px solid #397eaf;
                color: #9bd6ff;
            }

            #fc-mode.returning {
                background: rgba(190,125,35,.25);
                border: 1px solid #a9742f;
                color: #ffc86d;
            }

            #fc-mode.standby {
                background: rgba(120,120,120,.20);
                border: 1px solid #666;
                color: #bbb;
            }

            #fc-tabs {
                padding: 0 20px 20px;
            }

            #fc-mexico-tab {
                width: 100%;
                border: 1px solid rgba(255,255,255,.10);
                border-radius: 10px;
                padding: 12px 14px;
                background: rgba(255,255,255,.05);
                color: #eee;
                font-size: 15px;
                font-weight: 900;
                letter-spacing: .6px;
            }

            #fc-mexico-panel {
                margin: 0 20px 20px;
                border: 1px solid rgba(255,255,255,.10);
                border-radius: 12px;
                overflow: hidden;
                background: rgba(0,0,0,.18);
                max-height: min(68vh, 720px);
                overflow-y: auto;
            }

            #fc-mexico-header {
                min-height: 48px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 14px;
                border-bottom: 1px solid rgba(255,255,255,.07);
            }

            #fc-mexico-title {
                font-size: 15px;
                font-weight: 900;
                letter-spacing: .6px;
            }

            .fc-mexico-heading {
                display: flex;
                align-items: center;
                gap: 9px;
            }

            .fc-highlight-toggle {
                display: flex;
                align-items: center;
                gap: 6px;
                color: #aeb6c1;
                font-size: 10px;
                font-weight: 800;
                letter-spacing: .5px;
            }

            .fc-highlight-toggle input { display: none; }

            .fc-toggle-track {
                width: 36px;
                height: 20px;
                padding: 2px;
                border-radius: 999px;
                background: #555;
                box-sizing: border-box;
                transition: .2s ease;
            }

            .fc-toggle-knob {
                display: block;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: #ddd;
                transition: .2s ease;
            }

            .fc-highlight-toggle input:checked + .fc-toggle-track {
                background: #2d8a52;
            }

            .fc-highlight-toggle input:checked + .fc-toggle-track .fc-toggle-knob {
                transform: translateX(16px);
                background: #fff;
            }

            #fc-mexico-minimize {
                width: 38px;
                height: 32px;
                border: 0;
                border-radius: 9px;
                background: #354f73;
                color: #dceaff;
                font-size: 21px;
                font-weight: 800;
            }

            #fc-mexico-content {
                min-height: 70px;
                padding: 10px;
            }

            .fc-shop-heading {
                margin: 12px 2px 7px;
                color: #91a1b2;
                font-size: 11px;
                font-weight: 900;
                letter-spacing: 1px;
                text-align: left;
                text-transform: uppercase;
            }

            .fc-shop-heading:first-child { margin-top: 2px; }

            .fc-item-card {
                margin-bottom: 9px;
                padding: 12px;
                border: 1px solid rgba(255,255,255,.11);
                border-radius: 12px;
                background: rgba(255,255,255,.045);
                text-align: left;
                transition: border-color .2s, background .2s, box-shadow .2s;
            }

            #fc-mexico-content.fc-highlights-on .fc-item-card.fc-sold-out {
                border-color: #b54a4a;
                background: rgba(154,39,39,.20);
                box-shadow: inset 3px 0 0 #dc5757;
            }

            #fc-mexico-content.fc-highlights-on .fc-item-card.fc-best-profit {
                border-color: #43a76a;
                background: rgba(38,130,73,.20);
                box-shadow: inset 3px 0 0 #58d486;
            }

            .fc-item-top, .fc-buy-row, .fc-card-summary {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
            }

            .fc-item-name { font-size: 16px; font-weight: 900; }
            .fc-stock { font-size: 12px; font-weight: 900; color: #b9c4cf; }
            .fc-stock.sold { color: #ff7777; }
            .fc-item-cost { margin-top: 5px; color: #b9c4cf; font-size: 12px; }

            .fc-buy-row { margin-top: 11px; }
            .fc-buy-label { color: #aeb6c1; font-size: 11px; font-weight: 800; }
            .fc-buy-input {
                width: 64px;
                padding: 8px;
                border: 1px solid rgba(255,255,255,.14);
                border-radius: 8px;
                background: rgba(0,0,0,.28);
                color: #fff;
                font-size: 14px;
                text-align: center;
            }

            .fc-button {
                padding: 8px 10px;
                border: 0;
                border-radius: 8px;
                background: #354f73;
                color: #e5f0ff;
                font-size: 11px;
                font-weight: 900;
            }

            .fc-card-summary {
                margin-top: 9px;
                color: #98a5b2;
                font-size: 11px;
            }

            .fc-profit-toggle { width: 100%; margin-top: 10px; }
            .fc-profit-panel { margin-top: 8px; }
            .fc-profit-section {
                margin-top: 7px;
                padding: 9px;
                border-radius: 9px;
                background: rgba(0,0,0,.23);
                font-size: 11px;
                line-height: 1.65;
            }

            .fc-profit-title { color: #dceaff; font-weight: 900; }
            .fc-muted { color: #81909f; }
            .fc-catalog-note { color: #7f8994; font-size: 10px; padding: 2px 2px 10px; }

            #fc-copy-diagnostics {
                width: 100%;
                margin-bottom: 10px;
                padding: 10px;
                background: #3d5f83;
                border: 1px solid #5681ad;
                color: #eef7ff;
            }

            #fc-copy-diagnostics.fc-copy-success {
                background: #28734a;
                border-color: #42a66c;
            }

            #fc-copy-diagnostics.fc-copy-error {
                background: #873c3c;
                border-color: #bd5656;
            }

            .fc-profit-mode,
            .fc-sort-mode {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 5px;
                margin-bottom: 10px;
                padding: 4px;
                border-radius: 10px;
                background: rgba(0,0,0,.25);
            }

            .fc-mode-choice {
                padding: 9px 6px;
                border: 1px solid transparent;
                border-radius: 8px;
                background: transparent;
                color: #8d99a5;
                font-size: 11px;
                font-weight: 900;
            }

            .fc-mode-choice.active {
                border-color: #49759f;
                background: #294764;
                color: #e4f2ff;
            }

            .fc-sold-out-toggle {
                width: 100%;
                margin-bottom: 10px;
                padding: 10px 8px;
                border: 1px solid #4f5964;
                border-radius: 8px;
                background: rgba(0,0,0,.25);
                color: #b8c2cc;
                font-size: 11px;
                font-weight: 900;
            }

            .fc-sold-out-toggle.active {
                border-color: #9a6940;
                background: #654329;
                color: #fff0dc;
            }

            #fc-footer {
                padding: 16px 10px 18px;
                text-align: center;
                color: #7f8994;
                font-size: 11px;
                font-weight: 800;
                letter-spacing: 1.3px;
                border-top: 1px solid rgba(255,255,255,.05);
            }

            body.fc-active #notes_panel {
                display: none !important;
                visibility: hidden !important;
                pointer-events: none !important;
            }
        `;

        document.head.appendChild(style);
    }

    function createPanel() {
        if (document.getElementById('fc-panel')) return;

        installStyles();

        const panel = document.createElement('div');
        panel.id = 'fc-panel';

        panel.innerHTML = `
            <div id="fc-header">
                <div id="fc-title">&#9992; FLIGHT COMMAND</div>
                <button id="fc-minimize" type="button">-</button>
            </div>

            <div id="fc-content">
                <div id="fc-country">DETECTING...</div>
                <div id="fc-route">Checking flight status</div>
                <div id="fc-mode" class="standby">STANDBY</div>
            </div>

            <div id="fc-tabs">
                <button id="fc-mexico-tab" type="button">MEXICO</button>
            </div>

            <div id="fc-mexico-panel" style="display:none;">
                <div id="fc-mexico-header">
                    <div class="fc-mexico-heading">
                        <div id="fc-mexico-title">MEXICO</div>
                        <label class="fc-highlight-toggle" title="Turn profit and sold-out colors on or off">
                            HIGHLIGHT
                            <input id="fc-highlight-switch" type="checkbox" ${highlightingEnabled ? 'checked' : ''}>
                            <span class="fc-toggle-track"><span class="fc-toggle-knob"></span></span>
                        </label>
                    </div>
                    <button id="fc-mexico-minimize" type="button">-</button>
                </div>
                <div id="fc-mexico-content"></div>
            </div>

            <div id="fc-footer">FLIGHT COMMAND - ${VERSION}</div>
        `;

        document.body.appendChild(panel);

        document.getElementById('fc-minimize').addEventListener('click', closePanel);
        document.getElementById('fc-mexico-tab').addEventListener('click', openMexico);
        document.getElementById('fc-mexico-minimize').addEventListener('click', closeMexico);
        document.getElementById('fc-highlight-switch').addEventListener('change', event => {
            highlightingEnabled = event.target.checked;
            localStorage.setItem('fc-highlighting', highlightingEnabled ? 'on' : 'off');
            document.getElementById('fc-mexico-content')?.classList.toggle('fc-highlights-on', highlightingEnabled);
        });

        updatePanel();
        renderMexicoItems();
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>'"]/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        })[character]);
    }

    function money(value) {
        return Number.isFinite(value)
            ? `$${Math.round(value).toLocaleString('en-US')}`
            : '-';
    }

    function itemKey(name) {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    function readLiveListing(item) {
        const pageText = document.body?.innerText || '';

        // Direct shop ground truth only exists after landing. Never interpret
        // flight pages or another userscript's diagnostics as shop inventory.
        if (globalTravelIndicatorIsVisible(pageText)) return null;

        const candidates = document.querySelectorAll('li, article, [data-item], [data-item-id], [class*="item"]');
        const wanted = item.name.toLowerCase();

        for (const element of candidates) {
            if (element.closest('#fc-panel, [id^="fc-multi-country"], [id*="multi-country-intel"]')) continue;

            const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
            if (!text || text.length > 900 || !text.toLowerCase().includes(wanted)) continue;

            const soldOut = /sold\s*out|out\s*of\s*stock/i.test(text);
            const quantityMatch = text.match(/(?:quantity|stock|available)\s*:?\s*([\d,]+)/i);
            const priceMatch = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);

            // A real shop row must contain its own price and either a stock
            // value or an explicit sold-out label.
            if (!priceMatch || (!quantityMatch && !soldOut)) continue;

            return {
                soldOut,
                quantity: soldOut ? 0 : (quantityMatch ? Number(quantityMatch[1].replace(/,/g, '')) : null),
                cost: priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null
            };
        }

        return null;
    }

    function publishDirectShopBridge() {
        const pageText = document.body?.innerText || '';

        if (globalTravelIndicatorIsVisible(pageText)) {
            try {
                localStorage.removeItem(LIVE_BRIDGE_KEY);
            } catch (error) {}
            return false;
        }

        const bridgeItems = {};

        for (const catalogItem of MEXICO_ITEMS) {
            const feed = feedItemByName(catalogItem.name);
            if (!Number.isFinite(feed?.id)) continue;

            const live = readLiveListing(catalogItem);
            if (!live) continue;

            const stock = live.soldOut ? 0 : live.quantity;
            const cost = live.cost ?? (Number.isFinite(feed.cost) ? feed.cost : null);

            if (!Number.isFinite(stock) || !Number.isFinite(cost)) continue;

            bridgeItems[String(feed.id)] = {
                id: feed.id,
                name: catalogItem.name,
                stock,
                cost
            };
        }

        // Requiring multiple direct rows prevents unrelated item mentions from
        // being published as Torn shop ground truth.
        if (Object.keys(bridgeItems).length < 2) return false;

        try {
            localStorage.setItem(LIVE_BRIDGE_KEY, JSON.stringify({
                source: 'DIRECT_TORN_SHOP',
                country: 'Mexico',
                observedAt: Date.now(),
                items: bridgeItems
            }));
            return true;
        } catch (error) {
            return false;
        }
    }

    function getCardData(item) {
        const live = readLiveListing(item);
        const feed = feedItemByName(item.name);
        const feedCost = Number.isFinite(feed?.cost) ? feed.cost : null;
        const feedQuantity = Number.isFinite(feed?.quantity) ? feed.quantity : null;
        const cost = live?.cost ?? feedCost ?? item.cost ?? item.minCost;
        const quantity = live?.quantity ?? feedQuantity;
        const soldOut = live?.soldOut === true || quantity === 0;
        // Player Market and NPC selling prices are deliberately left unset until
        // their live price sources are connected. This prevents false highlights.
        const playerProfit = null;
        const npcProfit = Number.isFinite(item.npcSale) && Number.isFinite(cost)
            ? item.npcSale - cost
            : null;

        return {
            ...item,
            id: feed?.id ?? item.id ?? null,
            cost,
            quantity,
            soldOut,
            playerProfit,
            npcProfit,
            stockSource: live ? 'DIRECT TORN SHOP' : (feed ? 'FOREIGN STOCK FEED' : 'CATALOG FALLBACK')
        };
    }

    function profitPercent(profit, cost) {
        if (!Number.isFinite(profit) || !Number.isFinite(cost) || cost <= 0) return '-';
        return `${((profit / cost) * 100).toFixed(1)}%`;
    }

    function feedStatusText() {
        if (feedLoading) return 'Stock feed: refreshing...';
        if (mexicoFeed?.update) {
            const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000 - mexicoFeed.update));
            return `Stock feed: ${ageSeconds}s old`;
        }
        if (mexicoFeed?.receivedAt) return 'Stock feed: cached';
        if (feedError) return `Stock feed unavailable: ${feedError}`;
        return 'Stock feed: waiting for first refresh';
    }

    function renderMexicoItems(force = false) {
        const content = document.getElementById('fc-mexico-content');
        if (!content) return;

        const items = MEXICO_ITEMS.map(getCardData);
        const signature = JSON.stringify(items.map(item => [item.cost, item.quantity, item.soldOut, profitMode, sortMode, hideSoldOut, highlightingEnabled]));
        if (!force && signature === mexicoRenderSignature) return;
        mexicoRenderSignature = signature;

        const profitField = profitMode === 'npc' ? 'npcProfit' : 'playerProfit';
        const sortByProfit = sortMode.startsWith('profit-');
        const sortByQuantity = sortMode.startsWith('quantity-');
        const sortField = sortByProfit ? profitField : (sortByQuantity ? 'quantity' : 'cost');
        const descending = sortMode.endsWith('-high');
        const visibleItems = hideSoldOut ? items.filter(item => !item.soldOut) : items;
        const sortedItems = [...visibleItems].sort((left, right) => {
            const leftComparable = Number.isFinite(left[sortField]) && (!sortByProfit || !left.soldOut);
            const rightComparable = Number.isFinite(right[sortField]) && (!sortByProfit || !right.soldOut);

            if (leftComparable !== rightComparable) return leftComparable ? -1 : 1;
            if (!leftComparable) return 0;

            const difference = left[sortField] - right[sortField];
            return descending ? -difference : difference;
        });
        const profitable = items.filter(item => !item.soldOut && Number.isFinite(item[profitField]));
        const bestProfit = profitable.length
            ? Math.max(...profitable.map(item => item[profitField]))
            : null;

        let activeShop = '';
        let cards = '';

        for (const item of sortedItems) {
            if (item.shop !== activeShop) {
                activeShop = item.shop;
                cards += `<div class="fc-shop-heading">${escapeHtml(activeShop)}</div>`;
            }

            const key = itemKey(item.name);
            const state = itemCardState.get(key) || { amount: 0, expanded: false };
            const isBest = Number.isFinite(bestProfit) && item[profitField] === bestProfit;
            const quantityLabel = item.soldOut
                ? 'SOLD OUT'
                : (Number.isFinite(item.quantity) ? item.quantity.toLocaleString('en-US') : 'Stock updates in Mexico');
            const totalCost = state.amount * item.cost;
            const totalMarketProfit = Number.isFinite(item.playerProfit)
                ? state.amount * item.playerProfit
                : null;

            cards += `
                <section class="fc-item-card ${item.soldOut ? 'fc-sold-out' : ''} ${isBest ? 'fc-best-profit' : ''}" data-item-key="${key}">
                    <div class="fc-item-top">
                        <div class="fc-item-name">${escapeHtml(item.name)}</div>
                        <div class="fc-stock ${item.soldOut ? 'sold' : ''}">${quantityLabel}</div>
                    </div>
                    <div class="fc-item-cost">Cost abroad: ${money(item.cost)}${item.maxCost && item.stockSource === 'CATALOG FALLBACK' ? `-${money(item.maxCost)}` : ''}</div>
                    <div class="fc-catalog-note">Source: ${escapeHtml(item.stockSource)}</div>
                    <div class="fc-buy-row">
                        <label class="fc-buy-label">BUY AMOUNT</label>
                        <input class="fc-buy-input" type="number" inputmode="numeric" min="0" ${Number.isFinite(item.quantity) ? `max="${item.quantity}"` : ''} value="${state.amount}">
                        <button class="fc-button fc-buy-max" type="button" ${item.soldOut || !Number.isFinite(item.quantity) ? 'disabled' : ''}>BUY MAX</button>
                    </div>
                    <div class="fc-card-summary">
                        <span>Total cost: <strong class="fc-total-cost">${money(totalCost)}</strong></span>
                        <span>Stock remaining: <strong class="fc-stock-remaining">${Number.isFinite(item.quantity) ? Math.max(0, item.quantity - state.amount).toLocaleString('en-US') : '-'}</strong></span>
                    </div>
                    <button class="fc-button fc-profit-toggle" type="button">${state.expanded ? 'HIDE PROFIT INFO ^' : 'VIEW PROFIT INFO v'}</button>
                    <div class="fc-profit-panel" ${state.expanded ? '' : 'hidden'}>
                        <div class="fc-profit-section">
                            <div class="fc-profit-title">NPC STORE PROFIT</div>
                            <div>Sell to: <strong>${escapeHtml(item.npcStore || 'Store data pending')}</strong></div>
                            <div>Profit: <strong>${money(item.npcProfit)}</strong></div>
                            <div>Profit range: <strong>-</strong></div>
                            <div>Profit: <strong>${profitPercent(item.npcProfit, item.cost)}</strong></div>
                        </div>
                        <div class="fc-profit-section">
                            <div class="fc-profit-title">PLAYER MARKET PROFIT</div>
                            <div>Per item: <strong>${Number.isFinite(item.playerProfit) ? money(item.playerProfit) : 'Live price pending'}</strong></div>
                            <div>Profit range: <strong>-</strong></div>
                            <div>Profit: <strong>${profitPercent(item.playerProfit, item.cost)}</strong></div>
                            <div>Selected total profit: <strong class="fc-total-profit">${money(totalMarketProfit)}</strong></div>
                        </div>
                    </div>
                </section>`;
        }

        content.classList.toggle('fc-highlights-on', highlightingEnabled);
        content.innerHTML = `
            <div class="fc-profit-mode" aria-label="Best-profit highlight mode">
                <button class="fc-mode-choice ${profitMode === 'npc' ? 'active' : ''}" data-profit-mode="npc" type="button">NPC PROFIT</button>
                <button class="fc-mode-choice ${profitMode === 'market' ? 'active' : ''}" data-profit-mode="market" type="button">PLAYER MARKET</button>
            </div>
            <div class="fc-sort-mode" aria-label="Item sorting order">
                <button class="fc-mode-choice ${sortMode === 'price-high' ? 'active' : ''}" data-sort-mode="price-high" type="button">HIGHEST PRICE FIRST</button>
                <button class="fc-mode-choice ${sortMode === 'price-low' ? 'active' : ''}" data-sort-mode="price-low" type="button">LOWEST PRICE FIRST</button>
                <button class="fc-mode-choice ${sortMode === 'profit-high' ? 'active' : ''}" data-sort-mode="profit-high" type="button">HIGHEST PROFIT FIRST</button>
                <button class="fc-mode-choice ${sortMode === 'profit-low' ? 'active' : ''}" data-sort-mode="profit-low" type="button">LOWEST PROFIT FIRST</button>
                <button class="fc-mode-choice ${sortMode === 'quantity-high' ? 'active' : ''}" data-sort-mode="quantity-high" type="button">HIGHEST QUANTITY FIRST</button>
                <button class="fc-mode-choice ${sortMode === 'quantity-low' ? 'active' : ''}" data-sort-mode="quantity-low" type="button">LOWEST QUANTITY FIRST</button>
            </div>
            <button class="fc-sold-out-toggle ${hideSoldOut ? 'active' : ''}" data-toggle-sold-out type="button">HIDE ALL SOLD OUT ITEMS: ${hideSoldOut ? 'ON' : 'OFF'}</button>
            <div class="fc-catalog-note">Complete Mexico catalog - sold-out items stay visible<br>${escapeHtml(feedStatusText())}</div>
            <button id="fc-copy-diagnostics" class="fc-button" type="button">COPY DIAGNOSTIC DATA</button>
            ${cards}`;

        bindMexicoCardEvents(sortedItems);
    }

    function diagnosticTextForItem(item) {
        const candidates = document.querySelectorAll(
            'li, article, [data-item], [data-item-id], [class*="item"]'
        );
        const wanted = item.name.toLowerCase();
        const matches = [];

        for (const element of candidates) {
            if (element.closest('#fc-panel, [id^="fc-multi-country"], [id*="multi-country-intel"]')) continue;

            const text = (element.innerText || '')
                .replace(/\s+/g, ' ')
                .trim();

            if (!text || !text.toLowerCase().includes(wanted)) continue;

            matches.push({
                tag: element.tagName,
                className: typeof element.className === 'string'
                    ? element.className.slice(0, 300)
                    : '',
                text: text.slice(0, 1200)
            });

            if (matches.length >= 5) break;
        }

        return matches;
    }

    function buildDiagnosticReport() {
        const pageText = document.body?.innerText || '';
        const flight = getFlightInfo();
        const items = MEXICO_ITEMS.map(item => {
            const calculated = getCardData(item);
            return {
                name: calculated.name,
                shop: calculated.shop,
                configuredCost: item.cost ?? null,
                configuredCostRange: item.minCost
                    ? [item.minCost, item.maxCost]
                    : null,
                legacyMarketReferenceIgnored: item.market ?? null,
                foreignStockFeedItem: feedItemByName(item.name),
                detectedCost: calculated.cost ?? null,
                detectedQuantity: calculated.quantity,
                detectedSoldOut: calculated.soldOut,
                calculatedPlayerProfit: calculated.playerProfit,
                calculatedNpcProfit: calculated.npcProfit,
                npcStore: calculated.npcStore ?? null,
                matchingPageElements: diagnosticTextForItem(item)
            };
        });

        const availablePlayerItems = items.filter(item =>
            !item.detectedSoldOut && Number.isFinite(item.calculatedPlayerProfit)
        );
        const highestPlayerProfit = availablePlayerItems.length
            ? Math.max(...availablePlayerItems.map(item => item.calculatedPlayerProfit))
            : null;

        return JSON.stringify({
            report: 'Torn Flight Command Mexico diagnostics',
            scriptVersion: VERSION,
            generatedAt: new Date().toISOString(),
            page: {
                origin: location.origin,
                pathname: location.pathname,
                title: document.title,
                viewport: `${window.innerWidth}x${window.innerHeight}`
            },
            flight: {
                travelingIndicatorVisible: globalTravelIndicatorIsVisible(pageText),
                detected: flight
            },
            foreignStockFeed: {
                url: FEED_URL,
                status: feedStatusText(),
                update: mexicoFeed?.update ?? null,
                receivedAt: mexicoFeed?.receivedAt ?? null,
                itemCount: mexicoFeed?.stocks?.length ?? 0,
                lastError: feedError || null
            },
            liveBridge: (() => {
                try {
                    return JSON.parse(localStorage.getItem(LIVE_BRIDGE_KEY) || 'null');
                } catch (error) {
                    return null;
                }
            })(),
            highlighting: {
                enabled: highlightingEnabled,
                selectedMode: profitMode,
                highestPlayerProfit,
                itemsMarkedHighestPlayerProfit: Number.isFinite(highestPlayerProfit)
                    ? items
                        .filter(item => item.calculatedPlayerProfit === highestPlayerProfit)
                        .map(item => item.name)
                    : []
            },
            mexicoItems: items
        }, null, 2);
    }

    function fallbackCopyText(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Copy command was rejected');
    }

    async function copyDiagnosticData(button) {
        const originalText = button.textContent;

        try {
            const report = buildDiagnosticReport();

            try {
                await navigator.clipboard.writeText(report);
            } catch (clipboardError) {
                fallbackCopyText(report);
            }

            button.textContent = 'COPIED - PASTE IT INTO CHAT';
            button.classList.remove('fc-copy-error');
            button.classList.add('fc-copy-success');
        } catch (error) {
            button.textContent = 'COPY FAILED - TAP AGAIN';
            button.classList.remove('fc-copy-success');
            button.classList.add('fc-copy-error');
        }

        setTimeout(() => {
            if (!button.isConnected) return;
            button.textContent = originalText;
            button.classList.remove('fc-copy-success', 'fc-copy-error');
        }, 4000);
    }

    function bindMexicoCardEvents(items) {
        const content = document.getElementById('fc-mexico-content');
        if (!content) return;

        const diagnosticButton = content.querySelector('#fc-copy-diagnostics');
        diagnosticButton?.addEventListener('click', () => copyDiagnosticData(diagnosticButton));

        content.querySelectorAll('[data-profit-mode]').forEach(button => {
            button.addEventListener('click', () => {
                profitMode = button.dataset.profitMode;
                localStorage.setItem('fc-profit-mode', profitMode);
                mexicoRenderSignature = '';
                renderMexicoItems(true);
            });
        });

        content.querySelectorAll('[data-sort-mode]').forEach(button => {
            button.addEventListener('click', () => {
                sortMode = button.dataset.sortMode;
                localStorage.setItem('fc-sort-mode', sortMode);
                mexicoRenderSignature = '';
                renderMexicoItems(true);
            });
        });

        content.querySelector('[data-toggle-sold-out]')?.addEventListener('click', () => {
            hideSoldOut = !hideSoldOut;
            localStorage.setItem('fc-hide-sold-out', String(hideSoldOut));
            mexicoRenderSignature = '';
            renderMexicoItems(true);
        });

        content.querySelectorAll('.fc-item-card').forEach(card => {
            const key = card.dataset.itemKey;
            const item = items.find(candidate => itemKey(candidate.name) === key);
            if (!item) return;

            const input = card.querySelector('.fc-buy-input');
            const maxButton = card.querySelector('.fc-buy-max');
            const profitButton = card.querySelector('.fc-profit-toggle');

            const updateAmount = rawAmount => {
                const available = Number.isFinite(item.quantity) ? item.quantity : Number.MAX_SAFE_INTEGER;
                const amount = Math.max(0, Math.min(available, Math.floor(Number(rawAmount) || 0)));
                const oldState = itemCardState.get(key) || {};
                itemCardState.set(key, { ...oldState, amount });
                input.value = amount;
                card.querySelector('.fc-total-cost').textContent = money(amount * item.cost);
                card.querySelector('.fc-stock-remaining').textContent = Number.isFinite(item.quantity)
                    ? Math.max(0, item.quantity - amount).toLocaleString('en-US')
                    : '-';
                card.querySelector('.fc-total-profit').textContent = Number.isFinite(item.playerProfit)
                    ? money(amount * item.playerProfit)
                    : 'Live price pending';
            };

            input.addEventListener('input', () => updateAmount(input.value));
            maxButton.addEventListener('click', () => updateAmount(item.quantity));
            profitButton.addEventListener('click', () => {
                const panel = card.querySelector('.fc-profit-panel');
                const expanded = panel.hidden;
                panel.hidden = !expanded;
                profitButton.textContent = expanded ? 'HIDE PROFIT INFO ^' : 'VIEW PROFIT INFO v';
                const oldState = itemCardState.get(key) || { amount: 0 };
                itemCardState.set(key, { ...oldState, expanded });
            });
        });
    }

    function openMexico() {
        mexicoOpen = true;
        const panel = document.getElementById('fc-mexico-panel');
        if (panel) panel.style.display = 'block';
        refreshMexicoFeed();
        renderMexicoItems(true);
    }

    function closeMexico() {
        mexicoOpen = false;
        const panel = document.getElementById('fc-mexico-panel');
        if (panel) panel.style.display = 'none';
    }

    function openPanel() {
        panelOpen = true;
        document.body.classList.add('fc-active');
        createPanel();

        const panel = document.getElementById('fc-panel');
        if (panel) panel.style.display = 'block';

        hideRealNotes();
        updatePanel();
    }

    function closePanel() {
        panelOpen = false;
        mexicoOpen = false;
        document.body.classList.remove('fc-active');
        document.getElementById('fc-panel')?.remove();
    }

    function togglePanel() {
        if (panelOpen) closePanel();
        else openPanel();
    }

    function updatePanel() {
        if (!panelOpen) return;

        const info = getFlightInfo();
        const country = document.getElementById('fc-country');
        const route = document.getElementById('fc-route');
        const mode = document.getElementById('fc-mode');

        if (!country || !route || !mode) return;

        if (!info) {
            country.textContent = 'NO FLIGHT DETECTED';
            route.textContent = 'Flight Command is standing by';
            mode.textContent = 'STANDBY';
            mode.className = 'standby';
            return;
        }

        country.textContent = info.country;
        route.textContent = info.route;
        mode.textContent = info.direction;
        mode.className = info.direction === 'RETURNING' ? 'returning' : 'outbound';
    }

    function elementLooksLikeNotesButton(element) {
        if (!element || !(element instanceof Element)) return false;
        if (element.closest('#fc-panel')) return false;

        let node = element;

        for (let depth = 0; depth < 7 && node; depth++) {
            const text = (node.innerText || node.textContent || '')
                .trim()
                .replace(/\s+/g, ' ');

            const aria = (node.getAttribute?.('aria-label') || '').trim();
            const title = (node.getAttribute?.('title') || '').trim();

            if (text === 'Notes' || aria === 'Notes' || title === 'Notes') {
                return true;
            }

            node = node.parentElement;
        }

        return false;
    }

    function interceptNotes(event) {
        if (!elementLooksLikeNotesButton(event.target)) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        togglePanel();
        return false;
    }

    document.addEventListener('click', interceptNotes, true);

    function hideRealNotes() {
        if (!panelOpen) return;

        const notesPanel = document.getElementById('notes_panel');
        if (!notesPanel) return;

        notesPanel.style.setProperty('display', 'none', 'important');
        notesPanel.style.setProperty('visibility', 'hidden', 'important');
        notesPanel.style.setProperty('pointer-events', 'none', 'important');
    }

    const observer = new MutationObserver(() => {
        if (panelOpen) hideRealNotes();
    });

    function startObserver() {
        if (!document.body) {
            setTimeout(startObserver, 100);
            return;
        }

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    setInterval(() => {
        if (panelOpen) {
            updatePanel();
            hideRealNotes();
            if (mexicoOpen) renderMexicoItems();
        }
    }, 500);

    setInterval(() => {
        refreshMexicoFeed();
        publishDirectShopBridge();
    }, FEED_REFRESH_MS);

    startObserver();
    refreshMexicoFeed(true);

})();
