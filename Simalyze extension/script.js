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
        const description = (apiData?.project?.description || '');
        const titleLength = title.length;
        const descriptionLength = description.length;
        const hasThumbnail = !!domData.previewImageUrl;

        let contentQualityImpact = 0;
        let contentQualityReason = [];

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
                engagementReason.push('No engagement despite some views.');
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
                    simalyzeAnalysisArea.innerHTML = '';
                    simalyzeAnalysisArea.style.display = 'none';

                    if (analyzerModeActive && !slopRemover2Active) {
                        simalyzeAnalysisArea.innerHTML = `<span style="color: ${isHostDarkMode() ? '#bbb' : 'grey'};">Simalyze: Analyzing...</span>`;
                        simalyzeAnalysisArea.style.display = 'flex';
                    }

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

                const imageWrapper = element.querySelector('div.flex.w-full.h-full.relative.overflow-hidden');
                const imgElement = imageWrapper ? imageWrapper.querySelector('img.object-cover') : null;
                const textWrapper = element.querySelector('div.p-1.text-left.overflow-hidden');
                let simalyzeBlockOverlay = element.querySelector('.simalyze-block-overlay');
                let simalyzeHighlightIndicator = element.querySelector('.simalyze-highlight-indicator');

                if (imageWrapper && !simalyzeBlockOverlay) {
                    simalyzeBlockOverlay = document.createElement('div');
                    simalyzeBlockOverlay.classList.add('simalyze-block-overlay');
                    simalyzeBlockOverlay.style.cssText = `
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                        z-index: 10;
                        background-color: ${isHostDarkMode() ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.9)'};
                        border-radius: inherit;
                        backdrop-filter: blur(5px);
                        -webkit-backdrop-filter: blur(5px);
                        text-align: center;
                        pointer-events: auto; 
                    `;
                    imageWrapper.appendChild(simalyzeBlockOverlay);
                } else if (!imageWrapper && !simalyzeBlockOverlay) {
                    simalyzeBlockOverlay = document.createElement('div');
                    simalyzeBlockOverlay.classList.add('simalyze-block-overlay');
                    element.appendChild(simalyzeBlockOverlay);
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
                        border: var(--simalyze-thin-stroke) solid var(--simalyze-highlight-border);
                        pointer-events: none;
                    `;
                    element.appendChild(simalyzeHighlightIndicator);
                }

                element.classList.remove('simalyze-hidden', 'simalyze-blurred', 'simalyze-highlighted');
                element.style.display = '';
                if(simalyzeBlockOverlay) simalyzeBlockOverlay.style.display = 'none';
                simalyzeHighlightIndicator.style.display = 'none';
                if (imgElement) imgElement.style.filter = '';
                if (imageWrapper) imageWrapper.style.display = '';
                if (textWrapper) textWrapper.style.display = '';
                const simalyzeAnalysisArea = element.querySelector('.simalyze-analysis-area');
                if (simalyzeAnalysisArea) simalyzeAnalysisArea.style.display = 'none';

                const shouldBeHidden = slopRemover2Active && compositeScore < 30;
                const shouldBeBlurred = analyzerModeActive && !shouldBeHidden && compositeScore < 50;
                const shouldBeHighlighted = highlightGoodProjectsActive && !shouldBeHidden && compositeScore >= highlightThreshold;

                if (shouldBeHidden) {
                    element.style.display = 'none';
                    element.classList.add('simalyze-hidden');
                } else if (shouldBeBlurred && simalyzeBlockOverlay) {
                    simalyzeBlockOverlay.style.display = 'flex';
                    simalyzeBlockOverlay.style.pointerEvents = 'auto';
                    simalyzeBlockOverlay.innerHTML = `
                        <img src="${SIMALYZE_LOGO_URL}" alt="Simalyze Logo" style="width: 60px; height: 60px; margin-bottom: 10px; opacity: 0.8;">
                        <span style="font-size: 20px; font-weight: bold; color: ${currentColors.textColor}; margin-bottom: 5px;">This project is rated below 50.</span>
                        <span style="font-size: 16px; color: ${isHostDarkMode() ? '#ccc' : '#333'}; margin-bottom: 10px;">(Score: ${compositeScore.toFixed(0)})</span>
                        <button class="simalyze-view-button" style="
                            background-color: ${currentColors.buttonBg};
                            border: ${currentColors.thinStroke} solid ${currentColors.buttonBorder};
                            border-radius: ${currentColors.borderRadius};
                            padding: 8px 15px;
                            font-size: 14px;
                            cursor: pointer;
                            color: ${currentColors.textColor};
                            transition: background-color 0.2s;
                            pointer-events: auto; 
                        ">Are you sure you want to view it?</button>
                    `;
                    const viewButton = simalyzeBlockOverlay.querySelector('.simalyze-view-button');
                    viewButton.onmouseover = () => { viewButton.style.backgroundColor = currentColors.buttonHover; };
                    viewButton.onmouseout = () => { viewButton.style.backgroundColor = currentColors.buttonBg; };
                    viewButton.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        simalyzeBlockOverlay.style.display = 'none'; 
                        element.classList.remove('simalyze-blurred');
                        if (imgElement) imgElement.style.filter = '';
                        if (analyzerModeActive && simalyzeAnalysisArea) {
                            simalyzeAnalysisArea.style.display = 'flex';
                        }
                    };
                    element.classList.add('simalyze-blurred');
                    if (imgElement) imgElement.style.filter = `blur(5px)`;
                } else {
                    if (shouldBeHighlighted) {
                        element.classList.add('simalyze-highlighted');
                        simalyzeHighlightIndicator.style.display = 'flex';
                        simalyzeHighlightIndicator.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"/></svg>
                            <span>Good!</span>
                        `;
                        element.style.border = `${currentColors.thinStroke} solid ${currentColors.highlightBorderColor}`;
                    } else {
                        element.style.border = '';
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
                                border: ${currentColors.thinStroke} solid ${currentColors.buttonBorder};
                                border-radius: ${currentColors.borderRadius};
                                padding: 2px 6px;
                                font-size: 11px;
                                cursor: pointer;
                                color: ${currentColors.textColor};
                                transition: background-color 0.2s;
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
            fontFamily: "'Montserrat', sans-serif", mainBg: '#1a1a1a', modalBorder: '#333333', modalShadow: '0 8px 32px rgba(0, 0, 0, 0.5)', textColor: '#e0e0e0', textSecondaryColor: '#a0a0a0', headingColor: '#ffffff', sectionBorder: '#2f2f2f', buttonBg: 'rgba(255, 255, 255, 0.1)', buttonHover: 'rgba(255, 255, 255, 0.15)', buttonBorder: 'rgba(255, 255, 255, 0.2)', inputBg: '#252525', inputBorder: '#4a4a4a', inputColor: '#ffffff', inputPlaceholder: 'rgba(255, 255, 255, 0.5)', scoreGood: '#4ade80', scoreNeutral: '#9ca3af', scoreBad: '#f87171', sliderTrack: '#333', sliderThumb: '#999999', borderRadius: '12px', thinStroke: '1px', highlightBgColor: 'rgba(74, 222, 128, 0.1)', highlightBorderColor: '#4ade80', highlightTextColor: '#4ade80'
        } : {
            fontFamily: "'Montserrat', sans-serif", mainBg: '#ffffff', modalBorder: '#e0e0e0', modalShadow: '0 8px 32px rgba(0, 0, 0, 0.12)', textColor: '#333333', textSecondaryColor: '#555555', headingColor: '#000000', sectionBorder: '#eeeeee', buttonBg: '#f0f0f0', buttonHover: '#e0e0e0', buttonBorder: '#d0d0d0', inputBg: '#f8f8f8', inputBorder: '#dcdcdc', inputColor: '#000000', inputPlaceholder: 'rgba(0, 0, 0, 0.4)', scoreGood: '#22c55e', scoreNeutral: '#666666', scoreBad: '#ef4444', sliderTrack: '#e0e0e0', sliderThumb: '#666666', borderRadius: '12px', thinStroke: '1px', highlightBgColor: 'rgba(34, 197, 94, 0.1)', highlightBorderColor: '#22c55e', highlightTextColor: '#16a34a'
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
        };
    }

    function showSettingsModal() {
        /* @tweakable Maximum width of the settings modal */
        const settingsModalMaxWidth = '600px';
        /* @tweakable Padding for the settings modal content on desktop */
        const settingsModalPadding = '24px';
        /* @tweakable Padding for the settings modal content on mobile */
        const settingsModalPaddingMobile = '16px';
        /* @tweakable Gap between sections in the settings modal */
        const settingsModalSectionGap = '20px';

        let modalHost = document.getElementById('simalyze-settings-modal-host');
        if (modalHost) {
            const container = modalHost.shadowRoot.getElementById('simalyze-settings-modal-container');
            if (container.style.display === 'flex') {
                container.style.display = 'none';
            } else {
                container.style.display = 'flex';
                const newColors = getCurrentThemeProperties();
                const content = modalHost.shadowRoot.getElementById('simalyze-settings-modal-content');
                content.style.background = newColors.mainBg;
                content.style.color = newColors.textColor;
            }
            return;
        }

        const colors = getCurrentThemeProperties();

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
                    border: ${colors.thinStroke} solid ${colors.modalBorder};
                    max-height: 90vh;
                }

                #simalyze-modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding-bottom: 16px;
                    border-bottom: ${colors.thinStroke} solid ${colors.sectionBorder};
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
                    border-top: ${colors.thinStroke} solid ${colors.sectionBorder};
                    display: flex;
                    justify-content: flex-end; 
                    flex-shrink: 0;
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
                    border-radius: ${colors.borderRadius};
                    outline: none;
                    transition: background 0.2s;
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
                    transition: transform 0.2s;
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
                            <button id="simalyze-info-button" class="simalyze-modal-button" style="background: ${colors.buttonBg}; border: ${colors.thinStroke} solid ${colors.buttonBorder}; font-size: 20px; cursor: pointer; color: ${colors.headingColor}; padding: 5px; border-radius: ${colors.borderRadius}; transition: background-color 0.2s, border-color 0.2s; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${colors.headingColor};">
                                    <circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>
                                </svg>
                            </button>
                            <button id="simalyze-close-button" class="simalyze-modal-button" style="background: ${colors.buttonBg}; border: ${colors.thinStroke} solid ${colors.buttonBorder}; font-size: 24px; cursor: pointer; color: ${colors.headingColor}; padding: 5px; border-radius: ${colors.borderRadius}; transition: background-color 0.2s, border-color 0.2s; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${colors.headingColor};">
                                    <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div id="simalyze-modal-body">
                        <div style="background: rgba(0,0,0,0.02); border: 1px solid ${colors.sectionBorder}; padding: 16px; border-radius: ${colors.borderRadius};">
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

                        <div style="background: rgba(0,0,0,0.02); border: 1px solid ${colors.sectionBorder}; padding: 16px; border-radius: ${colors.borderRadius};">
                            <h3 style="font-size: 16px; font-weight: bold; color: ${colors.headingColor}; margin: 0 0 12px 0;">Appearance</h3>
                            <div style="display: flex; flex-direction: column; gap: 16px;">
                                <div>
                                    <label for="custom-css-textarea" style="font-size: 14px; color: ${colors.textColor}; display: block; margin-bottom: 8px;">Custom CSS</label>
                                    <textarea id="custom-css-textarea" class="simalyze-textarea" placeholder="Enter your custom CSS here..."></textarea>
                                    <div style="display: flex; gap: 8px; margin-top: 8px;">
                                        <button id="apply-css-button" class="simalyze-modal-button" style="flex-grow: 1; background: ${colors.buttonBg}; border: ${colors.thinStroke} solid ${colors.buttonBorder}; font-size: 13px; cursor: pointer; color: ${colors.textColor}; padding: 6px 12px; border-radius: ${colors.borderRadius};">Apply & Save</button>
                                            <button id="clear-css-button" class="simalyze-modal-button" style="background: ${colors.buttonBg}; border: ${colors.thinStroke} solid ${colors.buttonBorder}; font-size: 13px; cursor: pointer; color: ${colors.textColor}; padding: 6px 12px; border-radius: ${colors.borderRadius};">Clear</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style="background: rgba(0,0,0,0.02); border: 1px solid ${colors.sectionBorder}; padding: 16px; border-radius: ${colors.borderRadius};">
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
                            border: ${colors.thinStroke} solid ${colors.buttonBorder};
                            border-radius: ${colors.borderRadius};
                            padding: 8px 15px;
                            font-size: 14px;
                            cursor: pointer;
                            color: ${colors.textColor};
                            transition: background-color 0.2s, border-color 0.2s;
                            padding-left: 15px;
                            padding-right: 15px;
                        ">Visit My Profile</button>
                    </div>
                </div>
            </div>
        `;
        shadowRoot.innerHTML = modalHTML;

        const closeButton = shadowRoot.getElementById('simalyze-close-button');
        const infoButton = shadowRoot.getElementById('simalyze-info-button');
        const analyzerModeCheckbox = shadowRoot.getElementById('analyzer-mode-checkbox');
        const slopRemover2Checkbox = shadowRoot.getElementById('slop-remover-2-checkbox');
        const highlightGoodProjectsCheckbox = shadowRoot.getElementById('highlight-good-projects-checkbox');
        const highlightThresholdSlider = shadowRoot.getElementById('highlight-threshold-slider');
        const highlightThresholdValueSpan = shadowRoot.getElementById('highlight-threshold-value');
        const visitProfileButton = shadowRoot.getElementById('visit-profile-button');

        closeButton.onclick = () => {
            shadowRoot.getElementById('simalyze-settings-modal-container').style.display = 'none';
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
        if (infoModalHost) {
            const container = infoModalHost.shadowRoot.getElementById('simalyze-info-modal-container');
            container.style.display = 'flex';
            return;
        }

        const colors = getCurrentThemeProperties();

        infoModalHost = document.createElement('div');
        infoModalHost.id = 'simalyze-info-modal-host';
        document.body.appendChild(infoModalHost);

        const shadowRoot = infoModalHost.attachShadow({ mode: 'open' });

        /* @tweakable Maximum width of the info modal */
        const infoModalMaxWidth = '550px';
        /* @tweakable Padding for the info modal content on desktop */
        const infoModalPadding = '24px';
        /* @tweakable Padding for the info modal content on mobile */
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
                    border: ${colors.thinStroke} solid ${colors.modalBorder};
                    max-height: 90vh;
                }

                #simalyze-info-modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding-bottom: 16px;
                    border-bottom: ${colors.thinStroke} solid ${colors.sectionBorder};
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
                        <button id="simalyze-info-close-button" class="simalyze-modal-button" style="background: ${colors.buttonBg}; border: ${colors.thinStroke} solid ${colors.buttonBorder}; font-size: 20px; cursor: pointer; color: ${colors.headingColor}; padding: 5px; border-radius: ${colors.borderRadius}; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
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

        const infoCloseButton = shadowRoot.getElementById('simalyze-info-close-button');
        infoCloseButton.onclick = () => {
            shadowRoot.getElementById('simalyze-info-modal-container').style.display = 'none';
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
                .simalyze-modal-button:hover {
                    background-color: ${colors.buttonHover} !important;
                    border-color: ${colors.buttonHover} !important;
                }
            </style>
            <div id="simalyze-details-modal-container" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; align-items: center; z-index: 10002; font-family: 'Montserrat', sans-serif; overflow: auto;">
                <div id="simalyze-details-modal-content" style="background: ${colors.mainBg}; padding: 10px; border-radius: ${colors.borderRadius}; box-shadow: ${colors.modalShadow}; width: 90%; max-width: 600px; max-height: 90vh; box-sizing: border-box; position: relative; display: flex; flex-direction: column; border: ${colors.thinStroke} solid ${colors.modalBorder};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <h2 style="font-size: 20px; font-weight: bold; color: ${colors.headingColor};">Analysis: ${projectTitle}</h2>
                        <button id="simalyze-details-close-button" class="simalyze-modal-button" style="background: ${colors.buttonBg}; border: ${colors.thinStroke} solid ${colors.buttonBorder}; font-size: 24px; cursor: pointer; color: ${colors.headingColor}; padding: 5px; border-radius: ${colors.borderRadius}; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s, border-color 0.2s;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: ${colors.headingColor};">
                                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div style="flex-grow: 1; overflow-y: auto; padding-bottom: 5px; display: flex; flex-direction: column; gap: 10px;">
                        <div style="text-align: center; margin-bottom: 10px; padding-bottom: 10px; border-bottom: ${colors.thinStroke} solid ${colors.sectionBorder};">
                            <h3 style="font-size: 18px; font-weight: bold; color: ${colors.headingColor}; margin-bottom: 5px;">Composite Quality Score</h3>
                            <div style="font-size: 48px; font-weight: 700; color: ${typeof analysisResult.compositeScore === 'number' ? (analysisResult.compositeScore > 70 ? colors.scoreGood : (analysisResult.compositeScore < 50 ? colors.scoreBad : colors.scoreNeutral)): colors.scoreNeutral};">
                                ${analysisResult.compositeScore}
                            </div>
                            <p style="font-size: 14px; color: ${colors.textColor}; margin-top: 5px;">${analysisResult.summary || 'No summary available.'}</p>
                        </div>
                        <div style="padding-top: 10px; border-top: ${colors.thinStroke} solid ${colors.sectionBorder};">
                            <h3 style="font-size: 16px; font-weight: bold; color: ${colors.headingColor}; margin-bottom: 10px;">Scoring Breakdown</h3>
                            ${breakdownHTML}
                        </div>
                    </div>
                </div>
            </div>
        `;
        shadowRoot.innerHTML = detailsModalHTML;

        const detailsCloseButton = shadowRoot.getElementById('simalyze-details-close-button');
        detailsCloseButton.onclick = () => {
            shadowRoot.getElementById('simalyze-details-modal-container').style.display = 'none';
        };
        detailsCloseButton.onmouseover = () => { detailsCloseButton.style.backgroundColor = colors.buttonHover; };
        detailsCloseButton.onmouseout = () => { detailsCloseButton.style.backgroundColor = colors.buttonBg; };

        shadowRoot.getElementById('simalyze-details-modal-container').style.display = 'flex';
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
                border: ${colors.thinStroke} solid ${colors.buttonBorder};
                border-radius: ${colors.borderRadius};
                color: ${colors.textColor};
                padding: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background-color 0.2s, border-color 0.2s, transform 0.2s;
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
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0 .73 2.73l.22.38a2 2 0 0 0-2.73.73l.15.08a2 2 0 0 1-2 0l.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
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
