// ==UserScript==
// @name         Websim Simalyze
// @namespace    http://websim.ai/userscripts/simalyze
// @version      2.0
// @description  Removes unwanted content and provides filtering options for WebSim based on a sophisticated algorithm using the full metadata API.
// @author       FsX
// @match        https://websim.com/*
// @match        https://websim.ai/*
// @match        https://websim.pages.dev/*
// @run-at       document-idle
// @grant        none
// @tweakable    Adjust the URLs where this script will run. Use '*' for wildcards.
// ==/UserScript==

(async function() {
    let pLimit;
    try {
        const module = await import('p-limit');
        pLimit = module.default;
    } catch (e) {
        console.error("Simalyze: Failed to load p-limit module. Concurrency limiting will not be applied.", e);
        pLimit = (concurrency) => (fn) => fn();
    }

    const consoleHeaderStyle = 'font-size: 24px; color: black; text-shadow: none;';
    const consoleRainbowStyle = 'font-size: 24px; color: black;';
    const consoleByFsXStyle = 'font-size: 16px; color: black;';

    console.log('%cThanks for using %cWEBSIM SIMALYZE%c', consoleHeaderStyle, consoleRainbowStyle, '');
    console.log('%cBy FsX', consoleByFsXStyle);

    let analyzerModeActive = JSON.parse(localStorage.getItem('simalyze_analyzerModeActive')) ?? false;
    let slopRemover2Active = JSON.parse(localStorage.getItem('simalyze_slopRemover2Active')) ?? false;
    let highlightGoodProjectsActive = JSON.parse(localStorage.getItem('simalyze_highlightGoodProjectsActive')) ?? false;
    let highlightThreshold = JSON.parse(localStorage.getItem('simalyze_highlightThreshold')) ?? 75;
    let currentTheme = localStorage.getItem('simalyze_currentTheme') ?? 'gray';
    let customCSS = localStorage.getItem('simalyze_customCSS') ?? '';

    let loadingAnalysisText = "Loading analysis...";
    let bypassAnalysisButtonText = "View Project (Bypass Analysis)";
    let unwantedKeyword = "Keyboard & Achievements";
    let unwantedKeywordPenalty = -50;

    let viewProjectButtonText = "View Project";
    let viewDetailsButtonText = "View Details";

    const projectDataCache = new Map();
    const creatorStatsCache = new Map();
    const analysisCache = new Map();

    const apiConcurrencyLimit = 5;
    const analysisConcurrencyLimit = 1;

    const limitApi = pLimit(apiConcurrencyLimit);
    const limitAnalysis = pLimit(analysisConcurrencyLimit);

    const projectCacheDuration = 5 * 60 * 1000;
    const creatorStatsCacheDuration = 5 * 60 * 1000;
    const assetsCacheDuration = 10 * 60 * 1000;
    const analysisResultCacheDuration = 10 * 60 * 1000;
    const revisionsCacheDuration = 10 * 60 * 1000;
    const screenshotsCacheDuration = 10 * 60 * 1000;
    const descendantsCacheDuration = 15 * 60 * 1000;
    const htmlContentCacheDuration = 15 * 60 * 1000;

    const WEBSIM_API_BASE_URL = 'https://api.websim.com/api/v1';
    const SIMALYZE_LOGO_URL = 'https://raw.githubusercontent.com/fsxstealth/Quantum-Planner/main/lol.png';
    const FSX_PROFILE_URL = 'https://websim.com/@fsx/';

    const GOOD_PROJECT_ICON_SVG = `
        <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
        </svg>
    `;

    const TIMER_LOADING_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="currentColor"> <path d="M13 5.07089C16.3923 5.55612 19 8.47353 19 12C19 15.866 15.866 19 12 19C8.13401 19 5 15.866 5 12C5 9.96159 5.87128 8.12669 7.26175 6.84738L5.84658 5.43221C4.09461 7.0743 3 9.40932 3 12C3 16.9706 7.02944 21 12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C11.662 3 11.3283 3.01863 11 3.05493V9.08551H13V5.07089Z" fill="currentColor"/> <path d="M7.70711 8.70708C7.31658 9.0976 7.31658 9.73077 7.70711 10.1213L10.5355 12.9497C10.9261 13.3402 11.5592 13.3402 11.9497 12.9497C12.3403 12.5592 12.3403 11.926 11.9497 11.5355L9.12132 8.70708C8.7308 8.31655 8.09763 8.31655 7.70711 8.70708Z" fill="currentColor"/> </svg>`;

    function saveSettings() {
        localStorage.setItem('simalyze_analyzerModeActive', JSON.stringify(analyzerModeActive));
        localStorage.setItem('simalyze_slopRemover2Active', JSON.stringify(slopRemover2Active));
        localStorage.setItem('simalyze_highlightGoodProjectsActive', JSON.stringify(highlightGoodProjectsActive));
        localStorage.setItem('simalyze_highlightThreshold', JSON.stringify(highlightThreshold));
        localStorage.setItem('simalyze_currentTheme', currentTheme);
        localStorage.setItem('simalyze_customCSS', customCSS);
    }

    function parseNumber(text) {
        if (!text) return 0;
        const cleanText = String(text).toLowerCase().trim();
        if (cleanText.endsWith('k')) {
            return parseFloat(cleanText) * 1000;
        }
        if (cleanText.endsWith('m')) {
            return parseFloat(cleanText) * 1000000;
        }
        return parseFloat(cleanText) || 0;
    }

    function extractDomData(element) {
        const fullPostLink = element.getAttribute('href') || '';
        const projectIdFromDom = element.getAttribute('w-pid') || '';

        let projectSlug = null;
        let projectUsername = null;
        const matchSlug = fullPostLink.match(/^\/@([a-zA-Z0-9_]{3,32})\/([a-zA-Z0-9-]+)$/);
        if (matchSlug) {
            projectUsername = matchSlug[1];
            projectSlug = matchSlug[2];
        }

        const previewImageUrl = element.querySelector('div.flex.w-full.h-full.relative.overflow-hidden img.object-cover')?.src || '';

        const titleElement = element.querySelector('h3.text-lg');
        const title = titleElement ? titleElement.textContent : '';

        const authorLinkElement = element.querySelector('a[href*="/@"]');
        const authorAvatarUrl = authorLinkElement?.querySelector('img')?.src || '';
        const authorNameElement = authorLinkElement?.nextElementSibling;
        const authorName = authorNameElement ? authorNameElement.textContent.trim() : '';
        const authorProfileLink = authorLinkElement?.href || '';

        const timestampSpan = element.querySelector('span[title]');
        const timestamp = timestampSpan?.title || '';
        const relativeTime = timestampSpan?.textContent || '';

        let likesValue = 0;
        let viewsValue = 0;
        const cardFooter = element.querySelector('div.flex.justify-between.items-center.text-gray-500.dark\\:text-gray-400.mt-2.text-xs');
        if (cardFooter) {
            const spansInFooter = Array.from(cardFooter.querySelectorAll('span'));
            const likesSpan = spansInFooter.find(s => s.textContent.includes('♡'));
            if (likesSpan) {
                const match = likesSpan.textContent.match(/♡\s*(\d+(\.\d+)?[kKm]?)/i);
                if (match && match[1]) {
                    likesValue = parseNumber(match[1]);
                }
            }
            const viewsSpan = spansInFooter.find(s => {
                return s.querySelector('svg') && s.textContent.match(/(\d+(\.\d+)?[kKm]?)\s*$/i);
            });
            if (viewsSpan) {
                const match = viewsSpan.textContent.match(/(\d+(\.\d+)?[kKm]?)\s*$/i);
                if (match && match[1]) {
                    viewsValue = parseNumber(match[1]);
                }
            }
        }

        return {
            projectIdFromDom: projectIdFromDom,
            projectSlug: projectSlug,
            projectUsername: projectUsername,
            fullPostLink: fullPostLink,
            previewImageUrl: previewImageUrl,
            title: title,
            authorAvatarUrl: authorAvatarUrl,
            authorName: authorName,
            authorProfileLink: authorProfileLink,
            timestamp: timestamp,
            relativeTime: relativeTime,
            likesValue: likesValue,
            viewsValue: viewsValue,
            extractedCreatorUsername: authorName
        };
    }

    async function fetchProjectMetadata(projectDomData) {
        const { projectIdFromDom, projectSlug, projectUsername, extractedCreatorUsername } = projectDomData;

        let apiData = null;
        let creatorStats = null;
        let numAssets = null;
        let revisionsCount = null;
        let screenshotsCount = null;
        let avgPlaytime = null;
        let descendantsCount = null;
        let htmlContent = null;

        let canonicalProjectId = projectIdFromDom;

        if (projectUsername && projectSlug) {
            let cached = projectDataCache.get(`slug-${projectUsername}-${projectSlug}`);
            if (cached && (Date.now() - cached.lastFetched < projectCacheDuration)) {
                apiData = cached;
                if (!canonicalProjectId && apiData?.project?.id) {
                    canonicalProjectId = apiData.project.id;
                }
            }
        }

        if (!apiData && canonicalProjectId) {
            let cached = projectDataCache.get(canonicalProjectId);
            if (cached && (Date.now() - cached.lastFetched < projectCacheDuration)) {
                apiData = cached;
            }
        }

        if (!apiData) {
            try {
                if (projectUsername && projectSlug) {
                    const response = await limitApi(() => fetch(`${WEBSIM_API_BASE_URL}/users/${projectUsername}/slugs/${projectSlug}`));
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const data = await response.json();
                    if (data?.project?.id) {
                        apiData = data;
                        canonicalProjectId = data.project.id;
                        projectDataCache.set(canonicalProjectId, { ...data, lastFetched: Date.now() });
                        projectDataCache.set(`slug-${projectUsername}-${projectSlug}`, { ...data, lastFetched: Date.now() });
                    }
                }
            } catch (error) {
                console.error(`Simalyze: Exception fetching project by slug for /@${projectUsername}/${projectSlug}:`, error);
            }

            if (!apiData && projectIdFromDom) {
                try {
                    const response = await limitApi(() => fetch(`${WEBSIM_API_BASE_URL}/projects/${projectIdFromDom}`));
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const data = await response.json();
                    if (data?.project?.id) {
                        apiData = data;
                        canonicalProjectId = data.project.id;
                        projectDataCache.set(canonicalProjectId, { ...data, lastFetched: Date.now() });
                    }
                } catch (error) {
                    console.error(`Simalyze: Exception fetching project by ID for ${projectIdFromDom}:`, error);
                }
            }
        }

        if (extractedCreatorUsername) {
            let cachedCreatorStats = creatorStatsCache.get(extractedCreatorUsername);
            if (!cachedCreatorStats || (Date.now() - cachedCreatorStats.lastFetched > creatorStatsCacheDuration)) {
                try {
                    const response = await limitApi(() => fetch(`${WEBSIM_API_BASE_URL}/users/${extractedCreatorUsername}/stats`));
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const data = await response.json();
                    if (data?.stats) {
                        creatorStats = data.stats;
                        creatorStatsCache.set(extractedCreatorUsername, { ...data.stats, lastFetched: Date.now() });
                    }
                } catch (error) {
                    console.error(`Simalyze: Exception fetching creator stats for ${extractedCreatorUsername}:`, error);
                }
            } else {
                const { lastFetched, ...stats } = cachedCreatorStats;
                creatorStats = stats;
            }
        }

        if (canonicalProjectId) {
            if (apiData?.project_revision?.version) {
                const assetsCacheKey = `assets-${canonicalProjectId}-${apiData.project_revision.version}`;
                let cachedAssets = analysisCache.get(assetsCacheKey);
                if (!cachedAssets || (Date.now() - cachedAssets.lastFetched > assetsCacheDuration)) {
                    try {
                        const response = await limitApi(() => fetch(`${WEBSIM_API_BASE_URL}/projects/${canonicalProjectId}/revisions/${apiData.project_revision.version}/assets`));
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        const data = await response.json();
                        numAssets = data?.assets?.length || 0;
                        analysisCache.set(assetsCacheKey, { numAssets, lastFetched: Date.now() });
                    } catch (error) {
                        console.error(`Simalyze: Exception fetching assets for project ${canonicalProjectId}.`, error);
                    }
                } else {
                    numAssets = cachedAssets.numAssets;
                }
            }

            const revisionsCacheKey = `revisions-${canonicalProjectId}`;
            let cachedRevisions = analysisCache.get(revisionsCacheKey);
            if (!cachedRevisions || (Date.now() - cachedRevisions.lastFetched > revisionsCacheDuration)) {
                try {
                    const response = await limitApi(() => fetch(`${WEBSIM_API_BASE_URL}/projects/${canonicalProjectId}/revisions`));
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const data = await response.json();
                    revisionsCount = data?.revisions?.data?.length || 0;
                    analysisCache.set(revisionsCacheKey, { revisionsCount, lastFetched: Date.now() });
                } catch (error) {
                    console.error(`Simalyze: Exception fetching revisions for project ${canonicalProjectId}.`, error);
                }
            } else {
                revisionsCount = cachedRevisions.revisionsCount;
            }

            if (apiData?.project_revision?.version) {
                const screenshotsCacheKey = `screenshots-${canonicalProjectId}-${apiData.project_revision.version}`;
                let cachedScreenshots = analysisCache.get(screenshotsCacheKey);
                if (!cachedScreenshots || (Date.now() - cachedScreenshots.lastFetched > screenshotsCacheDuration)) {
                    try {
                        const response = await limitApi(() => fetch(`${WEBSIM_API_BASE_URL}/projects/${canonicalProjectId}/revisions/${apiData.project_revision.version}/screenshots`));
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        const data = await response.json();
                        screenshotsCount = data?.screenshots?.length || 0;
                        analysisCache.set(screenshotsCacheKey, { screenshotsCount, lastFetched: Date.now() });
                    } catch (error) {
                        console.error(`Simalyze: Exception fetching screenshots for project ${canonicalProjectId}.`, error);
                    }
                } else {
                    screenshotsCount = cachedScreenshots.screenshotsCount;
                }
            }

            if (apiData?.project?.id) {
                const statsCacheKey = `project_stats-${canonicalProjectId}`;
                let cachedProjectStats = analysisCache.get(statsCacheKey);
                if (!cachedProjectStats || (Date.now() - cachedProjectStats.lastFetched > creatorStatsCacheDuration)) {
                    try {
                        const response = await limitApi(() => fetch(`${WEBSIM_API_BASE_URL}/projects/${canonicalProjectId}/stats`));
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        const data = await response.json();
                        avgPlaytime = data?.playtime_stats?.[0]?.avg_active_dur || 0;
                        analysisCache.set(statsCacheKey, { avgPlaytime, lastFetched: Date.now() });
                    } catch (error) {
                        console.error(`Simalyze: Exception fetching detailed project stats for ${canonicalProjectId}.`, error);
                    }
                } else {
                    avgPlaytime = cachedProjectStats.avgPlaytime;
                }
            }

            const descendantsCacheKey = `descendants-${canonicalProjectId}`;
            let cachedDescendants = analysisCache.get(descendantsCacheKey);
            if (!cachedDescendants || (Date.now() - cachedDescendants.lastFetched > descendantsCacheDuration)) {
                try {
                    const response = await limitApi(() => fetch(`${WEBSIM_API_BASE_URL}/projects/${canonicalProjectId}/descendants?first=0`));
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const data = await response.json();
                    descendantsCount = data?.projects?.meta?.count || data?.projects?.data?.length || 0;
                    analysisCache.set(descendantsCacheKey, { descendantsCount, lastFetched: Date.now() });
                } catch (error) {
                    console.error(`Simalyze: Exception fetching descendants for project ${canonicalProjectId}.`, error);
                }
            } else {
                descendantsCount = cachedDescendants.descendantsCount;
            }

            if (apiData?.project_revision?.version) {
                const htmlCacheKey = `html-${canonicalProjectId}-${apiData.project_revision.version}`;
                let cachedHtml = analysisCache.get(htmlCacheKey);
                if (!cachedHtml || (Date.now() - cachedHtml.lastFetched > htmlContentCacheDuration)) {
                    try {
                        const response = await limitApi(() => fetch(`${WEBSIM_API_BASE_URL}/projects/${canonicalProjectId}/revisions/${apiData.project_revision.version}/html`));
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        const textData = await response.text();
                        htmlContent = textData;
                        analysisCache.set(htmlCacheKey, { htmlContent, lastFetched: Date.now() });
                    } catch (error) {
                        console.error(`Simalyze: Exception fetching HTML for project ${canonicalProjectId}.`, error);
                    }
                } else {
                    htmlContent = cachedHtml.htmlContent;
                }
            }
        }
        return { apiData, creatorStats, numAssets, revisionsCount, screenshotsCount, avgPlaytime, descendantsCount, htmlContent };
    }

    async function analyzeProject(domData, fetchedData) {
        let compositeScore = 50;

        const breakdown = {
            contentQuality: { scoreImpact: 0, reason: '' },
            engagementScore: { scoreImpact: 0, reason: '' },
            creatorReputationScore: { scoreImpact: 0, reason: '' },
            projectMaturityScore: { scoreImpact: 0, reason: '' },
            influenceAndOriginalityScore: { scoreImpact: 0, reason: '' },
            codeComplexityScore: { scoreImpact: 0, reason: '' },
            visualPresentationScore: { scoreImpact: 0, reason: '' },
            overallCompleteness: { scoreImpact: 0, reason: '' },
        };

        const apiData = fetchedData.apiData;
        const creatorStats = fetchedData.creatorStats;
        const numAssets = fetchedData.numAssets;
        const revisionsCount = fetchedData.revisionsCount;
        const screenshotsCount = fetchedData.screenshotsCount;
        const avgPlaytime = fetchedData.avgPlaytime;
        const descendantsCount = fetchedData.descendantsCount;
        const htmlContent = fetchedData.htmlContent;

        const isProjectDataAvailable = !!apiData?.project;
        const isCreatorStatsAvailable = !!creatorStats;
        const isRevisionDataAvailable = !!apiData?.project_revision;
        const isRevisionsCountAvailable = typeof revisionsCount === 'number';
        const isScreenshotsCountAvailable = typeof screenshotsCount === 'number';
        const isAvgPlaytimeAvailable = typeof avgPlaytime === 'number';
        const isDescendantsCountAvailable = typeof descendantsCount === 'number';
        const isHtmlContentAvailable = typeof htmlContent === 'string';

        const title = (apiData?.project?.title || domData.title || '').toLowerCase();
        const description = (apiData?.project?.description || '').toLowerCase();
        const titleLength = title.length;
        const descriptionLength = description.length;
        const hasThumbnail = !!domData.previewImageUrl;

        let contentQualityImpact = 0;
        let contentQualityReason = [];

        if (unwantedKeyword && (title.includes(unwantedKeyword.toLowerCase()) || description.includes(unwantedKeyword.toLowerCase()))) {
            contentQualityImpact += unwantedKeywordPenalty;
            contentQualityReason.push(`Contains unwanted keyword "${unwantedKeyword}" (${unwantedKeywordPenalty} penalty).`);
        }

        if (titleLength < 5 && titleLength > 0) { contentQualityImpact -= 10; contentQualityReason.push(`Very short title (${titleLength} chars).`); }
        else if (titleLength < 15 && titleLength > 0) { contentQualityImpact -= 5; contentQualityReason.push(`Short title (${titleLength} chars).`); }
        else if (titleLength > 50) { contentQualityImpact -= 2; contentQualityReason.push(`Very long title (${titleLength} chars).`); }
        else if (titleLength === 0) { contentQualityImpact -= (10 + 5); contentQualityReason.push('Missing title.'); }

        if (isProjectDataAvailable) {
            if (descriptionLength < 30 && descriptionLength > 0) { contentQualityImpact -= 7; contentQualityReason.push(`Short description (${descriptionLength} chars).`); }
            else if (descriptionLength === 0) { contentQualityImpact -= 15; contentQualityReason.push('Missing description.'); }
            if (descriptionLength >= 30) { contentQualityImpact += 3; contentQualityReason.push('Good description length.'); }
        } else {
            contentQualityImpact -= 5;
            contentQualityReason.push('Content quality assessment limited (API data unavailable).');
        }

        if (titleLength >= 15 && descriptionLength >= 30 && hasThumbnail && isProjectDataAvailable) { contentQualityImpact += 7; contentQualityReason.push('Good title, description, and thumbnail.'); }

        breakdown.contentQuality.scoreImpact = Math.round(contentQualityImpact);
        breakdown.contentQuality.reason = contentQualityReason.length > 0 ? contentQualityReason.join(' ') : 'Adequate content presentation.';
        compositeScore += breakdown.contentQuality.scoreImpact;

        let engagementImpact = 0;
        let engagementReason = [];

        const likes = apiData?.project?.stats?.likes ?? domData.likesValue;
        const views = apiData?.project?.stats?.views ?? domData.viewsValue;
        const comments = 0;

        if (isProjectDataAvailable && apiData.project.stats) {
            if (likes > 500) { engagementImpact += 15; engagementReason.push('Very high likes.'); }
            else if (likes > 100) { engagementImpact += 10; engagementReason.push('High likes.'); }
            else if (likes > 20) { engagementImpact += 5; engagementReason.push('Good likes.'); }

            if (views > 10000) { engagementImpact += 15; engagementReason.push('Very high views.'); }
            else if (views > 2000) { engagementImpact += 10; engagementReason.push('High views.'); }
            else if (views > 500) { engagementImpact += 5; engagementReason.push('Good views.'); }

            if (isAvgPlaytimeAvailable) {
                if (avgPlaytime > 60) { engagementImpact += 8; engagementReason.push(`High average playtime (${avgPlaytime.toFixed(0)}s).`); }
                else if (avgPlaytime > 15) { engagementImpact += 4; engagementReason.push(`Moderate average playtime (${avgPlaytime.toFixed(0)}s).`); }
                else if (views > 500 && avgPlaytime === 0) { engagementImpact -= 5; engagementReason.push('No recorded playtime despite views.'); }
            } else {
                engagementReason.push('Playtime data unavailable from API.');
            }

            if (views > 1000 && likes < views / 50) {
                engagementImpact -= 10;
                engagementReason.push('Low engagement relative to views (potential "slop").');
            }
            if (views > 500 && likes === 0) {
                engagementImpact -= 7;
                engagementReason.push('No recorded engagement despite some views.');
            }
        } else {
            if (likes > 500) { engagementImpact += 15; engagementReason.push('Very high likes (from DOM).'); }
            else if (likes > 100) { engagementImpact += 10; engagementReason.push('High likes (from DOM).'); }
            else if (likes > 20) { engagementImpact += 5; engagementReason.push('Good likes (from DOM).'); }

            if (views > 10000) { engagementImpact += 15; engagementReason.push('Very high views (from DOM).'); }
            else if (views > 2000) { engagementImpact += 10; engagementReason.push('High views (from DOM).'); }
            else if (views > 500) { engagementImpact += 5; engagementReason.push('Good views (from DOM).'); }

            if (views > 1000 && likes < views / 50) {
                engagementImpact -= 10;
                engagementReason.push('Low likes relative to views (from DOM).');
            }
            if (views > 500 && likes === 0) {
                engagementImpact -= 7;
                engagementReason.push('No likes despite some views (from DOM).');
            }
            engagementImpact -= 10;
            engagementReason.push('Engagement data assessment limited (API data unavailable).');
        }
        breakdown.engagementScore.scoreImpact = Math.round(engagementImpact);
        breakdown.engagementScore.reason = engagementReason.length > 0 ? engagementReason.join(' ') : 'Moderate engagement.';
        compositeScore += breakdown.engagementScore.scoreImpact;

        let creatorImpact = 0;
        let creatorReason = [];

        if (isCreatorStatsAvailable) {
            const creatorTotalLikes = creatorStats.total_likes ?? 0;
            const creatorTotalViews = creatorStats.total_views ?? 0;

            if (creatorTotalLikes > 2000) { creatorImpact += 10; creatorReason.push('Very high overall creator likes.'); }
            else if (creatorTotalLikes > 500) { creatorImpact += 7; creatorReason.push('High overall creator likes.'); }
            else if (creatorTotalLikes > 100) { creatorImpact += 3; creatorReason.push('Good overall creator likes.'); }

            if (creatorTotalViews > 20000) { creatorImpact += 10; creatorReason.push('Very high overall creator views.'); }
            else if (creatorTotalViews > 5000) { creatorImpact += 7; creatorReason.push('High overall creator views.'); }
            else if (creatorTotalViews > 1000) { creatorImpact += 3; creatorReason.push('Good overall creator views.'); }

            if (creatorTotalLikes === 0 && creatorTotalViews === 0) {
                creatorImpact -= 5;
                creatorReason.push('New or very inactive creator.');
            }
        } else {
            creatorImpact -= 7;
            creatorReason.push('Creator reputation data unavailable from API.');
        }
        breakdown.creatorReputationScore.scoreImpact = Math.round(creatorImpact);
        breakdown.creatorReputationScore.reason = creatorReason.length > 0 ? creatorReason.join(' ') : 'Average creator reputation.';
        compositeScore += breakdown.creatorReputationScore.scoreImpact;

        let maturityImpact = 0;
        let maturityReason = [];

        const revisionVersion = apiData?.project_revision?.version ?? 1;
        const isSitePosted = !!apiData?.site;

        if (isRevisionsCountAvailable && isProjectDataAvailable) {
            if (revisionsCount > 20) { maturityImpact += 10; maturityReason.push(`Extensive revision history (${revisionsCount} revisions).`); }
            else if (revisionsCount > 5) { maturityImpact += 5; maturityReason.push(`Multiple revisions (${revisionsCount} revisions) (suggests ongoing development/complexity).`); }
            else if (revisionsCount <= 2) { maturityImpact -= 5; maturityReason.push(`Few revisions (${revisionsCount} revisions) (may indicate early stage or low effort).`); }

            if (isSitePosted) { maturityImpact += 5; maturityReason.push('Published as a live site.'); }
        } else {
            maturityImpact -= 8;
            maturityReason.push('Project maturity data (revisions count) unavailable from API.');
        }
        breakdown.projectMaturityScore.scoreImpact = Math.round(maturityImpact);
        breakdown.projectMaturityScore.reason = maturityReason.length > 0 ? maturityReason.join(' ') : 'Moderate project maturity.';
        compositeScore += breakdown.projectMaturityScore.scoreImpact;

        let influenceImpact = 0;
        let influenceReason = [];

        if (isProjectDataAvailable && isDescendantsCountAvailable) {
            if (descendantsCount > 0) {
                const calculatedBonus = Math.min(20, descendantsCount * 2);
                influenceImpact += calculatedBonus;
                influenceReason.push(`Has ${descendantsCount} remixes (+${calculatedBonus}).`);
            }
            if (apiData.project.from_template) {
                influenceImpact -= 10;
                influenceReason.push('Created from a template.');
            }
        } else {
            influenceImpact -= 5;
            influenceReason.push('Influence data unavailable (descendants/template status).');
        }

        breakdown.influenceAndOriginalityScore.scoreImpact = Math.round(influenceImpact);
        breakdown.influenceAndOriginalityScore.reason = influenceReason.length > 0 ? influenceReason.join(' ') : 'Standard influence/originality.';
        compositeScore += breakdown.influenceAndOriginalityScore.scoreImpact;

        let complexityImpact = 0;
        let complexityReason = [];

        if (typeof numAssets === 'number') {
            if (numAssets > 10) { complexityImpact += 7; complexityReason.push(`Significant number of assets (${numAssets} assets, implies more content/complexity).`); }
            else if (numAssets > 2) { complexityImpact += 3; complexityReason.push(`Some assets present (${numAssets} assets, indicates custom content).`); }
            else if (numAssets === 0) { complexityImpact -= 3; complexityReason.push('Few or no custom assets.'); }
        } else {
            complexityImpact -= 5;
            complexityReason.push('Asset count data unavailable (limits complexity assessment).');
        }

        if (isRevisionsCountAvailable) {
            if (revisionsCount > 15) { complexityImpact += 5; complexityReason.push(`High number of revisions (${revisionsCount} revisions, suggests iterative code development).`); }
            else if (revisionsCount <= 3 && revisionsCount > 0) { complexityImpact -= 2; complexityReason.push(`Few revisions (${revisionsCount} revisions) (may indicate simpler code).`); }
        } else {
            complexityImpact -= 5;
            complexityReason.push('Revision data (for complexity) unavailable from API.');
        }

        breakdown.codeComplexityScore.scoreImpact = Math.round(complexityImpact);
        breakdown.codeComplexityScore.reason = complexityReason.length > 0 ? complexityReason.join(' ') : 'Average code complexity estimate.';
        compositeScore += breakdown.codeComplexityScore.scoreImpact;

        let visualPresentationImpact = 0;
        let visualPresentationReason = [];

        if (!hasThumbnail) { visualPresentationImpact -= 10; visualPresentationReason.push('Missing thumbnail.'); }

        if (isScreenshotsCountAvailable) {
            if (screenshotsCount > 3) { visualPresentationImpact += 7; visualPresentationReason.push(`Multiple screenshots (${screenshotsCount}) present (good visual documentation).`); }
            else if (screenshotsCount >= 1) { visualPresentationImpact += 3; visualPresentationReason.push(`At least one additional screenshot (${screenshotsCount}) present.`); }
            else if (screenshotsCount === 0 && !hasThumbnail) { visualPresentationImpact -= 5; visualPresentationReason.push('No screenshots beyond default.'); }
        } else {
            visualPresentationImpact -= 5;
            visualPresentationReason.push('Screenshots data unavailable (limits visual assessment).');
        }

        breakdown.visualPresentationScore.scoreImpact = Math.round(visualPresentationImpact);
        breakdown.visualPresentationScore.reason = visualPresentationReason.length > 0 ? visualPresentationReason.join(' ') : 'Standard visual presentation.';
        compositeScore += breakdown.visualPresentationScore.scoreImpact;

        let completenessImpact = 0;
        let completenessReason = [];

        if (isProjectDataAvailable && isRevisionDataAvailable && isCreatorStatsAvailable && typeof numAssets === 'number' && isRevisionsCountAvailable && isScreenshotsCountAvailable && isAvgPlaytimeAvailable && isDescendantsCountAvailable && isHtmlContentAvailable) {
            if (apiData.project.description && apiData.project.title && domData.previewImageUrl && (apiData.project_revision?.version ?? 0) > 0 && numAssets >= 0 && revisionsCount >= 0 && screenshotsCount >= 0 && avgPlaytime >= 0 && descendantsCount >= 0 && htmlContent) {
                completenessImpact += 5;
                completenessReason.push('All major project metadata present and fetched.');
            } else {
                completenessImpact -= 5;
                completenessReason.push('Some project metadata missing or incomplete (from available API data).');
            }
        } else {
            completenessImpact -= 15;
            completenessReason.push('Core project metadata unavailable from API (e.g., project not found or fetch failed).');
        }

        breakdown.overallCompleteness.scoreImpact = Math.round(completenessImpact);
        breakdown.overallCompleteness.reason = completenessReason.length > 0 ? completenessReason.join(' ') : 'Standard completeness.';
        compositeScore += breakdown.overallCompleteness.scoreImpact;

        compositeScore = Math.max(0, Math.min(100, Math.round(compositeScore)));

        let summary = '';
        if (compositeScore >= 80) summary = 'This project demonstrates high quality, strong engagement, and a mature development. Looks good!';
        else if (compositeScore >= 60) summary = 'This project is generally good, with decent quality and engagement. Worth a look.';
        else if (compositeScore >= 50) summary = 'This project is of average quality. It has some potential but could use improvements.';
        else summary = 'This project appears to be of very low quality and may contain unoriginal or undesirable content.';

        return {
            compositeScore: compositeScore,
            breakdown: breakdown,
            summary: summary
        };
    }

    async function applySlopRemover() {
        const isHostDarkMode = () => document.documentElement.classList.contains('dark') || document.body.classList.contains('dark');
        const currentColors = getCurrentThemeProperties();

        const selector = 'a.flex.flex-col.bg-gray-100.dark\\:bg-neutral-900.w-full.h-auto.border.border-gray-300.dark\\:border-neutral-700.transition-colors';
        const elementsToFilter = document.querySelectorAll(`${selector}:not([data-simalyzed="true"])`);

        const projectProcesses = [];

        for (const element of elementsToFilter) {
            element.dataset.simalyzed = "true";

            const imageWrapper = element.querySelector('div.flex.w-full.h-full.relative.overflow-hidden');
            const imgElement = imageWrapper ? imageWrapper.querySelector('img.object-cover') : null;

            let simalyzeProjectOverlay = element.querySelector('.simalyze-project-overlay');
            if (!simalyzeProjectOverlay) {
                simalyzeProjectOverlay = document.createElement('div');
                simalyzeProjectOverlay.classList.add('simalyze-project-overlay');
                simalyzeProjectOverlay.style.cssText = `
                    position: absolute;
                    top: 0; left: 0; width: 100%; height: 100%;
                    display: flex; flex-direction: column; justify-content: center; align-items: center;
                    z-index: 10;
                    background-color: ${isHostDarkMode() ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.9)'};
                    border-radius: inherit;
                    backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
                    text-align: center;
                    pointer-events: auto;
                    opacity: 0;
                    transition: opacity var(--simalyze-project-card-transition-duration) ease-in-out;
                `;
                if (imageWrapper) {
                    imageWrapper.appendChild(simalyzeProjectOverlay);
                } else {
                    element.appendChild(simalyzeProjectOverlay);
                }
            }
            simalyzeProjectOverlay.style.display = 'flex';
            simalyzeProjectOverlay.style.opacity = '1';

            simalyzeProjectOverlay.innerHTML = `
                <div style="
                    width: ${currentColors.loadingSpinnerSize};
                    height: ${currentColors.loadingSpinnerSize};
                    color: ${currentColors.loadingSpinnerColor};
                    animation: spin 1s linear infinite;
                ">
                    ${TIMER_LOADING_ICON_SVG}
                </div>
                <span style="font-size: 16px; font-weight: bold; color: ${currentColors.textColor}; margin-top: 10px;">
                    ${loadingAnalysisText}
                </span>
                <button class="simalyze-view-button-loading" style="
                    background-color: ${currentColors.buttonBg};
                    border: var(--simalyze-thin-stroke) solid ${currentColors.buttonBorder};
                    border-radius: var(--simalyze-border-radius);
                    padding: 8px 15px;
                    font-size: 14px;
                    cursor: pointer;
                    color: ${currentColors.textColor};
                    transition: background-color var(--simalyze-project-card-transition-duration);
                    pointer-events: auto;
                    margin-top: 15px;
                ">
                    ${bypassAnalysisButtonText}
                </button>
            `;
            const viewButtonLoading = simalyzeProjectOverlay.querySelector('.simalyze-view-button-loading');
            viewButtonLoading.onmouseover = () => { viewButtonLoading.style.backgroundColor = currentColors.buttonHover; };
            viewButtonLoading.onmouseout = () => { viewButtonLoading.style.backgroundColor = currentColors.buttonBg; };
            viewButtonLoading.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                element.dataset.simalyzeForceView = "true";
                simalyzeProjectOverlay.style.opacity = '0';
                setTimeout(() => simalyzeProjectOverlay.style.display = 'none', currentColors.projectCardTransitionDuration);
                if (imgElement) imgElement.style.filter = '';
            };

            projectProcesses.push(limitAnalysis(async () => {
                const domData = extractDomData(element);
                const fetchedData = await fetchProjectMetadata(domData);

                const finalAnalysisData = {
                    title: fetchedData.apiData?.project?.title || domData.title,
                    description: fetchedData.apiData?.project?.description || '',
                    previewImageUrl: domData.previewImageUrl,
                    likes: fetchedData.apiData?.project?.stats?.likes ?? domData.likesValue,
                    views: fetchedData.apiData?.project?.stats?.views ?? domData.viewsValue,
                    creatorUsername: fetchedData.apiData?.project?.created_by?.username || domData.authorName,
                    revisionVersion: fetchedData.apiData?.project_revision?.version ?? 0,
                    isSitePosted: fetchedData.apiData?.site !== null,
                    revisionsCount: fetchedData.revisionsCount ?? 0,
                    screenshotsCount: fetchedData.screenshotsCount ?? 0,
                    avgPlaytime: fetchedData.avgPlaytime ?? 0,
                    descendantsCount: fetchedData.descendantsCount ?? 0,
                };

                const analysisId = fetchedData.apiData?.project?.id || domData.fullPostLink;
                let analysisResult = null;

                let cachedAnalysisResult = analysisCache.get(analysisId);
                if (!cachedAnalysisResult || (Date.now() - cachedAnalysisResult.lastFetched > analysisResultCacheDuration)) {
                    try {
                        analysisResult = await analyzeProject(
                            finalAnalysisData,
                            fetchedData
                        );
                        analysisCache.set(analysisId, { ...analysisResult, lastFetched: Date.now() });
                    } catch (error) {
                        console.error(`Simalyze: Project analysis failed for ${analysisId}:`, error);
                        analysisResult = { compositeScore: 0, breakdown: {}, summary: 'Analysis failed.' };
                        analysisCache.set(analysisId, { ...analysisResult, lastFetched: Date.now() });
                    }
                } else {
                    analysisResult = cachedAnalysisResult;
                }

                const compositeScore = analysisResult?.compositeScore ?? 0;

                const textWrapper = element.querySelector('div.p-1.text-left.overflow-hidden');
                let simalyzeHighlightIndicator = element.querySelector('.simalyze-highlight-indicator');

                let simalyzeAnalysisArea = element.querySelector('.simalyze-analysis-area');
                if (!simalyzeAnalysisArea) {
                    simalyzeAnalysisArea = document.createElement('div');
                    simalyzeAnalysisArea.classList.add('simalyze-analysis-area');
                    simalyzeAnalysisArea.style.cssText = `
                        margin-top: 5px;
                        font-size: 13px;
                        display: flex;
                        align-items: center;
                        gap: 5px;
                        flex-wrap: wrap;
                    `;
                    const cardContentWrapper = element.querySelector('div.flex.flex-col.p-3');
                    if (cardContentWrapper) {
                        const cardFooterEl = element.querySelector('div.flex.justify-between.items-center.text-gray-500.dark\\:text-gray-400.mt-2.text-xs');
                        if (cardFooterEl && cardFooterEl.parentNode === cardContentWrapper) {
                            cardContentWrapper.insertBefore(simalyzeAnalysisArea, cardFooterEl.nextSibling);
                        } else {
                            cardContentWrapper.appendChild(simalyzeAnalysisArea);
                        }
                    } else {
                        element.appendChild(simalyzeAnalysisArea);
                    }
                }

                if (!simalyzeHighlightIndicator) {
                    simalyzeHighlightIndicator = document.createElement('div');
                    simalyzeHighlightIndicator.classList.add('simalyze-highlight-indicator');
                    simalyzeHighlightIndicator.style.cssText = `
                        position: absolute;
                        top: 5px;
                        right: 5px;
                        z-index: 15;
                        display: flex;
                        align-items: center;
                        gap: 3px;
                        font-size: 12px;
                        font-weight: bold;
                        color: var(--simalyze-highlight-text);
                        background-color: var(--simalyze-highlight-bg);
                        padding: 3px 6px;
                        border-radius: var(--simalyze-border-radius);
                        border: var(--simalyze-highlight-border-thickness) solid var(--simalyze-highlight-border);
                        pointer-events: none;
                        opacity: 0;
                        transition: opacity var(--simalyze-project-card-transition-duration) ease-in-out;
                    `;
                    element.appendChild(simalyzeHighlightIndicator);
                }

                element.classList.remove('simalyze-hidden', 'simalyze-blurred', 'simalyze-highlighted');
                element.style.opacity = '1';
                element.style.pointerEvents = 'auto';
                element.style.outline = '';
                element.style.outlineOffset = '';
                element.style.border = '';

                if(simalyzeProjectOverlay) {
                    simalyzeProjectOverlay.style.display = 'none';
                    simalyzeProjectOverlay.style.opacity = '0';
                    simalyzeProjectOverlay.style.pointerEvents = 'none';
                }
                simalyzeHighlightIndicator.style.display = 'none';
                simalyzeHighlightIndicator.style.opacity = '0';
                if (imgElement) imgElement.style.filter = '';
                if (imageWrapper) imageWrapper.style.display = '';
                if (textWrapper) textWrapper.style.display = '';
                if (simalyzeAnalysisArea) simalyzeAnalysisArea.style.display = 'none';

                const shouldBeHidden = slopRemover2Active && compositeScore < 30;
                const shouldBeBlurred = analyzerModeActive && !shouldBeHidden && compositeScore < 50;
                const shouldBeHighlighted = highlightGoodProjectsActive && !shouldBeHidden && compositeScore >= highlightThreshold;

                element.style.transition = `opacity var(--simalyze-project-card-transition-duration) ease-in-out, outline var(--simalyze-project-card-transition-duration) ease-in-out`;


                if (shouldBeHidden) {
                    element.style.opacity = '0';
                    element.style.pointerEvents = 'none';
                    setTimeout(() => {
                        element.style.display = 'none';
                        element.classList.add('simalyze-hidden');
                    }, currentColors.projectCardTransitionDuration);
                } else if (shouldBeBlurred && element.dataset.simalyzeForceView !== "true") {
                    simalyzeProjectOverlay.style.display = 'flex';
                    simalyzeProjectOverlay.style.opacity = '1';
                    simalyzeProjectOverlay.style.pointerEvents = 'auto';
                    simalyzeProjectOverlay.innerHTML = `
                        <img src="${SIMALYZE_LOGO_URL}" alt="Simalyze Logo" style="width: 60px; height: 60px; margin-bottom: 10px; opacity: 0.8;">
                        <span style="font-size: 20px; font-weight: bold; color: ${currentColors.textColor}; margin-bottom: 5px;">This project is rated below 50.</span>
                        <span style="font-size: 16px; color: ${isHostDarkMode() ? '#ccc' : '#333'}; margin-bottom: 10px;">(Score: ${compositeScore.toFixed(0)})</span>
                        <div style="display: flex; gap: 10px; margin-top: 15px;">
                            <button class="simalyze-view-project-button" style="
                                background-color: ${currentColors.buttonBg};
                                border: var(--simalyze-thin-stroke) solid ${currentColors.buttonBorder};
                                border-radius: var(--simalyze-border-radius);
                                padding: 8px 15px;
                                font-size: 14px;
                                cursor: pointer;
                                color: ${currentColors.textColor};
                                transition: background-color var(--simalyze-project-card-transition-duration);
                                pointer-events: auto;
                            ">
                                ${viewProjectButtonText}
                            </button>
                            <button class="simalyze-view-details-button" style="
                                background-color: ${currentColors.buttonBg};
                                border: var(--simalyze-thin-stroke) solid ${currentColors.buttonBorder};
                                border-radius: var(--simalyze-border-radius);
                                padding: 8px 15px;
                                font-size: 14px;
                                cursor: pointer;
                                color: ${currentColors.textColor};
                                transition: background-color var(--simalyze-project-card-transition-duration);
                                pointer-events: auto;
                            ">
                                ${viewDetailsButtonText}
                            </button>
                        </div>
                    `;

                    const viewProjectBtn = simalyzeProjectOverlay.querySelector('.simalyze-view-project-button');
                    viewProjectBtn.onmouseover = () => { viewProjectBtn.style.backgroundColor = currentColors.buttonHover; };
                    viewProjectBtn.onmouseout = () => { viewProjectBtn.style.backgroundColor = currentColors.buttonBg; };
                    viewProjectBtn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        simalyzeProjectOverlay.style.opacity = '0';
                        setTimeout(() => simalyzeProjectOverlay.style.display = 'none', currentColors.projectCardTransitionDuration);
                        element.classList.remove('simalyze-blurred');
                        if (imgElement) imgElement.style.filter = '';
                        element.dataset.simalyzeForceView = "true";
                    };

                    const viewDetailsBtn = simalyzeProjectOverlay.querySelector('.simalyze-view-details-button');
                    viewDetailsBtn.onmouseover = () => { viewDetailsBtn.style.backgroundColor = currentColors.buttonHover; };
                    viewDetailsBtn.onmouseout = () => { viewDetailsBtn.style.backgroundColor = currentColors.buttonBg; };
                    viewDetailsBtn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showProjectDetailsModal(finalAnalysisData.title, analysisResult);
                    };
                    element.classList.add('simalyze-blurred');
                    if (imgElement) imgElement.style.transition = `filter var(--simalyze-project-card-transition-duration) ease-in-out`;
                    if (imgElement) imgElement.style.filter = `blur(5px)`;
                } else {
                    if (simalyzeProjectOverlay) {
                         simalyzeProjectOverlay.style.opacity = '0';
                         setTimeout(() => simalyzeProjectOverlay.style.display = 'none', currentColors.projectCardTransitionDuration);
                    }
                    element.classList.remove('simalyze-blurred');
                    if (imgElement) imgElement.style.filter = '';

                    if (shouldBeHighlighted) {
                        element.classList.add('simalyze-highlighted');
                        simalyzeHighlightIndicator.style.display = 'flex';
                        simalyzeHighlightIndicator.style.opacity = '1';
                        simalyzeHighlightIndicator.innerHTML = `
                            <div style="width: 14px; height: 14px; color: currentColor;">
                                ${GOOD_PROJECT_ICON_SVG}
                            </div>
                            <span>Good!</span>
                        `;
                        element.style.outline = `${currentColors.highlightBorderThickness} solid ${currentColors.highlightBorderColor}`;
                        element.style.outlineOffset = currentColors.highlightOutlineOffset;
                        element.style.borderRadius = currentColors.borderRadius;
                    } else {
                        element.style.outline = '';
                        element.style.outlineOffset = '';
                        simalyzeHighlightIndicator.style.opacity = '0';
                        setTimeout(() => simalyzeHighlightIndicator.style.display = 'none', currentColors.projectCardTransitionDuration);
                    }

                    if (analyzerModeActive && compositeScore !== -1) {
                        if (simalyzeAnalysisArea) {
                            simalyzeAnalysisArea.style.display = 'flex';
                            simalyzeAnalysisArea.innerHTML = '';

                            const scoreDisplay = document.createElement('span');
                            scoreDisplay.style.fontWeight = 'bold';
                            let scoreColor = currentColors.scoreNeutral;
                            if (compositeScore > 70) {
                                scoreColor = currentColors.scoreGood;
                            } else if (compositeScore < 50) {
                                scoreColor = currentColors.scoreBad;
                            }
                            scoreDisplay.style.color = scoreColor;
                            scoreDisplay.textContent = `Simalyze Score: ${compositeScore}`;
                            simalyzeAnalysisArea.appendChild(scoreDisplay);

                            const detailsButton = document.createElement('button');
                            detailsButton.textContent = 'Details';
                            detailsButton.style.cssText = `
                                background-color: ${currentColors.buttonBg};
                                border: var(--simalyze-thin-stroke) solid ${currentColors.buttonBorder};
                                border-radius: var(--simalyze-border-radius);
                                padding: 2px 6px;
                                font-size: 11px;
                                cursor: pointer;
                                color: ${currentColors.textColor};
                                transition: background-color var(--simalyze-project-card-transition-duration);
                            `;
                            detailsButton.onmouseover = () => { detailsButton.style.backgroundColor = currentColors.buttonHover; };
                            detailsButton.onmouseout = () => { detailsButton.style.backgroundColor = currentColors.buttonBg; };
                            detailsButton.onclick = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                showProjectDetailsModal(finalAnalysisData.title, analysisResult);
                            };
                            simalyzeAnalysisArea.appendChild(detailsButton);
                        }
                    }
                }
            }));
        }
        await Promise.all(projectProcesses);
    }

    function getCurrentThemeProperties() {
        const isHostDarkMode = () => document.documentElement.classList.contains('dark') || document.body.classList.contains('dark');
        const computedStyle = getComputedStyle(document.documentElement);

        const fallback = isHostDarkMode() ? {
            fontFamily: "'Montserrat', sans-serif", mainBg: '#1a1a1a', modalBorder: '#333333', modalShadow: '0 8px 32px rgba(0, 0, 0, 0.5)', textColor: '#e0e0e0', textSecondaryColor: '#a0a0a0', headingColor: '#ffffff', sectionBorder: '#2f2f2f', buttonBg: 'rgba(255, 255, 255, 0.1)', buttonHover: 'rgba(255, 255, 255, 0.15)', buttonBorder: 'rgba(255, 255, 255, 0.2)', inputBg: '#252525', inputBorder: '#4a4a4a', inputColor: '#ffffff', inputPlaceholder: 'rgba(255, 255, 255, 0.5)', scoreGood: '#4ade80', scoreNeutral: '#9ca3af', scoreBad: '#f87171', sliderTrack: '#333', sliderThumb: '#999999', borderRadius: '12px', thinStroke: '1px', highlightBgColor: 'rgba(74, 222, 128, 0.1)', highlightBorderColor: '#4ade80', highlightTextColor: '#4ade80', loadingSpinnerSize: '30px', loadingSpinnerColor: '#9ca3af', loadingSpinnerBorderThickness: '4px', highlightBorderThickness: '2px', highlightOutlineOffset: '0px', modalTransitionDuration: 300, modalEnterTransform: 'translateY(-20px)', modalExitTransform: 'translateY(-20px)', projectCardTransitionDuration: 300
        } : {
            fontFamily: "'Montserrat', sans-serif", mainBg: '#ffffff', modalBorder: '#e0e0e0', modalShadow: '0 8px 32px rgba(0, 0, 0, 0.12)', textColor: '#333333', textSecondaryColor: '#555555', headingColor: '#000000', sectionBorder: '#eeeeee', buttonBg: '#f0f0f0', buttonHover: '#e0e0e0', buttonBorder: '#d0d0d0', inputBg: '#f8f8f8', inputBorder: '#dcdcdc', inputColor: '#000000', inputPlaceholder: 'rgba(0, 0, 0, 0.4)', scoreGood: '#22c55e', scoreNeutral: '#666666', scoreBad: '#ef4444', sliderTrack: '#e0e0e0', sliderThumb: '#666666', borderRadius: '12px', thinStroke: '1px', highlightBgColor: 'rgba(34, 197, 94, 0.1)', highlightBorderColor: '#22c55e', highlightTextColor: '#16a34a', loadingSpinnerSize: '30px', loadingSpinnerColor: '#666666', loadingSpinnerBorderThickness: '4px', highlightBorderThickness: '2px', highlightOutlineOffset: '0px', modalTransitionDuration: 300, modalEnterTransform: 'translateY(-20px)', modalExitTransform: 'translateY(-20px)', projectCardTransitionDuration: 300
        };

        return {
            fontFamily: computedStyle.getPropertyValue('--simalyze-font-family').trim() || fallback.fontFamily,
            mainBg: computedStyle.getPropertyValue('--simalyze-main-bg').trim() || fallback.mainBg,
            modalBorder: computedStyle.getPropertyValue('--simalyze-modal-border').trim() || fallback.modalBorder,
            modalShadow: computedStyle.getPropertyValue('--simalyze-modal-shadow').trim() || fallback.modalShadow,
            textColor: computedStyle.getPropertyValue('--simalyze-text-color').trim() || fallback.textColor,
            textSecondaryColor: computedStyle.getPropertyValue('--simalyze-text-secondary-color').trim() || fallback.textSecondaryColor,
            headingColor: computedStyle.getPropertyValue('--simalyze-heading-color').trim() || fallback.headingColor,
            sectionBorder: computedStyle.getPropertyValue('--simalyze-section-border').trim() || fallback.sectionBorder,
            buttonBg: computedStyle.getPropertyValue('--simalyze-button-bg').trim() || fallback.buttonBg,
            buttonHover: computedStyle.getPropertyValue('--simalyze-button-hover').trim() || fallback.buttonHover,
            buttonBorder: computedStyle.getPropertyValue('--simalyze-button-border').trim() || fallback.buttonBorder,
            inputBg: computedStyle.getPropertyValue('--simalyze-input-bg').trim() || fallback.inputBg,
            inputBorder: computedStyle.getPropertyValue('--simalyze-input-border').trim() || fallback.inputBorder,
            inputColor: computedStyle.getPropertyValue('--simalyze-input-color').trim() || fallback.inputColor,
            inputPlaceholder: computedStyle.getPropertyValue('--simalyze-input-placeholder').trim() || fallback.inputPlaceholder,
            scoreGood: computedStyle.getPropertyValue('--simalyze-score-good').trim() || fallback.scoreGood,
            scoreNeutral: computedStyle.getPropertyValue('--simalyze-score-neutral').trim() || fallback.scoreNeutral,
            scoreBad: computedStyle.getPropertyValue('--simalyze-score-bad').trim() || fallback.scoreBad,
            sliderTrack: computedStyle.getPropertyValue('--simalyze-slider-track').trim() || fallback.sliderTrack,
            sliderThumb: computedStyle.getPropertyValue('--simalyze-slider-thumb').trim() || fallback.sliderThumb,
            borderRadius: computedStyle.getPropertyValue('--simalyze-border-radius').trim() || fallback.borderRadius,
            thinStroke: computedStyle.getPropertyValue('--simalyze-thin-stroke').trim() || fallback.thinStroke,
            highlightBgColor: computedStyle.getPropertyValue('--simalyze-highlight-bg').trim() || fallback.highlightBgColor,
            highlightBorderColor: computedStyle.getPropertyValue('--simalyze-highlight-border').trim() || fallback.highlightBorderColor,
            highlightTextColor: computedStyle.getPropertyValue('--simalyze-highlight-text').trim() || fallback.highlightTextColor,
            loadingSpinnerSize: computedStyle.getPropertyValue('--simalyze-loading-spinner-size').trim() || fallback.loadingSpinnerSize,
            loadingSpinnerColor: computedStyle.getPropertyValue('--simalyze-loading-spinner-color').trim() || fallback.loadingSpinnerColor,
            loadingSpinnerBorderThickness: computedStyle.getPropertyValue('--simalyze-loading-spinner-border-thickness').trim() || fallback.loadingSpinnerBorderThickness,
            highlightBorderThickness: computedStyle.getPropertyValue('--simalyze-highlight-border-thickness').trim() || fallback.highlightBorderThickness,
            highlightOutlineOffset: computedStyle.getPropertyValue('--simalyze-highlight-outline-offset').trim() || fallback.highlightOutlineOffset,
            modalTransitionDuration: parseInt(computedStyle.getPropertyValue('--simalyze-modal-transition-duration')) || fallback.modalTransitionDuration,
            modalEnterTransform: computedStyle.getPropertyValue('--simalyze-modal-enter-transform').trim() || fallback.modalEnterTransform,
            modalExitTransform: computedStyle.getPropertyValue('--simalyze-modal-exit-transform').trim() || fallback.modalExitTransform,
            projectCardTransitionDuration: parseInt(computedStyle.getPropertyValue('--simalyze-project-card-transition-duration')) || fallback.projectCardTransitionDuration,
        };
    }

    function showSettingsModal() {
        const settingsModalMaxWidth = '600px';
        const settingsModalPadding = '24px';
        const settingsModalPaddingMobile = '16px';
        const settingsModalSectionGap = '20px';

        let modalHost = document.getElementById('simalyze-settings-modal-host');
        const colors = getCurrentThemeProperties();

        if (modalHost) {
            const container = modalHost.shadowRoot.getElementById('simalyze-settings-modal-container');
            const content = modalHost.shadowRoot.getElementById('simalyze-settings-modal-content');
            if (container.style.opacity === '1') {
                content.style.animation = `simalyze-slide-out-to-top ${colors.modalTransitionDuration}ms ease-out forwards`;
                container.style.opacity = '0';
                container.style.pointerEvents = 'none';
                setTimeout(() => {
                    container.style.display = 'none';
                    content.style.animation = '';
                }, colors.modalTransitionDuration);
            } else {
                container.style.display = 'flex';
                content.style.background = colors.mainBg;
                content.style.color = colors.textColor;
                setTimeout(() => {
                    content.style.animation = `simalyze-slide-in-from-top ${colors.modalTransitionDuration}ms ease-out forwards`;
                    container.style.opacity = '1';
                    container.style.pointerEvents = 'auto';
                }, 10);
            }
            return;
        }

        modalHost = document.createElement('div');
        modalHost.id = 'simalyze-settings-modal-host';
        document.body.appendChild(modalHost);

        const shadowRoot = modalHost.attachShadow({ mode: 'open' });

        const modalHTML = `
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap');

                #simalyze-settings-modal-container {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(5px);
                    -webkit-backdrop-filter: blur(5px);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 10000;
                    font-family: ${colors.fontFamily};
                    box-sizing: border-box;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity ${colors.modalTransitionDuration}ms ease-in-out;
                }

                #simalyze-settings-modal-content {
                    background: ${colors.mainBg};
                    padding: ${settingsModalPadding};
                    border-radius: ${colors.borderRadius};
                    box-shadow: ${colors.modalShadow};
                    width: 100%;
                    max-width: ${settingsModalMaxWidth};
                    box-sizing: border-box;
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    border: var(--simalyze-thin-stroke) solid ${colors.modalBorder};
                    max-height: 90vh;
                    transform: ${colors.modalEnterTransform};
                }

                #simalyze-modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding-bottom: 16px;
                    border-bottom: var(--simalyze-thin-stroke) solid ${colors.sectionBorder};
                    flex-shrink: 0;
                }

                #simalyze-modal-body {
                    flex-grow: 1;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: ${settingsModalSectionGap};
                    padding-top: 16px;
                    padding-right: 12px;
                    margin-right: -12px;
                }

                #simalyze-modal-body::-webkit-scrollbar {
                    width: 8px;
                }
                #simalyze-modal-body::-webkit-scrollbar-track {
                    background: transparent;
                }
                #simalyze-modal-body::-webkit-scrollbar-thumb {
                    background-color: ${colors.sliderThumb};
                    border-radius: 4px;
                    border: 2px solid ${colors.mainBg};
                }

                #simalyze-modal-footer {
                    padding-top: 16px;
                    border-top: var(--simalyze-thin-stroke) solid ${colors.sectionBorder};
                    display: flex;
                    justify-content: flex-end;
                    flex-shrink: 0;
                }

                .simalyze-modal-button {
                    transition: background-color var(--simalyze-project-card-transition-duration), border-color var(--simalyze-project-card-transition-duration);
                }
                .simalyze-modal-button:hover {
                    background-color: ${colors.buttonHover} !important;
                    border-color: ${colors.buttonHover} !important;
                }

                @media (max-width: 640px) {
                    #simalyze-settings-modal-container {
                        align-items: stretch;
                    }
                    #simalyze-settings-modal-content {
                        max-width: 100%;
                        width: 100%;
                        height: 100%;
                        max-height: 100vh;
                        border-radius: 0;
                        border: none;
                        padding: ${settingsModalPaddingMobile};
                    }
                    #simalyze-modal-header h2 {
                        font-size: 18px !important;
                    }
                }

                input::placeholder {
                    color: var(--placeholder-color, ${colors.inputPlaceholder});
                }

                input[type="range"] {
                    -webkit-appearance: none;
                    width: 100%;
                    height: 8px;
                    background: ${colors.sliderTrack};
                    border-radius: var(--simalyze-border-radius);
                    outline: none;
                    transition: background var(--simalyze-project-card-transition-duration);
                }
                input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 20px;
                    height: 20px;
                    background: ${colors.sliderThumb};
                    border-radius: 50%;
                    cursor: grab;
                    box-shadow: 0 0 5px rgba(0,0,0,0.3);
                    transition: transform var(--simalyze-project-card-transition-duration);
                }
                input[type="range"]::-webkit-slider-thumb:active {
                    cursor: grabbing;
                    transform: scale(1.1);
                }
                input[type="range"]::-moz-range-thumb {
                    width: 20px;
                    height: 20px;
                    background: ${colors.sliderThumb};
                    border-radius: 50%;
                    cursor: grab;
                    box-shadow: 0 0 5px rgba(0,0,0,0.3);
                }
                .simalyze-textarea {
                    width: 100%;
                    min-height: 100px;
                    background-color: var(--simalyze-input-bg, ${colors.inputBg});
                    border: var(--simalyze-thin-stroke, ${colors.thinStroke}) solid var(--simalyze-input-border, ${colors.inputBorder});
                    border-radius: calc(var(--simalyze-border-radius, ${colors.borderRadius}) / 1.5);
                    color: var(--simalyze-input-color, ${colors.inputColor});
                    padding: 8px;
                    font-family: monospace;
                    font-size: 13px;
                    box-sizing: border-box;
                    resize: vertical;
                }
                .simalyze-select {
                    background-color: var(--simalyze-input-bg, ${colors.inputBg});
                    border: var(--simalyze-thin-stroke, ${colors.thinStroke}) solid var(--simalyze-input-border, ${colors.inputBorder});
                    border-radius: calc(var(--simalyze-border-radius, ${colors.borderRadius}) / 1.5);
                    color: var(--simalyze-input-color, ${colors.inputColor});
                    padding: 4px 8px;
                    font-size: 14px;
                }
            </style>
            <div id="simalyze-settings-modal-container">
                <div id="simalyze-settings-modal-content">
                    <div id="simalyze-modal-header">
                        <h2 style="font-size: 22px; font-weight: bold; color: ${colors.headingColor}; display: flex; align-items: center; gap: 12px; margin: 0;">
                            <img src="${SIMALYZE_LOGO_URL}" alt="Simalyze Logo" style="width: 32px; height: 32px; border-radius: 50%;">
                            Websim Simalyze
                        </h2>
                        <div style="display: flex; gap: 8px;">
                            <button id="simalyze-info-button" class="simalyze-modal-button" style="background: ${colors.buttonBg}; border: var(--simalyze-thin-stroke) solid ${colors.buttonBorder}; font-size: 20px; cursor: pointer; color: ${colors.headingColor}; padding: 5px; border-radius: ${colors.borderRadius}; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${colors.headingColor};">
                                    <circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>
                                </svg>
                            </button>
                            <button id="simalyze-close-button" class="simalyze-modal-button" style="background: ${colors.buttonBg}; border: var(--simalyze-thin-stroke) solid ${colors.buttonBorder}; font-size: 24px; cursor: pointer; color: ${colors.headingColor}; padding: 5px; border-radius: ${colors.borderRadius}; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${colors.headingColor};">
                                    <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div id="simalyze-modal-body">
                        <div style="background: rgba(0,0,0,0.02); border: var(--simalyze-thin-stroke) solid ${colors.sectionBorder}; padding: 16px; border-radius: ${colors.borderRadius};">
                            <h3 style="font-size: 16px; font-weight: bold; color: ${colors.headingColor}; margin: 0 0 12px 0;">Filter & Display Modes</h3>
                            <div style="display: flex; flex-direction: column; gap: 12px;">
                                <div style="display: flex; align-items: center; justify-content: space-between;">
                                    <div>
                                        <span style="font-size: 14px; color: ${colors.textColor}; font-weight: 500;">Analyzer Mode</span>
                                        <p style="font-size: 13px; color: ${colors.textSecondaryColor}; margin-top: 3px;">Shows quality score and blurs low-rated projects.</p>
                                    </div>
                                    <input type="checkbox" id="analyzer-mode-checkbox" style="width: 20px; height: 20px; cursor: pointer; margin: 0; flex-shrink: 0;">
                                </div>
                                <div style="display: flex; align-items: center; justify-content: space-between;">
                                    <div>
                                        <span style="font-size: 14px; color: ${colors.textColor}; font-weight: 500;">Low-Quality Projects remover (Hide Mode)</span>
                                        <p style="font-size: 13px; color: ${colors.textSecondaryColor}; margin-top: 3px;">Hides projects with a score below 30.</p>
                                    </div>
                                    <input type="checkbox" id="slop-remover-2-checkbox" style="width: 20px; height: 20px; cursor: pointer; margin: 0; flex-shrink: 0;">
                                </div>
                                <div style="display: flex; align-items: center; justify-content: space-between;">
                                    <div>
                                        <span style="font-size: 14px; color: ${colors.textColor}; font-weight: 500;">Highlight Good Projects</span>
                                        <p style="font-size: 13px; color: ${colors.textSecondaryColor}; margin-top: 3px;">Visually marks high-quality projects.</p>
                                    </div>
                                    <input type="checkbox" id="highlight-good-projects-checkbox" style="width: 20px; height: 20px; cursor: pointer; margin: 0; flex-shrink: 0;">
                                </div>
                            </div>
                        </div>

                        <div style="background: rgba(0,0,0,0.02); border: var(--simalyze-thin-stroke) solid ${colors.sectionBorder}; padding: 16px; border-radius: ${colors.borderRadius};">
                            <h3 style="font-size: 16px; font-weight: bold; color: ${colors.headingColor}; margin: 0 0 12px 0;">Appearance</h3>
                            <div style="display: flex; flex-direction: column; gap: 16px;">
                                <div>
                                    <label for="custom-css-textarea" style="font-size: 14px; color: ${colors.textColor}; display: block; margin-bottom: 8px;">Custom CSS</label>
                                    <textarea id="custom-css-textarea" class="simalyze-textarea" placeholder="Enter your custom CSS here..."></textarea>
                                    <div style="display: flex; gap: 8px; margin-top: 8px;">
                                        <button id="apply-css-button" class="simalyze-modal-button" style="flex-grow: 1; background: ${colors.buttonBg}; border: var(--simalyze-thin-stroke) solid ${colors.buttonBorder}; font-size: 13px; cursor: pointer; color: ${colors.textColor}; padding: 6px 12px; border-radius: ${colors.borderRadius};">Apply & Save</button>
                                            <button id="clear-css-button" class="simalyze-modal-button" style="background: ${colors.buttonBg}; border: var(--simalyze-thin-stroke) solid ${colors.buttonBorder}; font-size: 13px; cursor: pointer; color: ${colors.textColor}; padding: 6px 12px; border-radius: ${colors.borderRadius};">Clear</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style="background: rgba(0,0,0,0.02); border: var(--simalyze-thin-stroke) solid ${colors.sectionBorder}; padding: 16px; border-radius: ${colors.borderRadius};">
                            <h3 style="font-size: 16px; font-weight: bold; color: ${colors.headingColor}; margin: 0 0 12px 0;">Highlight Threshold</h3>
                            <div style="margin-top: 10px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                    <span style="font-size: 14px; color: ${colors.textColor};">Minimum Score to Highlight:</span>
                                    <span id="highlight-threshold-value" style="font-weight: bold; font-size: 16px; color: ${colors.scoreGood}; background-color: rgba(74, 222, 128, 0.1); padding: 4px 8px; border-radius: 6px;">${highlightThreshold}</span>
                                </div>
                                <input type="range" id="highlight-threshold-slider" min="50" max="100" value="${highlightThreshold}" step="1" style="width: 100%; margin-top: 5px;">
                            </div>
                        </div>
                    </div>
                    <div id="simalyze-modal-footer">
                        <button id="visit-profile-button" class="simalyze-modal-button" style="
                            background: ${colors.buttonBg};
                            border: var(--simalyze-thin-stroke) solid ${colors.buttonBorder};
                            border-radius: ${colors.borderRadius};
                            padding: 8px 15px;
                            font-size: 14px;
                            cursor: pointer;
                            color: ${colors.textColor};
                            transition: background-color var(--simalyze-project-card-transition-duration), border-color var(--simalyze-project-card-transition-duration);
                            padding-left: 15px;
                            padding-right: 15px;
                        ">Visit My Profile</button>
                    </div>
                </div>
            </div>
        `;
        shadowRoot.innerHTML = modalHTML;

        const container = shadowRoot.getElementById('simalyze-settings-modal-container');
        const content = shadowRoot.getElementById('simalyze-settings-modal-content');
        container.style.display = 'flex';
        setTimeout(() => {
            content.style.animation = `simalyze-slide-in-from-top ${colors.modalTransitionDuration}ms ease-out forwards`;
            container.style.opacity = '1';
            container.style.pointerEvents = 'auto';
        }, 10);

        const closeButton = shadowRoot.getElementById('simalyze-close-button');
        const infoButton = shadowRoot.getElementById('simalyze-info-button');
        const analyzerModeCheckbox = shadowRoot.getElementById('analyzer-mode-checkbox');
        const slopRemover2Checkbox = shadowRoot.getElementById('slop-remover-2-checkbox');
        const highlightGoodProjectsCheckbox = shadowRoot.getElementById('highlight-good-projects-checkbox');
        const highlightThresholdSlider = shadowRoot.getElementById('highlight-threshold-slider');
        const highlightThresholdValueSpan = shadowRoot.getElementById('highlight-threshold-value');
        const visitProfileButton = shadowRoot.getElementById('visit-profile-button');

        closeButton.onclick = () => {
            content.style.animation = `simalyze-slide-out-to-top ${colors.modalTransitionDuration}ms ease-out forwards`;
            container.style.opacity = '0';
            container.style.pointerEvents = 'none';
            setTimeout(() => {
                container.style.display = 'none';
                content.style.animation = '';
            }, colors.modalTransitionDuration);
        };
        closeButton.onmouseover = () => { closeButton.style.backgroundColor = colors.buttonHover; };
        closeButton.onmouseout = () => { closeButton.style.backgroundColor = colors.buttonBg; };

        infoButton.onclick = () => {
            showInfoModal();
        };
        infoButton.onmouseover = () => { infoButton.style.backgroundColor = colors.buttonHover; };
        infoButton.onmouseout = () => { infoButton.style.backgroundColor = colors.buttonBg; };

        analyzerModeCheckbox.checked = analyzerModeActive;
        analyzerModeCheckbox.onchange = () => {
            analyzerModeActive = analyzerModeCheckbox.checked;
            saveSettings();
            applySlopRemover();
        };

        slopRemover2Checkbox.checked = slopRemover2Active;
        slopRemover2Checkbox.onchange = () => {
            slopRemover2Active = slopRemover2Checkbox.checked;
            saveSettings();
            applySlopRemover();
        };

        highlightGoodProjectsCheckbox.checked = highlightGoodProjectsActive;
        highlightGoodProjectsCheckbox.onchange = () => {
            highlightGoodProjectsActive = highlightGoodProjectsCheckbox.checked;
            saveSettings();
            applySlopRemover();
        };

        highlightThresholdSlider.value = highlightThreshold;
        highlightThresholdSlider.oninput = () => {
            highlightThreshold = parseInt(highlightThresholdSlider.value, 10);
            highlightThresholdValueSpan.textContent = highlightThreshold;
        };
        highlightThresholdSlider.onchange = () => {
            saveSettings();
            applySlopRemover();
        };

        const customCssTextarea = shadowRoot.getElementById('custom-css-textarea');
        customCssTextarea.value = customCSS;
        const applyCssButton = shadowRoot.getElementById('apply-css-button');
        applyCssButton.onclick = () => {
            customCSS = customCssTextarea.value;
            applyCustomCSS();
            saveSettings();
        };
        applyCssButton.onmouseover = () => { applyCssButton.style.backgroundColor = colors.buttonHover; };
        applyCssButton.onmouseout = () => { applyCssButton.style.backgroundColor = colors.buttonBg; };

        const clearCssButton = shadowRoot.getElementById('clear-css-button');
        clearCssButton.onclick = () => {
            customCssTextarea.value = '';
            customCSS = '';
            applyCustomCSS();
            saveSettings();
        };
        clearCssButton.onmouseover = () => { clearCssButton.style.backgroundColor = colors.buttonHover; };
        clearCssButton.onmouseout = () => { clearCssButton.style.backgroundColor = colors.buttonBg; };

        visitProfileButton.onclick = () => {
            window.open(FSX_PROFILE_URL, '_blank');
        };
        visitProfileButton.onmouseover = () => { visitProfileButton.style.backgroundColor = colors.buttonHover; };
        visitProfileButton.onmouseout = () => { visitProfileButton.style.backgroundColor = colors.buttonBg; };
    }

    function showInfoModal() {
        let infoModalHost = document.getElementById('simalyze-info-modal-host');
        const colors = getCurrentThemeProperties();
        let shadowRoot;

        if (infoModalHost) {
            shadowRoot = infoModalHost.shadowRoot;
            const container = shadowRoot.getElementById('simalyze-info-modal-container');
            const content = shadowRoot.getElementById('simalyze-info-modal-content');
            container.style.display = 'flex';
            setTimeout(() => {
                content.style.animation = `simalyze-slide-in-from-top ${colors.modalTransitionDuration}ms ease-out forwards`;
                container.style.opacity = '1';
                container.style.pointerEvents = 'auto';
            }, 10);
            return;
        } else {
            infoModalHost = document.createElement('div');
            infoModalHost.id = 'simalyze-info-modal-host';
            document.body.appendChild(infoModalHost);
            shadowRoot = infoModalHost.attachShadow({ mode: 'open' });
        }

        const infoModalMaxWidth = '550px';
        const infoModalPadding = '24px';
        const infoModalPaddingMobile = '16px';

        const infoModalHTML = `
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap');

                #simalyze-info-modal-container {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(5px);
                    -webkit-backdrop-filter: blur(5px);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 10001;
                    font-family: 'Montserrat', sans-serif;
                    box-sizing: border-box;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity ${colors.modalTransitionDuration}ms ease-in-out;
                }

                #simalyze-info-modal-content {
                    background: ${colors.mainBg};
                    padding: ${infoModalPadding};
                    border-radius: ${colors.borderRadius};
                    box-shadow: ${colors.modalShadow};
                    width: 100%;
                    max-width: ${infoModalMaxWidth};
                    box-sizing: border-box;
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    border: var(--simalyze-thin-stroke) solid ${colors.modalBorder};
                    max-height: 90vh;
                    transform: ${colors.modalEnterTransform};
                }

                #simalyze-info-modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding-bottom: 16px;
                    border-bottom: var(--simalyze-thin-stroke) solid ${colors.sectionBorder};
                    flex-shrink: 0;
                }

                #simalyze-info-modal-body {
                    flex-grow: 1;
                    overflow-y: auto;
                    padding-top: 16px;
                    text-align: left;
                    color: ${colors.textColor};
                    font-size: 14px;
                    padding-right: 12px;
                    margin-right: -12px;
                }

                #simalyze-info-modal-body::-webkit-scrollbar {
                    width: 8px;
                }
                #simalyze-info-modal-body::-webkit-scrollbar-track {
                    background: transparent;
                }
                #simalyze-info-modal-body::-webkit-scrollbar-thumb {
                    background-color: ${colors.sliderThumb};
                    border-radius: 4px;
                    border: 2px solid ${colors.mainBg};
                }

                .simalyze-modal-button {
                    transition: background-color var(--simalyze-project-card-transition-duration), border-color var(--simalyze-project-card-transition-duration);
                }
                .simalyze-modal-button:hover {
                    background-color: ${colors.buttonHover} !important;
                    border-color: ${colors.buttonHover} !important;
                }

                @media (max-width: 640px) {
                    #simalyze-info-modal-container {
                        align-items: stretch;
                    }
                    #simalyze-info-modal-content {
                        max-width: 100%;
                        width: 100%;
                        height: 100%;
                        max-height: 100vh;
                        border-radius: 0;
                        border: none;
                        padding: ${infoModalPaddingMobile};
                    }
                    #simalyze-info-modal-header h3 {
                        font-size: 18px !important;
                    }
                }
            </style>
            <div id="simalyze-info-modal-container">
                <div id="simalyze-info-modal-content">
                    <div id="simalyze-info-modal-header">
                        <h3 style="font-size: 22px; font-weight: bold; color: ${colors.headingColor}; display: flex; align-items: center; gap: 12px; margin: 0;">
                            <img src="${SIMALYZE_LOGO_URL}" alt="Simalyze Logo" style="width: 32px; height: 32px; border-radius: 50%;">
                            Websim Simalyze Info
                        </h3>
                        <button id="simalyze-info-close-button" class="simalyze-modal-button" style="background: ${colors.buttonBg}; border: var(--simalyze-thin-stroke) solid ${colors.buttonBorder}; font-size: 20px; cursor: pointer; color: ${colors.headingColor}; padding: 5px; border-radius: ${colors.borderRadius}; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; transition: background-color var(--simalyze-project-card-transition-duration), border-color var(--simalyze-project-card-transition-duration);">
                             <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${colors.headingColor};">
                                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div id="simalyze-info-modal-body">
                        <p style="font-size: 15px; color: ${colors.textColor}; margin-top: 0;">
                            Websim Simalyze for Analyzing Websim projects based on code complexity, engagement, creator reputation, and more.
                            <br><br>
                            The analysis is based on several key aspects, using Websim metadata:
                            <ul style="list-style: disc; padding-left: 20px; margin-top: 10px; text-align: left; color: ${colors.textColor}; font-size: 14px;">
                                <li><strong>Content Quality:</strong> Evaluation of title, description, and presence of a thumbnail.</li>
                                <li><strong>Engagement:</strong> Likes, views, and average playtime.</li>
                                <li><strong>Creator Reputation:</strong> The overall activity and popularity of the project's creator.</li>
                                <li><strong>Project Maturity:</strong> Revision history and whether it's a published site.</li>
                                <li><strong>Influence & Originality:</strong> Number of remixes and whether it was made from a template.</li>
                                <li><strong>Code Complexity:</strong> Indirectly assessed through asset usage, revision frequency, and HTML script content.</li>
                                <li><strong>Visual Presentation:</strong> Presence and number of screenshots.</li>
                                <li><strong>Overall Completeness:</strong> Presence of essential project metadata.</li>
                            </ul>
                            <p style="font-size: 15px; color: ${colors.textColor}; margin-top: 15px; text-align: left;">
                                Based on these factors, the script generates a "Composite Quality Score" from 0 to 100.
                                <br><br>
                                The script offers multiple modes to customize your browsing experience:
                                <ul style="list-style: disc; padding-left: 20px; margin-top: 10px; text-align: left; color: ${colors.textColor}; font-size: 14px;">
                                    <li><strong>Analyzer Mode:</strong> Displays the generated score directly on each project card, allowing you to manually assess quality. Projects with a score below 50 will always be blurred with a warning.</li>
                                    <li><strong>Low-Quality Projects remover (Hide Mode):</strong> Completely hides projects with a Simalyze score below 30, providing a cleaner feed.</li>
                                    <li><strong>Highlight Good Projects:</strong> Visually emphasizes high-quality projects (score >= 75 by default) to help you discover gems.</li>
                                </ul>
                                Together, these features help you filter out unwanted content and discover higher quality creations on Websim.
                            </p>
                        </p>
                    </div>
                </div>
            </div>
        `;
        shadowRoot.innerHTML = infoModalHTML;

        const container = shadowRoot.getElementById('simalyze-info-modal-container');
        const content = shadowRoot.getElementById('simalyze-info-modal-content');
        container.style.display = 'flex';
        setTimeout(() => {
            content.style.animation = `simalyze-slide-in-from-top ${colors.modalTransitionDuration}ms ease-out forwards`;
            container.style.opacity = '1';
            container.style.pointerEvents = 'auto';
        }, 10);

        const infoCloseButton = shadowRoot.getElementById('simalyze-info-close-button');
        infoCloseButton.onclick = () => {
            content.style.animation = `simalyze-slide-out-to-top ${colors.modalTransitionDuration}ms ease-out forwards`;
            container.style.opacity = '0';
            container.style.pointerEvents = 'none';
            setTimeout(() => {
                container.style.display = 'none';
                content.style.animation = '';
            }, colors.modalTransitionDuration);
        };
        infoCloseButton.onmouseover = () => { infoCloseButton.style.backgroundColor = colors.buttonHover; };
        infoCloseButton.onmouseout = () => { infoCloseButton.style.backgroundColor = colors.buttonBg; };
    }

    function showProjectDetailsModal(projectTitle, analysisResult) {
        let detailsModalHost = document.getElementById('simalyze-details-modal-host');
        const colors = getCurrentThemeProperties();
        let shadowRoot;

        if (detailsModalHost) {
            shadowRoot = detailsModalHost.shadowRoot;
            const container = shadowRoot.getElementById('simalyze-details-modal-container');
            const content = shadowRoot.getElementById('simalyze-details-modal-content');
            container.style.display = 'flex';
            setTimeout(() => {
                content.style.animation = `simalyze-slide-in-from-top ${colors.modalTransitionDuration}ms ease-out forwards`;
                container.style.opacity = '1';
                container.style.pointerEvents = 'auto';
            }, 10);
            return;
        } else {
            detailsModalHost = document.createElement('div');
            detailsModalHost.id = 'simalyze-details-modal-host';
            document.body.appendChild(detailsModalHost);
            shadowRoot = detailsModalHost.attachShadow({ mode: 'open' });
        }

        const breakdownHTML = Object.entries(analysisResult.breakdown).map(([key, value]) => `
            <div style="margin-bottom: 5px;">
                <strong style="color: ${colors.textColor};">${key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}:</strong>
                <span style="color: ${typeof value.scoreImpact === 'number' ? (value.scoreImpact > 0 ? colors.scoreGood : (value.scoreImpact < 0 ? colors.scoreBad : colors.scoreNeutral)): colors.scoreNeutral}; font-weight: bold;">
                     ${typeof value.scoreImpact === 'number' ? (value.scoreImpact >= 0 ? '+' : '') + value.scoreImpact : 'N/A'}
                </span>
                <p style="font-size: 13px; color: ${colors.textSecondaryColor}; margin-top: 2px;">${value.reason}</p>
            </div>
        `).join('');

        const detailsModalHTML = `
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap');
                .simalyze-modal-button {
                    transition: background-color var(--simalyze-project-card-transition-duration), border-color var(--simalyze-project-card-transition-duration);
                }
                .simalyze-modal-button:hover {
                    background-color: ${colors.buttonHover} !important;
                    border-color: ${colors.buttonHover} !important;
                }
            </style>
            <div id="simalyze-details-modal-container" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; align-items: center; z-index: 10002; font-family: 'Montserrat', sans-serif; overflow: auto; opacity: 0; pointer-events: none; transition: opacity ${colors.modalTransitionDuration}ms ease-in-out;">
                <div id="simalyze-details-modal-content" style="background: ${colors.mainBg}; padding: 10px; border-radius: ${colors.borderRadius}; box-shadow: ${colors.modalShadow}; width: 90%; max-width: 600px; max-height: 90vh; box-sizing: border-box; position: relative; display: flex; flex-direction: column; border: var(--simalyze-thin-stroke) solid ${colors.modalBorder}; transform: ${colors.modalEnterTransform};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <h2 style="font-size: 20px; font-weight: bold; color: ${colors.headingColor};">Analysis: ${projectTitle}</h2>
                        <button id="simalyze-details-close-button" class="simalyze-modal-button" style="background: ${colors.buttonBg}; border: var(--simalyze-thin-stroke) solid ${colors.buttonBorder}; font-size: 24px; cursor: pointer; color: ${colors.headingColor}; padding: 5px; border-radius: ${colors.borderRadius}; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; transition: background-color var(--simalyze-project-card-transition-duration), border-color var(--simalyze-project-card-transition-duration);">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${colors.headingColor};">
                                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div style="flex-grow: 1; overflow-y: auto; padding-bottom: 5px; display: flex; flex-direction: column; gap: 10px;">
                        <div style="text-align: center; margin-bottom: 10px; padding-bottom: 10px; border-bottom: var(--simalyze-thin-stroke) solid ${colors.sectionBorder};">
                            <h3 style="font-size: 18px; font-weight: bold; color: ${colors.headingColor}; margin-bottom: 5px;">Composite Quality Score</h3>
                            <div style="font-size: 48px; font-weight: 700; color: ${typeof analysisResult.compositeScore === 'number' ? (analysisResult.compositeScore > 70 ? colors.scoreGood : (analysisResult.compositeScore < 50 ? colors.scoreBad : colors.scoreNeutral)): colors.scoreNeutral};">
                                ${analysisResult.compositeScore}
                            </div>
                            <p style="font-size: 14px; color: ${colors.textColor}; margin-top: 5px;">${analysisResult.summary || 'No summary available.'}</p>
                        </div>
                        <div style="padding-top: 10px; border-top: var(--simalyze-thin-stroke) solid ${colors.sectionBorder};">
                            <h3 style="font-size: 16px; font-weight: bold; color: ${colors.headingColor}; margin-bottom: 10px;">Scoring Breakdown</h3>
                            ${breakdownHTML}
                        </div>
                    </div>
                </div>
            </div>
        `;
        shadowRoot.innerHTML = detailsModalHTML;

        const container = shadowRoot.getElementById('simalyze-details-modal-container');
        const content = shadowRoot.getElementById('simalyze-details-modal-content');
        container.style.display = 'flex';
        setTimeout(() => {
            content.style.animation = `simalyze-slide-in-from-top ${colors.modalTransitionDuration}ms ease-out forwards`;
            container.style.opacity = '1';
            container.style.pointerEvents = 'auto';
        }, 10);

        const detailsCloseButton = shadowRoot.getElementById('simalyze-details-close-button');
        detailsCloseButton.onclick = () => {
            content.style.animation = `simalyze-slide-out-to-top ${colors.modalTransitionDuration}ms ease-out forwards`;
            container.style.opacity = '0';
            container.style.pointerEvents = 'none';
            setTimeout(() => {
                container.style.display = 'none';
                content.style.animation = '';
            }, colors.modalTransitionDuration);
        };
        detailsCloseButton.onmouseover = () => { detailsCloseButton.style.backgroundColor = colors.buttonHover; };
        detailsCloseButton.onmouseout = () => { detailsCloseButton.style.backgroundColor = colors.buttonBg; };
    }

    function addSimalyzeSettingsButton() {
        const buttonContainer = document.querySelector('div.flex.flex-col.items-center.w-full > div.flex.flex-col.items-center.gap-4.w-full');

        if (buttonContainer && !buttonContainer.querySelector('.simalyze-settings-button')) {
            const simalyzeButton = document.createElement('button');
            simalyzeButton.setAttribute('aria-label', 'Simalyze Settings');
            simalyzeButton.classList.add(
                'p-2', 'rounded', 'transition-all', 'duration-200', 'flex', 'items-center',
                'justify-center', 'active:scale-95', 'simalyze-settings-button'
            );

            const colors = getCurrentThemeProperties();

            simalyzeButton.style.cssText = `
                background-color: ${colors.buttonBg};
                border: var(--simalyze-thin-stroke) solid ${colors.buttonBorder};
                border-radius: ${colors.borderRadius};
                color: ${colors.textColor};
                padding: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background-color var(--simalyze-project-card-transition-duration), border-color var(--simalyze-project-card-transition-duration), transform var(--simalyze-project-card-transition-duration);
                cursor: pointer;
            `;

            simalyzeButton.onmouseover = () => {
                simalyzeButton.style.backgroundColor = colors.buttonHover;
                simalyzeButton.style.borderColor = colors.buttonHover;
                simalyzeButton.style.transform = 'scale(1.05)';
            };
            simalyzeButton.onmouseout = () => {
                simalyzeButton.style.backgroundColor = colors.buttonBg;
                simalyzeButton.style.borderColor = colors.buttonBorder;
                simalyzeButton.style.transform = 'scale(1)';
            };
            simalyzeButton.onmousedown = () => {
                simalyzeButton.style.transform = 'scale(0.95)';
            };
            simalyzeButton.onmouseup = () => {
                simalyzeButton.style.transform = 'scale(1)';
            };

            const settingsSVG = `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings">
                    <path d="M13 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0 .73 2.73l.22.38a2 2 0 0 0-2.73.73l.15.08a2 2 0 0 1-2 0l.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
            `;

            simalyzeButton.innerHTML = settingsSVG;

            simalyzeButton.onclick = () => {
                showSettingsModal();
            };

            buttonContainer.appendChild(simalyzeButton);
            return true;
        }
        return false;
    }

    let simalyzeButtonAdded = false;

    function syncDarkMode() {
        if (document.documentElement.classList.contains('dark')) {
            document.body.classList.add('dark');
        } else {
            document.body.classList.remove('dark');
        }
    }

    function applyCustomCSS() {
        let styleElement = document.getElementById('simalyze-custom-css');
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = 'simalyze-custom-css';
            document.head.appendChild(styleElement);
        }
        styleElement.textContent = customCSS;
    }

    const observer = new MutationObserver(function(mutationsList) {
        let needsReapply = false;
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1 && (node.matches('a.flex.flex-col') || node.querySelector('a.flex.flex-col'))) {
                        needsReapply = true;
                        break;
                    }
                }
            }
            if (needsReapply) break;
        }

        if (!simalyzeButtonAdded) {
            simalyzeButtonAdded = addSimalyzeSettingsButton();
        }

        if (needsReapply) {
            setTimeout(applySlopRemover, 100);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    syncDarkMode();
    applyCustomCSS();

    setTimeout(() => {
        if (!simalyzeButtonAdded) {
            simalyzeButtonAdded = addSimalyzeSettingsButton();
        }
        applySlopRemover();
    }, 1000);

})();
