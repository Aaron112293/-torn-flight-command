// ==UserScript==
// @name         Torn Flight Command
// @namespace    torn.flight.command
// @version      1.8.22
// @description  Flight Command travel, profit, cash-reserve, smart purchase, and automatic return controls
// @updateURL    https://raw.githubusercontent.com/Aaron112293/-torn-flight-command/main/Torn_Flight_Command_v1.8.22.user.js
// @downloadURL  https://raw.githubusercontent.com/Aaron112293/-torn-flight-command/main/Torn_Flight_Command_v1.8.22.user.js
// @match        https://www.torn.com/*
// @connect      yata.yt
// @connect      weav3r.dev
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = 'v1.8.22';
    const FLIGHT_STATE_KEY = 'fc-last-confirmed-flight';
    const GROUND_STATE_KEY = 'fc-ground-location-v1';
    const FLIGHT_DESTINATION_KEY = 'fc-flight-destination-v1';
    const FLIGHT_TYPE_KEY = 'fc-flight-type-v1';
    const CASH_RESERVE_KEY = 'fc-minimum-cash-reserve-v1';
    const AUTO_BUY_ENABLED_KEY = 'fc-auto-buy-enabled-v1';
    const AUTO_BUY_MODE_KEY = 'fc-auto-buy-mode-v1';
    const AUTO_BUY_ITEM_KEY = 'fc-auto-buy-item-v1';
    const AUTO_BUY_TRIP_KEY = 'fc-auto-buy-trip-v1';
    const AUTO_RETURN_PENDING_KEY = 'fc-auto-return-pending-v1';
    const FLIGHT_INTENT_KEY = 'fc-pending-flight-intent-v2';
    const TRAVEL_PAGE_URL = 'https://www.torn.com/page.php?sid=travel';
    const LONG_PRESS_MS = 650;
    const FEED_URL = 'https://yata.yt/api/v1/travel/export/';
    const FEED_CACHE_KEY = 'fc-mexico-foreign-stock-cache-v1';
    const PRICE_API_BASE = 'https://weav3r.dev/api/marketplace/';
    const PRICE_CACHE_KEY = 'fc-weav3r-market-price-cache-v1';
    const LIVE_BRIDGE_KEY = 'flightCommandLiveShopBridgeV1';
    const FEED_REFRESH_MS = 30000;
    const PRICE_REFRESH_MS = 15 * 60 * 1000;
    const PRICE_FORCE_COOLDOWN_MS = 60 * 1000;

    const itemCardState = new Map();
    let mexicoRenderSignature = '';
    let highlightingEnabled = localStorage.getItem('fc-highlighting') !== 'off';
    const savedProfitMode = localStorage.getItem('fc-profit-mode');
    let profitMode = ['npc', 'market', 'auto'].includes(savedProfitMode) ? savedProfitMode : 'market';
    const savedSortMode = localStorage.getItem('fc-sort-mode');
    let sortMode = ['price-high', 'price-low', 'profit-high', 'profit-low', 'quantity-high', 'quantity-low'].includes(savedSortMode)
        ? savedSortMode
        : 'profit-high';
    let hideSoldOut = localStorage.getItem('fc-hide-sold-out') === 'true';
    let mexicoFeed = loadCachedMexicoFeed();
    let feedLoading = false;
    let feedError = '';
    let lastFeedRequest = 0;
    let marketPrices = loadCachedMarketPrices();
    let marketPriceLoading = false;
    let marketPriceError = '';
    let marketPriceProgress = { complete: 0, total: 0 };
    let lastMarketPriceBatch = 0;
    let lastPurchaseAttempt = null;
    let lastFlightAction = null;
    let selectedFlightDestination = localStorage.getItem(FLIGHT_DESTINATION_KEY) || 'Mexico';
    let selectedFlightType = localStorage.getItem(FLIGHT_TYPE_KEY) || 'Private Jet';
    let minimumCashReserve = Math.max(0, Number(localStorage.getItem(CASH_RESERVE_KEY)) || 0);
    let autoBuyEnabled = localStorage.getItem(AUTO_BUY_ENABLED_KEY) === 'on';
    let autoBuyMode = localStorage.getItem(AUTO_BUY_MODE_KEY) === 'manual' ? 'manual' : 'auto';
    let manualBuyItem = localStorage.getItem(AUTO_BUY_ITEM_KEY) || 'Jaguar Plushie';
    let flightPressTimer = null;
    let flightLongPressTriggered = false;
    let flightIntentBusy = false;
    let lastRecoveredBoardingControl = null;
    let purchasePressTimer = null;
    let purchaseLongPressTriggered = false;
    let smartPurchaseBusy = false;
    let lastSmartPurchaseAction = null;

    const FLIGHT_DESTINATIONS = ['Mexico'];
    const FLIGHT_TYPES = ['Standard', 'Airstrip', 'Private Jet'];

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

    function loadCachedMarketPrices() {
        try {
            const cached = JSON.parse(localStorage.getItem(PRICE_CACHE_KEY) || '{}');
            return cached && typeof cached === 'object' ? cached : {};
        } catch (error) {
            return {};
        }
    }

    function saveMarketPrices() {
        try {
            localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(marketPrices));
        } catch (error) {
            // Current in-memory prices remain usable if storage is unavailable.
        }
    }

    function marketPriceById(id) {
        return Number.isFinite(Number(id)) ? marketPrices[String(id)] || null : null;
    }

    function responseText(response) {
        if (typeof response === 'string') return response;
        return [response?.responseText, response?.response, response?.body]
            .find(value => typeof value === 'string') || '';
    }

    async function requestMarketPriceJson(itemId) {
        const url = `${PRICE_API_BASE}${itemId}?limit=5`;
        if (typeof PDA_httpGet === 'function') {
            const response = await PDA_httpGet(url, { Accept: 'application/json' });
            const text = responseText(response);
            if (!text) throw new Error('Weav3r returned no response text.');
            return JSON.parse(text);
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            credentials: 'omit'
        });
        if (!response.ok) throw new Error(`Weav3r request failed (${response.status}).`);
        return response.json();
    }

    function normalizeMarketPrice(data) {
        const listings = Array.isArray(data?.listings)
            ? data.listings
                .map(listing => ({
                    price: Number(listing?.price),
                    quantity: Number(listing?.quantity),
                    updated: Number(listing?.last_checked ?? listing?.content_updated)
                }))
                .filter(listing => Number.isFinite(listing.price) && listing.price >= 0)
                .sort((left, right) => left.price - right.price)
            : [];
        const lowest = listings[0] || null;
        const marketPrice = Number(data?.market_price);
        const bazaarAverage = Number(data?.bazaar_average);
        const generatedAt = Number(data?.generated_at);

        return {
            itemId: Number(data?.item_id),
            itemName: String(data?.item_name || ''),
            lowestListingPrice: lowest?.price ?? null,
            lowestListingQuantity: Number.isFinite(lowest?.quantity) ? lowest.quantity : null,
            lowestListingUpdated: Number.isFinite(lowest?.updated) ? lowest.updated : null,
            marketPrice: Number.isFinite(marketPrice) ? marketPrice : null,
            bazaarAverage: Number.isFinite(bazaarAverage) ? bazaarAverage : null,
            generatedAt: Number.isFinite(generatedAt) ? generatedAt : null,
            receivedAt: Date.now()
        };
    }

    async function refreshMarketPrices(force = false) {
        if (marketPriceLoading || !Array.isArray(mexicoFeed?.stocks)) return;
        if (force && Date.now() - lastMarketPriceBatch < PRICE_FORCE_COOLDOWN_MS) {
            marketPriceError = 'Price refresh is limited to once per minute.';
            mexicoRenderSignature = '';
            renderMexicoItems(true);
            return;
        }

        const available = MEXICO_ITEMS
            .map(item => feedItemByName(item.name))
            .filter(item => Number.isFinite(item?.id) && Number(item.quantity) > 0);
        const targets = available.filter(item => {
            const cached = marketPriceById(item.id);
            return force || !cached?.receivedAt || Date.now() - cached.receivedAt >= PRICE_REFRESH_MS;
        });
        if (!targets.length) return;

        marketPriceLoading = true;
        marketPriceError = '';
        marketPriceProgress = { complete: 0, total: targets.length };
        lastMarketPriceBatch = Date.now();
        let failures = 0;
        mexicoRenderSignature = '';
        renderMexicoItems(true);

        let cursor = 0;
        const worker = async () => {
            while (cursor < targets.length) {
                const target = targets[cursor++];
                try {
                    const data = await requestMarketPriceJson(target.id);
                    const normalized = normalizeMarketPrice(data);
                    if (!Number.isFinite(normalized.itemId)) throw new Error('Missing item ID.');
                    marketPrices[String(target.id)] = normalized;
                    saveMarketPrices();
                } catch (error) {
                    failures += 1;
                }
                marketPriceProgress.complete += 1;
                mexicoRenderSignature = '';
                renderMexicoItems(true);
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        };

        await Promise.all([worker(), worker()]);
        marketPriceLoading = false;
        marketPriceError = failures
            ? `${failures} of ${targets.length} live price requests failed; cached prices retained.`
            : '';
        mexicoRenderSignature = '';
        renderMexicoItems(true);
    }

    async function requestFeedJson() {
        const requestUrl = `${FEED_URL}?fc=${Date.now()}`;
        if (typeof PDA_httpGet === 'function') {
            const response = await PDA_httpGet(requestUrl, {
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

        const response = await fetch(requestUrl, {
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
            void refreshMarketPrices();
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
    let filtersOpen = false;
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

    function nativePageText() {
        return [...(document.body?.children || [])]
            .filter(element => element.id !== 'fc-panel')
            .map(element => element.innerText || '')
            .join('\n');
    }

    function getFlightInfo() {
        const text = nativePageText();
        const travelingVisible = globalTravelIndicatorIsVisible(text);
        let routeMatch = null;

        const travelingLink = [...document.querySelectorAll('[aria-label*="Traveling from" i]')]
            .find(element => !element.closest('#fc-panel'));
        const travelingLabel = travelingLink?.getAttribute('aria-label') || '';
        const countries = [...new Set(Object.values(CITY_TO_COUNTRY))];
        for (const country of countries) {
            const escaped = country.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`Traveling\\s+from\\s+Torn\\s+to\\s+${escaped}`, 'i').test(travelingLabel)) {
                routeMatch = {
                    country,
                    city: null,
                    direction: 'OUTBOUND',
                    route: `Torn -> ${country}`
                };
                break;
            }
            if (new RegExp(`Traveling\\s+from\\s+${escaped}\\s+to\\s+Torn`, 'i').test(travelingLabel)) {
                routeMatch = {
                    country,
                    city: null,
                    direction: 'RETURNING',
                    route: `${country} -> Torn`
                };
                break;
            }
        }

        for (const city of routeMatch ? [] : Object.keys(CITY_TO_COUNTRY)) {
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
            saveGroundState({
                location: 'traveling',
                country: routeMatch.country,
                direction: routeMatch.direction
            });
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

    function loadGroundState() {
        try {
            const state = JSON.parse(localStorage.getItem(GROUND_STATE_KEY) || 'null');
            return state && typeof state === 'object' ? state : null;
        } catch (error) {
            return null;
        }
    }

    function saveGroundState(state) {
        try {
            localStorage.setItem(GROUND_STATE_KEY, JSON.stringify({ ...state, recordedAt: Date.now() }));
        } catch (error) {
            // The controls can still use page-based detection for this session.
        }
    }

    function pageLooksLikeMexicoShop() {
        let matches = 0;
        for (const item of MEXICO_ITEMS) {
            if (findNativeShopRow(item)) matches += 1;
            if (matches >= 2) return true;
        }
        return false;
    }

    function currentGroundState(flightInfo = getFlightInfo()) {
        if (flightInfo) {
            return {
                kind: 'traveling',
                country: flightInfo.country,
                direction: flightInfo.direction
            };
        }

        if (pageLooksLikeMexicoShop()) {
            saveGroundState({ location: 'abroad', country: 'Mexico' });
            return { kind: 'abroad', country: 'Mexico' };
        }

        const saved = loadGroundState();
        if (saved?.location === 'traveling') {
            if (saved.direction === 'OUTBOUND') {
                saveGroundState({ location: 'abroad', country: saved.country || 'Mexico' });
                return { kind: 'abroad', country: saved.country || 'Mexico' };
            }
            if (saved.direction === 'RETURNING') {
                saveGroundState({ location: 'torn', country: 'Torn' });
                return { kind: 'torn', country: 'Torn' };
            }
        }

        if (saved?.location === 'abroad') return { kind: 'abroad', country: saved.country || 'Mexico' };
        return { kind: 'torn', country: 'Torn' };
    }

    function parseCompactCash(value) {
        const cleaned = String(value || '').trim().replace(/[$,\s]/g, '');
        const match = cleaned.match(/^(\d+(?:\.\d+)?)([KMBT]?)$/i);
        if (!match) return null;
        const multiplier = {
            K: 1_000,
            M: 1_000_000,
            B: 1_000_000_000,
            T: 1_000_000_000_000
        }[match[2].toUpperCase()] || 1;
        const amount = Number(match[1]) * multiplier;
        return Number.isFinite(amount) ? Math.round(amount) : null;
    }

    function readCurrentCash() {
        const preferred = [
            ...document.querySelectorAll('#user-money, [data-testid*="money" i], [aria-label*="cash" i], [title*="cash" i], [class*="money" i]')
        ];
        const exactTextCandidates = [...document.querySelectorAll('span, strong, div, p')]
            .filter(element => /^\s*\$\s*\d[\d,.]*\s*[KMBT]?\s*$/i.test(element.innerText || ''));
        const candidates = [...new Set([...preferred, ...exactTextCandidates])];

        for (const element of candidates) {
            if (!visibleElement(element) || element.closest('#fc-panel')) continue;
            const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
            const match = text.match(/\$\s*(\d[\d,.]*\s*[KMBT]?)/i);
            const amount = parseCompactCash(match?.[1]);
            if (!Number.isFinite(amount)) continue;
            return {
                amount,
                sourceText: match[0].replace(/\s+/g, ''),
                tag: element.tagName,
                className: typeof element.className === 'string' ? element.className.slice(0, 300) : ''
            };
        }
        return null;
    }

    function cashReserveStatus() {
        const cash = readCurrentCash();
        const enabled = minimumCashReserve > 0;
        return {
            enabled,
            reserve: minimumCashReserve,
            currentCash: cash?.amount ?? null,
            sourceText: cash?.sourceText ?? null,
            source: cash,
            locked: enabled && (!Number.isFinite(cash?.amount) || cash.amount < minimumCashReserve)
        };
    }

    function isTravelPage() {
        return location.pathname === '/page.php'
            && new URLSearchParams(location.search).get('sid') === 'travel';
    }

    function loadPendingFlightIntent() {
        try {
            const intent = JSON.parse(localStorage.getItem(FLIGHT_INTENT_KEY) || 'null');
            return intent && typeof intent === 'object' ? intent : null;
        } catch (error) {
            return null;
        }
    }

    function savePendingFlightIntent(intent) {
        try {
            localStorage.setItem(FLIGHT_INTENT_KEY, JSON.stringify(intent));
        } catch (error) {
            // The current page can still attempt the action without persistence.
        }
    }

    function clearPendingFlightIntent() {
        try {
            localStorage.removeItem(FLIGHT_INTENT_KEY);
        } catch (error) {
            // Nothing else is required if storage is unavailable.
        }
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
                display: flex;
                flex-direction: column;
            }

            #fc-panel.fc-cash-lock {
                border-color: #ff6269;
                animation: fc-cash-border-pulse 1.6s ease-in-out infinite;
            }

            #fc-panel.fc-cash-lock::after {
                content: '';
                position: absolute;
                inset: 0;
                z-index: 2147483647;
                border-radius: inherit;
                background: #e01822;
                opacity: 0;
                pointer-events: none;
                animation: fc-cash-red-flash 1.6s ease-in-out infinite;
            }

            @keyframes fc-cash-red-flash {
                0%, 100% { opacity: 0; }
                50% { opacity: .42; }
            }

            @keyframes fc-cash-border-pulse {
                0%, 100% { box-shadow: 0 16px 50px rgba(0,0,0,.65); }
                50% { box-shadow: 0 0 0 3px rgba(255,71,79,.55), 0 0 32px rgba(255,32,42,.82), 0 16px 50px rgba(0,0,0,.72); }
            }

            #fc-panel.fc-cash-lock #fc-mode.cash-blocked {
                background: #7c171d;
                border-color: #ff7379;
                color: #fff;
            }

            #fc-header {
                flex: 0 0 auto;
                height: 66px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 20px;
                border-bottom: 1px solid rgba(255,255,255,.08);
            }

            #fc-scroll-body {
                min-height: 0;
                overflow-y: auto;
                overflow-x: hidden;
                overscroll-behavior: contain;
                -webkit-overflow-scrolling: touch;
                touch-action: none;
                scrollbar-gutter: stable;
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
                font-family: inherit;
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

            #fc-mode.flight-action {
                min-width: 176px;
                padding: 10px 16px;
                background: #294f72;
                border: 1px solid #5793c4;
                color: #eef8ff;
                touch-action: manipulation;
                -webkit-user-select: none;
                user-select: none;
            }

            #fc-mode.return-action {
                background: rgba(190,125,35,.25);
                border-color: #b27d31;
                color: #ffd184;
            }

            #fc-mode:disabled {
                opacity: 1;
            }

            #fc-flight-hint {
                margin-top: 8px;
                color: #8995a4;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: .25px;
            }

            #fc-purchase-mode {
                display: block;
                width: 100%;
                margin-top: 13px;
                padding: 11px 12px;
                border: 1px solid #45bf78;
                border-radius: 10px;
                background: linear-gradient(180deg, #248f50, #176638);
                color: #f2fff7;
                font: 900 12px inherit;
                letter-spacing: .65px;
                touch-action: manipulation;
                -webkit-user-select: none;
                user-select: none;
            }

            #fc-purchase-mode.off {
                border-color: #49735c;
                background: rgba(35,91,58,.42);
                color: #a9d6bb;
            }

            #fc-purchase-mode.busy {
                animation: fc-purchase-pulse 1s ease-in-out infinite;
            }

            #fc-purchase-mode.error {
                border-color: #ff7379;
                background: #7c171d;
            }

            @keyframes fc-purchase-pulse {
                0%, 100% { box-shadow: 0 0 0 rgba(63,219,125,0); }
                50% { box-shadow: 0 0 20px rgba(63,219,125,.65); }
            }

            #fc-purchase-hint {
                margin-top: 6px;
                color: #86a995;
                font-size: 10px;
                font-weight: 700;
            }

            #fc-purchase-picker {
                margin-top: 10px;
                padding: 13px;
                border: 1px solid rgba(69,191,120,.45);
                border-radius: 12px;
                background: rgba(5,18,11,.88);
                text-align: left;
            }

            #fc-purchase-picker[hidden] {
                display: none !important;
            }

            .fc-purchase-toggle-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin-bottom: 13px;
                color: #dff7e8;
                font-size: 12px;
                font-weight: 900;
            }

            #fc-auto-buy-switch {
                width: 22px;
                height: 22px;
                accent-color: #36bd70;
            }

            .fc-purchase-options {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 7px;
                margin-bottom: 12px;
            }

            .fc-purchase-option,
            #fc-manual-buy-item,
            #fc-purchase-picker-close {
                min-width: 0;
                border: 1px solid rgba(255,255,255,.14);
                border-radius: 9px;
                padding: 10px 8px;
                background: rgba(255,255,255,.05);
                color: #dce5ef;
                font: 900 11px inherit;
            }

            .fc-purchase-option.active {
                border-color: #45bf78;
                background: #176638;
                color: #fff;
            }

            #fc-manual-buy-item {
                width: 100%;
                margin-bottom: 10px;
                background: #101914;
            }

            #fc-auto-buy-status {
                margin-bottom: 11px;
                color: #9fc2ae;
                font-size: 10px;
                font-weight: 800;
                line-height: 1.4;
            }

            #fc-purchase-picker-close {
                width: 100%;
                border-color: #45bf78;
                background: #176638;
            }

            #fc-flight-picker {
                margin-top: 14px;
                padding: 13px;
                border: 1px solid rgba(255,255,255,.14);
                border-radius: 12px;
                background: rgba(5,8,12,.72);
                text-align: left;
            }

            #fc-flight-picker[hidden] {
                display: none !important;
            }

            .fc-flight-picker-title {
                margin: 0 0 8px;
                color: #aeb9c7;
                font-size: 11px;
                font-weight: 900;
                letter-spacing: 1px;
            }

            .fc-flight-options {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 7px;
                margin-bottom: 12px;
            }

            .fc-flight-options.destination {
                grid-template-columns: 1fr;
            }

            .fc-flight-option,
            #fc-flight-picker-close {
                border: 1px solid rgba(255,255,255,.14);
                border-radius: 9px;
                padding: 9px 6px;
                background: rgba(255,255,255,.05);
                color: #dce5ef;
                font-size: 11px;
                font-weight: 900;
                font-family: inherit;
            }

            .fc-flight-option.active {
                border-color: #5793c4;
                background: #294f72;
                color: #fff;
            }

            #fc-flight-picker-close {
                width: 100%;
            }

            .fc-cash-reserve-row {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto auto;
                gap: 7px;
                margin-bottom: 8px;
            }

            #fc-cash-reserve-input {
                min-width: 0;
                border: 1px solid rgba(255,255,255,.18);
                border-radius: 9px;
                padding: 10px;
                background: rgba(0,0,0,.35);
                color: #fff;
                font: 800 13px inherit;
            }

            #fc-cash-reserve-save,
            #fc-cash-reserve-clear {
                border: 1px solid #5793c4;
                border-radius: 9px;
                padding: 9px 10px;
                background: #294f72;
                color: #fff;
                font: 900 11px inherit;
            }

            #fc-cash-reserve-clear {
                border-color: rgba(255,255,255,.16);
                background: rgba(255,255,255,.06);
            }

            #fc-cash-reserve-status {
                margin: 0 0 13px;
                color: #aeb9c7;
                font-size: 11px;
                font-weight: 800;
                line-height: 1.35;
            }

            #fc-cash-reserve-status.locked {
                color: #ff9da2;
            }

            #fc-tabs {
                padding: 0 20px 20px;
                display: grid;
                gap: 8px;
            }

            #fc-mexico-tab,
            #fc-filters-tab,
            #fc-copy-diagnostics {
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

            #fc-mexico-tab.active,
            #fc-filters-tab.active {
                border-color: #5681ad;
                background: #294764;
                color: #eef7ff;
            }

            #fc-mexico-panel,
            #fc-filters-panel {
                margin: 0 20px 20px;
                border: 1px solid rgba(255,255,255,.10);
                border-radius: 12px;
                background: rgba(0,0,0,.18);
                overflow: visible;
                max-height: none;
            }

            #fc-filters-panel {
                height: auto;
                max-height: none;
                overflow: visible;
                touch-action: auto;
            }

            #fc-mexico-header,
            #fc-filters-header {
                min-height: 48px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 14px;
                border-bottom: 1px solid rgba(255,255,255,.07);
            }

            #fc-mexico-title,
            #fc-filters-title {
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

            #fc-mexico-content,
            #fc-filters-content {
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
                padding: 12px 14px;
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

            .fc-profit-mode {
                grid-template-columns: repeat(3, 1fr);
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

            <div id="fc-scroll-body">
            <div id="fc-content">
                <div id="fc-country">DETECTING...</div>
                <div id="fc-route">Checking flight status</div>
                <button id="fc-mode" class="standby" type="button" disabled>STANDBY</button>
                <div id="fc-flight-hint">Hold the flight button to choose destination and flight type</div>
                <button id="fc-purchase-mode" class="off" type="button">AUTO BUY: OFF</button>
                <div id="fc-purchase-hint">Tap to buy now · Hold for settings · Returns to Torn after purchase</div>
                <div id="fc-purchase-picker" hidden>
                    <label class="fc-purchase-toggle-row">
                        AUTO BUY AFTER LANDING
                        <input id="fc-auto-buy-switch" type="checkbox" ${autoBuyEnabled ? 'checked' : ''}>
                    </label>
                    <div class="fc-flight-picker-title">PURCHASE MODE</div>
                    <div class="fc-purchase-options">
                        <button class="fc-purchase-option" data-auto-buy-mode="auto" type="button">AUTO MOST PROFIT</button>
                        <button class="fc-purchase-option" data-auto-buy-mode="manual" type="button">MANUAL ITEM</button>
                    </div>
                    <div class="fc-flight-picker-title">MANUAL ITEM · MEXICO</div>
                    <select id="fc-manual-buy-item">
                        ${MEXICO_ITEMS.map(item => `<option value="${escapeHtml(item.name)}" ${item.name === manualBuyItem ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
                    </select>
                    <div id="fc-auto-buy-status"></div>
                    <button id="fc-purchase-picker-close" type="button">DONE</button>
                </div>
                <div id="fc-flight-picker" hidden>
                    <div class="fc-flight-picker-title">DESTINATION</div>
                    <div class="fc-flight-options destination">
                        ${FLIGHT_DESTINATIONS.map(destination => `<button class="fc-flight-option" data-flight-destination="${destination}" type="button">${destination.toUpperCase()}</button>`).join('')}
                    </div>
                    <div class="fc-flight-picker-title">FLIGHT TYPE</div>
                    <div class="fc-flight-options">
                        ${FLIGHT_TYPES.map(type => `<button class="fc-flight-option" data-flight-type="${type}" type="button">${type.toUpperCase()}</button>`).join('')}
                    </div>
                    <div class="fc-flight-picker-title">MINIMUM CASH RESERVE</div>
                    <div class="fc-cash-reserve-row">
                        <input id="fc-cash-reserve-input" type="text" inputmode="decimal" autocomplete="off" placeholder="$0" value="${minimumCashReserve || ''}">
                        <button id="fc-cash-reserve-save" type="button">SAVE</button>
                        <button id="fc-cash-reserve-clear" type="button">CLEAR</button>
                    </div>
                    <div id="fc-cash-reserve-status"></div>
                    <button id="fc-flight-picker-close" type="button">DONE</button>
                </div>
            </div>

            <div id="fc-tabs">
                <button id="fc-copy-diagnostics" type="button">COPY DIAGNOSTIC DATA</button>
                <button id="fc-filters-tab" type="button">FILTERS</button>
                <button id="fc-mexico-tab" type="button">MEXICO</button>
            </div>

            <div id="fc-mexico-panel" style="display:none;">
                <div id="fc-mexico-header">
                    <div id="fc-mexico-title">MEXICO</div>
                </div>
                <div id="fc-mexico-content"></div>
            </div>

            <div id="fc-filters-panel" style="display:none;">
                <div id="fc-filters-header">
                    <div class="fc-mexico-heading">
                        <div id="fc-filters-title">FILTERS</div>
                        <label class="fc-highlight-toggle" title="Turn profit and sold-out colors on or off">
                            HIGHLIGHT
                            <input id="fc-highlight-switch" type="checkbox" ${highlightingEnabled ? 'checked' : ''}>
                            <span class="fc-toggle-track"><span class="fc-toggle-knob"></span></span>
                        </label>
                    </div>
                </div>
                <div id="fc-filters-content">
                    <div class="fc-profit-mode" aria-label="Best-profit highlight mode">
                        <button class="fc-mode-choice" data-profit-mode="npc" type="button">NPC PROFIT</button>
                        <button class="fc-mode-choice" data-profit-mode="market" type="button">PLAYER MARKET</button>
                        <button class="fc-mode-choice" data-profit-mode="auto" type="button">AUTO BEST</button>
                    </div>
                    <div class="fc-sort-mode" aria-label="Item sorting order">
                        <button class="fc-mode-choice" data-sort-mode="price-high" type="button">HIGHEST PRICE FIRST</button>
                        <button class="fc-mode-choice" data-sort-mode="price-low" type="button">LOWEST PRICE FIRST</button>
                        <button class="fc-mode-choice" data-sort-mode="profit-high" type="button">HIGHEST PROFIT FIRST</button>
                        <button class="fc-mode-choice" data-sort-mode="profit-low" type="button">LOWEST PROFIT FIRST</button>
                        <button class="fc-mode-choice" data-sort-mode="quantity-high" type="button">HIGHEST QUANTITY FIRST</button>
                        <button class="fc-mode-choice" data-sort-mode="quantity-low" type="button">LOWEST QUANTITY FIRST</button>
                    </div>
                    <button class="fc-sold-out-toggle" data-toggle-sold-out type="button"></button>
                </div>
            </div>

            <div id="fc-footer">FLIGHT COMMAND - ${VERSION}</div>
            </div>
        `;

        document.body.appendChild(panel);

        document.getElementById('fc-minimize').addEventListener('click', closePanel);
        bindFlightControl();
        bindPurchaseControl();
        document.getElementById('fc-mexico-tab').addEventListener('click', toggleMexicoSection);
        document.getElementById('fc-filters-tab').addEventListener('click', toggleFiltersSection);
        enableCapturedTouchScroll(document.getElementById('fc-scroll-body'));
        const diagnosticButton = document.getElementById('fc-copy-diagnostics');
        diagnosticButton.addEventListener('click', () => copyDiagnosticData(diagnosticButton));
        document.getElementById('fc-highlight-switch').addEventListener('change', event => {
            highlightingEnabled = event.target.checked;
            localStorage.setItem('fc-highlighting', highlightingEnabled ? 'on' : 'off');
            document.getElementById('fc-mexico-content')?.classList.toggle('fc-highlights-on', highlightingEnabled);
        });

        document.querySelectorAll('#fc-filters-content [data-profit-mode]').forEach(button => {
            button.addEventListener('click', () => {
                profitMode = button.dataset.profitMode;
                localStorage.setItem('fc-profit-mode', profitMode);
                mexicoRenderSignature = '';
                renderMexicoItems(true);
            });
        });

        document.querySelectorAll('#fc-filters-content [data-sort-mode]').forEach(button => {
            button.addEventListener('click', () => {
                sortMode = button.dataset.sortMode;
                localStorage.setItem('fc-sort-mode', sortMode);
                mexicoRenderSignature = '';
                renderMexicoItems(true);
            });
        });

        document.querySelector('#fc-filters-content [data-toggle-sold-out]').addEventListener('click', () => {
            hideSoldOut = !hideSoldOut;
            localStorage.setItem('fc-hide-sold-out', String(hideSoldOut));
            mexicoRenderSignature = '';
            renderMexicoItems(true);
        });

        updatePanel();
        renderMexicoItems();
    }

    function syncFlightPicker() {
        document.querySelectorAll('[data-flight-destination]').forEach(button => {
            button.classList.toggle('active', button.dataset.flightDestination === selectedFlightDestination);
        });
        document.querySelectorAll('[data-flight-type]').forEach(button => {
            button.classList.toggle('active', button.dataset.flightType === selectedFlightType);
        });

        const reserve = cashReserveStatus();
        const input = document.getElementById('fc-cash-reserve-input');
        const status = document.getElementById('fc-cash-reserve-status');
        if (input && document.activeElement !== input) {
            input.value = minimumCashReserve ? String(minimumCashReserve) : '';
        }
        if (status) {
            status.classList.toggle('locked', reserve.locked);
            if (!reserve.enabled) {
                status.textContent = Number.isFinite(reserve.currentCash)
                    ? `Reserve disabled · Current cash: ${money(reserve.currentCash)}`
                    : 'Reserve disabled';
            } else if (!Number.isFinite(reserve.currentCash)) {
                status.textContent = `LOCKED · Cash not detected · Reserve: ${money(reserve.reserve)}`;
            } else if (reserve.locked) {
                status.textContent = `LOCKED · ${money(reserve.currentCash)} available · ${money(reserve.reserve)} reserve`;
            } else {
                status.textContent = `Current cash: ${money(reserve.currentCash)} · Reserve: ${money(reserve.reserve)}`;
            }
        }
    }

    function openFlightPicker() {
        const picker = document.getElementById('fc-flight-picker');
        if (!picker) return;
        closePurchasePicker();
        syncFlightPicker();
        picker.hidden = false;
    }

    function closeFlightPicker() {
        const picker = document.getElementById('fc-flight-picker');
        if (picker) picker.hidden = true;
    }

    function bindFlightControl() {
        const button = document.getElementById('fc-mode');
        if (!button) return;

        const cancelTimer = () => {
            if (flightPressTimer) clearTimeout(flightPressTimer);
            flightPressTimer = null;
        };

        button.addEventListener('pointerdown', () => {
            if (button.disabled) return;
            flightLongPressTriggered = false;
            cancelTimer();
            flightPressTimer = setTimeout(() => {
                flightPressTimer = null;
                flightLongPressTriggered = true;
                openFlightPicker();
                navigator.vibrate?.(35);
            }, LONG_PRESS_MS);
        });
        button.addEventListener('pointerup', cancelTimer);
        button.addEventListener('pointercancel', cancelTimer);
        button.addEventListener('pointerleave', cancelTimer);
        button.addEventListener('contextmenu', event => event.preventDefault());
        button.addEventListener('click', event => {
            if (flightLongPressTriggered) {
                event.preventDefault();
                flightLongPressTriggered = false;
                return;
            }
            void beginFlightAction();
        });

        document.querySelectorAll('[data-flight-destination]').forEach(option => {
            option.addEventListener('click', () => {
                selectedFlightDestination = option.dataset.flightDestination;
                localStorage.setItem(FLIGHT_DESTINATION_KEY, selectedFlightDestination);
                syncFlightPicker();
                updatePanel();
            });
        });
        document.querySelectorAll('[data-flight-type]').forEach(option => {
            option.addEventListener('click', () => {
                selectedFlightType = option.dataset.flightType;
                localStorage.setItem(FLIGHT_TYPE_KEY, selectedFlightType);
                syncFlightPicker();
                updatePanel();
            });
        });

        const reserveInput = document.getElementById('fc-cash-reserve-input');
        const reserveSave = document.getElementById('fc-cash-reserve-save');
        const saveReserve = () => {
            const amount = parseCompactCash(reserveInput?.value);
            const status = document.getElementById('fc-cash-reserve-status');
            if (!Number.isFinite(amount) || amount < 0) {
                if (status) {
                    status.textContent = 'ENTER A VALID AMOUNT · Examples: 1000000 or 1m';
                    status.classList.add('locked');
                }
                return;
            }
            minimumCashReserve = amount;
            localStorage.setItem(CASH_RESERVE_KEY, String(amount));
            reserveInput?.blur();
            updatePanel();
        };
        reserveSave?.addEventListener('click', saveReserve);
        reserveInput?.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            saveReserve();
        });
        document.getElementById('fc-cash-reserve-clear')?.addEventListener('click', () => {
            minimumCashReserve = 0;
            localStorage.removeItem(CASH_RESERVE_KEY);
            if (reserveInput) reserveInput.value = '';
            updatePanel();
        });
        document.getElementById('fc-flight-picker-close')?.addEventListener('click', closeFlightPicker);
        syncFlightPicker();
    }

    function smartPurchaseItems() {
        return MEXICO_ITEMS.map(getCardData);
    }

    function smartPurchaseSelection() {
        const items = smartPurchaseItems();
        if (autoBuyMode === 'manual') {
            return items.find(item => item.name === manualBuyItem) || items[0] || null;
        }

        return items
            .filter(item => !item.soldOut
                && Number(item.quantity) > 0
                && Number.isFinite(selectedProfit(item, profitMode))
                && selectedProfit(item, profitMode) > 0)
            .sort((left, right) => selectedProfit(right, profitMode) - selectedProfit(left, profitMode))[0] || null;
    }

    function purchaseProfitModeLabel() {
        if (profitMode === 'npc') return 'NPC';
        if (profitMode === 'market') return 'PLAYER';
        return 'AUTO BEST';
    }

    function syncPurchaseControl() {
        const button = document.getElementById('fc-purchase-mode');
        const status = document.getElementById('fc-auto-buy-status');
        const toggle = document.getElementById('fc-auto-buy-switch');
        const select = document.getElementById('fc-manual-buy-item');
        const selected = smartPurchaseSelection();

        document.querySelectorAll('[data-auto-buy-mode]').forEach(option => {
            option.classList.toggle('active', option.dataset.autoBuyMode === autoBuyMode);
        });
        if (toggle) toggle.checked = autoBuyEnabled;
        if (select) {
            select.value = manualBuyItem;
            select.disabled = autoBuyMode !== 'manual';
        }

        if (button) {
            button.className = smartPurchaseBusy ? 'busy' : (!autoBuyEnabled ? 'off' : '');
            if (lastSmartPurchaseAction?.stage === 'FAILED') button.classList.add('error');
            if (smartPurchaseBusy) {
                button.textContent = `BUYING ${lastSmartPurchaseAction?.item || 'ITEM'}...`;
            } else if (!autoBuyEnabled) {
                button.textContent = 'AUTO BUY: OFF';
            } else if (autoBuyMode === 'manual') {
                button.textContent = `MANUAL BUY: ${manualBuyItem.toUpperCase()}`;
            } else {
                button.textContent = selected
                    ? `AUTO BUY [${purchaseProfitModeLabel()}]: ${selected.name.toUpperCase()}`
                    : 'AUTO BUY: WAITING FOR PROFIT DATA';
            }
        }

        if (status) {
            const selectionProfit = selected ? selectedProfit(selected, profitMode) : null;
            const base = autoBuyMode === 'auto'
                ? (selected
                    ? `${purchaseProfitModeLabel()} filter · Current best: ${selected.name} · ${money(selectionProfit)} each`
                    : `${purchaseProfitModeLabel()} filter · No profitable in-stock item is currently available`)
                : `Selected item: ${manualBuyItem}`;
            const recent = lastSmartPurchaseAction
                ? ` · Last: ${lastSmartPurchaseAction.stage}${lastSmartPurchaseAction.error ? ` — ${lastSmartPurchaseAction.error}` : ''}`
                : '';
            status.textContent = `${autoBuyEnabled ? 'Enabled for the next landing' : 'Automatic landing purchase is off'} · ${base}${recent}`;
        }
    }

    function openPurchasePicker() {
        const picker = document.getElementById('fc-purchase-picker');
        if (!picker) return;
        closeFlightPicker();
        syncPurchaseControl();
        picker.hidden = false;
    }

    function closePurchasePicker() {
        const picker = document.getElementById('fc-purchase-picker');
        if (picker) picker.hidden = true;
    }

    function bindPurchaseControl() {
        const button = document.getElementById('fc-purchase-mode');
        if (!button) return;

        const cancelTimer = () => {
            if (purchasePressTimer) clearTimeout(purchasePressTimer);
            purchasePressTimer = null;
        };

        button.addEventListener('pointerdown', () => {
            purchaseLongPressTriggered = false;
            cancelTimer();
            purchasePressTimer = setTimeout(() => {
                purchasePressTimer = null;
                purchaseLongPressTriggered = true;
                openPurchasePicker();
                navigator.vibrate?.(35);
            }, LONG_PRESS_MS);
        });
        button.addEventListener('pointerup', cancelTimer);
        button.addEventListener('pointercancel', cancelTimer);
        button.addEventListener('pointerleave', cancelTimer);
        button.addEventListener('contextmenu', event => event.preventDefault());
        button.addEventListener('click', event => {
            if (purchaseLongPressTriggered) {
                event.preventDefault();
                purchaseLongPressTriggered = false;
                return;
            }
            void runSmartPurchase('MANUAL_TAP');
        });

        document.getElementById('fc-auto-buy-switch')?.addEventListener('change', event => {
            autoBuyEnabled = Boolean(event.target.checked);
            localStorage.setItem(AUTO_BUY_ENABLED_KEY, autoBuyEnabled ? 'on' : 'off');
            if (!autoBuyEnabled) localStorage.removeItem(AUTO_BUY_TRIP_KEY);
            syncPurchaseControl();
        });
        document.querySelectorAll('[data-auto-buy-mode]').forEach(option => {
            option.addEventListener('click', () => {
                autoBuyMode = option.dataset.autoBuyMode === 'manual' ? 'manual' : 'auto';
                localStorage.setItem(AUTO_BUY_MODE_KEY, autoBuyMode);
                syncPurchaseControl();
            });
        });
        document.getElementById('fc-manual-buy-item')?.addEventListener('change', event => {
            manualBuyItem = event.target.value;
            localStorage.setItem(AUTO_BUY_ITEM_KEY, manualBuyItem);
            syncPurchaseControl();
        });
        document.getElementById('fc-purchase-picker-close')?.addEventListener('click', closePurchasePicker);
        syncPurchaseControl();
    }

    function loadAutoBuyTrip() {
        try {
            const trip = JSON.parse(localStorage.getItem(AUTO_BUY_TRIP_KEY) || 'null');
            return trip && typeof trip === 'object' ? trip : null;
        } catch (error) {
            return null;
        }
    }

    function saveAutoBuyTrip(trip) {
        localStorage.setItem(AUTO_BUY_TRIP_KEY, JSON.stringify(trip));
    }

    function armAutoBuyTrip(intent) {
        if (!autoBuyEnabled || intent.direction !== 'OUTBOUND') {
            localStorage.removeItem(AUTO_BUY_TRIP_KEY);
            return;
        }
        saveAutoBuyTrip({
            token: intent.createdAt,
            destination: intent.destination,
            completed: false,
            armedAt: Date.now()
        });
    }

    function loadPendingAutoReturn() {
        try {
            const pending = JSON.parse(localStorage.getItem(AUTO_RETURN_PENDING_KEY) || 'null');
            return pending && typeof pending === 'object' ? pending : null;
        } catch (error) {
            return null;
        }
    }

    function scheduleAutoReturn(item, amount, trigger) {
        localStorage.setItem(AUTO_RETURN_PENDING_KEY, JSON.stringify({
            item: item?.name || null,
            amount,
            trigger,
            createdAt: Date.now()
        }));
    }

    function recordFlightAction(stage, error = null, extra = {}) {
        lastFlightAction = {
            stage,
            error,
            destination: selectedFlightDestination,
            flightType: selectedFlightType,
            recordedAt: new Date().toISOString(),
            ...extra
        };
    }

    function nativeTravelControls() {
        return [...document.querySelectorAll('button, a, input, [role="button"]')]
            .filter(element => visibleElement(element) && !element.closest('#fc-panel'));
    }

    function flightControlHint(element) {
        const context = element.closest('li, tr, form, [role="dialog"], [class*="modal"], [class*="dialog"], [class*="row"]');
        return [
            element.innerText,
            element.value,
            element.getAttribute('aria-label'),
            element.getAttribute('title'),
            element.getAttribute('href'),
            context?.innerText
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }

    function flightControlOwnHint(element) {
        return [
            element.innerText,
            element.value,
            element.getAttribute('aria-label'),
            element.getAttribute('title'),
            element.getAttribute('href'),
            element.getAttribute('name')
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }

    function flightTypePattern(type) {
        if (type === 'Private Jet') return /\bprivate\s+(?:jets?|flights?)\b|\bjet\b/i;
        if (type === 'Airstrip') return /\bairstrip\b/i;
        return /\bstandard\b/i;
    }

    function flightTypeValue(type) {
        if (type === 'Airstrip') return '2';
        if (type === 'Private Jet') return '3';
        return '1';
    }

    function findTravelTypeRadio(type) {
        return [...document.querySelectorAll('input[name="travelType"][type="radio"]')]
            .find(input => input.value === flightTypeValue(type) && visibleElement(input)) || null;
    }

    function contextSupportsFlightType(context, type) {
        if (!context) return false;
        const pattern = flightTypePattern(type);
        let node = context;

        for (let depth = 0; depth < 7 && node && node !== document.body; depth += 1, node = node.parentElement) {
            const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
            if (text.length > 0 && text.length < 2200 && pattern.test(text)) return true;

            let sibling = node.previousElementSibling;
            for (let offset = 0; offset < 3 && sibling; offset += 1, sibling = sibling.previousElementSibling) {
                const siblingText = (sibling.innerText || '').replace(/\s+/g, ' ').trim();
                if (siblingText.length > 0 && siblingText.length < 300 && pattern.test(siblingText)) return true;
            }
        }
        return false;
    }

    function findDestinationContext(destination) {
        const pattern = destination === 'Mexico' ? /\b(?:mexico|ciudad\s+juarez)\b/i : new RegExp(destination, 'i');
        return [...document.querySelectorAll('li, tr, article, section, [role="row"], div')]
            .filter(element => {
                if (!visibleElement(element) || element.closest('#fc-panel')) return false;
                const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
                return text.length > 0
                    && text.length < 1200
                    && pattern.test(text)
                    && element.querySelector('button, a, input, [role="button"]');
            })
            .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0] || null;
    }

    function findDestinationControl(context, destination) {
        if (!context) return null;
        const pattern = destination === 'Mexico' ? /\b(?:mexico|ciudad\s+juarez)\b/i : new RegExp(destination, 'i');
        return [...context.querySelectorAll('button, a, input, [role="button"]')]
            .filter(visibleElement)
            .find(control => pattern.test(flightControlOwnHint(control))) || null;
    }

    function findFlightTypeControl(context, type) {
        if (!context) return null;
        const pattern = flightTypePattern(type);
        const controls = [...context.querySelectorAll('button, a, input, [role="button"]')].filter(visibleElement);
        const direct = controls.find(control => pattern.test(flightControlOwnHint(control)));
        if (direct) return direct;

        const labels = [...context.querySelectorAll('div, span, th, td, label')]
            .filter(element => visibleElement(element) && pattern.test((element.innerText || '').trim()));
        for (const label of labels) {
            let node = label;
            for (let depth = 0; depth < 4 && node && context.contains(node); depth += 1, node = node.parentElement) {
                const associated = [...node.querySelectorAll('button, a, input, [role="button"]')]
                    .filter(visibleElement);
                if (associated.length === 1) return associated[0];
            }
        }
        return null;
    }

    function findTravelHomeControl() {
        return nativeTravelControls().find(control => {
            const own = flightControlOwnHint(control);
            const className = typeof control.className === 'string' ? control.className : '';
            return /^travel\s+home$/i.test(own)
                || /travel-home-header-button/i.test(className);
        }) || null;
    }

    function findReturnDepartureControl() {
        return nativeTravelControls().find(control => {
            if (control === findTravelHomeControl()) return false;
            return /\b(?:return|fly|travel|depart)\s+(?:back\s+)?to\s+(?:torn|torn\s+city)\b/i.test(flightControlOwnHint(control));
        }) || null;
    }

    function findReturnControl() {
        return findTravelHomeControl() || findReturnDepartureControl();
    }

    function findDepartureControl(destination) {
        const destinationPattern = destination === 'Mexico'
            ? /\b(?:mexico|ciudad\s+juarez)\b/i
            : new RegExp(destination, 'i');
        return nativeTravelControls().find(control => {
            const own = flightControlOwnHint(control);
            if (!/^(?:fly|travel|depart|go|continue|book)\b/i.test(own)) return false;
            return destinationPattern.test(flightControlHint(control));
        }) || null;
    }

    function findDestinationContinueControl(destination) {
        const destinationPattern = destination === 'Mexico'
            ? /\b(?:mexico|ciudad\s+juarez)\b/i
            : new RegExp(destination, 'i');
        const containers = [...document.querySelectorAll('div, section, article, form')]
            .filter(element => {
                if (!visibleElement(element) || element.closest('#fc-panel')) return false;
                const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
                return text.length > 0
                    && text.length < 900
                    && destinationPattern.test(text)
                    && /are\s+you\s+sure.*(?:travel|fly)/i.test(text);
            })
            .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);

        for (const container of containers) {
            const button = [...container.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]')]
                .filter(visibleElement)
                .find(control => /^continue$/i.test(
                    (control.innerText || control.value || control.getAttribute('aria-label') || '').trim()
                ));
            if (button) return button;
        }
        return null;
    }

    function findBoardingContinueControl(destination) {
        const destinationPattern = destination === 'Mexico'
            ? /\b(?:mexico|ciudad\s+juarez)\b/i
            : new RegExp(destination, 'i');
        const containers = [...document.querySelectorAll('div, section, article')]
            .filter(element => {
                if (!visibleElement(element) || element.closest('#fc-panel')) return false;
                const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
                return text.length > 0
                    && text.length < 900
                    && destinationPattern.test(text)
                    && /(?:step\s+on\s+board|heading\s+for)/i.test(text);
            })
            .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);

        for (const container of containers) {
            const control = [...container.querySelectorAll('a, button, [role="button"]')]
                .filter(visibleElement)
                .find(element => /^continue$/i.test((element.innerText || element.getAttribute('aria-label') || '').trim()));
            if (control) return control;
        }
        return null;
    }

    async function clickFlightConfirmationAndBoarding(intent, confirmation, extra = {}) {
        confirmation.click();
        recordFlightAction('FINAL_CONFIRMATION_CLICKED', null, {
            intent,
            control: controlSnapshot(confirmation),
            ...extra
        });

        const boardingContinue = await waitForValue(
            () => findBoardingContinueControl(intent.destination),
            4000
        );
        if (boardingContinue) {
            boardingContinue.click();
            recordFlightAction('BOARDING_CONTINUE_CLICKED', null, {
                intent,
                control: controlSnapshot(boardingContinue),
                ...extra
            });
        }
        clearPendingFlightIntent();
    }

    function recoverBoardingContinue() {
        const flight = getFlightInfo();
        if (!flight || flight.direction !== 'OUTBOUND') return;
        const boardingContinue = findBoardingContinueControl(flight.country);
        if (!boardingContinue || boardingContinue === lastRecoveredBoardingControl) return;

        lastRecoveredBoardingControl = boardingContinue;
        boardingContinue.click();
        recordFlightAction('BOARDING_CONTINUE_RECOVERED', null, {
            destination: flight.country,
            control: controlSnapshot(boardingContinue),
            detectedFlight: flight
        });
    }

    function findConfirmationControl(destination, type, returning = false) {
        const continueControl = findDestinationContinueControl(returning ? 'Torn' : destination);
        if (continueControl) return continueControl;

        const dialogs = [...document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="dialog"], form')]
            .filter(visibleElement)
            .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
        const destinationPattern = returning
            ? /\b(?:torn|torn\s+city)\b/i
            : destination === 'Mexico' ? /\b(?:mexico|ciudad\s+juarez)\b/i : new RegExp(destination, 'i');

        for (const dialog of dialogs) {
            const text = (dialog.innerText || '').replace(/\s+/g, ' ');
            if (!destinationPattern.test(text)) continue;
            const buttons = [...dialog.querySelectorAll('button, a, input, [role="button"]')].filter(visibleElement);
            const confirmation = buttons.find(control => /^(?:yes|confirm|fly|travel|depart|return)$/i.test(
                (control.innerText || control.value || control.getAttribute('aria-label') || '').trim()
            ));
            if (confirmation) return confirmation;
            if (!returning && !flightTypePattern(type).test(text)) continue;
        }
        return null;
    }

    function diagnosticFlightControls() {
        return nativeTravelControls()
            .filter(control => /\b(?:mexico|ciudad\s+juarez|torn|return|fly|travel|standard|airstrip|private|jet|confirm|yes|free)\b/i.test(flightControlHint(control)))
            .map(controlSnapshot)
            .slice(0, 80);
    }

    function diagnosticFlightStructure(destination = selectedFlightDestination) {
        const context = findDestinationContext(destination);
        if (!context) return null;
        const ancestors = [];
        let node = context;
        for (let depth = 0; depth < 5 && node && node !== document.body; depth += 1, node = node.parentElement) {
            ancestors.push({
                depth,
                tag: node.tagName,
                className: typeof node.className === 'string' ? node.className.slice(0, 400) : '',
                text: (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2500),
                controls: [...node.querySelectorAll('button, a, input, [role="button"]')]
                    .filter(visibleElement)
                    .map(controlSnapshot)
                    .slice(0, 40)
            });
        }
        return ancestors;
    }

    async function beginFlightAction() {
        if (flightIntentBusy) return;
        const ground = currentGroundState();
        if (ground.kind === 'traveling') return;

        const reserve = cashReserveStatus();
        // The reserve protects new outbound trips but must never strand the
        // player abroad. Returning to Torn is always allowed.
        if (reserve.locked && ground.kind !== 'abroad') {
            const error = Number.isFinite(reserve.currentCash)
                ? `Current cash ${money(reserve.currentCash)} is below the ${money(reserve.reserve)} reserve.`
                : `Current cash could not be detected for the ${money(reserve.reserve)} reserve.`;
            recordFlightAction('CASH_RESERVE_LOCKED', error, { cashReserve: reserve });
            navigator.vibrate?.([60, 50, 60]);
            updatePanel();
            return;
        }

        const intent = {
            direction: ground.kind === 'abroad' ? 'RETURNING' : 'OUTBOUND',
            destination: ground.kind === 'abroad' ? ground.country : selectedFlightDestination,
            flightType: selectedFlightType,
            createdAt: Date.now(),
            stage: 'REQUESTED'
        };
        savePendingFlightIntent(intent);
        armAutoBuyTrip(intent);
        recordFlightAction('REQUESTED', null, { intent });
        closePanel();

        if (!isTravelPage()) {
            location.href = TRAVEL_PAGE_URL;
            return;
        }
        await processPendingFlightIntent();
    }

    async function processPendingFlightIntent() {
        const intent = loadPendingFlightIntent();
        if (!intent || flightIntentBusy) return;
        if (Date.now() - Number(intent.createdAt || 0) > 2 * 60 * 1000) {
            recordFlightAction('EXPIRED', 'The flight request expired before Torn travel controls became available.', { intent });
            clearPendingFlightIntent();
            return;
        }
        if (getFlightInfo()) {
            recordFlightAction('FLIGHT_DETECTED', null, { intent });
            clearPendingFlightIntent();
            return;
        }
        if (!isTravelPage()) {
            location.href = TRAVEL_PAGE_URL;
            return;
        }

        flightIntentBusy = true;
        try {
            if (intent.direction === 'RETURNING') {
                let returnIntent = intent;

                if (returnIntent.stage === 'REQUESTED') {
                    const returnControl = await waitForValue(findReturnControl, 5000);
                    if (!returnControl) throw new Error('A clearly labeled Travel home or Return to Torn control was not found.');

                    const clickedTravelHome = returnControl === findTravelHomeControl();
                    returnIntent = {
                        ...returnIntent,
                        stage: clickedTravelHome ? 'RETURN_HOME_CLICKED' : 'RETURN_DEPARTURE_CLICKED'
                    };
                    // Persist before clicking because Travel home can perform a
                    // full navigation and destroy this JavaScript context.
                    savePendingFlightIntent(returnIntent);
                    returnControl.click();
                    recordFlightAction(returnIntent.stage, null, {
                        intent: returnIntent,
                        control: controlSnapshot(returnControl)
                    });
                    await new Promise(resolve => setTimeout(resolve, 650));
                }

                if (returnIntent.stage === 'RETURN_HOME_CLICKED') {
                    const travelTypeRadio = findTravelTypeRadio(returnIntent.flightType);
                    if (travelTypeRadio && !travelTypeRadio.checked) {
                        travelTypeRadio.click();
                        recordFlightAction('RETURN_FLIGHT_TYPE_SELECTED', null, {
                            intent: returnIntent,
                            control: controlSnapshot(travelTypeRadio),
                            travelTypeValue: travelTypeRadio.value
                        });
                        await new Promise(resolve => setTimeout(resolve, 350));
                    }

                    const departureControl = findReturnDepartureControl();
                    if (departureControl) {
                        returnIntent = { ...returnIntent, stage: 'RETURN_DEPARTURE_CLICKED' };
                        savePendingFlightIntent(returnIntent);
                        departureControl.click();
                        recordFlightAction('RETURN_DEPARTURE_CLICKED', null, {
                            intent: returnIntent,
                            control: controlSnapshot(departureControl)
                        });
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }

                if (returnIntent.stage === 'FINAL_CONFIRMATION_CLICKED') {
                    const boardingContinue = findBoardingContinueControl('Torn');
                    if (boardingContinue) {
                        returnIntent = { ...returnIntent, stage: 'RETURN_BOARDING_CONTINUE_CLICKED' };
                        savePendingFlightIntent(returnIntent);
                        boardingContinue.click();
                        recordFlightAction('RETURN_BOARDING_CONTINUE_CLICKED', null, {
                            intent: returnIntent,
                            control: controlSnapshot(boardingContinue)
                        });
                    }
                    return;
                }

                if (returnIntent.stage === 'RETURN_BOARDING_CONTINUE_CLICKED') return;

                const confirmation = await waitForValue(
                    () => findConfirmationControl('Torn', returnIntent.flightType, true),
                    3500
                );
                if (confirmation) {
                    returnIntent = { ...returnIntent, stage: 'FINAL_CONFIRMATION_CLICKED' };
                    savePendingFlightIntent(returnIntent);
                    confirmation.click();
                    recordFlightAction('FINAL_CONFIRMATION_CLICKED', null, {
                        intent: returnIntent,
                        control: controlSnapshot(confirmation)
                    });

                    const boardingContinue = await waitForValue(
                        () => findBoardingContinueControl('Torn'),
                        3500
                    );
                    if (boardingContinue) {
                        returnIntent = { ...returnIntent, stage: 'RETURN_BOARDING_CONTINUE_CLICKED' };
                        savePendingFlightIntent(returnIntent);
                        boardingContinue.click();
                        recordFlightAction('RETURN_BOARDING_CONTINUE_CLICKED', null, {
                            intent: returnIntent,
                            control: controlSnapshot(boardingContinue)
                        });
                    }
                } else {
                    recordFlightAction('WAITING_FOR_RETURN_CONTROLS', null, { intent: returnIntent });
                }
                // Keep the intent until getFlightInfo() proves the return has
                // started. The polling loop will resume after any page change.
                return;
            }

            const travelTypeRadio = await waitForValue(() => findTravelTypeRadio(intent.flightType), 5000);
            if (!travelTypeRadio) throw new Error(`Torn's ${intent.flightType} flight-type selector was not found.`);
            if (!travelTypeRadio.checked) {
                travelTypeRadio.click();
                recordFlightAction('FLIGHT_TYPE_SELECTED', null, {
                    intent,
                    control: controlSnapshot(travelTypeRadio),
                    travelTypeValue: travelTypeRadio.value
                });
                await new Promise(resolve => setTimeout(resolve, 350));
            }

            const existingContinue = findDestinationContinueControl(intent.destination);
            if (existingContinue) {
                await clickFlightConfirmationAndBoarding(intent, existingContinue, {
                    travelTypeValue: travelTypeRadio.value,
                    rowWasAlreadyExpanded: true
                });
                return;
            }

            const context = await waitForValue(() => findDestinationContext(intent.destination), 5000);
            if (!context) throw new Error(`The ${intent.destination} travel row was not found.`);

            const pageSectionAlreadyUsesType = contextSupportsFlightType(context, intent.flightType);
            let flightTypeControl = findFlightTypeControl(context, intent.flightType);
            if (!flightTypeControl) {
                const destinationControl = findDestinationControl(context, intent.destination);
                if (!destinationControl) throw new Error(`The ${intent.destination} destination control was not found.`);
                destinationControl.click();
                recordFlightAction('DESTINATION_CLICKED', null, { intent, control: controlSnapshot(destinationControl) });

                const continueControl = await waitForValue(
                    () => findDestinationContinueControl(intent.destination),
                    3500
                );
                if (continueControl) {
                    await clickFlightConfirmationAndBoarding(intent, continueControl, {
                        travelTypeValue: travelTypeRadio.value
                    });
                    return;
                }

                const expandedContext = findDestinationContext(intent.destination) || context;
                if (pageSectionAlreadyUsesType || contextSupportsFlightType(expandedContext, intent.flightType)) {
                    const directConfirmation = await waitForValue(
                        () => findConfirmationControl(intent.destination, intent.flightType, false),
                        2500
                    );
                    if (directConfirmation) {
                        directConfirmation.click();
                        recordFlightAction('FINAL_CONFIRMATION_CLICKED', null, {
                            intent,
                            control: controlSnapshot(directConfirmation),
                            flightTypeWasSelectedBySection: true
                        });
                        clearPendingFlightIntent();
                        return;
                    }

                    const departureControl = await waitForValue(
                        () => findDepartureControl(intent.destination),
                        2500
                    );
                    if (departureControl) {
                        departureControl.click();
                        recordFlightAction('DEPARTURE_CONTROL_CLICKED', null, {
                            intent,
                            control: controlSnapshot(departureControl),
                            flightTypeWasSelectedBySection: true
                        });
                        const confirmation = await waitForValue(
                            () => findConfirmationControl(intent.destination, intent.flightType, false),
                            2500
                        );
                        if (confirmation) {
                            confirmation.click();
                            recordFlightAction('FINAL_CONFIRMATION_CLICKED', null, {
                                intent,
                                control: controlSnapshot(confirmation),
                                flightTypeWasSelectedBySection: true
                            });
                        }
                        clearPendingFlightIntent();
                        return;
                    }

                    if (getFlightInfo()) {
                        recordFlightAction('FLIGHT_DETECTED', null, { intent, flightTypeWasSelectedBySection: true });
                        clearPendingFlightIntent();
                        return;
                    }
                    throw new Error(`${intent.flightType} is selected by the page section, but its departure control was not found after expanding ${intent.destination}.`);
                }

                flightTypeControl = await waitForValue(() => {
                    const dialog = [...document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="dialog"], form')]
                        .filter(visibleElement)
                        .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0];
                    return findFlightTypeControl(dialog || expandedContext || document.body, intent.flightType)
                        || findFlightTypeControl(document.body, intent.flightType);
                }, 3500);
            }
            if (!flightTypeControl) throw new Error(`The ${intent.flightType} control was not found for ${intent.destination}.`);

            flightTypeControl.click();
            recordFlightAction('FLIGHT_TYPE_CLICKED', null, { intent, control: controlSnapshot(flightTypeControl) });
            const confirmation = await waitForValue(
                () => findConfirmationControl(intent.destination, intent.flightType, false),
                3500
            );
            if (confirmation) {
                confirmation.click();
                recordFlightAction('FINAL_CONFIRMATION_CLICKED', null, { intent, control: controlSnapshot(confirmation) });
            } else {
                recordFlightAction('FLIGHT_TYPE_CLICKED_NO_CONFIRMATION', null, { intent });
            }
            clearPendingFlightIntent();
        } catch (error) {
            recordFlightAction('FAILED', error.message || String(error), {
                intent,
                visibleTravelControls: diagnosticFlightControls(),
                travelStructure: diagnosticFlightStructure(intent.destination)
            });
            clearPendingFlightIntent();
            openPanel();
        } finally {
            flightIntentBusy = false;
        }
    }

    function enableCapturedTouchScroll(element) {
        if (!element) return;

        let previousY = null;

        element.addEventListener('touchstart', event => {
            previousY = event.touches[0]?.clientY ?? null;
        }, { passive: true });

        element.addEventListener('touchmove', event => {
            const currentY = event.touches[0]?.clientY;
            if (!Number.isFinite(currentY) || !Number.isFinite(previousY)) return;

            element.scrollTop += previousY - currentY;
            previousY = currentY;

            if (event.cancelable) event.preventDefault();
            event.stopPropagation();
        }, { passive: false });

        const finishTouch = () => {
            previousY = null;
        };

        element.addEventListener('touchend', finishTouch, { passive: true });
        element.addEventListener('touchcancel', finishTouch, { passive: true });
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

    function parseShopMoney(numberText, suffixText = '') {
        const base = Number(String(numberText).replace(/,/g, ''));
        if (!Number.isFinite(base)) return null;
        const multiplier = {
            K: 1_000,
            M: 1_000_000,
            B: 1_000_000_000
        }[String(suffixText).toUpperCase()] || 1;
        return Math.round(base * multiplier);
    }

    function itemKey(name) {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    function readTravelCapacity() {
        const patterns = [
            /(?:items?(?:\s+carried)?|carrying\s+capacity|travel\s+capacity|item\s+capacity)\s*:?\s*([\d,]+)\s*(?:\/|of)\s*([\d,]+)/i,
            /([\d,]+)\s*(?:\/|of)\s*([\d,]+)\s*(?:items?|slots?)/i
        ];
        const parseCapacity = text => {
            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (!match) continue;

                const used = Number(match[1].replace(/,/g, ''));
                const total = Number(match[2].replace(/,/g, ''));
                if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0 || total > 1000 || used < 0 || used > total) continue;

                return {
                    used,
                    total,
                    remaining: Math.max(0, total - used),
                    sourceText: match[0].slice(0, 160)
                };
            }
            return null;
        };

        let pageText = document.body?.innerText || '';
        document.querySelectorAll('#fc-panel, #fc-mexico-panel, [id^="fc-multi-country"], [id*="multi-country-intel"]').forEach(panel => {
            const panelText = panel.innerText || '';
            if (panelText) pageText = pageText.replace(panelText, '');
        });
        const pageCapacity = parseCapacity(pageText.replace(/\s+/g, ' '));
        if (pageCapacity) return pageCapacity;

        const candidates = [
            ...document.querySelectorAll('[aria-label], [title], header, [class*="travel"], [class*="capacity"], [class*="item"]')
        ];

        for (const element of candidates) {
            if (element.closest('#fc-panel, #fc-mexico-panel, [id^="fc-multi-country"], [id*="multi-country-intel"]')) continue;

            const values = [
                element.getAttribute?.('aria-label'),
                element.getAttribute?.('title'),
                element.innerText
            ];

            for (const rawValue of values) {
                const text = String(rawValue || '').replace(/\s+/g, ' ').trim();
                if (!text || text.length > 240) continue;

                const capacity = parseCapacity(text);
                if (capacity) return capacity;
            }
        }

        return null;
    }

    function visibleElement(element) {
        if (!(element instanceof Element)) return false;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    }

    function activeFormControl(element) {
        if (!(element instanceof Element)) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && element.getAttribute('aria-hidden') !== 'true';
    }

    function controlSnapshot(element) {
        const context = element.closest('li, form, [role="dialog"], [class*="modal"], [class*="dialog"]');
        return {
            tag: element.tagName,
            className: typeof element.className === 'string' ? element.className.slice(0, 300) : '',
            type: element.getAttribute('type'),
            text: (element.innerText || element.value || '').replace(/\s+/g, ' ').trim().slice(0, 200),
            ariaLabel: element.getAttribute('aria-label'),
            title: element.getAttribute('title'),
            name: element.getAttribute('name'),
            placeholder: element.getAttribute('placeholder'),
            dataTestId: element.getAttribute('data-testid'),
            value: 'value' in element ? String(element.value || '').slice(0, 100) : null,
            disabled: Boolean(element.disabled),
            contextText: (context?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500)
        };
    }

    function snapshotControls(context) {
        if (!context) return [];
        return [...context.querySelectorAll('button, [role="button"], input, select, textarea')]
            .filter(element => !element.closest('#fc-panel, #fc-mexico-panel'))
            .map(controlSnapshot)
            .slice(0, 40);
    }

    function recordPurchaseAttempt(item, amount, stage, error = null, extra = {}) {
        lastPurchaseAttempt = {
            item: item?.name || null,
            amount,
            stage,
            error,
            recordedAt: new Date().toISOString(),
            travelCapacity: readTravelCapacity(),
            ...extra
        };
    }

    function findNativeShopRow(item) {
        const wanted = item.name.toLowerCase();
        const candidates = document.querySelectorAll('li, article, [data-item], [data-item-id]');

        for (const element of candidates) {
            if (element.closest('#fc-panel, #fc-mexico-panel, [id^="fc-multi-country"], [id*="multi-country-intel"]')) continue;
            const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
            if (!text || text.length > 1200 || !text.toLowerCase().includes(wanted)) continue;
            if (!/\$\s*[\d,]+|sold\s*out|stock\s*[\d,]+/i.test(text)) continue;
            return element;
        }

        return null;
    }

    function setNativeInputValue(input, amount) {
        const prototype = input instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (setter) setter.call(input, String(amount));
        else input.value = String(amount);
        input.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: String(amount)
        }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function waitForValue(getValue, timeoutMs = 2500) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const value = getValue();
            if (value) return value;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return null;
    }

    function purchaseButtonWithin(context, itemName) {
        if (!context) return null;
        const buttons = [...context.querySelectorAll('button, [role="button"], input[type="submit"]')];
        return buttons.find(button => {
            if (!visibleElement(button) || button.closest('#fc-panel, #fc-mexico-panel')) return false;
            const text = (button.innerText || button.value || '').replace(/\s+/g, ' ').trim();
            const className = typeof button.className === 'string' ? button.className : '';
            const hint = [
                text,
                className,
                button.getAttribute('aria-label'),
                button.getAttribute('title'),
                button.getAttribute('data-testid')
            ].filter(Boolean).join(' ');
            if (text.toLowerCase() === itemName.toLowerCase() || /buy\s+max/i.test(hint)) return false;
            if (/buyIconButton___/.test(className)) return false;
            return /^(?:buy|purchase)(?:\s+(?:now|items?))?$/i.test(text);
        }) || null;
    }

    function shopBuyIcon(row) {
        if (!row) return null;
        return [...row.querySelectorAll('button')].find(button =>
            visibleElement(button)
            && !button.disabled
            && typeof button.className === 'string'
            && /buyIconButton___/.test(button.className)
        ) || null;
    }

    function purchaseControlsFor(item, row) {
        const contexts = [row];
        document.querySelectorAll('form, [role="dialog"], [class*="modal"], [class*="dialog"]').forEach(context => {
            if (!visibleElement(context) || context.closest('#fc-panel, #fc-mexico-panel')) return;
            const text = (context.innerText || '').replace(/\s+/g, ' ').trim();
            if (text.toLowerCase().includes(item.name.toLowerCase()) || /\b(?:buy|purchase|quantity)\b/i.test(text)) {
                contexts.push(context);
            }
        });

        for (const context of contexts.filter(Boolean)) {
            const button = purchaseButtonWithin(context, item.name);
            if (!button) continue;

            // Torn retains an older quantity input beside the current form.
            // Scope the lookup to the form containing the live BUY button.
            const inputContext = button.closest('form') || context;
            const input = [...inputContext.querySelectorAll(
                'input.input-money, input[placeholder*="Qty" i], input[type="number"], input[inputmode="numeric"], input[type="text"]'
            )].find(candidate =>
                !candidate.disabled
                && candidate.type !== 'hidden'
                && candidate.type !== 'button'
                && candidate.type !== 'submit'
                && activeFormControl(candidate)
            );
            if (input) return { input, button, context: inputContext };
        }
        return null;
    }

    function shopRowIsExpanded(row) {
        if (!row) return false;
        return [...row.querySelectorAll('button')].some(button =>
            visibleElement(button)
            && typeof button.className === 'string'
            && /(?:^|\s)expanded___/.test(button.className)
        );
    }

    async function purchaseFromTornShop(item, amount) {
        let row = findNativeShopRow(item);
        recordPurchaseAttempt(item, amount, 'STARTED');
        if (!row) {
            recordPurchaseAttempt(item, amount, 'FAILED', 'Mexico shop row was not found.');
            throw new Error('Open the Mexico shop page before buying.');
        }

        recordPurchaseAttempt(item, amount, 'SHOP_ROW_FOUND', null, {
            rowText: (row.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
            rowControls: snapshotControls(row)
        });

        const rowIsExpanded = shopRowIsExpanded(row);

        // Torn keeps old quantity inputs mounted after a completed purchase.
        // Re-open a collapsed row before resolving controls so a second BUY MAX
        // cannot submit through the stale input left by the previous purchase.
        let controls = rowIsExpanded ? purchaseControlsFor(item, row) : null;
        if (!controls) {
            const itemInfoClose = [...row.querySelectorAll('button')].find(button =>
                visibleElement(button)
                && (button.getAttribute('data-testid') === 'close-x-button'
                    || /close item info/i.test(button.getAttribute('aria-label') || ''))
            );
            if (itemInfoClose) {
                itemInfoClose.click();
                await new Promise(resolve => setTimeout(resolve, 150));
                row = findNativeShopRow(item) || row;
            }

            const buyIcon = shopBuyIcon(row);
            buyIcon?.click();
            recordPurchaseAttempt(item, amount, buyIcon ? 'PURCHASE_EXPAND_CLICKED' : 'PURCHASE_EXPAND_CONTROL_NOT_FOUND', null, {
                rowWasExpanded: rowIsExpanded,
                closedItemInfo: Boolean(itemInfoClose),
                rowControls: snapshotControls(row)
            });

            controls = await waitForValue(() => {
                row = findNativeShopRow(item) || row;
                if (!shopRowIsExpanded(row)) return null;
                return purchaseControlsFor(item, row);
            }, 700);

            // After a successful or rejected purchase, Torn can leave the old
            // result panel expanded. Its first cart click only closes that
            // panel. If the row is now collapsed, click the freshly mounted
            // cart once more to open a new quantity form.
            if (!controls) {
                row = findNativeShopRow(item) || row;
                if (!shopRowIsExpanded(row)) {
                    const retryBuyIcon = shopBuyIcon(row);
                    retryBuyIcon?.click();
                    recordPurchaseAttempt(item, amount,
                        retryBuyIcon ? 'PURCHASE_REOPEN_CLICKED' : 'PURCHASE_REOPEN_CONTROL_NOT_FOUND', null, {
                            rowControls: snapshotControls(row)
                        });
                }

                controls = await waitForValue(() => {
                    row = findNativeShopRow(item) || row;
                    if (!shopRowIsExpanded(row)) return null;
                    return purchaseControlsFor(item, row);
                }, 2500);
            }
        }

        if (!controls) {
            recordPurchaseAttempt(item, amount, 'FAILED', 'Torn purchase controls were not found after expanding the item.', {
                rowControls: snapshotControls(row),
                visibleRelevantControls: diagnosticPurchaseControls()
            });
            throw new Error('Torn purchase controls were not found. Expand the item and try again.');
        }

        const { input, button: purchaseButton, context } = controls;
        recordPurchaseAttempt(item, amount, 'CONTROLS_FOUND', null, {
            input: controlSnapshot(input),
            purchaseButton: controlSnapshot(purchaseButton),
            contextControls: snapshotControls(context)
        });

        setNativeInputValue(input, amount);
        input.focus();
        input.blur();
        // Torn enables BUY asynchronously after its controlled input receives
        // the quantity. Re-resolve the form and wait for that enabled state.
        const refreshedControls = await waitForValue(() => {
            row = findNativeShopRow(item) || row;
            if (!shopRowIsExpanded(row)) return null;
            const current = purchaseControlsFor(item, row);
            return current && !current.button.disabled ? current : null;
        }, 2500);
        if (!refreshedControls) {
            recordPurchaseAttempt(item, amount, 'BUY_BUTTON_NOT_ENABLED',
                'Torn did not enable the BUY button after the quantity was entered.', {
                    input: controlSnapshot(input),
                    purchaseButton: controlSnapshot(purchaseButton),
                    rowControls: snapshotControls(row)
                });
            throw new Error('Torn did not accept the purchase quantity. Try again.');
        }

        const livePurchaseButton = refreshedControls.button;
        livePurchaseButton.click();
        recordPurchaseAttempt(item, amount, 'PURCHASE_CLICKED', null, {
            input: controlSnapshot(refreshedControls?.input || input),
            purchaseButton: controlSnapshot(livePurchaseButton),
            controlsReacquired: Boolean(refreshedControls)
        });

        const finalConfirmation = await waitForValue(() => {
            row = findNativeShopRow(item) || row;
            const contexts = [
                row,
                ...document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="dialog"]')
            ].filter((context, index, all) => context && visibleElement(context) && all.indexOf(context) === index);

            for (const confirmationContext of contexts) {
                const text = (confirmationContext.innerText || '').replace(/\s+/g, ' ').trim();
                const namesItem = text.toLowerCase().includes(item.name.toLowerCase());
                const asksToBuy = new RegExp(`\\bbuy\\s+${amount}x\\s+`, 'i').test(text)
                    || /do\s+you\s+want\s+to\s+buy|are\s+you\s+sure|confirm\s+(?:your\s+)?purchase/i.test(text);
                if (!namesItem || !asksToBuy) continue;

                const button = [...confirmationContext.querySelectorAll('button, [role="button"], input[type="submit"]')].find(candidate => {
                    if (!visibleElement(candidate) || candidate.disabled) return false;
                    const label = (candidate.innerText || candidate.value || candidate.getAttribute('aria-label') || '')
                        .replace(/\s+/g, ' ')
                        .trim();
                    return /^yes$/i.test(label);
                });
                if (button) return button;
            }
            return null;
        }, 2500);

        finalConfirmation?.click();
        recordPurchaseAttempt(item, amount, finalConfirmation ? 'FINAL_CONFIRMATION_CLICKED' : 'FINAL_CONFIRMATION_NOT_FOUND',
            finalConfirmation ? null : 'Torn opened a final Yes/No purchase prompt, but its Yes button was not found.', {
                finalConfirmationButton: finalConfirmation ? controlSnapshot(finalConfirmation) : null,
                rowControls: snapshotControls(row)
            });

        if (!finalConfirmation) throw new Error('Final Torn purchase confirmation was not found.');
        return 'Purchase confirmed';
    }

    function recordSmartPurchase(stage, item = null, amount = null, error = null, extra = {}) {
        lastSmartPurchaseAction = {
            stage,
            item: item?.name || null,
            amount,
            mode: autoBuyMode,
            trigger: extra.trigger || null,
            selectedProfit: item ? selectedProfit(item, profitMode) : null,
            error,
            recordedAt: new Date().toISOString(),
            ...extra
        };
        syncPurchaseControl();
    }

    async function runSmartPurchase(trigger = 'MANUAL_TAP') {
        if (smartPurchaseBusy) return false;

        const ground = currentGroundState();
        if (ground.kind !== 'abroad' || ground.country !== 'Mexico' || !pageLooksLikeMexicoShop()) {
            recordSmartPurchase('WAITING_FOR_MEXICO', null, null, 'Purchase controls are available after landing in Mexico.', { trigger });
            return false;
        }

        const capacity = readTravelCapacity();
        if (!Number.isFinite(capacity?.remaining)) {
            recordSmartPurchase('WAITING_FOR_CAPACITY', null, null, 'Waiting for Torn travel capacity.', { trigger });
            return false;
        }
        if (capacity.remaining <= 0) {
            recordSmartPurchase('NO_CAPACITY', null, 0, 'Travel capacity is full.', { trigger });
            return false;
        }

        const item = smartPurchaseSelection();
        if (!item) {
            recordSmartPurchase('NO_ITEM', null, 0, 'No eligible in-stock item has usable profit data.', { trigger });
            return false;
        }
        if (item.soldOut || !Number.isFinite(item.quantity) || item.quantity <= 0) {
            recordSmartPurchase('ITEM_UNAVAILABLE', item, 0, `${item.name} is sold out or its stock is unavailable.`, { trigger });
            return false;
        }

        let amount = Math.min(capacity.remaining, item.quantity);
        const cash = readCurrentCash();
        if (Number.isFinite(cash?.amount) && Number.isFinite(item.cost) && item.cost > 0) {
            const spendableCash = Math.max(0, cash.amount - minimumCashReserve);
            amount = Math.min(amount, Math.floor(spendableCash / item.cost));
        }
        amount = Math.max(0, Math.floor(amount));
        if (!amount) {
            recordSmartPurchase('INSUFFICIENT_CASH', item, 0,
                minimumCashReserve > 0
                    ? 'Not enough spendable cash after preserving the configured reserve.'
                    : 'Not enough cash to purchase this item.',
                { trigger, cash: cash?.amount ?? null, minimumCashReserve });
            return false;
        }

        const trip = loadAutoBuyTrip();
        if (trip && !trip.completed) {
            saveAutoBuyTrip({ ...trip, completed: true, completedAt: Date.now(), result: 'STARTED' });
        }

        smartPurchaseBusy = true;
        recordSmartPurchase('BUYING', item, amount, null, {
            trigger,
            capacity,
            cash: cash?.amount ?? null,
            minimumCashReserve
        });
        try {
            await purchaseFromTornShop(item, amount);
            recordSmartPurchase('PURCHASE_CONFIRMED', item, amount, null, { trigger });
            const completedTrip = loadAutoBuyTrip();
            if (completedTrip) {
                saveAutoBuyTrip({ ...completedTrip, completed: true, completedAt: Date.now(), result: 'PURCHASE_CONFIRMED', item: item.name, amount });
            }
            scheduleAutoReturn(item, amount, trigger);
            setTimeout(() => {
                publishDirectShopBridge();
                refreshMexicoFeed(true);
                mexicoRenderSignature = '';
                renderMexicoItems(true);
            }, 1200);
            return true;
        } catch (error) {
            recordSmartPurchase('FAILED', item, amount, error?.message || String(error), {
                trigger,
                purchaseAttempt: lastPurchaseAttempt
            });
            const failedTrip = loadAutoBuyTrip();
            if (failedTrip) {
                saveAutoBuyTrip({ ...failedTrip, completed: true, completedAt: Date.now(), result: 'FAILED', item: item.name, amount });
            }
            return false;
        } finally {
            smartPurchaseBusy = false;
            syncPurchaseControl();
        }
    }

    async function maybeAutoBuyAfterLanding() {
        if (!autoBuyEnabled || smartPurchaseBusy) return;
        const trip = loadAutoBuyTrip();
        if (!trip || trip.completed || trip.destination !== 'Mexico') return;

        const ground = currentGroundState();
        if (ground.kind !== 'abroad' || ground.country !== 'Mexico') return;
        if (!pageLooksLikeMexicoShop() || !Number.isFinite(readTravelCapacity()?.remaining)) return;

        await runSmartPurchase('AUTO_LANDING');
    }

    async function maybeReturnAfterSmartPurchase() {
        const pending = loadPendingAutoReturn();
        if (!pending || flightIntentBusy) return;

        const age = Date.now() - Number(pending.createdAt || 0);
        if (age < 1800) return;
        if (age > 2 * 60 * 1000) {
            localStorage.removeItem(AUTO_RETURN_PENDING_KEY);
            return;
        }

        const flight = getFlightInfo();
        if (flight) {
            localStorage.removeItem(AUTO_RETURN_PENDING_KEY);
            return;
        }

        const ground = currentGroundState();
        if (ground.kind === 'torn') {
            localStorage.removeItem(AUTO_RETURN_PENDING_KEY);
            return;
        }
        if (ground.kind !== 'abroad') return;

        // Remove this before starting the durable flight intent so the timer
        // cannot issue a duplicate return request.
        localStorage.removeItem(AUTO_RETURN_PENDING_KEY);
        const item = smartPurchaseItems().find(candidate => candidate.name === pending.item) || null;
        recordSmartPurchase('RETURN_REQUESTED', item, pending.amount ?? null, null, {
            trigger: pending.trigger,
            purchasedItem: pending.item,
            purchasedAmount: pending.amount
        });
        await beginFlightAction();
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
            const priceMatch = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)\s*([KMB])?/i);

            // A real shop row must contain its own price and either a stock
            // value or an explicit sold-out label.
            if (!priceMatch || (!quantityMatch && !soldOut)) continue;

            return {
                soldOut,
                quantity: soldOut ? 0 : (quantityMatch ? Number(quantityMatch[1].replace(/,/g, '')) : null),
                cost: priceMatch ? parseShopMoney(priceMatch[1], priceMatch[2]) : null
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
        const priceData = marketPriceById(feed?.id ?? item.id);
        const feedCost = Number.isFinite(feed?.cost) ? feed.cost : null;
        const feedQuantity = Number.isFinite(feed?.quantity) ? feed.quantity : null;
        const cost = live?.cost ?? feedCost ?? item.cost ?? item.minCost;
        const quantity = live?.quantity ?? feedQuantity;
        const soldOut = live?.soldOut === true || quantity === 0;
        const resalePrice = Number.isFinite(priceData?.lowestListingPrice)
            ? priceData.lowestListingPrice
            : (Number.isFinite(priceData?.marketPrice) ? priceData.marketPrice : null);
        const playerProfit = Number.isFinite(resalePrice) && Number.isFinite(cost)
            ? resalePrice - cost
            : null;
        const npcProfit = Number.isFinite(item.npcSale) && Number.isFinite(cost)
            ? item.npcSale - cost
            : null;

        return {
            ...item,
            id: feed?.id ?? item.id ?? null,
            cost,
            quantity,
            soldOut,
            resalePrice,
            playerProfit,
            npcProfit,
            marketPriceData: priceData,
            priceSource: Number.isFinite(priceData?.lowestListingPrice)
                ? 'WEAV3R LOWEST LISTING'
                : (Number.isFinite(priceData?.marketPrice) ? 'WEAV3R MARKET VALUE' : null),
            stockSource: live ? 'DIRECT TORN SHOP' : (feed ? 'FOREIGN STOCK FEED' : 'CATALOG FALLBACK')
        };
    }

    function profitPercent(profit, cost) {
        if (!Number.isFinite(profit) || !Number.isFinite(cost) || cost <= 0) return '-';
        return `${((profit / cost) * 100).toFixed(1)}%`;
    }

    function selectedProfit(item, mode = profitMode) {
        if (mode === 'npc') return Number.isFinite(item.npcProfit) ? item.npcProfit : null;
        if (mode === 'market') return Number.isFinite(item.playerProfit) ? item.playerProfit : null;

        const profits = [item.npcProfit, item.playerProfit].filter(Number.isFinite);
        return profits.length ? Math.max(...profits) : null;
    }

    function relativeTime(unixSeconds) {
        const timestamp = Number(unixSeconds);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
        const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
        if (seconds < 60) return `${seconds}s ago`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
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

    function priceStatusText() {
        if (marketPriceLoading) {
            return `Market prices: loading ${marketPriceProgress.complete}/${marketPriceProgress.total}`;
        }
        const received = Object.values(marketPrices)
            .map(price => Number(price?.receivedAt))
            .filter(Number.isFinite);
        if (marketPriceError) return `Market prices: ${marketPriceError}`;
        if (!received.length) return 'Market prices: waiting for first refresh';
        const ageSeconds = Math.max(0, Math.floor((Date.now() - Math.max(...received)) / 1000));
        return `Market prices: Weav3r, refreshed ${ageSeconds}s ago`;
    }

    function renderMexicoItems(force = false) {
        const content = document.getElementById('fc-mexico-content');
        if (!content) return;

        syncFilterControls();

        const items = MEXICO_ITEMS.map(getCardData);
        const travelCapacity = readTravelCapacity();
        const signature = JSON.stringify(items.map(item => [
            item.cost,
            item.quantity,
            item.soldOut,
            item.resalePrice,
            item.playerProfit,
            item.npcProfit,
            profitMode,
            sortMode,
            hideSoldOut,
            highlightingEnabled,
            marketPriceLoading,
            marketPriceProgress.complete,
            marketPriceError,
            travelCapacity?.used ?? null,
            travelCapacity?.total ?? null
        ]));
        if (!force && signature === mexicoRenderSignature) return;
        mexicoRenderSignature = signature;

        const sortByProfit = sortMode.startsWith('profit-');
        const sortByQuantity = sortMode.startsWith('quantity-');
        const sortField = sortByQuantity ? 'quantity' : 'cost';
        const descending = sortMode.endsWith('-high');
        const visibleItems = hideSoldOut ? items.filter(item => !item.soldOut) : items;
        const sortedItems = [...visibleItems].sort((left, right) => {
            const leftValue = sortByProfit ? selectedProfit(left) : left[sortField];
            const rightValue = sortByProfit ? selectedProfit(right) : right[sortField];
            const leftComparable = Number.isFinite(leftValue) && (!sortByProfit || !left.soldOut);
            const rightComparable = Number.isFinite(rightValue) && (!sortByProfit || !right.soldOut);

            if (leftComparable !== rightComparable) return leftComparable ? -1 : 1;
            if (!leftComparable) return 0;

            const difference = leftValue - rightValue;
            return descending ? -difference : difference;
        });
        const profitable = items.filter(item => !item.soldOut && Number.isFinite(selectedProfit(item)));
        const bestProfit = profitable.length
            ? Math.max(...profitable.map(item => selectedProfit(item)))
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
            const purchaseLimit = Number.isFinite(travelCapacity?.remaining) && Number.isFinite(item.quantity)
                ? Math.min(travelCapacity.remaining, item.quantity)
                : null;
            const displayedAmount = Number.isFinite(purchaseLimit)
                ? Math.min(state.amount, purchaseLimit)
                : state.amount;
            if (displayedAmount !== state.amount) {
                itemCardState.set(key, { ...state, amount: displayedAmount });
            }
            const isBest = Number.isFinite(bestProfit) && selectedProfit(item) === bestProfit;
            const quantityLabel = item.soldOut
                ? 'SOLD OUT'
                : (Number.isFinite(item.quantity) ? item.quantity.toLocaleString('en-US') : 'Stock updates in Mexico');
            const totalCost = displayedAmount * item.cost;
            const totalMarketProfit = Number.isFinite(item.playerProfit)
                ? displayedAmount * item.playerProfit
                : null;

            cards += `
                <section class="fc-item-card ${item.soldOut ? 'fc-sold-out' : ''} ${isBest ? 'fc-best-profit' : ''}" data-item-key="${key}">
                    <div class="fc-item-top">
                        <div class="fc-item-name">${escapeHtml(item.name)}</div>
                        <div class="fc-stock ${item.soldOut ? 'sold' : ''}">${quantityLabel}</div>
                    </div>
                    <div class="fc-item-cost">Cost abroad: ${money(item.cost)}${item.maxCost && item.stockSource === 'CATALOG FALLBACK' ? `-${money(item.maxCost)}` : ''}</div>
                    <div class="fc-catalog-note">Source: ${escapeHtml(item.stockSource)}</div>
                    <div class="fc-catalog-note">Resale estimate: ${Number.isFinite(item.resalePrice) ? money(item.resalePrice) : 'Loading live price'}${item.priceSource ? ` · ${escapeHtml(item.priceSource)}` : ''}</div>
                    <div class="fc-buy-row">
                        <label class="fc-buy-label">BUY AMOUNT</label>
                        <input class="fc-buy-input" type="number" inputmode="numeric" min="0" ${Number.isFinite(purchaseLimit) ? `max="${purchaseLimit}"` : ''} value="${displayedAmount}">
                        <button class="fc-button fc-buy-max" type="button" ${item.soldOut || !Number.isFinite(purchaseLimit) ? 'disabled' : ''}>BUY MAX${Number.isFinite(purchaseLimit) ? ` (${purchaseLimit})` : ''}</button>
                    </div>
                    <div class="fc-card-summary">
                        <span>Total cost: <strong class="fc-total-cost">${money(totalCost)}</strong></span>
                        <span>Stock remaining: <strong class="fc-stock-remaining">${Number.isFinite(item.quantity) ? Math.max(0, item.quantity - displayedAmount).toLocaleString('en-US') : '-'}</strong></span>
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
                            <div>Estimated resale: <strong>${Number.isFinite(item.resalePrice) ? money(item.resalePrice) : 'Live price pending'}</strong></div>
                            <div>Per item: <strong>${Number.isFinite(item.playerProfit) ? money(item.playerProfit) : 'Live price pending'}</strong></div>
                            <div>Profit range: <strong>-</strong></div>
                            <div>Profit: <strong>${profitPercent(item.playerProfit, item.cost)}</strong></div>
                            <div>Price checked: <strong>${item.marketPriceData?.lowestListingUpdated ? relativeTime(item.marketPriceData.lowestListingUpdated) : '-'}</strong></div>
                            <div>Selected total profit: <strong class="fc-total-profit">${money(totalMarketProfit)}</strong></div>
                        </div>
                    </div>
                </section>`;
        }

        content.classList.toggle('fc-highlights-on', highlightingEnabled);
        content.innerHTML = `
            <div class="fc-catalog-note">Complete Mexico catalog${hideSoldOut ? ' - sold-out items hidden' : ' - sold-out items visible'}<br>${escapeHtml(feedStatusText())}<br>${escapeHtml(priceStatusText())}<br>${travelCapacity ? `Travel capacity: ${travelCapacity.used}/${travelCapacity.total} used · ${travelCapacity.remaining} slots remaining` : 'Travel capacity: waiting for Torn capacity display'}</div>
            <button id="fc-refresh-prices" class="fc-button" type="button" ${marketPriceLoading ? 'disabled' : ''}>REFRESH MARKET PRICES</button>
            ${cards}`;

        bindMexicoCardEvents(sortedItems, travelCapacity);
    }

    function syncFilterControls() {
        const filters = document.getElementById('fc-filters-content');
        if (!filters) return;

        filters.querySelectorAll('[data-profit-mode]').forEach(button => {
            button.classList.toggle('active', button.dataset.profitMode === profitMode);
        });
        filters.querySelectorAll('[data-sort-mode]').forEach(button => {
            button.classList.toggle('active', button.dataset.sortMode === sortMode);
        });

        const soldOutButton = filters.querySelector('[data-toggle-sold-out]');
        if (soldOutButton) {
            soldOutButton.classList.toggle('active', hideSoldOut);
            soldOutButton.textContent = `HIDE ALL SOLD OUT ITEMS: ${hideSoldOut ? 'ON' : 'OFF'}`;
        }
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

    function diagnosticPurchaseControls() {
        const itemNames = MEXICO_ITEMS.map(item => item.name.toLowerCase());
        return [...document.querySelectorAll('button, [role="button"], input, select, textarea')]
            .filter(element => {
                if (!visibleElement(element) || element.closest('#fc-panel, #fc-mexico-panel')) return false;
                const hint = [
                    element.innerText,
                    element.value,
                    typeof element.className === 'string' ? element.className : '',
                    element.getAttribute('aria-label'),
                    element.getAttribute('title'),
                    element.getAttribute('name'),
                    element.getAttribute('placeholder'),
                    element.getAttribute('data-testid')
                ].filter(Boolean).join(' ').replace(/\s+/g, ' ');
                const context = element.closest('li, form, [role="dialog"], [class*="modal"], [class*="dialog"]');
                const contextText = (context?.innerText || '').replace(/\s+/g, ' ').toLowerCase().slice(0, 1200);
                return /\b(?:buy|purchase|cart|basket|max|quantity|amount)\b/i.test(hint)
                    || itemNames.some(name => contextText.includes(name));
            })
            .map(controlSnapshot)
            .slice(0, 80);
    }

    function buildDiagnosticReport() {
        const pageText = nativePageText();
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
                estimatedResalePrice: calculated.resalePrice,
                marketPriceSource: calculated.priceSource,
                weav3rPriceData: calculated.marketPriceData,
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
        const selectedProfitForReport = item => selectedProfit({
            npcProfit: item.calculatedNpcProfit,
            playerProfit: item.calculatedPlayerProfit
        });
        const availableSelectedItems = items.filter(item =>
            !item.detectedSoldOut && Number.isFinite(selectedProfitForReport(item))
        );
        const highestSelectedProfit = availableSelectedItems.length
            ? Math.max(...availableSelectedItems.map(selectedProfitForReport))
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
            travelCapacity: readTravelCapacity(),
            purchaseAutomation: {
                lastAttempt: lastPurchaseAttempt,
                smartPurchase: {
                    enabled: autoBuyEnabled,
                    mode: autoBuyMode,
                    profitFilter: profitMode,
                    manualItem: manualBuyItem,
                    currentSelection: smartPurchaseSelection()?.name || null,
                    busy: smartPurchaseBusy,
                    trip: loadAutoBuyTrip(),
                    pendingReturn: loadPendingAutoReturn(),
                    lastAction: lastSmartPurchaseAction
                },
                visibleRelevantControls: diagnosticPurchaseControls()
            },
            flightAutomation: {
                selectedDestination: selectedFlightDestination,
                selectedFlightType,
                cashReserve: cashReserveStatus(),
                groundState: currentGroundState(flight),
                pendingIntent: loadPendingFlightIntent(),
                lastAction: lastFlightAction,
                returnHomeControl: findTravelHomeControl() ? controlSnapshot(findTravelHomeControl()) : null,
                returnDepartureControl: findReturnDepartureControl() ? controlSnapshot(findReturnDepartureControl()) : null,
                visibleTravelControls: diagnosticFlightControls(),
                travelStructure: diagnosticFlightStructure()
            },
            foreignStockFeed: {
                url: FEED_URL,
                status: feedStatusText(),
                update: mexicoFeed?.update ?? null,
                receivedAt: mexicoFeed?.receivedAt ?? null,
                itemCount: mexicoFeed?.stocks?.length ?? 0,
                lastError: feedError || null
            },
            playerMarketPrices: {
                provider: 'TornW3B / Weav3r',
                apiBase: PRICE_API_BASE,
                status: priceStatusText(),
                cachedItemCount: Object.keys(marketPrices).length,
                refreshIntervalMinutes: PRICE_REFRESH_MS / 60000,
                lastError: marketPriceError || null
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
                highestSelectedProfit,
                itemsMarkedHighestProfit: Number.isFinite(highestSelectedProfit)
                    ? items
                        .filter(item => selectedProfitForReport(item) === highestSelectedProfit)
                        .map(item => item.name)
                    : [],
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

    function bindMexicoCardEvents(items, travelCapacity) {
        const content = document.getElementById('fc-mexico-content');
        if (!content) return;

        const refreshPricesButton = content.querySelector('#fc-refresh-prices');
        refreshPricesButton?.addEventListener('click', () => void refreshMarketPrices(true));

        content.querySelectorAll('.fc-item-card').forEach(card => {
            const key = card.dataset.itemKey;
            const item = items.find(candidate => itemKey(candidate.name) === key);
            if (!item) return;

            const input = card.querySelector('.fc-buy-input');
            const maxButton = card.querySelector('.fc-buy-max');
            const profitButton = card.querySelector('.fc-profit-toggle');

            const updateAmount = rawAmount => {
                const available = Number.isFinite(item.quantity) ? item.quantity : Number.MAX_SAFE_INTEGER;
                const remainingSlots = Number.isFinite(travelCapacity?.remaining)
                    ? travelCapacity.remaining
                    : 0;
                const amount = Math.max(0, Math.min(available, remainingSlots, Math.floor(Number(rawAmount) || 0)));
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
                return amount;
            };

            input.addEventListener('input', () => updateAmount(input.value));
            maxButton.addEventListener('click', async () => {
                const amount = updateAmount(Math.min(item.quantity, travelCapacity.remaining));
                if (!amount) return;

                const originalText = maxButton.textContent;
                maxButton.disabled = true;
                maxButton.textContent = `BUYING ${amount}...`;

                try {
                    const result = await purchaseFromTornShop(item, amount);
                    maxButton.textContent = result.toUpperCase();
                    scheduleAutoReturn(item, amount, 'CARD_BUY_MAX');
                    setTimeout(() => {
                        publishDirectShopBridge();
                        refreshMexicoFeed(true);
                        mexicoRenderSignature = '';
                        renderMexicoItems(true);
                    }, 1200);
                } catch (error) {
                    const previousStage = lastPurchaseAttempt?.stage || null;
                    if (previousStage !== 'FAILED') {
                        recordPurchaseAttempt(item, amount, 'FAILED', error?.message || String(error), {
                            previousStage,
                            rowControls: snapshotControls(findNativeShopRow(item)),
                            visibleRelevantControls: diagnosticPurchaseControls()
                        });
                    }
                    maxButton.textContent = error?.message || 'PURCHASE FAILED';
                    maxButton.disabled = false;
                }

                setTimeout(() => {
                    if (!maxButton.isConnected) return;
                    maxButton.textContent = originalText;
                    maxButton.disabled = false;
                }, 4000);
            });
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
        closeFilters();
        mexicoOpen = true;
        const panel = document.getElementById('fc-mexico-panel');
        if (panel) panel.style.display = 'block';
        document.getElementById('fc-mexico-tab')?.classList.add('active');
        refreshMexicoFeed();
        void refreshMarketPrices();
        renderMexicoItems(true);
        scrollPanelSectionIntoView(panel);
    }

    function closeMexico() {
        mexicoOpen = false;
        const panel = document.getElementById('fc-mexico-panel');
        if (panel) panel.style.display = 'none';
        document.getElementById('fc-mexico-tab')?.classList.remove('active');
    }

    function toggleMexicoSection() {
        if (mexicoOpen) closeMexico();
        else openMexico();
    }

    function openFilters() {
        closeMexico();
        filtersOpen = true;
        const panel = document.getElementById('fc-filters-panel');
        if (panel) panel.style.display = 'block';
        document.getElementById('fc-filters-tab')?.classList.add('active');
        syncFilterControls();
        scrollPanelSectionIntoView(panel);
    }

    function scrollPanelSectionIntoView(section) {
        const scroller = document.getElementById('fc-scroll-body');
        if (!scroller || !section) return;

        requestAnimationFrame(() => {
            const scrollerRect = scroller.getBoundingClientRect();
            const sectionRect = section.getBoundingClientRect();
            scroller.scrollTop = Math.max(0, scroller.scrollTop + sectionRect.top - scrollerRect.top - 8);
        });
    }

    function closeFilters() {
        filtersOpen = false;
        const panel = document.getElementById('fc-filters-panel');
        if (panel) panel.style.display = 'none';
        document.getElementById('fc-filters-tab')?.classList.remove('active');
    }

    function toggleFiltersSection() {
        if (filtersOpen) closeFilters();
        else openFilters();
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
        filtersOpen = false;
        closeFilters();
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
        const ground = currentGroundState(info);
        const reserve = cashReserveStatus();
        const panel = document.getElementById('fc-panel');
        const country = document.getElementById('fc-country');
        const route = document.getElementById('fc-route');
        const mode = document.getElementById('fc-mode');
        const hint = document.getElementById('fc-flight-hint');

        if (!panel || !country || !route || !mode || !hint) return;

        panel.classList.toggle('fc-cash-lock', reserve.locked);

        if (info) {
            country.textContent = info.country;
            route.textContent = info.route;
            mode.textContent = info.direction;
            mode.className = info.direction === 'RETURNING' ? 'returning' : 'outbound';
            mode.disabled = true;
            hint.textContent = 'Flight controls unlock after landing';
            syncFlightPicker();
            syncPurchaseControl();
            closeFlightPicker();
            return;
        }

        mode.disabled = false;
        if (ground.kind === 'abroad') {
            country.textContent = ground.country || 'ABROAD';
            route.textContent = `${ground.country || 'Destination'} - ready to return`;
            mode.textContent = 'RETURN TO TORN';
            mode.className = 'flight-action return-action';
            hint.textContent = 'Tap to return · Hold to choose the next destination and flight type';
        } else {
            country.textContent = 'TORN';
            route.textContent = `${selectedFlightType} selected`;
            mode.textContent = `FLY TO ${selectedFlightDestination.toUpperCase()}`;
            mode.className = 'flight-action';
            hint.textContent = 'Tap to fly · Hold to choose destination and flight type';
        }
        if (reserve.locked && ground.kind !== 'abroad') {
            mode.classList.add('cash-blocked');
            hint.textContent = Number.isFinite(reserve.currentCash)
                ? `CASH RESERVE LOCK · ${money(reserve.currentCash)} / ${money(reserve.reserve)} · Hold to change`
                : `CASH RESERVE LOCK · Cash not detected · ${money(reserve.reserve)} reserve · Hold to change`;
        } else if (reserve.locked && ground.kind === 'abroad') {
            hint.textContent = 'Cash is below reserve · Return to Torn remains available';
        }
        syncFlightPicker();
        syncPurchaseControl();
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
        if (loadPendingFlightIntent()) void processPendingFlightIntent();
        recoverBoardingContinue();
    }, 800);

    setInterval(() => {
        void maybeAutoBuyAfterLanding();
        void maybeReturnAfterSmartPurchase();
    }, 1000);

    setInterval(() => {
        refreshMexicoFeed();
        publishDirectShopBridge();
    }, FEED_REFRESH_MS);

    setInterval(() => {
        void refreshMarketPrices();
    }, PRICE_REFRESH_MS);

    startObserver();
    refreshMexicoFeed(true);
    setTimeout(() => void processPendingFlightIntent(), 700);
    setTimeout(recoverBoardingContinue, 900);

})();
