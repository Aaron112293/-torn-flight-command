// ==UserScript==
// @name         Flight Command - Multi-Country Intelligence Test
// @namespace    torn.flight.command.test
// @version      0.7.0
// @description  Multi-country stock intelligence with age buckets and availability-aware demand-shift validation
// @match        https://www.torn.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // CONFIG
    // =========================================================

    const ID = 'fc-multi-country-test-v07';

    const FEED_URL =
        'https://torn-intel.com/api/v1/foreign-stock/travel-table';

    const LIVE_BRIDGE_KEY =
        'flightCommandLiveShopBridgeV1';

    const HISTORY_KEY =
        'fcMultiCountryIntelV07';

    const LEGACY_HISTORY_KEY =
        'fcMultiCountryIntelV06';

    const AUTO_REFRESH_MS = 30000;

    const MAX_SAMPLES_PER_ITEM = 160;
    const MAX_EVENTS_PER_ITEM = 100;
    const MAX_VALIDATIONS_PER_ITEM = 350;
    const MAX_DEMAND_EVENTS = 100;

    const RATE_INTERVALS = 8;

    const WEIGHTS = [
        0,
        0.25,
        0.50,
        0.75,
        1
    ];

    const MIN_VALIDATIONS_FOR_LEARNING = 6;

    const VERY_FRESH_SECONDS = 15;

    const MAX_BRIDGE_AGE_MS = 15000;

    // =========================================================
    // AGE BUCKETS
    // =========================================================

    const AGE_BUCKETS = [
        { key: '0-10s', min: 0, max: 10 },
        { key: '11-20s', min: 11, max: 20 },
        { key: '21-30s', min: 21, max: 30 },
        { key: '31-40s', min: 31, max: 40 },
        { key: '41-50s', min: 41, max: 50 },
        { key: '51-60s', min: 51, max: 60 },
        { key: '61-90s', min: 61, max: 90 },
        { key: '90+s', min: 91, max: Infinity }
    ];

    // =========================================================
    // COUNTRY CONFIG
    // =========================================================

    const COUNTRY_NAMES = {
        mex: 'Mexico',
        can: 'Canada',
        uni: 'United Kingdom',
        jap: 'Japan',
        chi: 'China',
        haw: 'Hawaii',
        arg: 'Argentina',
        swi: 'Switzerland',
        uae: 'United Arab Emirates',
        sou: 'South Africa',
        cay: 'Cayman Islands'
    };

    const COUNTRY_ORDER = [
        'mex',
        'can',
        'uni',
        'jap',
        'chi',
        'haw',
        'arg',
        'swi',
        'uae',
        'sou',
        'cay'
    ];

    const FEATURED_ITEMS = {
        mex: [
            'Jaguar Plushie',
            'Mayan Statue',
            'Dahlia'
        ],

        can: [
            'Wolverine Plushie',
            'Crocus',
            'Hockey Stick'
        ],

        uni: [
            'Nessie Plushie',
            'Red Fox Plushie',
            'Heather'
        ],

        jap: [
            'Cherry Blossom',
            'Sumo Doll',
            'Maneki Neko'
        ],

        chi: [
            'Panda Plushie',
            'Peony',
            'Jade Buddha'
        ],

        haw: [
            'Orchid',
            'Pele Charm'
        ],

        arg: [
            'Monkey Plushie',
            'Ceibo Flower',
            'Soccer Ball'
        ],

        swi: [
            'Chamois Plushie',
            'Edelweiss'
        ],

        uae: [
            'Camel Plushie',
            'Tribulus Omanense'
        ],

        sou: [
            'Lion Plushie',
            'African Violet',
            'Elephant Statue'
        ],

        cay: [
            'Stingray Plushie',
            'Banana Orchid',
            'Nodding Turtle'
        ]
    };

    // =========================================================
    // v0.7 DEMAND PRIORITY EXPERIMENT
    // =========================================================

    /*
     * IMPORTANT:
     *
     * This is currently an EXPERIMENTAL priority ordering only.
     *
     * v0.7 does NOT use this ordering to modify predictions.
     * It only records whether higher-priority inventory is gone
     * and measures what happens to lower-priority items.
     *
     * Later this should come from actual profitability.
     */
    const MEXICO_DEMAND_PRIORITY = [
        'Jaguar Plushie',
        'Dahlia',
        'Mayan Statue'
    ];

    let latestFeed = null;
    let latestLog = '';

    let loading = false;
    let lastRefresh = 0;
    let refreshCount = 0;

    let latestChanges = [];

    // =========================================================
    // STORAGE
    // =========================================================

    function loadJson(key, fallback) {
        try {
            const raw =
                localStorage.getItem(key);

            if (!raw) {
                return fallback;
            }

            return JSON.parse(raw) ?? fallback;

        } catch (_) {
            return fallback;
        }
    }

    function saveJson(key, value) {
        try {
            localStorage.setItem(
                key,
                JSON.stringify(value)
            );
        } catch (_) {}
    }

    function deepCopy(value) {
        return JSON.parse(
            JSON.stringify(value)
        );
    }

    function createEmptyIntelligence() {
        return {
            countries: {},

            stats: {
                normalSamples: 0,
                rawAbsoluteError: 0,
                modelAbsoluteError: 0,
                rawExact: 0,
                modelExact: 0,
                transitionSamples: 0,
                rawLargestError: 0,
                modelLargestError: 0
            },

            demand: {
                mex: {
                    lastObservedAt: null,
                    liveItems: {},
                    selloutEvents: [],
                    restockEvents: []
                }
            },

            migration: {
                source: null,
                migratedAt: null
            }
        };
    }

    let intelligence =
        loadJson(
            HISTORY_KEY,
            null
        );

    if (!intelligence) {
        const legacy =
            loadJson(
                LEGACY_HISTORY_KEY,
                null
            );

        if (legacy) {
            intelligence =
                deepCopy(
                    legacy
                );

            const previousMigration =
                intelligence.migration || null;

            intelligence.migration = {
                source:
                    LEGACY_HISTORY_KEY,

                migratedAt:
                    new Date()
                        .toISOString(),

                previousMigration
            };

        } else {
            intelligence =
                createEmptyIntelligence();
        }

        saveJson(
            HISTORY_KEY,
            intelligence
        );
    }

    intelligence.countries =
        intelligence.countries || {};

    intelligence.stats = {
        normalSamples: 0,
        rawAbsoluteError: 0,
        modelAbsoluteError: 0,
        rawExact: 0,
        modelExact: 0,
        transitionSamples: 0,
        rawLargestError: 0,
        modelLargestError: 0,
        ...(intelligence.stats || {})
    };

    intelligence.demand =
        intelligence.demand || {};

    intelligence.demand.mex =
        intelligence.demand.mex || {
            lastObservedAt: null,
            liveItems: {},
            selloutEvents: [],
            restockEvents: []
        };

    intelligence.demand.mex.liveItems =
        intelligence.demand.mex.liveItems || {};

    intelligence.demand.mex.selloutEvents =
        Array.isArray(
            intelligence.demand.mex.selloutEvents
        )
            ? intelligence.demand.mex.selloutEvents
            : [];

    intelligence.demand.mex.restockEvents =
        Array.isArray(
            intelligence.demand.mex.restockEvents
        )
            ? intelligence.demand.mex.restockEvents
            : [];

    // =========================================================
    // HELPERS
    // =========================================================

    function safeJson(value) {
        try {
            return JSON.stringify(
                value,
                null,
                2
            );
        } catch (_) {
            return String(value);
        }
    }

    function number(value) {
        const n = Number(value);

        return Number.isFinite(n)
            ? n
            : null;
    }

    function formatNumber(value) {
        const n = number(value);

        if (n === null) {
            return '-';
        }

        return Math.round(n)
            .toLocaleString();
    }

    function formatDecimal(
        value,
        digits = 1
    ) {
        const n = number(value);

        if (n === null) {
            return '-';
        }

        return n.toFixed(digits);
    }

    function formatRatio(value) {
        const n = number(value);

        if (n === null) {
            return '-';
        }

        return n.toFixed(2);
    }

    function money(value) {
        const n = number(value);

        if (n === null) {
            return '-';
        }

        return (
            '$' +
            Math.round(n)
                .toLocaleString()
        );
    }

    function ageMs(timestamp) {
        const ts =
            number(timestamp);

        if (ts === null) {
            return '-';
        }

        const seconds =
            Math.max(
                0,
                Math.floor(
                    (
                        Date.now() -
                        ts
                    ) / 1000
                )
            );

        if (seconds < 60) {
            return `${seconds}s`;
        }

        const minutes =
            Math.floor(
                seconds / 60
            );

        if (minutes < 60) {
            return `${minutes}m`;
        }

        return `${
            Math.floor(
                minutes / 60
            )
        }h`;
    }

    function ageUnix(timestamp) {
        const ts =
            number(timestamp);

        if (ts === null) {
            return '-';
        }

        return ageMs(
            ts * 1000
        );
    }

    function average(values) {
        const valid =
            values.filter(
                Number.isFinite
            );

        if (!valid.length) {
            return null;
        }

        return (
            valid.reduce(
                (sum, value) =>
                    sum + value,
                0
            ) /
            valid.length
        );
    }

    function median(values) {
        const valid =
            values
                .filter(
                    Number.isFinite
                )
                .sort(
                    (a, b) =>
                        a - b
                );

        if (!valid.length) {
            return null;
        }

        const middle =
            Math.floor(
                valid.length / 2
            );

        if (
            valid.length %
                2 ===
            1
        ) {
            return valid[middle];
        }

        return (
            valid[
                middle - 1
            ] +
            valid[
                middle
            ]
        ) / 2;
    }

    function pushLimited(
        array,
        value,
        max
    ) {
        array.push(value);

        if (array.length > max) {
            array.splice(
                0,
                array.length - max
            );
        }
    }

    function getItemMap(countryData) {
        const byId = {};
        const byName = {};

        for (
            const item of
            countryData?.stocks || []
        ) {
            byId[
                String(item.id)
            ] = item;

            byName[
                item.name
            ] = item;
        }

        return {
            byId,
            byName
        };
    }

    function readLiveBridge() {
        const bridge =
            loadJson(
                LIVE_BRIDGE_KEY,
                null
            );

        if (
            !bridge ||
            bridge.source !==
                'DIRECT_TORN_SHOP'
        ) {
            return null;
        }

        return bridge;
    }

    // =========================================================
    // AGE BUCKET HELPERS
    // =========================================================

    function getAgeBucket(
        ageSeconds
    ) {
        const age =
            number(ageSeconds);

        if (age === null) {
            return null;
        }

        for (
            const bucket of
            AGE_BUCKETS
        ) {
            if (
                age >= bucket.min &&
                age <= bucket.max
            ) {
                return bucket;
            }
        }

        return null;
    }

    function getAgeBucketKey(
        ageSeconds
    ) {
        return (
            getAgeBucket(
                ageSeconds
            )?.key ||
            'UNKNOWN'
        );
    }

    function calculateIdealCorrectionRatio(
        liveStock,
        rawStock,
        fullCorrection
    ) {
        const live =
            number(liveStock);

        const raw =
            number(rawStock);

        const full =
            number(fullCorrection);

        if (
            live === null ||
            raw === null ||
            full === null ||
            full <= 0
        ) {
            return null;
        }

        return (
            raw - live
        ) / full;
    }

    // =========================================================
    // HISTORY STRUCTURE
    // =========================================================

    function ensureCountry(code) {
        if (
            !intelligence
                .countries[
                    code
                ]
        ) {
            intelligence
                .countries[
                    code
                ] = {
                    items: {}
                };
        }

        return intelligence
            .countries[
                code
            ];
    }

    function ensureItem(
        code,
        item
    ) {
        const country =
            ensureCountry(code);

        const key =
            String(item.id);

        if (
            !country.items[
                key
            ]
        ) {
            country.items[
                key
            ] = {
                id: item.id,
                name: item.name,
                cost: item.cost,
                cycle: 1,
                samples: [],
                events: [],
                validations: []
            };
        }

        const history =
            country.items[key];

        history.name =
            item.name;

        history.cost =
            item.cost;

        history.cycle =
            history.cycle || 1;

        history.samples =
            Array.isArray(
                history.samples
            )
                ? history.samples
                : [];

        history.events =
            Array.isArray(
                history.events
            )
                ? history.events
                : [];

        history.validations =
            Array.isArray(
                history.validations
            )
                ? history.validations
                : [];

        return history;
    }

    function getHistory(
        code,
        itemId
    ) {
        return intelligence
            .countries?.[
                code
            ]
            ?.items?.[
                String(itemId)
            ] || null;
    }

    // =========================================================
    // FEED PROCESSING
    // =========================================================

    function processCountry(
        code,
        countryData
    ) {
        const changes = [];

        const feedTimestamp =
            Number(
                countryData.update
            ) * 1000;

        for (
            const item of
            countryData.stocks || []
        ) {
            const history =
                ensureItem(
                    code,
                    item
                );

            const previous =
                history.samples.length
                    ? history.samples[
                        history.samples.length - 1
                    ]
                    : null;

            if (
                previous &&
                previous.feedTimestamp ===
                    feedTimestamp
            ) {
                continue;
            }

            let transition =
                null;

            if (previous) {
                const from =
                    Number(
                        previous.quantity
                    );

                const to =
                    Number(
                        item.quantity
                    );

                if (
                    from > 0 &&
                    to === 0
                ) {
                    transition =
                        'SELLOUT';

                } else if (
                    from === 0 &&
                    to > 0
                ) {
                    transition =
                        'RESTOCK';

                    history.cycle += 1;
                }

                if (from !== to) {
                    const event = {
                        type:
                            transition ||
                            'CHANGE',

                        from,
                        to,

                        cycle:
                            history.cycle,

                        feedTimestamp,

                        observedAt:
                            Date.now()
                    };

                    pushLimited(
                        history.events,
                        event,
                        MAX_EVENTS_PER_ITEM
                    );

                    changes.push({
                        country:
                            COUNTRY_NAMES[
                                code
                            ],

                        id:
                            item.id,

                        name:
                            item.name,

                        from,
                        to,

                        type:
                            transition ||
                            'CHANGE',

                        cycle:
                            history.cycle
                    });
                }
            }

            const sample = {
                feedTimestamp,

                observedAt:
                    Date.now(),

                quantity:
                    Number(
                        item.quantity
                    ),

                cost:
                    Number(
                        item.cost
                    ),

                cycle:
                    history.cycle,

                transition
            };

            pushLimited(
                history.samples,
                sample,
                MAX_SAMPLES_PER_ITEM
            );
        }

        return changes;
    }

    // =========================================================
    // CURRENT CYCLE
    // =========================================================

    function currentCycleSamples(
        history
    ) {
        if (!history) {
            return [];
        }

        const cycle =
            history.cycle || 1;

        return history.samples.filter(
            sample =>
                sample.cycle ===
                cycle
        );
    }

    // =========================================================
    // DEPLETION ENGINE
    // =========================================================

    function calculateDepletion(
        code,
        itemId
    ) {
        const history =
            getHistory(
                code,
                itemId
            );

        if (!history) {
            return {
                rate: null,
                intervals: 0,
                cycle: 0
            };
        }

        const samples =
            currentCycleSamples(
                history
            );

        if (
            samples.length < 2
        ) {
            return {
                rate: null,
                intervals: 0,
                cycle:
                    history.cycle
            };
        }

        const rates = [];

        for (
            let i =
                samples.length - 1;

            i > 0 &&
            rates.length <
                RATE_INTERVALS;

            i--
        ) {
            const newer =
                samples[i];

            const older =
                samples[i - 1];

            if (
                newer.transition ===
                    'RESTOCK' ||
                newer.transition ===
                    'SELLOUT'
            ) {
                continue;
            }

            const dtMinutes =
                (
                    newer.feedTimestamp -
                    older.feedTimestamp
                ) /                60000;

            if (
                !Number.isFinite(
                    dtMinutes
                ) ||
                dtMinutes <= 0
            ) {
                continue;
            }

            const delta =
                Number(
                    older.quantity
                ) -
                Number(
                    newer.quantity
                );

            if (delta >= 0) {
                rates.push(
                    delta /
                    dtMinutes
                );
            }
        }

        return {
            rate:
                average(rates),

            intervals:
                rates.length,

            cycle:
                history.cycle
        };
    }

    // =========================================================
    // FULL AGE CORRECTION
    // =========================================================

    function calculateFullCorrection(
        code,
        item,
        countryData
    ) {
        const rawStock =
            Number(
                item.quantity
            );

        const feedTimestamp =
            Number(
                countryData.update
            ) * 1000;

        const ageSeconds =
            Math.max(
                0,
                (
                    Date.now() -
                    feedTimestamp
                ) /
                1000
            );

        const depletion =
            calculateDepletion(
                code,
                item.id
            );

        if (
            rawStock <= 0 ||
            !Number.isFinite(
                depletion.rate
            )
        ) {
            return {
                rawStock,
                ageSeconds,
                rate:
                    depletion.rate,
                intervals:
                    depletion.intervals,
                cycle:
                    depletion.cycle,
                fullCorrection: 0
            };
        }

        const fullCorrection =
            depletion.rate *
            (
                ageSeconds / 60
            );

        return {
            rawStock,
            ageSeconds,
            rate:
                depletion.rate,
            intervals:
                depletion.intervals,
            cycle:
                depletion.cycle,

            fullCorrection:
                Math.max(
                    0,
                    fullCorrection
                )
        };
    }

    // =========================================================
    // CURRENT v0.6 MODEL
    // =========================================================

    function usableValidations(
        history
    ) {
        if (!history) {
            return [];
        }

        return history.validations.filter(
            validation =>
                validation.type ===
                    'NORMAL' &&
                Number.isFinite(
                    validation.liveStock
                ) &&
                Number.isFinite(
                    validation.rawStock
                ) &&
                Number.isFinite(
                    validation.fullCorrection
                )
        );
    }

    function evaluateWeight(
        validations,
        weight
    ) {
        if (!validations.length) {
            return null;
        }

        let totalError = 0;

        for (
            const validation of
            validations
        ) {
            const predicted =
                Math.max(
                    0,

                    validation.rawStock -
                    (
                        validation
                            .fullCorrection *
                        weight
                    )
                );

            totalError +=
                Math.abs(
                    validation.liveStock -
                    predicted
                );
        }

        return (
            totalError /
            validations.length
        );
    }

    function learnedWeight(
        code,
        itemId,
        ageSeconds
    ) {
        const history =
            getHistory(
                code,
                itemId
            );

        if (!history) {
            return {
                weight: 0,
                validations: 0,
                status:
                    'RAW FEED PREFERRED'
            };
        }

        const validations =
            usableValidations(
                history
            );

        if (
            validations.length <
                MIN_VALIDATIONS_FOR_LEARNING
        ) {
            return {
                weight: 0,

                validations:
                    validations.length,

                status:
                    'LEARNING'
            };
        }

        let bestWeight = 0;
        let bestError =
            Infinity;

        for (
            const weight of
            WEIGHTS
        ) {
            const error =
                evaluateWeight(
                    validations,
                    weight
                );

            if (
                error !== null &&
                error < bestError
            ) {
                bestError =
                    error;

                bestWeight =
                    weight;
            }
        }

        if (
            ageSeconds <=
                VERY_FRESH_SECONDS
        ) {
            bestWeight =
                Math.min(
                    bestWeight,
                    0.25
                );
        }

        let status =
            'RAW FEED PREFERRED';

        if (
            bestWeight > 0 &&
            bestWeight < 1
        ) {
            status =
                'PARTIAL CORRECTION';

        } else if (
            bestWeight === 1
        ) {
            status =
                'FULL CORRECTION';
        }

        return {
            weight:
                bestWeight,

            validations:
                validations.length,

            historicalMAE:
                bestError,

            status
        };
    }

    function calculateModel(
        code,
        item,
        countryData
    ) {
        const base =
            calculateFullCorrection(
                code,
                item,
                countryData
            );

        const learning =
            learnedWeight(
                code,
                item.id,
                base.ageSeconds
            );

        const appliedCorrection =
            base.fullCorrection *
            learning.weight;

        const modelStock =
            Math.max(
                0,

                Math.round(
                    base.rawStock -
                    appliedCorrection
                )
            );

        return {
            ...base,

            correctionWeight:
                learning.weight,

            validationCount:
                learning.validations,

            modelStatus:
                learning.status,

            appliedCorrection,

            modelStock
        };
    }

    // =========================================================
    // TRANSITION DETECTION
    // =========================================================

    function isTransitionSample(
        code,
        itemId,
        feedTimestamp
    ) {
        const history =
            getHistory(
                code,
                itemId
            );

        if (!history) {
            return false;
        }

        const recentEvents =
            history.events.slice(
                -3
            );

        return recentEvents.some(
            event =>
                (
                    event.type ===
                        'RESTOCK' ||
                    event.type ===
                        'SELLOUT'
                ) &&
                Math.abs(
                    event.feedTimestamp -
                    feedTimestamp
                ) <= 90000
        );
    }

    // =========================================================
    // v0.7 LIVE DEMAND STATE
    // =========================================================

    function getMexicoDemandState() {
        return intelligence
            .demand
            .mex;
    }

    function updateMexicoDemandState(
        bridge
    ) {
        if (
            !bridge ||
            bridge.country !==
                'Mexico'
        ) {
            return;
        }

        const demand =
            getMexicoDemandState();

        const observedAt =
            Number(
                bridge.observedAt
            );

        if (
            !Number.isFinite(
                observedAt
            )
        ) {
            return;
        }

        /*
         * Do not process the exact same live snapshot twice.
         */
        if (
            demand.lastObservedAt ===
                observedAt
        ) {
            return;
        }

        for (
            const live of
            Object.values(
                bridge.items || {}
            )
        ) {
            const name =
                live.name;

            if (
                !MEXICO_DEMAND_PRIORITY
                    .includes(name)
            ) {
                continue;
            }

            const stock =
                Number(
                    live.stock
                );

            if (
                !Number.isFinite(stock)
            ) {
                continue;
            }

            const previous =
                demand.liveItems[
                    name
                ] || null;

            const previousStock =
                previous
                    ? Number(
                        previous.stock
                    )
                    : null;

            if (
                Number.isFinite(
                    previousStock
                )
            ) {
                if (
                    previousStock > 0 &&
                    stock === 0
                ) {
                    const event = {
                        item:
                            name,

                        type:
                            'LIVE_SELLOUT',

                        from:
                            previousStock,

                        to:
                            0,

                        observedAt
                    };

                    pushLimited(
                        demand.selloutEvents,
                        event,
                        MAX_DEMAND_EVENTS
                    );

                    demand.liveItems[
                        name
                    ] = {
                        stock,
                        available: false,
                        observedAt,
                        soldOutAt:
                            observedAt
                    };

                    continue;
                }

                if (
                    previousStock === 0 &&
                    stock > 0
                ) {
                    const event = {
                        item:
                            name,

                        type:
                            'LIVE_RESTOCK',

                        from:
                            0,

                        to:
                            stock,

                        observedAt
                    };

                    pushLimited(
                        demand.restockEvents,
                        event,
                        MAX_DEMAND_EVENTS
                    );

                    demand.liveItems[
                        name
                    ] = {
                        stock,
                        available: true,
                        observedAt,
                        soldOutAt: null,
                        restockedAt:
                            observedAt
                    };

                    continue;
                }
            }

            demand.liveItems[
                name
            ] = {
                ...(previous || {}),

                stock,

                available:
                    stock > 0,

                observedAt,

                soldOutAt:
                    stock === 0
                        ? (
                            previous
                                ?.soldOutAt ||
                            observedAt
                        )
                        : null
            };
        }

        demand.lastObservedAt =
            observedAt;

        saveJson(
            HISTORY_KEY,
            intelligence
        );
    }

    function buildLiveAvailabilityState(
        bridge
    ) {
        const state = {};

        for (
            const name of
            MEXICO_DEMAND_PRIORITY
        ) {
            state[name] =
                null;
        }

        if (!bridge) {
            return state;
        }

        for (
            const live of
            Object.values(
                bridge.items || {}
            )
        ) {
            if (
                MEXICO_DEMAND_PRIORITY
                    .includes(
                        live.name
                    )
            ) {
                state[
                    live.name
                ] =
                    Number(
                        live.stock
                    ) > 0;
            }
        }

        return state;
    }

    function buildExternalAvailabilityState(
        mexico
    ) {
        const state = {};

        const map =
            getItemMap(
                mexico
            );

        for (
            const name of
            MEXICO_DEMAND_PRIORITY
        ) {
            const item =
                map.byName[
                    name
                ];

            state[name] =
                item
                    ? Number(
                        item.quantity
                    ) > 0
                    : null;
        }

        return state;
    }

    function getHigherPriorityItems(
        itemName
    ) {
        const index =
            MEXICO_DEMAND_PRIORITY
                .indexOf(
                    itemName
                );

        if (index <= 0) {
            return [];
        }

        return MEXICO_DEMAND_PRIORITY
            .slice(
                0,
                index
            );
    }

    function getHigherPrioritySoldOut(
        itemName,
        availabilityState
    ) {
        return getHigherPriorityItems(
            itemName
        ).filter(
            name =>
                availabilityState[
                    name
                ] === false
        );
    }

    function getSecondsSinceSellout(
        itemName,
        referenceTime
    ) {
        const item =
            getMexicoDemandState()
                .liveItems[
                    itemName
                ];

        const soldOutAt =
            number(
                item?.soldOutAt
            );

        const now =
            number(
                referenceTime
            );

        if (
            soldOutAt === null ||
            now === null
        ) {
            return null;
        }

        return Math.max(
            0,
            (
                now -
                soldOutAt
            ) /
            1000
        );
    }

    function describeDemandRegime(
        itemName,
        availabilityState
    ) {
        const higherSoldOut =
            getHigherPrioritySoldOut(
                itemName,
                availabilityState
            );

        if (
            higherSoldOut.length === 0
        ) {
            return 'BASELINE';
        }

        return (
            'AFTER_' +
            higherSoldOut
                .map(
                    name =>
                        name
                            .toUpperCase()
                            .replace(
                                /[^A-Z0-9]+/g,
                                '_'
                            )
                            .replace(
                                /^_|_$/g,
                                ''
                            )
                )
                .join('_AND_')
        );
    }

    // =========================================================
    // FLIGHT COMMAND COMPARISON
    // =========================================================

    function compareFlightCommand() {
        const bridge =
            readLiveBridge();

        if (
            !bridge ||
            bridge.country !==
                'Mexico' ||
            !latestFeed?.stocks?.mex
        ) {
            return null;
        }

        updateMexicoDemandState(
            bridge
        );

        const bridgeAge =
            Date.now() -
            Number(
                bridge.observedAt
            );

        const mexico =
            latestFeed.stocks.mex;

        const map =
            getItemMap(
                mexico
            );

        const liveAvailability =
            buildLiveAvailabilityState(
                bridge
            );

        const externalAvailability =
            buildExternalAvailabilityState(
                mexico
            );

        const comparisons = [];

        for (
            const [
                id,
                live
            ] of
            Object.entries(
                bridge.items || {}
            )
        ) {
            const external =
                map.byId[
                    String(id)
                ];

            if (!external) {
                continue;
            }

            const model =
                calculateModel(
                    'mex',
                    external,
                    mexico
                );

            const liveStock =
                Number(
                    live.stock
                );

            const rawStock =
                Number(
                    external.quantity
                );

            const rawError =
                Math.abs(
                    liveStock -
                    rawStock
                );

            const modelError =
                Math.abs(
                    liveStock -
                    model.modelStock
                );

            const transition =
                isTransitionSample(
                    'mex',
                    id,
                    Number(
                        mexico.update
                    ) * 1000
                );

            const idealCorrectionRatio =
                calculateIdealCorrectionRatio(
                    liveStock,
                    rawStock,
                    model.fullCorrection
                );

            const higherPriorityItems =
                getHigherPriorityItems(
                    live.name
                );

            const higherPrioritySoldOut =
                getHigherPrioritySoldOut(
                    live.name,
                    liveAvailability
                );

            const higherPrioritySelloutAges =
                {};

            for (
                const higherName of
                higherPrioritySoldOut
            ) {
                higherPrioritySelloutAges[
                    higherName
                ] =
                    getSecondsSinceSellout(
                        higherName,
                        bridge.observedAt
                    );
            }

            const secondsSinceMostRecentHigherSellout =
                higherPrioritySoldOut.length
                    ? Math.min(
                        ...higherPrioritySoldOut
                            .map(
                                name =>
                                    higherPrioritySelloutAges[
                                        name
                                    ]
                            )
                            .filter(
                                Number.isFinite
                            )
                    )
                    : null;

            const observedGap =
                rawStock -
                liveStock;

            const observedGapRatePerMinute =
                model.ageSeconds > 0
                    ? (
                        observedGap /
                        model.ageSeconds
                    ) * 60
                    : null;

            const rateMultiplierVsLearned =
                Number.isFinite(
                    observedGapRatePerMinute
                ) &&
                Number.isFinite(
                    model.rate
                ) &&
                model.rate > 0
                    ? (
                        observedGapRatePerMinute /
                        model.rate
                    )
                    : null;

            comparisons.push({
                id:
                    Number(id),

                name:
                    live.name,

                liveStock,

                rawStock,

                rawDifference:
                    liveStock -
                    rawStock,

                feedAgeSeconds:
                    Math.round(
                        model.ageSeconds
                    ),

                ageBucket:
                    getAgeBucketKey(
                        Math.round(
                            model.ageSeconds
                        )
                    ),

                depletionPerMinute:
                    model.rate,

                depletionIntervals:
                    model.intervals,

                cycle:
                    model.cycle,

                fullAgeCorrection:
                    model.fullCorrection,

                idealCorrectionRatio,

                correctionWeight:
                    model.correctionWeight,

                appliedCorrection:
                    model.appliedCorrection,

                modelStock:
                    model.modelStock,

                modelDifference:
                    liveStock -
                    model.modelStock,

                rawError,

                modelError,

                modelImproved:                    modelError <
                    rawError,

                modelEqual:
                    modelError ===
                    rawError,

                modelStatus:
                    model.modelStatus,

                validationCount:
                    model.validationCount,

                transition,

                trainable:
                    !transition &&
                    bridgeAge <=
                        MAX_BRIDGE_AGE_MS,

                liveCost:
                    Number(
                        live.cost
                    ),

                externalCost:
                    Number(
                        external.cost
                    ),

                // =============================================
                // v0.7 demand-shift diagnostics
                // =============================================

                demandPriority:
                    MEXICO_DEMAND_PRIORITY
                        .indexOf(
                            live.name
                        ) + 1,

                higherPriorityItems,

                higherPrioritySoldOut,

                liveAvailability,

                externalAvailability,

                availabilityMismatch:
                    Object.keys(
                        liveAvailability
                    ).some(
                        name =>
                            liveAvailability[
                                name
                            ] !== null &&
                            externalAvailability[
                                name
                            ] !== null &&
                            liveAvailability[
                                name
                            ] !==
                            externalAvailability[
                                name
                            ]
                    ),

                higherPrioritySelloutAges,

                secondsSinceMostRecentHigherSellout,

                demandRegime:
                    describeDemandRegime(
                        live.name,
                        liveAvailability
                    ),

                observedGap,

                observedGapRatePerMinute,

                rateMultiplierVsLearned
            });
        }

        return {
            country:
                'Mexico',

            liveObservedAt:
                bridge.observedAt,

            liveAgeMs:
                bridgeAge,

            externalUpdate:
                mexico.update,

            liveAvailability,

            externalAvailability,

            demandPriority:
                MEXICO_DEMAND_PRIORITY,

            comparisons
        };
    }

    // =========================================================
    // TRAIN / RECORD VALIDATION
    // =========================================================

    function trainFromComparison(
        comparison
    ) {
        if (
            !comparison?.comparisons
                ?.length
        ) {
            return;
        }

        const stats =
            intelligence.stats;

        for (
            const result of
            comparison.comparisons
        ) {
            const history =
                getHistory(
                    'mex',
                    result.id
                );

            if (!history) {
                continue;
            }

            if (
                result.transition ||
                !result.trainable
            ) {
                stats.transitionSamples +=
                    1;

                continue;
            }

            const validation = {
                type:
                    'NORMAL',

                experimentVersion:
                    '0.7',

                observedAt:
                    Date.now(),

                liveObservedAt:
                    comparison
                        .liveObservedAt,

                feedTimestamp:
                    Number(
                        comparison
                            .externalUpdate
                    ) * 1000,

                cycle:
                    result.cycle,

                liveStock:
                    result.liveStock,

                rawStock:
                    result.rawStock,

                feedAgeSeconds:
                    result.feedAgeSeconds,

                ageBucket:
                    result.ageBucket,

                depletionPerMinute:
                    result
                        .depletionPerMinute,

                fullCorrection:
                    result
                        .fullAgeCorrection,

                idealCorrectionRatio:
                    result
                        .idealCorrectionRatio,

                weightUsed:
                    result
                        .correctionWeight,

                modelStock:
                    result.modelStock,

                rawError:
                    result.rawError,

                modelError:
                    result.modelError,

                modelImproved:
                    result.modelImproved,

                modelEqual:
                    result.modelEqual,

                // =============================================
                // v0.7 demand data
                // =============================================

                demandPriority:
                    result.demandPriority,

                demandRegime:
                    result.demandRegime,

                higherPriorityItems:
                    result.higherPriorityItems,

                higherPrioritySoldOut:
                    result.higherPrioritySoldOut,

                liveAvailability:
                    result.liveAvailability,

                externalAvailability:
                    result.externalAvailability,

                availabilityMismatch:
                    result.availabilityMismatch,

                higherPrioritySelloutAges:
                    result.higherPrioritySelloutAges,

                secondsSinceMostRecentHigherSellout:
                    result.secondsSinceMostRecentHigherSellout,

                observedGap:
                    result.observedGap,

                observedGapRatePerMinute:
                    result.observedGapRatePerMinute,

                rateMultiplierVsLearned:
                    result.rateMultiplierVsLearned
            };

            pushLimited(
                history.validations,
                validation,
                MAX_VALIDATIONS_PER_ITEM
            );

            stats.normalSamples +=
                1;

            stats.rawAbsoluteError +=
                result.rawError;

            stats.modelAbsoluteError +=
                result.modelError;

            stats.rawLargestError =
                Math.max(
                    stats.rawLargestError,
                    result.rawError
                );

            stats.modelLargestError =
                Math.max(
                    stats.modelLargestError,
                    result.modelError
                );

            if (
                result.rawError === 0
            ) {
                stats.rawExact +=
                    1;
            }

            if (
                result.modelError === 0
            ) {
                stats.modelExact +=
                    1;
            }
        }

        saveJson(
            HISTORY_KEY,
            intelligence
        );
    }

    // =========================================================
    // VALIDATION ACCESS
    // =========================================================

    function allMexicoValidations() {
        const items =
            intelligence
                .countries?.mex
                ?.items || {};

        const validations = [];

        for (
            const history of
            Object.values(items)
        ) {
            for (
                const validation of
                history.validations || []
            ) {
                if (
                    validation.type !==
                        'NORMAL'
                ) {
                    continue;
                }

                validations.push({
                    itemId:
                        history.id,

                    itemName:
                        history.name,

                    ...validation
                });
            }
        }

        return validations;
    }

    // =========================================================
    // AGE BUCKET ANALYSIS
    // =========================================================

    function createBucketAccumulator(
        bucket
    ) {
        return {
            bucket:
                bucket.key,

            minAgeSeconds:
                bucket.min,

            maxAgeSeconds:
                Number.isFinite(
                    bucket.max
                )
                    ? bucket.max
                    : null,

            samples: 0,

            rawAbsoluteError: 0,
            modelAbsoluteError: 0,

            rawAverageError: null,
            modelAverageError: null,

            rawExact: 0,
            modelExact: 0,

            rawExactPct: null,
            modelExactPct: null,

            rawLargestError: 0,
            modelLargestError: 0,

            modelImproved: 0,
            modelEqual: 0,
            rawBetter: 0,

            idealRatioSamples: 0,
            averageIdealCorrectionRatio:
                null,

            medianIdealCorrectionRatio:
                null,

            clippedAverageIdealRatio:
                null,

            candidateWeightMAE: {}
        };
    }

    function buildAgeBucketAnalysis() {
        const result = {};

        const ratioValues = {};
        const clippedRatios = {};
        const bucketValidations = {};

        for (
            const bucket of
            AGE_BUCKETS
        ) {
            result[
                bucket.key
            ] =
                createBucketAccumulator(
                    bucket
                );

            ratioValues[
                bucket.key
            ] = [];

            clippedRatios[
                bucket.key
            ] = [];

            bucketValidations[
                bucket.key
            ] = [];
        }

        const validations =
            allMexicoValidations();

        for (
            const validation of
            validations
        ) {
            const bucket =
                getAgeBucket(
                    validation
                        .feedAgeSeconds
                );

            if (!bucket) {
                continue;
            }

            const stats =
                result[
                    bucket.key
                ];

            const rawError =
                Number(
                    validation.rawError
                );

            const modelError =
                Number(
                    validation.modelError
                );

            if (
                !Number.isFinite(
                    rawError
                ) ||
                !Number.isFinite(
                    modelError
                )
            ) {
                continue;
            }

            bucketValidations[
                bucket.key
            ].push(
                validation
            );

            stats.samples += 1;

            stats.rawAbsoluteError +=
                rawError;

            stats.modelAbsoluteError +=
                modelError;

            stats.rawLargestError =
                Math.max(
                    stats.rawLargestError,
                    rawError
                );

            stats.modelLargestError =
                Math.max(
                    stats.modelLargestError,
                    modelError
                );

            if (rawError === 0) {
                stats.rawExact += 1;
            }

            if (modelError === 0) {
                stats.modelExact += 1;
            }

            if (
                modelError <
                rawError
            ) {
                stats.modelImproved += 1;

            } else if (
                modelError ===
                rawError
            ) {
                stats.modelEqual += 1;

            } else {
                stats.rawBetter += 1;
            }

            let ratio =
                number(
                    validation
                        .idealCorrectionRatio
                );

            if (ratio === null) {
                ratio =
                    calculateIdealCorrectionRatio(
                        validation.liveStock,
                        validation.rawStock,
                        validation.fullCorrection
                    );
            }

            if (
                Number.isFinite(
                    ratio
                )
            ) {
                ratioValues[
                    bucket.key
                ].push(
                    ratio
                );

                clippedRatios[
                    bucket.key
                ].push(
                    Math.max(
                        0,
                        Math.min(
                            1,
                            ratio
                        )
                    )
                );
            }
        }

        for (
            const bucket of
            AGE_BUCKETS
        ) {
            const stats =
                result[
                    bucket.key
                ];

            if (
                stats.samples > 0
            ) {
                stats.rawAverageError =
                    stats.rawAbsoluteError /
                    stats.samples;

                stats.modelAverageError =
                    stats.modelAbsoluteError /
                    stats.samples;

                stats.rawExactPct =
                    stats.rawExact /
                    stats.samples *
                    100;

                stats.modelExactPct =
                    stats.modelExact /
                    stats.samples *
                    100;
            }

            const ratios =
                ratioValues[
                    bucket.key
                ];

            stats.idealRatioSamples =
                ratios.length;

            stats.averageIdealCorrectionRatio =
                average(
                    ratios
                );

            stats.medianIdealCorrectionRatio =
                median(
                    ratios
                );

            stats.clippedAverageIdealRatio =
                average(
                    clippedRatios[
                        bucket.key
                    ]
                );

            for (
                const weight of
                WEIGHTS
            ) {
                stats.candidateWeightMAE[
                    String(weight)
                ] =
                    evaluateWeight(
                        bucketValidations[
                            bucket.key
                        ],
                        weight
                    );
            }
        }

        return result;
    }

    // =========================================================
    // v0.7 DEMAND REGIME ANALYSIS
    // =========================================================

    function buildDemandRegimeAnalysis() {
        const validations =
            allMexicoValidations()
                .filter(
                    validation =>
                        validation
                            .experimentVersion ===
                        '0.7'
                );

        const output = {};

        for (
            const validation of
            validations
        ) {
            const itemName =
                validation.itemName;

            const regime =
                validation.demandRegime ||
                'UNKNOWN';

            if (!output[itemName]) {
                output[itemName] = {};
            }

            if (!output[itemName][regime]) {
                output[itemName][regime] = {
                    samples: 0,

                    rawAbsoluteError: 0,
                    modelAbsoluteError: 0,

                    rawAverageError: null,
                    modelAverageError: null,

                    exactRaw: 0,
                    exactModel: 0,

                    averageFeedAgeSeconds:
                        null,

                    averageLearnedRatePerMinute:
                        null,

                    averageObservedGapRatePerMinute:
                        null,

                    medianObservedGapRatePerMinute:
                        null,

                    averageRateMultiplierVsLearned:
                        null,

                    medianRateMultiplierVsLearned:
                        null,

                    averageIdealCorrectionRatio:
                        null,

                    medianIdealCorrectionRatio:
                        null,

                    averageSecondsSinceHigherSellout:
                        null,

                    availabilityMismatchSamples:
                        0,

                    higherPrioritySoldOut:
                        []
                };
            }

            const group =
                output[
                    itemName
                ][
                    regime
                ];

            group.samples += 1;

            group.rawAbsoluteError +=
                Number(
                    validation.rawError
                ) || 0;

            group.modelAbsoluteError +=
                Number(
                    validation.modelError
                ) || 0;

            if (
                validation.rawError === 0
            ) {
                group.exactRaw += 1;
            }

            if (
                validation.modelError === 0
            ) {
                group.exactModel += 1;
            }

            if (
                validation
                    .availabilityMismatch
            ) {
                group
                    .availabilityMismatchSamples +=
                    1;
            }

            group.higherPrioritySoldOut =
                Array.from(
                    new Set([
                        ...group
                            .higherPrioritySoldOut,

                        ...(
                            validation
                                .higherPrioritySoldOut ||
                            []
                        )
                    ])
                );
        }

        /*
         * Second pass for averages/medians.
         */
        for (
            const [
                itemName,
                regimes
            ] of
            Object.entries(output)
        ) {
            for (
                const [
                    regimeName,
                    stats
                ] of
                Object.entries(regimes)
            ) {
                const matching =
                    validations.filter(
                        validation =>
                            validation
                                .itemName ===
                                itemName &&
                            (
                                validation
                                    .demandRegime ||
                                'UNKNOWN'
                            ) ===
                                regimeName
                    );

                stats.rawAverageError =
                    stats.samples
                        ? (
                            stats.rawAbsoluteError /
                            stats.samples
                        )
                        : null;

                stats.modelAverageError =
                    stats.samples
                        ? (
                            stats.modelAbsoluteError /
                            stats.samples
                        )
                        : null;

                stats.averageFeedAgeSeconds =
                    average(
                        matching.map(
                            value =>
                                number(
                                    value.feedAgeSeconds
                                )
                        )
                    );

                stats.averageLearnedRatePerMinute =
                    average(
                        matching.map(
                            value =>
                                number(
                                    value
                                        .depletionPerMinute
                                )
                        )
                    );

                stats.averageObservedGapRatePerMinute =
                    average(
                        matching.map(
                            value =>
                                number(
                                    value
                                        .observedGapRatePerMinute
                                )
                        )
                    );

                stats.medianObservedGapRatePerMinute =
                    median(
                        matching.map(
                            value =>
                                number(
                                    value
                                        .observedGapRatePerMinute
                                )
                        )
                    );

                stats.averageRateMultiplierVsLearned =
                    average(
                        matching.map(
                            value =>
                                number(
                                    value
                                        .rateMultiplierVsLearned
                                )
                        )
                    );

                stats.medianRateMultiplierVsLearned =
                    median(
                        matching.map(
                            value =>
                                number(
                                    value
                                        .rateMultiplierVsLearned
                                )
                        )
                    );

                stats.averageIdealCorrectionRatio =
                    average(
                        matching.map(
                            value =>
                                number(
                                    value
                                        .idealCorrectionRatio
                                )
                        )
                    );

                stats.medianIdealCorrectionRatio =
                    median(
                        matching.map(
                            value =>
                                number(
                                    value
                                        .idealCorrectionRatio
                                )
                        )
                    );

                stats.averageSecondsSinceHigherSellout =
                    average(
                        matching.map(
                            value =>
                                number(
                                    value
                                        .secondsSinceMostRecentHigherSellout
                                )
                        )
                    );
            }
        }

        return output;
    }

    // =========================================================
    // FETCH
    // =========================================================

    async function fetchFeed(
        manual = false
    ) {
        if (loading) {
            return;
        }

        loading = true;

        setState(
            manual
                ? 'MANUAL'
                : 'REFRESHING'
        );

        updateDiagnostics();

        try {
            if (
                typeof PDA_httpGet !==
                    'function'
            ) {
                throw new Error(
                    'PDA_httpGet unavailable.'
                );
            }

            const raw =
                await PDA_httpGet(
                    FEED_URL,
                    {
                        Accept:
                            'application/json'
                    }
                );

            if (
                !raw ||
                typeof raw.responseText !==
                    'string'
            ) {
                throw new Error(
                    'No responseText returned.'
                );
            }

            const data =
                JSON.parse(
                    raw.responseText
                );

            if (!data?.stocks) {
                throw new Error(
                    'Feed did not contain stocks.'
                );
            }

            latestFeed = data;

            lastRefresh =
                Date.now();

            refreshCount += 1;

            latestChanges = [];

            for (
                const code of
                COUNTRY_ORDER
            ) {                const countryData =
                    data.stocks[
                        code
                    ];

                if (!countryData) {
                    continue;
                }

                latestChanges.push(
                    ...processCountry(
                        code,
                        countryData
                    )
                );
            }

            saveJson(
                HISTORY_KEY,
                intelligence
            );

            const comparison =
                compareFlightCommand();

            render(
                comparison
            );

            /*
             * Log before this observation trains itself.
             */
            buildLog(
                comparison
            );

            trainFromComparison(
                comparison
            );

            setState(
                'SUCCESS',
                true
            );

        } catch (error) {
            setState(
                'FAILED'
            );

            const body =
                document.getElementById(
                    `${ID}-body`
                );

            if (body) {
                body.textContent =
                    error?.stack ||
                    String(error);
            }

        } finally {
            loading = false;

            updateDiagnostics();
        }
    }

    // =========================================================
    // COMPARISON UI
    // =========================================================

    function comparisonHtml(
        comparison
    ) {
        if (!comparison) {
            return `
                <div class="cmp-box">
                    <div class="section-title">
                        🎯 FLIGHT COMMAND GROUND TRUTH
                    </div>

                    <div class="muted">
                        Waiting for direct Mexico shop data.
                    </div>
                </div>
            `;
        }

        const rows =
            comparison.comparisons
                .map(
                    item => {

                        const weightPct =
                            Math.round(
                                item
                                    .correctionWeight *
                                100
                            );

                        let resultClass =
                            'neutral';

                        let resultText =
                            'SAME AS RAW';

                        if (
                            item.modelImproved
                        ) {
                            resultClass =
                                'good';

                            resultText =
                                'MODEL IMPROVED';

                        } else if (
                            !item.modelEqual
                        ) {
                            resultClass =
                                'bad';

                            resultText =
                                'RAW WAS BETTER';
                        }

                        const higher =
                            item
                                .higherPrioritySoldOut
                                ?.length
                                ? item
                                    .higherPrioritySoldOut
                                    .join(', ')
                                : 'None';

                        return `
                            <div class="cmp-item">

                                <div class="item-title">
                                    ${item.name}
                                </div>

                                <div class="grid">

                                    <span>
                                        FC LIVE
                                        <b>
                                            ${formatNumber(
                                                item.liveStock
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        RAW FEED
                                        <b>
                                            ${formatNumber(
                                                item.rawStock
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        FEED AGE
                                        <b>
                                            ${item.feedAgeSeconds}s
                                        </b>
                                    </span>

                                    <span>
                                        AGE BUCKET
                                        <b>
                                            ${item.ageBucket}
                                        </b>
                                    </span>

                                    <span>
                                        LEARNED BURN
                                        <b>
                                            ${
                                                item
                                                    .depletionPerMinute ===
                                                null
                                                    ? 'Learning'
                                                    : `${formatDecimal(
                                                        item
                                                            .depletionPerMinute,
                                                        1
                                                    )}/min`
                                            }
                                        </b>
                                    </span>

                                    <span>
                                        OBSERVED GAP RATE
                                        <b>
                                            ${
                                                item
                                                    .observedGapRatePerMinute ===
                                                null
                                                    ? '-'
                                                    : `${formatDecimal(
                                                        item
                                                            .observedGapRatePerMinute,
                                                        1
                                                    )}/min`
                                            }
                                        </b>
                                    </span>

                                    <span>
                                        RATE MULTIPLIER
                                        <b>
                                            ${
                                                item
                                                    .rateMultiplierVsLearned ===
                                                null
                                                    ? '-'
                                                    : `${formatDecimal(
                                                        item
                                                            .rateMultiplierVsLearned,
                                                        2
                                                    )}×`
                                            }
                                        </b>
                                    </span>

                                    <span>
                                        WEIGHT
                                        <b>
                                            ${weightPct}%
                                        </b>
                                    </span>

                                    <span>
                                        FULL CORR.
                                        <b>
                                            ${formatDecimal(
                                                item
                                                    .fullAgeCorrection,
                                                1
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        IDEAL RATIO
                                        <b>
                                            ${formatRatio(
                                                item
                                                    .idealCorrectionRatio
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        MODEL
                                        <b>
                                            ${formatNumber(
                                                item.modelStock
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        MODEL ERROR
                                        <b>
                                            ${item.modelError}
                                        </b>
                                    </span>

                                    <span>
                                        DEMAND STATE
                                        <b>
                                            ${item.demandRegime}
                                        </b>
                                    </span>

                                    <span>
                                        HIGHER SOLD OUT
                                        <b>
                                            ${higher}
                                        </b>
                                    </span>

                                    <span>
                                        SINCE SELLOUT
                                        <b>
                                            ${
                                                item
                                                    .secondsSinceMostRecentHigherSellout ===
                                                null
                                                    ? '-'
                                                    : `${formatDecimal(
                                                        item
                                                            .secondsSinceMostRecentHigherSellout,
                                                        0
                                                    )}s`
                                            }
                                        </b>
                                    </span>

                                    <span>
                                        AVAILABILITY MISMATCH
                                        <b>
                                            ${
                                                item
                                                    .availabilityMismatch
                                                    ? 'YES'
                                                    : 'NO'
                                            }
                                        </b>
                                    </span>

                                </div>

                                <div class="intel-line">

                                    ${item.modelStatus}

                                    • ${item.demandRegime}

                                    • ${
                                        item.validationCount
                                    } validation(s)

                                    •
                                    <span class="${resultClass}">
                                        ${resultText}
                                    </span>

                                </div>

                            </div>
                        `;
                    }
                )
                .join('');

        return `
            <div class="cmp-box">

                <div class="section-title">
                    🎯 MEXICO — DEMAND SHIFT VALIDATION
                </div>

                <div class="muted">
                    FC age:
                    ${ageMs(
                        comparison
                            .liveObservedAt
                    )}
                    • Feed:
                    ${ageUnix(
                        comparison
                            .externalUpdate
                    )}
                </div>

                ${rows}

            </div>
        `;
    }

    // =========================================================
    // DEMAND STATE UI
    // =========================================================

    function demandStateHtml(
        comparison
    ) {
        if (!comparison) {
            return '';
        }

        const live =
            comparison
                .liveAvailability;

        const external =
            comparison
                .externalAvailability;

        const rows =
            MEXICO_DEMAND_PRIORITY
                .map(
                    (name, index) => {

                        const liveText =
                            live[name] === true
                                ? 'IN STOCK'
                                : live[name] === false
                                    ? 'SOLD OUT'
                                    : 'UNKNOWN';

                        const externalText =
                            external[name] === true
                                ? 'IN STOCK'
                                : external[name] === false
                                    ? 'SOLD OUT'
                                    : 'UNKNOWN';

                        const demandItem =
                            getMexicoDemandState()
                                .liveItems[
                                    name
                                ];

                        const since =
                            demandItem
                                ?.soldOutAt
                                ? (
                                    (
                                        comparison
                                            .liveObservedAt -
                                        demandItem
                                            .soldOutAt
                                    ) /
                                    1000
                                )
                                : null;

                        return `
                            <div class="demand-row">

                                <strong>
                                    #${index + 1}
                                    ${name}
                                </strong>

                                <div class="demand-grid">

                                    <span>
                                        Live
                                        <b>
                                            ${liveText}
                                        </b>
                                    </span>

                                    <span>
                                        External
                                        <b>
                                            ${externalText}
                                        </b>
                                    </span>

                                    <span>
                                        Sold out for
                                        <b>
                                            ${
                                                since === null
                                                    ? '-'
                                                    : `${formatDecimal(
                                                        Math.max(
                                                            0,
                                                            since
                                                        ),
                                                        0
                                                    )}s`
                                            }
                                        </b>
                                    </span>

                                </div>

                            </div>
                        `;
                    }
                )
                .join('');

        return `
            <div class="demand-box">

                <div class="section-title">
                    🔀 MEXICO DEMAND STATE
                </div>

                <div class="muted">
                    Experimental observation order only.
                    Predictions are still unchanged.
                </div>

                ${rows}

            </div>
        `;
    }

    // =========================================================
    // AGE BUCKET UI
    // =========================================================

    function ageBucketHtml() {
        const analysis =
            buildAgeBucketAnalysis();

        const rows =
            AGE_BUCKETS
                .map(
                    bucket => {

                        const stats =
                            analysis[
                                bucket.key
                            ];

                        if (
                            !stats ||
                            stats.samples === 0
                        ) {
                            return `
                                <div class="bucket-row">
                                    <strong>
                                        ${bucket.key}
                                    </strong>
                                    <div class="muted">
                                        No samples yet
                                    </div>
                                </div>
                            `;
                        }

                        const winner =
                            stats.modelAbsoluteError <
                            stats.rawAbsoluteError
                                ? 'MODEL'
                                : stats.modelAbsoluteError >
                                    stats.rawAbsoluteError
                                    ? 'RAW'
                                    : 'TIE';

                        return `
                            <div class="bucket-row">

                                <div class="bucket-head">

                                    <strong>
                                        ${bucket.key}
                                    </strong>

                                    <span>
                                        ${winner}
                                    </span>

                                </div>

                                <div class="bucket-grid">

                                    <span>
                                        Samples
                                        <b>
                                            ${stats.samples}
                                        </b>
                                    </span>

                                    <span>
                                        Raw MAE
                                        <b>
                                            ${formatDecimal(
                                                stats.rawAverageError,
                                                1
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        Model MAE
                                        <b>
                                            ${formatDecimal(
                                                stats.modelAverageError,
                                                1
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        Ideal median
                                        <b>
                                            ${formatRatio(
                                                stats
                                                    .medianIdealCorrectionRatio
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        Ideal clipped avg
                                        <b>
                                            ${formatRatio(
                                                stats
                                                    .clippedAverageIdealRatio
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        0% MAE
                                        <b>
                                            ${formatDecimal(
                                                stats
                                                    .candidateWeightMAE[
                                                    '0'
                                                ],
                                                1
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        25% MAE
                                        <b>
                                            ${formatDecimal(
                                                stats
                                                    .candidateWeightMAE[
                                                    '0.25'
                                                ],
                                                1
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        50% MAE
                                        <b>
                                            ${formatDecimal(
                                                stats
                                                    .candidateWeightMAE[
                                                    '0.5'
                                                ],
                                                1
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        75% MAE
                                        <b>
                                            ${formatDecimal(
                                                stats
                                                    .candidateWeightMAE[
                                                    '0.75'
                                                ],
                                                1
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        100% MAE
                                        <b>
                                            ${formatDecimal(
                                                stats
                                                    .candidateWeightMAE[
                                                    '1'
                                                ],
                                                1
                                            )}
                                        </b>
                                    </span>

                                </div>

                            </div>
                        `;
                    }
                )
                .join('');

        return `
            <div class="bucket-box">

                <div class="section-title">
                    ⏱ AGE-BUCKET ANALYSIS
                </div>

                ${rows}

            </div>
        `;
    }

    // =========================================================
    // DEMAND ANALYSIS UI
    // =========================================================

    function demandAnalysisHtml() {
        const analysis =
            buildDemandRegimeAnalysis();

        const sections = [];

        for (
            const name of
            MEXICO_DEMAND_PRIORITY
        ) {
            const regimes =
                analysis[
                    name
                ];

            if (!regimes) {
                continue;
            }

            const rows =
                Object.entries(
                    regimes
                )
                .map(
                    ([
                        regime,
                        stats
                    ]) => `
                        <div class="regime-row">

                            <strong>
                                ${regime}
                            </strong>

                            <div class="bucket-grid">

                                <span>
                                    Samples
                                    <b>
                                        ${stats.samples}
                                    </b>
                                </span>

                                <span>
                                    Learned burn
                                    <b>
                                        ${
                                            stats
                                                .averageLearnedRatePerMinute ===
                                            null
                                                ? '-'
                                                : `${formatDecimal(
                                                    stats
                                                        .averageLearnedRatePerMinute,
                                                    1
                                                )}/min`
                                        }
                                    </b>
                                </span>

                                <span>
                                    Gap rate avg
                                    <b>
                                        ${
                                            stats
                                                .averageObservedGapRatePerMinute ===
                                            null
                                                ? '-'
                                                : `${formatDecimal(
                                                    stats
                                                        .averageObservedGapRatePerMinute,
                                                    1
                                                )}/min`
                                        }
                                    </b>
                                </span>

                                <span>
                                    Gap rate median
                                    <b>
                                        ${
                                            stats
                                                .medianObservedGapRatePerMinute ===
                                            null
                                                ? '-'
                                                : `${formatDecimal(
                                                    stats
                                                        .medianObservedGapRatePerMinute,
                                                    1
                                                )}/min`
                                        }
                                    </b>
                                </span>

                                <span>
                                    Rate multiplier
                                    <b>
                                        ${
                                            stats
                                                .medianRateMultiplierVsLearned ===
                                            null
                                                ? '-'
                                                : `${formatDecimal(
                                                    stats
                                                        .medianRateMultiplierVsLearned,
                                                    2
                                                )}×`
                                        }
                                    </b>
                                </span>

                                <span>
                                    Ideal ratio median
                                    <b>
                                        ${formatRatio(
                                            stats
                                                .medianIdealCorrectionRatio
                                        )}
                                    </b>
                                </span>

                                <span>
                                    Raw MAE
                                    <b>
                                        ${formatDecimal(
                                            stats.rawAverageError,
                                            1
                                        )}
                                    </b>
                                </span>

                                <span>
                                    Model MAE
                                    <b>
                                        ${formatDecimal(
                                            stats.modelAverageError,
                                            1
                                        )}
                                    </b>
                                </span>

                                <span>
                                    Since sellout avg
                                    <b>
                                        ${
                                            stats
                                                .averageSecondsSinceHigherSellout ===
                                            null
                                                ? '-'
                                                : `${formatDecimal(
                                                    stats
                                                        .averageSecondsSinceHigherSellout,
                                                    0
                                                )}s`
                                        }
                                    </b>
                                </span>

                            </div>

                        </div>
                    `
                )
                .join('');

            sections.push(`
                <div class="demand-analysis-item">

                    <div class="item-title">
                        ${name}
                    </div>

                    ${rows}

                </div>
            `);
        }

        return `
            <div class="demand-analysis-box">

                <div class="section-title">
                    📈 DEMAND REGIME ANALYSIS
                </div>

                <div class="muted">
                    Only v0.7 observations are included here.
                </div>

                ${
                    sections.length
                        ? sections.join('')
                        : `
                            <div class="muted">
                                Waiting for v0.7 validations.
                            </div>
                        `
                }

            </div>
        `;
    }

    // =========================================================
    // COUNTRY UI
    // =========================================================

    function countryHtml(
        code,
        countryData
    ) {
        const map =
            getItemMap(
                countryData
            );

        const featured =
            FEATURED_ITEMS[
                code
            ] || [];

        const rows =
            featured
                .map(
                    name => {

                        const item =
                            map.byName[
                                name
                            ];

                        if (!item) {
                            return '';
                        }

                        const model =
                            calculateModel(
                                code,
                                item,
                                countryData
                            );

                        const soldOut =
                            Number(
                                item.quantity
                            ) <= 0;

                        return `
                            <div class="country-item">

                                <div class="country-item-top">

                                    <div>
                                        <strong>
                                            ${item.name}
                                        </strong>

                                        <div class="small">
                                            ID ${item.id}
                                            • ${money(
                                                item.cost
                                            )}
                                        </div>
                                    </div>

                                    <div class="${
                                        soldOut
                                            ? 'stock-zero'
                                            : 'stock-ok'
                                    }">
                                        ${
                                            soldOut
                                                ? 'SOLD OUT'
                                                : formatNumber(
                                                    item.quantity
                                                )
                                        }
                                    </div>

                                </div>

                                <div class="intel-grid">

                                    <span>
                                        Raw
                                        <b>
                                            ${formatNumber(
                                                item.quantity
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        Model
                                        <b>
                                            ${formatNumber(
                                                model.modelStock
                                            )}
                                        </b>
                                    </span>

                                    <span>
                                        Burn
                                        <b>
                                            ${
                                                model.rate ===
                                                null
                                                    ? 'Learning'
                                                    : `${formatDecimal(
                                                        model.rate,
                                                        1
                                                    )}/min`
                                            }                                        </b>
                                    </span>

                                    <span>
                                        Weight
                                        <b>
                                            ${
                                                Math.round(
                                                    model
                                                        .correctionWeight *
                                                    100
                                                )
                                            }%
                                        </b>
                                    </span>

                                </div>

                                <div class="intel-line">
                                    ${model.modelStatus}
                                    • cycle ${model.cycle}
                                    • ${model.intervals} burn interval(s)
                                </div>

                            </div>
                        `;
                    }
                )
                .join('');

        return `
            <div class="country-box">

                <div class="country-head">

                    <strong>
                        ${COUNTRY_NAMES[
                            code
                        ]}
                    </strong>

                    <span>
                        ${ageUnix(
                            countryData.update
                        )} old
                    </span>

                </div>

                ${rows}

            </div>
        `;
    }

    // =========================================================
    // RENDER
    // =========================================================

    function render(
        comparison
    ) {
        const body =
            document.getElementById(
                `${ID}-body`
            );

        if (
            !body ||
            !latestFeed
        ) {
            return;
        }

        const sections = [
            comparisonHtml(
                comparison
            ),

            demandStateHtml(
                comparison
            ),

            demandAnalysisHtml(),

            ageBucketHtml()
        ];

        for (
            const code of
            COUNTRY_ORDER
        ) {
            const countryData =
                latestFeed
                    .stocks[
                        code
                    ];

            if (!countryData) {
                continue;
            }

            sections.push(
                countryHtml(
                    code,
                    countryData
                )
            );
        }

        body.innerHTML =
            sections.join('');

        updateSummary();
    }

    // =========================================================
    // SUMMARY
    // =========================================================

    function updateSummary() {
        const el =
            document.getElementById(
                `${ID}-summary`
            );

        if (!el) {
            return;
        }

        const stats =
            intelligence.stats;

        const rawMAE =
            stats.normalSamples
                ? (
                    stats
                        .rawAbsoluteError /
                    stats.normalSamples
                ).toFixed(1)
                : '-';

        const modelMAE =
            stats.normalSamples
                ? (
                    stats
                        .modelAbsoluteError /
                    stats.normalSamples
                ).toFixed(1)
                : '-';

        const rawExact =
            stats.normalSamples
                ? (
                    stats.rawExact /
                    stats.normalSamples *
                    100
                ).toFixed(1)
                : '-';

        const modelExact =
            stats.normalSamples
                ? (
                    stats.modelExact /
                    stats.normalSamples *
                    100
                ).toFixed(1)
                : '-';

        const savedError =
            stats.rawAbsoluteError -
            stats.modelAbsoluteError;

        const improvementPct =
            stats.rawAbsoluteError > 0
                ? (
                    savedError /
                    stats.rawAbsoluteError *
                    100
                ).toFixed(1)
                : '-';

        const demand =
            getMexicoDemandState();

        el.innerHTML = `
            <div>
                Normal samples:
                <b>${stats.normalSamples}</b>
            </div>

            <div>
                Transition samples:
                <b>${stats.transitionSamples}</b>
            </div>

            <div>
                Raw avg error:
                <b>${rawMAE}</b>
            </div>

            <div>
                Model avg error:
                <b>${modelMAE}</b>
            </div>

            <div>
                Raw exact:
                <b>${rawExact}%</b>
            </div>

            <div>
                Model exact:
                <b>${modelExact}%</b>
            </div>

            <div>
                Error saved:
                <b>${savedError}</b>
            </div>

            <div>
                Improvement:
                <b>${improvementPct}%</b>
            </div>

            <div>
                Live sellouts:
                <b>
                    ${demand.selloutEvents.length}
                </b>
            </div>

            <div>
                Live restocks:
                <b>
                    ${demand.restockEvents.length}
                </b>
            </div>

            <div>
                Changes:
                <b>${latestChanges.length}</b>
            </div>

            <div>
                Refresh:
                <b>${refreshCount}</b>
            </div>
        `;
    }

    // =========================================================
    // LOG
    // =========================================================

    function buildLog(
        comparison
    ) {
        const destinations = {};

        for (
            const code of
            COUNTRY_ORDER
        ) {
            const countryData =
                latestFeed
                    ?.stocks?.[
                        code
                    ];

            if (!countryData) {
                continue;
            }

            const map =
                getItemMap(
                    countryData
                );

            const featured = [];

            for (
                const name of
                FEATURED_ITEMS[
                    code
                ] || []
            ) {
                const item =
                    map.byName[
                        name
                    ];

                if (!item) {
                    continue;
                }

                const model =
                    calculateModel(
                        code,
                        item,
                        countryData
                    );

                featured.push({
                    id:
                        item.id,

                    name:
                        item.name,

                    rawStock:
                        Number(
                            item.quantity
                        ),

                    cost:
                        Number(
                            item.cost
                        ),

                    feedAgeSeconds:
                        Math.round(
                            model.ageSeconds
                        ),

                    ageBucket:
                        getAgeBucketKey(
                            Math.round(
                                model.ageSeconds
                            )
                        ),

                    cycle:
                        model.cycle,

                    depletionPerMinute:
                        model.rate,

                    depletionIntervals:
                        model.intervals,

                    correctionWeight:
                        model
                            .correctionWeight,

                    fullAgeCorrection:
                        model
                            .fullCorrection,

                    appliedCorrection:
                        model
                            .appliedCorrection,

                    modelStock:
                        model.modelStock,

                    modelStatus:
                        model.modelStatus,

                    validations:
                        model.validationCount
                });
            }

            destinations[
                COUNTRY_NAMES[
                    code
                ]
            ] = {
                code,

                update:
                    countryData.update,

                age:
                    ageUnix(
                        countryData.update
                    ),

                featured
            };
        }

        const demand =
            getMexicoDemandState();

        latestLog =
            safeJson({
                test:
                    'Multi-Country Intelligence v0.7',

                experiment:
                    'Availability-Aware Demand Shift Validation',

                predictionMode:
                    'v0.6 prediction unchanged',

                refreshedAt:
                    new Date()
                        .toISOString(),

                refreshCount,

                feedTimestamp:
                    latestFeed
                        ?.timestamp,

                migration:
                    intelligence.migration,

                mexicoDemandPriority:
                    MEXICO_DEMAND_PRIORITY,

                mexicoDemandState: {
                    lastObservedAt:
                        demand.lastObservedAt,

                    liveItems:
                        demand.liveItems,

                    recentSelloutEvents:
                        demand
                            .selloutEvents
                            .slice(-10),

                    recentRestockEvents:
                        demand
                            .restockEvents
                            .slice(-10)
                },

                flightCommandComparison:
                    comparison,

                stats:
                    intelligence.stats,

                demandRegimeAnalysis:
                    buildDemandRegimeAnalysis(),

                ageBucketAnalysis:
                    buildAgeBucketAnalysis(),

                destinations,

                changes:
                    latestChanges
            });
    }

    async function copyLog() {
        if (!latestLog) {
            return;
        }

        const button =
            document.getElementById(
                `${ID}-copy`
            );

        try {
            await navigator
                .clipboard
                .writeText(
                    latestLog
                );

        } catch (_) {
            const textarea =
                document.createElement(
                    'textarea'
                );

            textarea.value =
                latestLog;

            textarea.style.position =
                'fixed';

            textarea.style.left =
                '-9999px';

            document.body.appendChild(
                textarea
            );

            textarea.select();

            document.execCommand(
                'copy'
            );

            textarea.remove();
        }

        if (button) {
            button.textContent =
                'COPIED ✓';

            setTimeout(
                () => {
                    button.textContent =
                        'COPY LOG';
                },
                1500
            );
        }
    }

    // =========================================================
    // MINIMIZE / RESTORE
    // =========================================================

    function createRestoreButton() {
        if (
            document.getElementById(
                `${ID}-restore`
            )
        ) {
            return;
        }

        const button =
            document.createElement(
                'button'
            );

        button.id =
            `${ID}-restore`;

        button.type =
            'button';

        button.textContent =
            '🌎';

        button.title =
            'Restore Multi-Country Intelligence';

        button.addEventListener(
            'click',
            restorePanel
        );

        document.body.appendChild(
            button
        );
    }

    function minimizePanel() {
        const panel =
            document.getElementById(
                ID
            );

        if (panel) {
            panel.style.display =
                'none';
        }

        createRestoreButton();
    }

    function restorePanel() {
        const panel =
            document.getElementById(
                ID
            );

        if (panel) {
            panel.style.display =
                'block';
        }

        document
            .getElementById(
                `${ID}-restore`
            )
            ?.remove();

        updateDiagnostics();
    }

    // =========================================================
    // DIAGNOSTICS
    // =========================================================

    function setState(
        text,
        good = false
    ) {
        const el =
            document.getElementById(
                `${ID}-state`
            );

        if (!el) {
            return;
        }

        el.textContent =
            text;

        el.style.color =
            good
                ? '#9de2ad'
                : '#ffd27d';
    }

    function updateDiagnostics() {
        const last =
            document.getElementById(
                `${ID}-last`
            );

        const next =
            document.getElementById(
                `${ID}-next`
            );

        const count =
            document.getElementById(
                `${ID}-count`
            );

        if (last) {
            last.textContent =
                lastRefresh
                    ? `${ageMs(
                        lastRefresh
                    )} ago`
                    : 'Never';
        }

        if (next) {
            if (loading) {
                next.textContent =
                    'Refreshing';

            } else if (
                lastRefresh
            ) {
                const remaining =
                    Math.max(
                        0,

                        Math.ceil(
                            (
                                AUTO_REFRESH_MS -
                                (
                                    Date.now() -
                                    lastRefresh
                                )
                            ) /
                            1000
                        )
                    );

                next.textContent =
                    `${remaining}s`;

            } else {
                next.textContent =
                    '--';
            }
        }

        if (count) {
            count.textContent =
                String(
                    refreshCount
                );
        }
    }

    // =========================================================
    // UI
    // =========================================================

    function createPanel() {
        if (
            document.getElementById(
                ID
            )
        ) {
            return;
        }

        const style =
            document.createElement(
                'style'
            );

        style.textContent = `
            #${ID} {
                position:fixed;
                left:10px;
                right:10px;
                top:65px;
                max-height:84vh;
                overflow:auto;
                z-index:2147483647;
                background:rgba(18,18,20,.985);
                color:#eee;
                border:1px solid rgba(255,255,255,.15);
                border-radius:12px;
                box-shadow:0 15px 45px rgba(0,0,0,.65);
                font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
            }

            #${ID}-restore {
                position:fixed;
                right:14px;
                bottom:90px;
                z-index:2147483647;
                width:56px;
                height:56px;
                border:1px solid rgba(255,255,255,.20);
                border-radius:50%;
                background:#303033;
                color:#eee;
                box-shadow:0 8px 24px rgba(0,0,0,.55);
                font-size:23px;
                font-weight:900;
            }

            #${ID} .head {
                position:sticky;
                top:0;
                z-index:5;
                padding:10px;
                background:#303033;
                border-bottom:1px solid rgba(255,255,255,.08);
            }

            #${ID} .title-row {
                display:flex;
                justify-content:space-between;
                align-items:center;
                gap:8px;
            }

            #${ID} .buttons {
                display:grid;
                grid-template-columns:1fr 1fr 1fr;
                gap:6px;
                margin-top:8px;
            }

            #${ID} button {
                min-height:38px;
                border:1px solid #555;
                border-radius:7px;
                background:#222;
                color:#eee;
                font-weight:800;
            }

            #${ID} .diagnostics {
                display:grid;
                grid-template-columns:1fr 1fr 1fr;
                gap:5px;
                margin-top:8px;
                padding:7px;
                border-radius:7px;
                background:rgba(0,0,0,.20);
                font-size:9px;
                color:#a3acb6;
            }

            #${ID}-body {
                padding:8px;
            }

            #${ID} .cmp-box,
            #${ID} .demand-box,
            #${ID} .demand-analysis-box,
            #${ID} .bucket-box,
            #${ID} .country-box {
                margin-bottom:10px;
                padding:10px;
                border-radius:9px;
                background:rgba(255,255,255,.04);
            }

            #${ID} .cmp-box {
                border:1px solid rgba(91,160,220,.35);
            }

            #${ID} .demand-box,
            #${ID} .demand-analysis-box {
                border:1px solid rgba(157,226,173,.30);
            }

            #${ID} .bucket-box {
                border:1px solid rgba(255,210,125,.25);
            }

            #${ID} .section-title {
                margin-bottom:6px;
                font-size:12px;
                font-weight:900;
            }

            #${ID} .muted,
            #${ID} .small {
                color:#929ca7;
                font-size:9px;
            }

            #${ID} .cmp-item,
            #${ID} .demand-row,
            #${ID} .regime-row,
            #${ID} .bucket-row {
                padding:9px 0;
                border-top:1px solid rgba(255,255,255,.07);
            }

            #${ID} .item-title {
                margin-bottom:5px;
                font-size:11px;
                font-weight:900;
            }

            #${ID} .grid,
            #${ID} .intel-grid,
            #${ID} .bucket-grid,
            #${ID} .demand-grid {
                display:grid;
                grid-template-columns:1fr 1fr;
                gap:4px 8px;
                font-size:9px;
                color:#9da6b0;
            }

            #${ID} .grid b,
            #${ID} .intel-grid b,
            #${ID} .bucket-grid b,
            #${ID} .demand-grid b {
                color:#eee;
            }

            #${ID} .good {
                color:#9de2ad;
                font-weight:900;
            }

            #${ID} .bad {
                color:#ee9999;
                font-weight:900;
            }

            #${ID} .neutral {
                color:#ffd27d;
                font-weight:900;
            }

            #${ID} .intel-line {
                margin-top:6px;
                padding-top:5px;
                border-top:1px solid rgba(255,255,255,.05);
                color:#9ba5af;
                font-size:8px;
                font-weight:700;
            }

            #${ID} .bucket-head {
                display:flex;
                justify-content:space-between;
                align-items:center;
                margin-bottom:5px;
                font-size:10px;
            }

            #${ID} .country-head {
                display:flex;
                justify-content:space-between;
                align-items:center;
                margin-bottom:5px;
                padding-bottom:5px;
                border-bottom:1px solid rgba(255,255,255,.06);
            }

            #${ID} .country-head span {
                color:#929ca7;
                font-size:9px;
            }

            #${ID} .country-item {
                padding:7px 0;
                border-bottom:1px solid rgba(255,255,255,.04);
            }

            #${ID} .country-item:last-child {
                border-bottom:0;
            }

            #${ID} .country-item-top {
                display:flex;
                justify-content:space-between;
                align-items:center;
                margin-bottom:5px;
                font-size:11px;
            }

            #${ID} .stock-ok {
                color:#9de2ad;
                font-weight:900;
            }

            #${ID} .stock-zero {
                color:#ec9393;
                font-size:9px;
                font-weight:900;
            }

            #${ID}-summary {
                display:grid;
                grid-template-columns:1fr 1fr;
                gap:5px 8px;
                padding:10px;
                border-top:1px solid rgba(255,255,255,.07);
                color:#929ca7;
                font-size:9px;
            }

            #${ID}-summary b {
                color:#eee;
            }
        `;

        document.head.appendChild(
            style
        );

        const panel =
            document.createElement(
                'div'
            );

        panel.id = ID;

        panel.innerHTML = `
            <div class="head">

                <div class="title-row">

                    <strong>
                        🔀 MULTI-COUNTRY INTELLIGENCE v0.7
                    </strong>

                    <span id="${ID}-state">
                        READY
                    </span>

                </div>

                <div class="buttons">

                    <button
                        id="${ID}-refresh"
                        type="button"
                    >
                        REFRESH NOW
                    </button>

                    <button
                        id="${ID}-copy"
                        type="button"
                    >
                        COPY LOG
                    </button>

                    <button
                        id="${ID}-minimize"
                        type="button"
                    >
                        MINIMIZE
                    </button>

                </div>

                <div class="diagnostics">

                    <div>
                        TEST:
                        <b>DEMAND SHIFT</b>
                    </div>

                    <div>
                        AUTO:
                        <b>30s</b>
                    </div>

                    <div>
                        Last:
                        <b id="${ID}-last">
                            Never
                        </b>                    </div>

                    <div>
                        Next:
                        <b id="${ID}-next">
                            --
                        </b>
                    </div>

                    <div>
                        Refreshes:
                        <b id="${ID}-count">
                            0
                        </b>
                    </div>

                </div>

            </div>

            <div id="${ID}-body">
                Building v0.7 demand-shift baseline…
            </div>

            <div id="${ID}-summary">
                Waiting for observations.
            </div>
        `;

        document.body.appendChild(
            panel
        );

        document
            .getElementById(
                `${ID}-refresh`
            )
            .addEventListener(
                'click',
                () =>
                    fetchFeed(true)
            );

        document
            .getElementById(
                `${ID}-copy`
            )
            .addEventListener(
                'click',
                copyLog
            );

        document
            .getElementById(
                `${ID}-minimize`
            )
            .addEventListener(
                'click',
                minimizePanel
            );

        fetchFeed();
    }

    // =========================================================
    // AUTO REFRESH
    // =========================================================

    setInterval(
        () => {
            updateDiagnostics();

            if (
                !loading &&
                lastRefresh &&
                Date.now() -
                    lastRefresh >=
                    AUTO_REFRESH_MS
            ) {
                fetchFeed();
            }
        },
        1000
    );

    // =========================================================
    // START
    // =========================================================

    if (document.body) {
        createPanel();

    } else {
        window.addEventListener(
            'DOMContentLoaded',
            createPanel,
            {
                once: true
            }
        );
    }

})();